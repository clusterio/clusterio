import t from "tap";
// @types/yargs is only a dev dependency of lib
// @ts-ignore
import yargs from "yargs";
import * as lib from "@clusterio/lib";
import { addr, linkPair } from "../shared/link.ts";

const control = addr({ controlId: 1 });
const controller = addr("controller");

// Control link whose controller end answers the list requests used by the resolvers
function controlLink() {
	const { link, peer } = linkPair(control, controller);
	peer.handle(lib.HostListRequest, async () => [
		new lib.HostDetails("0.1", "Test Host", 11, false),
		new lib.HostDetails("0.1", "22", 12, false),
		new lib.HostDetails("0.1", "12", 13, false),
	]);
	peer.handle(lib.InstanceDetailsListRequest, async () => [
		new lib.InstanceDetails("Test Instance", 57, 4, undefined, "stopped", undefined),
		new lib.InstanceDetails("10", 58, 4, undefined, "stopped", undefined),
		new lib.InstanceDetails("58", 59, 4, undefined, "stopped", undefined),
	]);
	const modPacks = [["Test Pack", 3], ["7", 4], ["4", 5]].map(([name, id]) => {
		const modPack = new lib.ModPack();
		modPack.name = name as string;
		modPack.id = id as number;
		return modPack;
	});
	peer.handle(lib.ModPackListRequest, async () => modPacks);
	peer.handle(lib.RoleListRequest, async () => [
		new lib.Role(28, "Test Role", "Test"),
		new lib.Role(29, "77", "Numeric"),
		new lib.Role(30, "28", "Shadowed"),
	]);
	return link;
}

// yargs parser that neither exits the process nor prints
function parser() {
	return yargs([]).exitProcess(false).strict(false);
}

t.test("Command", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("takes the name from the first word of a string definition", async t3 => {
			const command = new lib.Command({ definition: ["start <instance>", "Start"], handler: async () => {} });
			t3.equal(command.name, "start");
			t3.strictSame(command.alias, []);
		});
		t2.test("takes the name and aliases from an array definition", async t3 => {
			const command = new lib.Command({
				definition: [["remove <id>", "rm", "delete"], "Remove"],
				handler: async () => {},
			});
			t3.equal(command.name, "remove");
			t3.strictSame(command.alias, ["rm", "delete"]);
		});
	});

	t1.test("register()", async t2 => {
		t2.test("adds the definition to yargs", async t3 => {
			const command = new lib.Command({
				definition: [["start <instance>", "go"], "Start", y => { y.option("save", { type: "string" }); }],
				handler: async () => {},
			});
			const y = parser();
			command.register(y);
			const args = await y.parse(["go", "foo", "--save", "bar.zip"]);
			t3.strictSame(args._, ["go"]);
			t3.equal(args.instance, "foo");
			t3.equal(args.save, "bar.zip");
		});
	});

	t1.test("run()", async t2 => {
		t2.test("calls the handler with args and ctl", async t3 => {
			const calls: unknown[][] = [];
			const command = new lib.Command({
				definition: ["start"],
				handler: async (args, ctl) => { calls.push([args, ctl]); },
			});
			const ctl = controlLink();
			const args = { instance: "foo" };
			await command.run(args, ctl);
			t3.equal(calls.length, 1);
			t3.equal(calls[0][0], args);
			t3.equal(calls[0][1], ctl);
		});
		t2.test("rejects with the handler's error", async t3 => {
			const command = new lib.Command({
				definition: ["start"],
				handler: async () => { throw new lib.CommandError("failed"); },
			});
			await t3.rejects(command.run({}, controlLink()), new lib.CommandError("failed"));
		});
	});
});

