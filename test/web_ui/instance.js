import assert from "node:assert/strict";
import * as lib from "@clusterio/lib";

import { instanceModPack } from "../../packages/web_ui/src/util/instance.ts";

function modPack(id, name) {
	return lib.ModPack.fromJSON({ id, name, factorio_version: "2.0" });
}

describe("web_ui/util/instance", function() {
	describe("instanceModPack()", function() {
		const base = modPack(1, "Base");
		const space = modPack(2, "Space Age");
		const modPacks = new Map([[1, base], [2, space]]);

		it("should use the mod pack set on the instance", function() {
			assert.deepEqual(instanceModPack(2, modPacks, base), { id: 2, modPack: space, isDefault: false });
		});
		it("should keep the id of a mod pack that is not known", function() {
			assert.deepEqual(instanceModPack(9, modPacks, base), { id: 9, modPack: undefined, isDefault: false });
		});
		it("should fall back to the controller default", function() {
			assert.deepEqual(instanceModPack(undefined, modPacks, base), { id: 1, modPack: base, isDefault: true });
		});
		it("should prefer the subscribed copy of the default mod pack", function() {
			const stale = modPack(1, "Old name");
			assert.equal(instanceModPack(undefined, modPacks, stale).modPack, base);
			assert.equal(instanceModPack(undefined, new Map(), stale).modPack, stale);
		});
		it("should mark the default as unknown when it is not available", function() {
			assert.deepEqual(instanceModPack(undefined, modPacks, undefined), { isDefault: true });
		});
	});
});
