import stream from "node:stream";
import t from "tap";
import * as lib from "@clusterio/lib";

const nbsp = "\u{A0}";

// Resolves after pending promise callbacks and I/O callbacks have run
function settle() {
	return new Promise(resolve => { setImmediate(resolve); });
}

t.test("basicType()", async t1 => {
	t1.test("returns typeof for most values", async t2 => {
		t2.equal(lib.basicType("s"), "string");
		t2.equal(lib.basicType(undefined), "undefined");
		t2.equal(lib.basicType(7), "number");
		t2.equal(lib.basicType({ a: 1 }), "object");
		t2.equal(lib.basicType(true), "boolean");
		t2.equal(lib.basicType(() => {}), "function");
		t2.equal(lib.basicType(1n), "bigint");
	});
	t1.test("returns null and array for those values", async t2 => {
		t2.equal(lib.basicType(null), "null");
		t2.equal(lib.basicType([1, 2]), "array");
		t2.equal(lib.basicType([]), "array");
	});
});

t.test("wait()", async t1 => {
	t1.test("resolves after a timer of the given duration", async t2 => {
		const timers = t2.capture(globalThis, "setTimeout", ((fn: () => void) => { fn(); return 0; }) as any);
		t2.equal(await lib.wait(100), undefined);
		t2.equal(timers.calls.length, 1);
		t2.equal(timers.calls[0].args[1], 100);
	});
	t1.test("waits on a real timer", async t2 => {
		let done = false;
		const promise = lib.wait(5).then(() => { done = true; });
		await settle();
		t2.equal(done, false);
		await promise;
		t2.equal(done, true);
	});
});

t.test("timeout()", async t1 => {
	t1.test("returns the result of an already resolved promise", async t2 => {
		t2.equal(await lib.timeout(Promise.resolve("value"), 10, "timeout"), "value");
	});
	t1.test("returns the result if it arrives before the timeout", async t2 => {
		t2.equal(await lib.timeout(lib.wait(1).then(() => "value"), 1000, "timeout"), "value");
	});
	t1.test("returns timeoutResult if the promise takes too long", async t2 => {
		t2.equal(await lib.timeout(new Promise<string>(() => {}), 1, "timeout"), "timeout");
	});
	t1.test("passes on rejections", async t2 => {
		await t2.rejects(lib.timeout(Promise.reject(new Error("test")), 1000, "timeout"), new Error("test"));
	});
	t1.test("clears the timer when the promise settles first", async t2 => {
		const cleared = t2.capture(globalThis, "clearTimeout", clearTimeout);
		await lib.timeout(Promise.resolve("value"), 60_000, "timeout");
		t2.equal(cleared.calls.length, 1);
		t2.ok(cleared.calls[0].args[0], "a timer was cleared");
	});
});

t.test("createShutdownGuard()", async t1 => {
	// process.exit never returns, so the stand-in can throw to stop the guard
	function setup(t2: any, callback: () => Promise<unknown>, exitImpl = () => undefined as never) {
		const messages: [string, string][] = [];
		const logger = {
			info: (message: string) => { messages.push(["info", message]); },
			fatal: (message: string) => { messages.push(["fatal", message]); },
		} as unknown as lib.Logger;
		const exit = t2.capture(process, "exit", exitImpl);
		const guard = lib.createShutdownGuard(logger, "SIGINT", callback);
		return { guard, messages, exit };
	}

	t1.test("calls the callback on the first signal", async t2 => {
		let calls = 0;
		const { guard, messages, exit } = setup(t2, async () => { calls += 1; });
		guard();
		await settle();
		t2.equal(calls, 1);
		t2.strictSame(messages, [["info", "Caught SIGINT, shutting down"]]);
		t2.equal(exit.calls.length, 0);
	});
	t1.test("exits on the second signal", async t2 => {
		let calls = 0;
		const exited = new Error("exited");
		const { guard, messages, exit } = setup(
			t2, () => { calls += 1; return new Promise(() => {}); }, () => { throw exited; },
		);
		guard();
		t2.throws(() => guard(), exited);
		t2.equal(calls, 1);
		t2.strictSame(messages, [
			["info", "Caught SIGINT, shutting down"],
			["fatal", "Caught second SIGINT, terminating immediately"],
		]);
		t2.strictSame(exit.calls.map((call: any) => call.args), [[1]]);
	});
	t1.test("exits if the callback rejects", async t2 => {
		const error = new Error("test");
		const { guard, messages, exit } = setup(t2, async () => { throw error; });
		guard();
		await settle();
		t2.strictSame(messages, [
			["info", "Caught SIGINT, shutting down"],
			["fatal", "Error during shutdown, terminating immediately"],
			["fatal", error.stack],
		]);
		t2.strictSame(exit.calls.map((call: any) => call.args), [[1]]);
	});
});

