import t from "tap";
import * as lib from "@clusterio/lib";

// Each error class with its base class and the code it sets, if any
const classes: [new (message: string) => Error, new (...args: any[]) => Error, string | undefined][] = [
	[lib.CommandError, Error, "CommandError"],
	[lib.InstallationError, Error, "InstallationError"],
	[lib.ClientError, Error, undefined],
	[lib.ValidationError, lib.ClientError, undefined],
	[lib.InvalidValueError, lib.ValidationError, undefined],
	[lib.InvalidFieldError, lib.ValidationError, undefined],
	[lib.ForbiddenError, lib.ClientError, undefined],
	[lib.PermissionError, lib.ForbiddenError, undefined],
	[lib.InvalidAccessError, lib.ForbiddenError, undefined],
	[lib.NotFoundError, lib.ClientError, undefined],
	[lib.TimeoutError, lib.ClientError, undefined],
	[lib.ConflictError, lib.ClientError, undefined],
	[lib.ServerError, Error, undefined],
	[lib.InternalServerError, lib.ServerError, undefined],
	[lib.UnavailableError, lib.ServerError, undefined],
	[lib.InvalidMessage, lib.ValidationError, "InvalidMessage"],
	[lib.SessionLost, Error, "SessionLost"],
	[lib.WebSocketError, Error, "WebSocketError"],
	[lib.AuthenticationFailed, lib.WebSocketError, "AuthenticationFailed"],
	[lib.ProtocolError, lib.WebSocketError, "ProtocolError"],
	[lib.PolicyViolation, lib.WebSocketError, "PolicyViolation"],
	[lib.StartupError, Error, "StartupError"],
	[lib.EnvironmentError, Error, "EnvironmentError"],
];

t.test("error classes", async t1 => {
	for (const [ErrorClass, Base, code] of classes) {
		t1.test(ErrorClass.name, async t2 => {
			const err = new ErrorClass("failed");
			t2.ok(err instanceof Base, `extends ${Base.name}`);
			t2.equal(err.name, ErrorClass.name);
			t2.notOk(Object.hasOwn(err, "name"), "name comes from the prototype");
			t2.equal(err.message, "failed");
			t2.equal(err.stack!.split("\n")[0], `${ErrorClass.name}: failed`);
			t2.equal((err as any).code, code);
		});
	}
});

t.test("InvalidMessage", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("appends validation errors to the stack", async t3 => {
			const errors = [{ instancePath: "/value", message: "must be number" }];
			const err = new lib.InvalidMessage("Request Test failed validation", errors);
			t3.equal(err.errors, errors);
			t3.equal(err.message, "Request Test failed validation");
			t3.ok(err.stack!.startsWith("InvalidMessage: Request Test failed validation\n"));
			t3.ok(err.stack!.endsWith(`\n${JSON.stringify(errors, null, "\t")}`));
		});
		t2.test("leaves the stack alone without errors", async t3 => {
			for (const errors of [undefined, null]) {
				const err = new lib.InvalidMessage("Unrecognized request Test", errors);
				t3.equal(err.errors, errors);
				t3.notMatch(err.stack!, "\n[");
			}
		});
	});
});

t.test("PluginError", async t1 => {
	t1.test("constructor", async t2 => {
		t2.test("wraps the original error", async t3 => {
			const original = new TypeError("bad");
			const err = new lib.PluginError("my_plugin", original);
			t3.equal(err.name, "PluginError");
			t3.equal(err.code, "PluginError");
			t3.equal(err.pluginName, "my_plugin");
			t3.equal(err.original, original);
			t3.equal(err.message, "PluginError: bad");
		});
	});
});
