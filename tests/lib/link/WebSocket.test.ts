// The browser variant is the WebSocket global, the node variant is ws. Node.js
// has a browser compatible WebSocket global, so every case runs against both,
// using the parts of the API connectors.ts relies on.
import events from "node:events";
import { createRequire } from "node:module";
import net from "node:net";
import t, { type Test } from "tap";
import * as lib from "@clusterio/lib";
import { WebSocket as BrowserWebSocket } from "@clusterio/lib/dist/browser/src/link/WebSocket.browser.js";
import { WebSocket as NodeWebSocket } from "@clusterio/lib/dist/node/src/link/WebSocket.node.js";

// ws is a dependency of lib, not of the tests.
const require = createRequire(import.meta.resolve("@clusterio/lib/package.json"));
const { WebSocketServer } = require("ws");

const variants = [["node", NodeWebSocket], ["browser", BrowserWebSocket]] as const;
type AnyWebSocket = InstanceType<typeof NodeWebSocket> | InstanceType<typeof BrowserWebSocket>;

type ServerSocket = {
	send(data: string): void,
	close(code: number, reason: string): void,
	on(event: string, listener: (...args: any[]) => void): void,
};

/** Starts a ws server on a free port that echoes text messages back. */
async function startServer(test: Test) {
	const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	test.teardown(() => new Promise(resolve => server.close(resolve)));
	await new Promise(resolve => server.once("listening", resolve));
	const received: string[] = [];
	const closed = new Promise<{ code: number, reason: string }>(resolve => {
		server.on("connection", (socket: ServerSocket) => {
			socket.on("message", (data: Buffer, isBinary: boolean) => {
				received.push(isBinary ? "binary" : data.toString());
				socket.send(`echo ${data.toString()}`);
			});
			socket.on("close", (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
		});
	});
	const connection = new Promise<ServerSocket>(resolve => server.once("connection", resolve));
	return { url: new URL(`ws://127.0.0.1:${server.address().port}/api/socket`), received, closed, connection };
}

function waitForOpen(socket: AnyWebSocket) {
	return new Promise<void>((resolve, reject) => {
		socket.onopen = () => resolve();
		socket.onerror = () => reject(new Error("WebSocket error"));
	});
}

function waitForClose(socket: AnyWebSocket) {
	return new Promise<{ code: number, reason: string }>(resolve => {
		socket.onclose = (event: { code: number, reason: string }) => {
			resolve({ code: event.code, reason: event.reason });
		};
	});
}

function waitForMessage(socket: AnyWebSocket) {
	return new Promise<unknown>(resolve => {
		socket.onmessage = (event: { data: unknown }) => resolve(event.data);
	});
}

t.test("WebSocket", async t1 => {
	t1.test("browser variant is the global WebSocket", async t2 => {
		t2.equal(BrowserWebSocket, globalThis.WebSocket);
	});

	for (const [name, WebSocket] of variants) {
		t1.test(name, async t2 => {
			t2.test("has the readyState constants", async t3 => {
				t3.strictSame(
					[WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED],
					[0, 1, 2, 3],
				);
			});
			t2.test("connects to a URL object and exchanges text messages", async t3 => {
				const server = await startServer(t3);
				const socket = new WebSocket(server.url);
				await waitForOpen(socket);
				t3.equal(socket.readyState, WebSocket.OPEN);
				const message = waitForMessage(socket);
				socket.send("hello");
				t3.equal(await message, "echo hello", "text frames arrive as strings");
				t3.strictSame(server.received, ["hello"], "sent as a text frame");
				const closed = waitForClose(socket);
				socket.close();
				await closed;
			});
			t2.test("reports a close from the server", async t3 => {
				const server = await startServer(t3);
				const socket = new WebSocket(server.url);
				await waitForOpen(socket);
				const closed = waitForClose(socket);
				(await server.connection).close(lib.ConnectionClosed.Unauthorized, "Invalid token");
				t3.strictSame(await closed, { code: lib.ConnectionClosed.Unauthorized, reason: "Invalid token" });
			});
			t2.test("emits error then close with code 1006 when the connection fails", async t3 => {
				// Take a free port and release it so the connection is refused.
				const listener = net.createServer().listen(0, "127.0.0.1");
				await events.once(listener, "listening");
				const port = (listener.address() as net.AddressInfo).port;
				await new Promise(resolve => listener.close(resolve));
				const seen: string[] = [];
				const socket = new WebSocket(`ws://127.0.0.1:${port}/api/socket`);
				socket.onerror = () => { seen.push("error"); };
				const closed = waitForClose(socket);
				t3.equal((await closed).code, 1006);
				t3.strictSame(seen, ["error"]);
			});

			// Close codes the client side of connectors.ts sends. TryAgainLater
			// is only sent by the controller, as only it sets maxSendBufferSize.
			const clientCodes: [string, number][] = [
				["NormalClosure", lib.ConnectionClosed.NormalClosure],
				["Timeout", lib.ConnectionClosed.Timeout],
				["MalformedMessage", lib.ConnectionClosed.MalformedMessage],
			];
			for (const [codeName, code] of clientCodes) {
				t2.test(`closes with code ${codeName}`, async t3 => {
					const server = await startServer(t3);
					const socket = new WebSocket(server.url);
					await waitForOpen(socket);
					const closed = waitForClose(socket);
					socket.close(code, "reason");
					t3.strictSame(await closed, { code, reason: "reason" });
					t3.strictSame(await server.closed, { code, reason: "reason" });
				});
			}
		});
	}
});