t.test("AsyncSerialMergingCallback", async t1 => {
	// Callback that ends on the next tick and counts starts and ends
	function counted() {
		const counts = { started: 0, ended: 0 };
		const merger = new lib.AsyncSerialMergingCallback(
			() => new Promise(resolve => {
				counts.started += 1;
				process.nextTick(() => {
					counts.ended += 1;
					resolve();
				});
			})
		);
		return { counts, merger };
	}

	t1.test("invoke()", async t2 => {
		t2.test("calls the callback immediately and awaits it", async t3 => {
			const { counts, merger } = counted();
			const promise = merger.invoke();
			t3.strictSame(counts, { started: 1, ended: 0 });
			await promise;
			t3.strictSame(counts, { started: 1, ended: 1 });
		});
		t2.test("calls the callback again for an invoke while running", async t3 => {
			const { counts, merger } = counted();
			await Promise.all([merger.invoke(), merger.invoke()]);
			t3.strictSame(counts, { started: 2, ended: 2 });
		});
		t2.test("merges many invokes while running into one call", async t3 => {
			const { counts, merger } = counted();
			await Promise.all([merger.invoke(), merger.invoke(), merger.invoke(), merger.invoke()]);
			t3.strictSame(counts, { started: 2, ended: 2 });
		});
		t2.test("resolves invokes in order", async t3 => {
			const { merger } = counted();
			const events: number[] = [];
			await Promise.all([1, 2, 3, 4].map(n => merger.invoke().then(() => { events.push(n); })));
			t3.strictSame(events, [1, 2, 3, 4]);
		});
		t2.test("calls the callback again after it finished", async t3 => {
			const { counts, merger } = counted();
			await merger.invoke();
			await merger.invoke();
			t3.strictSame(counts, { started: 2, ended: 2 });
		});
		t2.test("rejects with the callback error and runs waiting invokes", async t3 => {
			let calls = 0;
			const merger = new lib.AsyncSerialMergingCallback(async () => {
				calls += 1;
				await settle();
				if (calls === 1) {
					throw new Error("first");
				}
			});
			const results = await Promise.allSettled([merger.invoke(), merger.invoke()]);
			t3.equal(calls, 2);
			t3.strictSame(results, [
				{ status: "rejected", reason: new Error("first") },
				{ status: "fulfilled", value: undefined },
			]);
		});
	});
});

