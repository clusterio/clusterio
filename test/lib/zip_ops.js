"use strict";
const assert = require("assert").strict;
const JSZip = require("jszip");

const { findRoot } = require("@clusterio/lib/zip_ops");


describe("lib/factorio", function() {
	describe("findRoot()", function() {
		it("should find the root of a zip", function() {
			let zip = new JSZip();
			zip.file("root/foo.txt", "");
			zip.file("root/bar.txt", "");

			assert.equal(findRoot(zip), "root");
		});

		it("should throw if files are at the root of the zip", function() {
			let zip = new JSZip();
			zip.file("root/foo.txt", "");
			zip.file("bar.txt", "");

			assert.throws(
				() => findRoot(zip),
				new Error("Zip contains file 'bar.txt' in root dir")
			);
		});

		it("should throw if there are multiple root dirs", function() {
			let zip = new JSZip();
			zip.file("root-1/foo.txt", "");
			zip.file("root-2/bar.txt", "");

			assert.throws(
				() => findRoot(zip),
				new Error("Zip contains multiple root folders")
			);
		});

		it("should throw if given an empty zip file", function() {
			let zip = new JSZip();

			assert.throws(
				() => findRoot(zip),
				new Error("Empty zip file")
			);
		});
	});
});
