"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const { testRoundTripJsonSerialisable } = require("../../common");

describe("lib/data/Note", function() {
	describe("class Note", function() {
		it("should derive its id from the resource type and id", function() {
			const note = new lib.Note("host", "12", "Runs on the basement box");
			assert.equal(note.id, "host/12");
			assert.equal(lib.Note.idFor("instance", 4), "instance/4");
		});
		it("should round trip serialize", function() {
			testRoundTripJsonSerialisable(lib.Note, [
				["host", "1", "text"],
				["user", "player", "multi\nline", "admin"],
				["mod", "mod_1.0.0", "text", "admin", 1234],
				["save", "1/world.zip", "text", "", 1234, true],
			]);
		});
		it("should omit default optional fields from json", function() {
			const note = new lib.Note("role", "5", "text");
			assert.deepEqual(note.toJSON(), { resourceType: "role", resourceId: "5", content: "text" });
		});
	});
});