t.test("AsyncSerialCallback", async t1 => {
	// Callback that ends on the next tick and rejects for 99
	function counted() {
		const counts = { started: 0, ended: 0 };
		const serialiser = new lib.AsyncSerialCallback(
			(input?: number) => new Promise<number | undefined>((resolve, reject) => {
				counts.started += 1;
				process.nextTick(() => {
					counts.ended += 1;
					if (input !== 99) {
						resolve(input);
					} else {
						reject(new Error("99"));
					}
				});
			})
		);
		return { counts, serialiser };
	}

	t1.test("invoke()", async t2 => {
		t2.test("calls the callback immediately and awaits it", async t3 => {
			const { counts, serialiser } = counted();
			const promise = serialiser.invoke();
			t3.strictSame(counts, { started: 1, ended: 0 });
			await promise;
			t3.strictSame(counts, { started: 1, ended: 1 });
		});
		t2.test("returns the result of the callback", async t3 => {
			const { serialiser } = counted();
			t3.equal(await serialiser.invoke(42), 42);
		});
		t2.test("calls the callback once per invoke", async t3 => {
			const { counts, serialiser } = counted();
			await Promise.all([serialiser.invoke(), serialiser.invoke(), serialiser.invoke(), serialiser.invoke()]);
			t3.strictSame(counts, { started: 4, ended: 4 });
		});
		t2.test("never overlaps calls", async t3 => {
			let running = 0;
			let maxRunning = 0;
			const serialiser = new lib.AsyncSerialCallback(async () => {
				running += 1;
				maxRunning = Math.max(maxRunning, running);
				await settle();
				running -= 1;
			});
			await Promise.all([serialiser.invoke(), serialiser.invoke(), serialiser.invoke()]);
			t3.equal(maxRunning, 1);
		});
		t2.test("serves invokes first in first out", async t3 => {
			const { serialiser } = counted();
			const events: number[] = [];
			const results = await Promise.all(
				[11, 12, 13, 14].map((n, i) => serialiser.invoke(n).then(res => { events.push(i + 1); return res; }))
			);
			t3.strictSame(events, [1, 2, 3, 4]);
			t3.strictSame(results, [11, 12, 13, 14]);
		});
		t2.test("passes on rejections", async t3 => {
			const { serialiser } = counted();
			await t3.rejects(serialiser.invoke(99), new Error("99"));
		});
		t2.test("continues with queued invokes after a rejection", async t3 => {
			const { serialiser } = counted();
			const events: number[] = [];
			const results = await Promise.allSettled(
				[11, 99, 13, 14].map((n, i) => serialiser.invoke(n).then(res => { events.push(i + 1); return res; }))
			);
			t3.strictSame(events, [1, 3, 4]);
			t3.strictSame(results, [
				{ status: "fulfilled", value: 11 },
				{ status: "rejected", reason: new Error("99") },
				{ status: "fulfilled", value: 13 },
				{ status: "fulfilled", value: 14 },
			]);
		});
	});
});

t.test("readStream()", async t1 => {
	t1.test("returns the content of the stream", async t2 => {
		const readable = stream.Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
		t2.strictSame(await lib.readStream(readable), Buffer.from("abcd"));
	});
	t1.test("returns an empty buffer for an empty stream", async t2 => {
		t2.strictSame(await lib.readStream(stream.Readable.from([])), Buffer.alloc(0));
	});
	t1.test("does not treat ^Z as the end outside of Windows", async t2 => {
		t2.intercept(process, "platform", { value: "linux" });
		const source = stream.Readable.from([Buffer.from("a"), Buffer.from("\x1a\r\n")]);
		const readable = Object.assign(source, { isTTY: true });
		t2.strictSame(await lib.readStream(readable), Buffer.from("a\x1a\r\n"));
	});
	t1.test("ends on ^Z from a Windows terminal", async t2 => {
		t2.intercept(process, "platform", { value: "win32" });
		const readable = Object.assign(
			stream.Readable.from([Buffer.from("a"), Buffer.from("\x1a\r\n"), Buffer.from("b")]),
			{ isTTY: true },
		);
		t2.strictSame(await lib.readStream(readable), Buffer.from("a"));
	});
	t1.test("does not treat ^Z as the end on Windows when not a terminal", async t2 => {
		t2.intercept(process, "platform", { value: "win32" });
		const readable = stream.Readable.from([Buffer.from("a"), Buffer.from("\x1a\r\n")]);
		t2.strictSame(await lib.readStream(readable), Buffer.from("a\x1a\r\n"));
	});
	t1.test("passes on stream errors", async t2 => {
		const readable = new stream.Readable({
			read() { this.destroy(new Error("test")); },
		});
		await t2.rejects(lib.readStream(readable), new Error("test"));
	});
});

t.test("splitOn()", async t1 => {
	t1.test("splits on the first separator", async t2 => {
		t2.strictSame(lib.splitOn(":", "a:b:c"), ["a", "b:c"]);
		t2.strictSame(lib.splitOn("::", "a::b::c"), ["a", "b::c"]);
	});
	t1.test("handles the separator at either end", async t2 => {
		t2.strictSame(lib.splitOn(":", ":a"), ["", "a"]);
		t2.strictSame(lib.splitOn(":", "a:"), ["a", ""]);
	});
	t1.test("returns the string and an empty string without a separator", async t2 => {
		t2.strictSame(lib.splitOn(":", "abc"), ["abc", ""]);
		t2.strictSame(lib.splitOn(":", ""), ["", ""]);
	});
});

