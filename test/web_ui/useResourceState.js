import assert from "node:assert/strict";

import { getResourceStatus } from "../../packages/web_ui/src/util/useResourceState.ts";

describe("web_ui/util/useResourceState", function() {
	describe("getResourceStatus()", function() {
		const error = new Error("Permission denied");

		it("should be ok when the resource exists", function() {
			assert.equal(getResourceStatus(true, true, true, null), "ok");
		});
		it("should keep showing a resource after the subscription stopped syncing", function() {
			assert.equal(getResourceStatus(true, true, false, null), "ok");
			assert.equal(getResourceStatus(true, true, false, error), "ok");
		});
		it("should be loading until the subscription has synced", function() {
			assert.equal(getResourceStatus(false, false, false, null), "loading");
		});
		it("should be loading while resyncing a resource that was seen", function() {
			assert.equal(getResourceStatus(false, true, false, null), "loading");
		});
		it("should be missing when synced without having seen the resource", function() {
			assert.equal(getResourceStatus(false, false, true, null), "missing");
		});
		it("should be deleted when synced after having seen the resource", function() {
			assert.equal(getResourceStatus(false, true, true, null), "deleted");
		});
		it("should be error when the subscription failed", function() {
			assert.equal(getResourceStatus(false, false, false, error), "error");
			assert.equal(getResourceStatus(false, true, false, error), "error");
		});
		it("should ignore the error of an earlier attempt once synced", function() {
			assert.equal(getResourceStatus(false, false, true, error), "missing");
			assert.equal(getResourceStatus(false, true, true, error), "deleted");
		});
	});
});
