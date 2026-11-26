import t from "tap";
import * as lib from "@clusterio/lib";
import { checkSingletonImport } from "../../packages/lib/dist/node/src/check_singleton_import.js";

t.test("checkSingletonImport()", async t1 => {
	t1.test("records the location of the first import", async t2 => {
		t2.intercept(globalThis, "_clusterioLibImportedFrom", { value: undefined, writable: true });
		checkSingletonImport("/first/lib");
		t2.equal(globalThis._clusterioLibImportedFrom, "/first/lib");
	});
	t1.test("rejects a second import naming both locations", async t2 => {
		const first = globalThis._clusterioLibImportedFrom;
		t2.match(first, /lib[\\/]dist[\\/]node[\\/]index\.js$/, "lib import set the location");
		const err = t2.throws(() => checkSingletonImport("/second/lib")) as Error;
		t2.type(err, lib.InstallationError);
		t2.match(err.message, /^Attempt to import duplicate copy of @clusterio\/lib\n/);
		t2.match(err.message, `Previously imported @clusterio/lib was located at ${first}\n`);
		t2.match(err.message, /This copy of @clusterio\/lib is located at \/second\/lib$/);
		t2.equal(globalThis._clusterioLibImportedFrom, first);
	});
});