t.test("escapeRegExp()", async t1 => {
	t1.test("escapes special characters", async t2 => {
		const special = "-[]{}()*+?.,\\^$|# \t";
		t2.equal(lib.escapeRegExp(special), special.replace(/./gs, "\\$&"));
	});
	t1.test("makes a RegExp that only matches the text", async t2 => {
		const text = "a.b*c(d)[e]{1,2}^$|+?\\ #";
		const regExp = new RegExp(`^${lib.escapeRegExp(text)}$`);
		t2.ok(regExp.test(text));
		t2.notOk(regExp.test(text.replace(".", "x")));
	});
	t1.test("leaves other text alone", async t2 => {
		t2.equal(lib.escapeRegExp("abc123_é"), "abc123_é");
	});
});

t.test("formatBytes()", async t1 => {
	t1.test("formats zero", async t2 => {
		t2.equal(lib.formatBytes(0), `0${nbsp}Bytes`);
		t2.equal(lib.formatBytes(0, "binary"), `0${nbsp}Bytes`);
	});
	t1.test("formats whole numbers of each SI unit", async t2 => {
		t2.equal(lib.formatBytes(1), `1.00${nbsp}Bytes`);
		t2.equal(lib.formatBytes(100), `100${nbsp}Bytes`);
		t2.equal(lib.formatBytes(100e3), `100${nbsp}kB`);
		t2.equal(lib.formatBytes(100e6), `100${nbsp}MB`);
		t2.equal(lib.formatBytes(100e9), `100${nbsp}GB`);
		t2.equal(lib.formatBytes(100e12), `100${nbsp}TB`);
	});
	t1.test("formats whole numbers of each binary unit", async t2 => {
		t2.equal(lib.formatBytes(100, "binary"), `100${nbsp}Bytes`);
		t2.equal(lib.formatBytes(100 * 2 ** 10, "binary"), `100${nbsp}kiB`);
		t2.equal(lib.formatBytes(100 * 2 ** 20, "binary"), `100${nbsp}MiB`);
		t2.equal(lib.formatBytes(100 * 2 ** 30, "binary"), `100${nbsp}GiB`);
		t2.equal(lib.formatBytes(100 * 2 ** 40, "binary"), `100${nbsp}TiB`);
	});
	t1.test("formats to 3 significant digits", async t2 => {
		const units = ["kB", "MB", "GB", "TB"];
		for (const [index, unit] of units.entries()) {
			const scale = 1000 ** (index + 1);
			t2.equal(lib.formatBytes(1.234 * scale), `1.23${nbsp}${unit}`);
			t2.equal(lib.formatBytes(12.34 * scale), `12.3${nbsp}${unit}`);
			t2.equal(lib.formatBytes(123.4 * scale), `123${nbsp}${unit}`);
		}
		const binaryUnits = ["kiB", "MiB", "GiB", "TiB"];
		for (const [index, unit] of binaryUnits.entries()) {
			const scale = 1024 ** (index + 1);
			t2.equal(lib.formatBytes(1.234 * scale, "binary"), `1.23${nbsp}${unit}`);
			t2.equal(lib.formatBytes(12.34 * scale, "binary"), `12.3${nbsp}${unit}`);
			t2.equal(lib.formatBytes(123.4 * scale, "binary"), `123${nbsp}${unit}`);
		}
	});
	t1.test("switches unit at the base", async t2 => {
		t2.equal(lib.formatBytes(999), `999${nbsp}Bytes`);
		t2.equal(lib.formatBytes(1000), `1.00${nbsp}kB`);
		t2.equal(lib.formatBytes(1023, "binary"), `1023${nbsp}Bytes`);
		t2.equal(lib.formatBytes(1024, "binary"), `1.00${nbsp}kiB`);
	});
	t1.test("keeps using TB above 1000 TB", async t2 => {
		t2.equal(lib.formatBytes(1e15), `1000${nbsp}TB`);
		t2.equal(lib.formatBytes(2 ** 50, "binary"), `1024${nbsp}TiB`);
	});
	t1.test("formats fractions of a byte", async t2 => {
		t2.equal(lib.formatBytes(0.5), `0.50${nbsp}Bytes`);
	});
	t1.test("moves to the next unit when rounding reaches the base", async t2 => {
		t2.equal(lib.formatBytes(999.96e3), `1.00${nbsp}MB`);
	});
});