t.test("CommandTree", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("defaults alias to an empty list", async t3 => {
			const tree = new lib.CommandTree({ name: "instance", description: "Instance" });
			t3.equal(tree.name, "instance");
			t3.strictSame(tree.alias, []);
			t3.equal(tree.description, "Instance");
			t3.equal(tree.subCommands.size, 0);
		});
		t2.test("keeps given aliases", async t3 => {
			const tree = new lib.CommandTree({ name: "instance", alias: ["i"], description: "Instance" });
			t3.strictSame(tree.alias, ["i"]);
		});
		t2.test("rejects a non-string name", async t3 => {
			t3.throws(
				() => new lib.CommandTree({ name: 1 as any, description: "x" }),
				new Error("name must be a string")
			);
		});
	});

	t1.test("add() and get()", async t2 => {
		t2.test("finds commands by name and alias", async t3 => {
			const tree = new lib.CommandTree({ name: "instance", description: "Instance" });
			const command = new lib.Command({ definition: [["remove", "rm"]], handler: async () => {} });
			const sub = new lib.CommandTree({ name: "config", alias: ["cfg"], description: "Config" });
			tree.add(command);
			tree.add(sub);
			t3.equal(tree.get("remove"), command);
			t3.equal(tree.get("rm"), command);
			t3.equal(tree.get("config"), sub);
			t3.equal(tree.get("cfg"), sub);
			t3.equal(tree.get("missing"), undefined);
		});
		t2.test("rejects a duplicate name", async t3 => {
			const tree = new lib.CommandTree({ name: "instance", description: "Instance" });
			tree.add(new lib.Command({ definition: ["start"], handler: async () => {} }));
			t3.throws(
				() => tree.add(new lib.Command({ definition: ["start <x>"], handler: async () => {} })),
				new Error("Command start already exists")
			);
		});
		t2.test("rejects a name that is taken by an alias", async t3 => {
			const tree = new lib.CommandTree({ name: "instance", description: "Instance" });
			tree.add(new lib.Command({ definition: [["remove", "rm"]], handler: async () => {} }));
			t3.throws(
				() => tree.add(new lib.Command({ definition: ["rm"], handler: async () => {} })),
				new Error("Command rm already exists")
			);
		});
		t2.test("rejects an alias that is already taken", async t3 => {
			const tree = new lib.CommandTree({ name: "instance", description: "Instance" });
			tree.add(new lib.Command({ definition: ["start"], handler: async () => {} }));
			t3.throws(
				() => tree.add(new lib.Command({ definition: [["begin", "start"]], handler: async () => {} })),
				new Error("Alias start for command begin already exists")
			);
		});
	});

	t1.test("register()", async t2 => {
		function makeTree() {
			const tree = new lib.CommandTree({ name: "instance", alias: ["i"], description: "Instance commands" });
			tree.add(new lib.Command({
				definition: [["start <id>", "run"], "Start an instance"],
				handler: async () => {},
			}));
			const sub = new lib.CommandTree({ name: "config", description: "Config commands" });
			sub.add(new lib.Command({ definition: ["list <id>", "List config"], handler: async () => {} }));
			tree.add(sub);
			return tree;
		}
		t2.test("registers sub commands under the tree", async t3 => {
			const y = parser();
			makeTree().register(y);
			const args = await y.parse(["i", "run", "5"]);
			t3.strictSame(args._, ["i", "run"]);
			t3.equal(args.id, 5);
		});
		t2.test("registers nested trees", async t3 => {
			const y = parser();
			makeTree().register(y);
			const args = await y.parse(["instance", "config", "list", "5"]);
			t3.strictSame(args._, ["instance", "config", "list"]);
			t3.equal(args.id, 5);
		});
		t2.test("shows help listing each sub command once when no sub command is given", async t3 => {
			const errors = t3.capture(console, "error");
			const y = parser();
			makeTree().register(y);
			await y.parse(["instance"]);
			const help = errors.calls.map(call => call.args.join(" ")).join("\n");
			t3.match(help, "Start an instance");
			t3.match(help, "Config commands");
			t3.equal(help.split("Start an instance").length, 2, "start listed once despite its alias");
		});
	});
});

