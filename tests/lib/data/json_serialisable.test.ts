import t from "tap";
import * as lib from "@clusterio/lib";
import {
	type KnownSamples, jsonSamples, jsonSerialisableClasses, testJsonSerialisable,
} from "../../shared/json_serialisable.ts";

// Every JSON serialisable class exported by lib gets the common tests, so new
// classes are covered without adding anything here. Schemas the sample
// generator cannot satisfy get hand written samples, minimal first.
const known: KnownSamples = new Map<object, unknown[]>([
	[lib.ModInfo.jsonSchema, [
		{ name: "a", version: "1.0.0", title: "A", author: "b" },
		{
			name: "a", version: "1.0.0", title: "A", author: "b", contact: "c", homepage: "h", description: "d",
			factorio_version: "2.0", dependencies: ["base >= 2.0", "? b", "! c", "(?) d", "~ e"],
			size: 1, mtime_ms: 2, sha1: "s", updated_at_ms: 3, is_deleted: true,
		},
	]],
	[lib.ModDependency.jsonSchema, ["base", "? a > 1.0.0"]],
	[lib.ModVersionEquality.jsonSchema, ["= 1.0.0", ">= 2.1.0"]],
	[lib.SubscriptionRequest.jsonSchema, [
		["InstanceDetailsUpdatesEvent", "subscribe", 0],
		["InstanceDetailsUpdatesEvent", "replace", 10, ["a", "b"]],
	]],
]);

// Classes whose fromJSON needs more than the JSON value, they have their own tests.
const excluded = new Set([
	"Config",
	"ControllerConfig",
	"CtlConfig",
	"HostConfig",
	"InstanceConfig",
]);

// Known failures, reported as todo until fixed.
const todo = new Map([
	["InstanceDetailsChangedEvent", "has no toJSON, so it serialises as { details } instead of InstanceDetails"],
]);

for (const [name, Class] of jsonSerialisableClasses(lib)) {
	if (excluded.has(name)) {
		continue;
	}
	t.test(name, { todo: todo.get(name) }, async t1 => {
		testJsonSerialisable(t1, Class, jsonSamples(Class, known));
	});
}