t.test("redactUrl()", async t1 => {
	t1.test("redacts the value of each credential parameter", async t2 => {
		t2.equal(
			lib.redactUrl("https://mods.factorio.com/download/mod?username=user&token=secret"),
			"https://mods.factorio.com/download/mod?username=user&token=REDACTED",
		);
		for (const name of ["access_token", "api_key", "apikey", "code", "password", "secret", "token"]) {
			t2.equal(lib.redactUrl(`https://example.com/?${name}=secret`), `https://example.com/?${name}=REDACTED`);
		}
	});
	t1.test("matches names case insensitively", async t2 => {
		t2.equal(lib.redactUrl("https://example.com/?Token=secret"), "https://example.com/?Token=REDACTED");
		t2.equal(lib.redactUrl("https://example.com/?API_KEY=secret"), "https://example.com/?API_KEY=REDACTED");
	});
	t1.test("redacts every occurrence of a repeated parameter", async t2 => {
		t2.equal(
			lib.redactUrl("https://example.com/?token=first&token=second"),
			"https://example.com/?token=REDACTED&token=REDACTED",
		);
	});
	t1.test("does not match parameter names partially", async t2 => {
		t2.equal(lib.redactUrl("https://example.com/?tokens=1&mytoken=2"), "https://example.com/?tokens=1&mytoken=2");
	});
	t1.test("keeps the hash", async t2 => {
		t2.equal(lib.redactUrl("https://example.com/p?token=x#top"), "https://example.com/p?token=REDACTED#top");
		t2.equal(lib.redactUrl("/p?token=x#top"), "/p?token=REDACTED#top");
	});
	t1.test("accepts a URL object", async t2 => {
		t2.equal(
			lib.redactUrl(new URL("https://example.com/path?token=secret")),
			"https://example.com/path?token=REDACTED",
		);
		t2.equal(lib.redactUrl(new URL("https://example.com/path?a=1")), "https://example.com/path?a=1");
	});
	t1.test("leaves URLs without credentials untouched", async t2 => {
		t2.equal(lib.redactUrl("https://example.com/path"), "https://example.com/path");
		t2.equal(lib.redactUrl("https://example.com/?page=2"), "https://example.com/?page=2");
		t2.equal(lib.redactUrl("https://example.com/?a=%20b"), "https://example.com/?a=%20b");
	});
	t1.test("returns unparsable input unchanged", async t2 => {
		t2.equal(lib.redactUrl("not a url?token=secret"), "not a url?token=secret");
		t2.equal(lib.redactUrl(""), "");
	});
	t1.test("redacts a path and returns a path", async t2 => {
		t2.equal(
			lib.redactUrl("/api/plugin/callback?code=secret&state=abc"),
			"/api/plugin/callback?code=REDACTED&state=abc",
		);
		t2.equal(lib.redactUrl("/api/plugin?page=2"), "/api/plugin?page=2");
		t2.equal(lib.redactUrl("/search?q=a%20b"), "/search?q=a%20b");
	});
	t1.test("redacts a request path starting with //", async t2 => {
		t2.notMatch(lib.redactUrl("//api/plugin?token=secret"), "secret");
	});
});