t.test("resolveHost()", async t1 => {
	t1.test("resolves an integer like string as an id", async t2 => {
		t2.equal(await lib.resolveHost(controlLink(), "11"), 11);
	});
	t1.test("resolves a host name", async t2 => {
		t2.equal(await lib.resolveHost(controlLink(), "Test Host"), 11);
	});
	t1.test("resolves an integer like name if no host has that id", async t2 => {
		t2.equal(await lib.resolveHost(controlLink(), "22"), 12);
	});
	t1.test("prefers the id over an integer like name", async t2 => {
		t2.equal(await lib.resolveHost(controlLink(), "12"), 12);
	});
	t1.test("rejects an unknown host", async t2 => {
		await t2.rejects(lib.resolveHost(controlLink(), "invalid"), new lib.CommandError("No host named invalid"));
		await t2.rejects(lib.resolveHost(controlLink(), "123"), new lib.CommandError("No host named 123"));
	});
});

t.test("resolveInstance()", async t1 => {
	t1.test("resolves an integer like string as an id", async t2 => {
		t2.equal(await lib.resolveInstance(controlLink(), "57"), 57);
	});
	t1.test("resolves an instance name", async t2 => {
		t2.equal(await lib.resolveInstance(controlLink(), "Test Instance"), 57);
	});
	t1.test("resolves an integer like name if no instance has that id", async t2 => {
		t2.equal(await lib.resolveInstance(controlLink(), "10"), 58);
	});
	t1.test("prefers the id over an integer like name", async t2 => {
		t2.equal(await lib.resolveInstance(controlLink(), "58"), 58);
	});
	t1.test("rejects an unknown instance", async t2 => {
		await t2.rejects(
			lib.resolveInstance(controlLink(), "invalid"),
			new lib.CommandError("No instance named invalid")
		);
	});
});

t.test("resolveModPack()", async t1 => {
	t1.test("resolves an integer like string as an id", async t2 => {
		t2.equal(await lib.resolveModPack(controlLink(), "3"), 3);
	});
	t1.test("resolves a mod pack name", async t2 => {
		t2.equal(await lib.resolveModPack(controlLink(), "Test Pack"), 3);
	});
	t1.test("resolves an integer like name if no mod pack has that id", async t2 => {
		t2.equal(await lib.resolveModPack(controlLink(), "7"), 4);
	});
	t1.test("prefers the id over an integer like name", async t2 => {
		t2.equal(await lib.resolveModPack(controlLink(), "4"), 4);
	});
	t1.test("resolves negative ids", async t2 => {
		const { link, peer } = linkPair(control, controller);
		const modPack = new lib.ModPack();
		modPack.id = -2;
		peer.handle(lib.ModPackListRequest, async () => [modPack]);
		t2.equal(await lib.resolveModPack(link, "-2"), -2);
	});
	t1.test("rejects an unknown mod pack", async t2 => {
		await t2.rejects(
			lib.resolveModPack(controlLink(), "invalid"),
			new lib.CommandError("No mod pack named invalid")
		);
	});
});

t.test("retrieveRole()", async t1 => {
	t1.test("retrieves a role by id", async t2 => {
		const role = await lib.retrieveRole(controlLink(), "28");
		t2.equal(role.id, 28);
		t2.equal(role.name, "Test Role");
	});
	t1.test("retrieves a role by name", async t2 => {
		t2.equal((await lib.retrieveRole(controlLink(), "Test Role")).id, 28);
	});
	t1.test("retrieves a role by an integer like name if no role has that id", async t2 => {
		t2.equal((await lib.retrieveRole(controlLink(), "77")).id, 29);
	});
	t1.test("returns a Role instance", async t2 => {
		t2.type(await lib.retrieveRole(controlLink(), "28"), lib.Role);
	});
	t1.test("rejects an unknown role", async t2 => {
		await t2.rejects(
			lib.retrieveRole(controlLink(), "invalid"),
			new lib.CommandError("No role named invalid")
		);
	});
});