t.test("safeExternalUrl()", async t1 => {
	t1.test("returns http and https URLs", async t2 => {
		t2.equal(lib.safeExternalUrl("https://example.com/path?q=1#top"), "https://example.com/path?q=1#top");
		t2.equal(lib.safeExternalUrl("http://example.com"), "http://example.com/");
		t2.equal(lib.safeExternalUrl(" https://example.com/ "), "https://example.com/");
	});
	t1.test("rejects other protocols", async t2 => {
		/* eslint-disable no-script-url */
		for (const link of [
			"javascript:alert(1)",
			"JavaScript:alert(1)",
			" javascript:alert(1)",
			"java\tscript:alert(1)",
			"\u0001javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"vbscript:msgbox(1)",
			"file:///etc/passwd",
			"ftp://example.com/",
		]) {
			t2.equal(lib.safeExternalUrl(link), undefined, link);
		}
		/* eslint-enable no-script-url */
	});
	t1.test("rejects values that are not URLs", async t2 => {
		for (const link of [undefined, null, 1, {}, { url: 1 }, "", "not a url", "/relative", "owner/repo"]) {
			t2.equal(lib.safeExternalUrl(link), undefined, String(link));
		}
	});
	t1.test("accepts npm repository objects", async t2 => {
		t2.equal(
			lib.safeExternalUrl({ type: "git", url: "git+https://github.com/owner/repo.git" }),
			"https://github.com/owner/repo",
		);
		// eslint-disable-next-line no-script-url
		t2.equal(lib.safeExternalUrl({ type: "git", url: "javascript:alert(1)" }), undefined);
	});
	t1.test("converts git URLs to https", async t2 => {
		for (const link of [
			"git+https://github.com/owner/repo.git",
			"git+http://github.com/owner/repo.git",
			"git://github.com/owner/repo.git",
			"git+ssh://git@github.com/owner/repo.git",
			"ssh://git@github.com/owner/repo.git",
			"git@github.com:owner/repo.git",
			"git@github.com:owner/repo",
		]) {
			t2.equal(lib.safeExternalUrl(link), "https://github.com/owner/repo", link);
		}
	});
	t1.test("does not treat host:/path as an scp style URL", async t2 => {
		t2.equal(lib.safeExternalUrl("git@github.com:/owner/repo"), undefined);
	});
	t1.test("expands repository shorthands", async t2 => {
		t2.equal(lib.safeExternalUrl("github:owner/repo"), "https://github.com/owner/repo");
		t2.equal(lib.safeExternalUrl("gitlab:owner/repo"), "https://gitlab.com/owner/repo");
		t2.equal(lib.safeExternalUrl("bitbucket:owner/repo"), "https://bitbucket.org/owner/repo");
		t2.equal(lib.safeExternalUrl("github://evil.example/x"), "https://github.com/evil.example/x");
	});
	t1.test("removes credentials", async t2 => {
		t2.equal(lib.safeExternalUrl("https://user:secret@example.com/"), "https://example.com/");
		t2.equal(lib.safeExternalUrl("git+https://user:secret@example.com/repo.git"), "https://example.com/repo");
	});
});

t.test("redactQuery()", async t1 => {
	t1.test("redacts credential parameters and keeps the rest", async t2 => {
		const query = { code: "secret", Token: ["a", "b"], state: "abc" };
		t2.strictSame(lib.redactQuery(query), { code: "REDACTED", Token: "REDACTED", state: "abc" });
	});
	t1.test("does not modify the input", async t2 => {
		const query = { code: "secret" };
		lib.redactQuery(query);
		t2.strictSame(query, { code: "secret" });
	});
	t1.test("returns a copy of an empty query", async t2 => {
		const query = {};
		const result = lib.redactQuery(query);
		t2.strictSame(result, {});
		t2.not(result, query);
	});
});

function word(value: string, opts: { exclude?: boolean } = {}): lib.ParsedWord {
	return { type: "word", value, ...opts };
}
function attr(name: string, value: string | lib.ParsedWord): lib.ParsedAttribute {
	return { type: "attribute", name, value: typeof value === "string" ? word(value) : value };
}
function parse(input: string, attributes?: Record<string, string>) {
	return lib.parseSearchString(input, attributes);
}
function terms(...items: lib.ParsedTerm[]) {
	return { terms: items, issues: [] };
}

t.test("parseSearchString()", async t1 => {
	t1.test("splits words", async t2 => {
		t2.strictSame(parse(""), terms());
		t2.strictSame(parse("word"), terms(word("word")));
		t2.strictSame(parse("some words here"), terms(word("some"), word("words"), word("here")));
	});
	t1.test("trims whitespace", async t2 => {
		t2.strictSame(parse("   "), terms());
		t2.strictSame(parse("word  "), terms(word("word")));
		t2.strictSame(parse("   some  words    here"), terms(word("some"), word("words"), word("here")));
	});
	t1.test("parses negated words", async t2 => {
		t2.strictSame(parse("this -that"), terms(word("this"), word("that", { exclude: true })));
		t2.strictSame(parse("not-negated"), terms(word("not-negated")));
		t2.strictSame(parse('-"a b"'), terms(word("a b", { exclude: true })));
	});
	t1.test("does not split quoted words", async t2 => {
		t2.strictSame(parse('"some quoted words" here'), terms(word("some quoted words"), word("here")));
		t2.strictSame(parse('words "a quoted string"'), terms(word("words"), word("a quoted string")));
	});
	t1.test("splits on quotation marks", async t2 => {
		t2.strictSame(parse('"quoted"unquoted'), terms(word("quoted"), word("unquoted")));
		t2.strictSame(parse('"quoted""double"'), terms(word("quoted"), word("double")));
		t2.strictSame(parse('word"with"quote'), terms(word("word"), word("with"), word("quote")));
		t2.strictSame(
			parse('word-"with"-negation'),
			terms(word("word-"), word("with"), word("negation", { exclude: true })),
		);
	});
	t1.test("allows colons in quotes", async t2 => {
		t2.strictSame(parse('"word:value"'), terms(word("word:value")));
	});
	t1.test("parses attribute:value", async t2 => {
		const attributes = { author: "word" };
		t2.strictSame(parse("author:Me", attributes), terms(attr("author", "Me")));
		t2.strictSame(parse("word author:Me", attributes), terms(word("word"), attr("author", "Me")));
		t2.strictSame(
			parse("author:Me and author:You", attributes),
			terms(attr("author", "Me"), word("and"), attr("author", "You")),
		);
		t2.strictSame(parse('author:"Me and You"', attributes), terms(attr("author", "Me and You")));
		t2.strictSame(parse("author:-Me", attributes), terms(attr("author", word("Me", { exclude: true }))));
	});
	t1.test("reports unrecognised attributes", async t2 => {
		t2.strictSame(parse("author:Me"), {
			terms: [word("Me")],
			issues: ['Unregonized attribute "author", use quotes to escape colons'],
		});
		t2.strictSame(parse("constructor:value"), {
			terms: [word("value")],
			issues: ['Unregonized attribute "constructor", use quotes to escape colons'],
		});
		t2.strictSame(parse(":value"), {
			terms: [word("value")],
			issues: ['Unregonized attribute "", use quotes to escape colons'],
		});
	});
	t1.test("throws on a bad attribute format", async t2 => {
		t2.throws(() => parse("author:Me", { author: "bad" }), new Error("Bad attribute format bad for author"));
	});
	t1.test("ignores attribute case", async t2 => {
		for (const name of ["Author", "AUTHOR", "auThOR"]) {
			t2.strictSame(parse(`${name}:Me`, { author: "word" }), terms(attr("author", "Me")));
		}
	});
	t1.test("parses partial inputs", async t2 => {
		t2.strictSame(parse("-"), terms(word("", { exclude: true })));
		t2.strictSame(parse('"'), terms(word("")));
		t2.strictSame(parse('"word'), terms(word("word")));
		t2.strictSame(parse("author:", { author: "word" }), terms(attr("author", "")));
		t2.strictSame(parse("author:-", { author: "word" }), terms(attr("author", word("", { exclude: true }))));
	});
});

t.test("wordMatches()", async t1 => {
	t1.test("matches if any text contains the word", async t2 => {
		t2.ok(lib.wordMatches(word("word"), "a word in a string"));
		t2.notOk(lib.wordMatches(word("word"), "a string without"));
		t2.ok(lib.wordMatches(word("word"), "no match", "no things", "a word", "bad text", ""));
		t2.notOk(lib.wordMatches(word("unword"), "no match", "no things", "a word", "bad text", ""));
	});
	t1.test("inverts the match for excluded words", async t2 => {
		const excluded = word("word", { exclude: true });
		t2.notOk(lib.wordMatches(excluded, "a word in a string"));
		t2.ok(lib.wordMatches(excluded, "a string without"));
		t2.notOk(lib.wordMatches(excluded, "no match", "a word"));
	});
	t1.test("handles no texts", async t2 => {
		t2.notOk(lib.wordMatches(word("word")));
		t2.ok(lib.wordMatches(word("word", { exclude: true })));
	});
	t1.test("matches case sensitively", async t2 => {
		t2.notOk(lib.wordMatches(word("Word"), "a word"));
	});
	t1.test("throws for attributes", async t2 => {
		t2.throws(
			() => lib.wordMatches(attr("attr", "value"), "a string"),
			new Error("wordMatches: parameter is not a word"),
		);
	});
});

t.test("parseRanges()", async t1 => {
	function range(input: string, min = 1, max = 10) {
		return [...lib.parseRanges(input, min, max)];
	}
	function expectedRange(start: number, end: number) {
		return Array.from({ length: end - start + 1 }, (_, i) => start + i);
	}
	t1.test("parses an empty input", async t2 => {
		t2.strictSame(range(""), []);
		t2.strictSame(range("   "), []);
	});
	t1.test("parses numbers separated by spaces or commas", async t2 => {
		t2.strictSame(range("1"), [1]);
		t2.strictSame(range(" 1 "), [1]);
		t2.strictSame(range("1 2"), [1, 2]);
		t2.strictSame(range("1,2"), [1, 2]);
		t2.strictSame(range("1, 2"), [1, 2]);
		t2.strictSame(range("1 , 2"), [1, 2]);
		t2.strictSame(range("1,"), [1]);
	});
	t1.test("parses ranges", async t2 => {
		t2.strictSame(range("1-4"), [1, 2, 3, 4]);
		t2.strictSame(range(" 1 - 4 "), [1, 2, 3, 4]);
		t2.strictSame(range("1- 4"), [1, 2, 3, 4]);
		t2.strictSame(range("1 -4"), [1, 2, 3, 4]);
		t2.strictSame(range(" 1, 2-4"), [1, 2, 3, 4]);
		t2.strictSame(range("5-5"), [5]);
	});
	t1.test("accepts reversed ranges", async t2 => {
		t2.strictSame(range("4-1"), [1, 2, 3, 4]);
	});
	t1.test("ignores duplicates", async t2 => {
		t2.strictSame(range("1, 2, 2, 2"), [1, 2]);
		t2.strictSame(range("1-4, 3, 4"), [1, 2, 3, 4]);
		t2.strictSame(range("3, 1-4"), [3, 1, 2, 4]);
	});
	t1.test("accepts the min and max values", async t2 => {
		t2.strictSame(range("1, 10"), [1, 10]);
		t2.strictSame(range("1-10"), expectedRange(1, 10));
	});
	t1.test("throws on bad input", async t2 => {
		t2.throws(() => range("1-"), new Error('Expected digit but got end of input while parsing "1-"'));
		t2.throws(() => range("1 - "), new Error('Expected digit but got end of input while parsing "1 -"'));
		t2.throws(() => range("a1-4"), new Error("Expected digit but got 'a' at pos 0 while parsing \"a1-4\""));
		t2.throws(() => range("1a-4"), new Error("Expected digit but got 'a' at pos 1 while parsing \"1a-4\""));
		t2.throws(() => range("1-a4"), new Error("Expected digit but got 'a' at pos 2 while parsing \"1-a4\""));
		t2.throws(() => range("1-4a"), new Error("Expected digit but got 'a' at pos 3 while parsing \"1-4a\""));
		t2.throws(() => range("1,,2"), new Error("Expected digit but got ',' at pos 2 while parsing \"1,,2\""));
		t2.throws(() => range("-1"), new Error("Expected digit but got '-' at pos 0 while parsing \"-1\""));
	});
	t1.test("throws if out of range", async t2 => {
		t2.throws(() => range("0"), new Error("value 0 is below the minimum value 1"));
		t2.throws(() => range("110"), new Error("value 110 is above the maximum value 10"));
		t2.throws(() => range("1-999"), new Error("end of range 1-999 is above the maximum value 10"));
		t2.throws(() => range("0-1"), new Error("start of range 0-1 is below the minimum value 1"));
		t2.throws(() => range("1-0"), new Error("start of range 0-1 is below the minimum value 1"));
	});
	t1.test("handles 16-bit ranges", async t2 => {
		t2.strictSame(range("1-65535", 1, 2 ** 16 - 1), expectedRange(1, 2 ** 16 - 1));
		t2.strictSame(range("20000-20002", 1, 2 ** 16 - 1), [20000, 20001, 20002]);
	});
});
