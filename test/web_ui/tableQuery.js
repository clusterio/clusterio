"use strict";
const assert = require("assert").strict;
const {
	parseOrder, parseSort, parsePagination, parseFilters,
	applySort, applyFilters, applyPagination,
} = require("@clusterio/web_ui/dist/browser/src/util/tableQuery");

// All helpers take the table namespace prefix (with trailing dot) as 2nd arg.
const P = "t.";

describe("web_ui/util/tableQuery", function() {
	describe("parseOrder", function() {
		it("accepts ascend/descend and rejects anything else", function() {
			assert.equal(parseOrder("ascend"), "ascend");
			assert.equal(parseOrder("descend"), "descend");
			assert.equal(parseOrder("sideways"), undefined);
			assert.equal(parseOrder(null), undefined);
		});
	});

	describe("parseSort", function() {
		it("falls back to the supplied defaults when absent", function() {
			assert.deepEqual(parseSort(new URLSearchParams(""), P, "name"), { columnKey: "name", order: "ascend" });
			assert.deepEqual(parseSort(new URLSearchParams(""), P), { columnKey: undefined, order: undefined });
		});
		it("reads an explicit namespaced sort column and order", function() {
			assert.deepEqual(
				parseSort(new URLSearchParams("t.sort=cpu&t.order=descend"), P, "name"),
				{ columnKey: "cpu", order: "descend" }
			);
		});
	});

	describe("parsePagination", function() {
		it("uses defaults for missing or garbage values", function() {
			assert.deepEqual(parsePagination(new URLSearchParams(""), P, 50), { page: 1, pageSize: 50 });
			assert.deepEqual(
				parsePagination(new URLSearchParams("t.page=x&t.pageSize=-3"), P, 50), { page: 1, pageSize: 50 }
			);
		});
		it("reads valid values", function() {
			assert.deepEqual(
				parsePagination(new URLSearchParams("t.page=3&t.pageSize=20"), P, 50), { page: 3, pageSize: 20 }
			);
		});
	});

	describe("parseFilters", function() {
		it("collects namespaced column filters but excludes reserved suffixes", function() {
			const params = new URLSearchParams("t.roles=1&t.roles=2&t.sort=name&other.x=1");
			assert.deepEqual(parseFilters(params, P), { roles: ["1", "2"] });
		});
	});

	describe("applySort", function() {
		it("omits parameters when the sort equals the default", function() {
			const params = new URLSearchParams();
			applySort(params, P, { columnKey: "name", order: "ascend" }, "name", "ascend");
			assert.equal(params.toString(), "");
		});
		it("writes a namespaced non-default sort", function() {
			const params = new URLSearchParams();
			applySort(params, P, { columnKey: "cpu", order: "descend" }, "name", "ascend");
			assert.equal(params.get("t.sort"), "cpu");
			assert.equal(params.get("t.order"), "descend");
		});
		it("clears the sort when the order is cleared", function() {
			const params = new URLSearchParams("t.sort=cpu&t.order=descend");
			applySort(params, P, { columnKey: undefined, order: undefined }, "name", "ascend");
			assert.equal(params.has("t.sort"), false);
			assert.equal(params.has("t.order"), false);
		});
	});

	describe("applyFilters", function() {
		it("sets active filters as repeated params and deletes inactive ones", function() {
			const params = new URLSearchParams("t.roles=old");
			applyFilters(params, P, { roles: ["1", "2"], lastSeen: null });
			assert.deepEqual(params.getAll("t.roles"), ["1", "2"]);
			assert.equal(params.has("t.lastSeen"), false);
		});
		it("round-trips a JSON-blob filter value with single encoding", function() {
			const params = new URLSearchParams();
			const blob = '{"admin":false}';
			applyFilters(params, P, { name: [blob] });
			// Single-encoded (%7B…), not double-encoded (%257B…).
			assert.equal(params.toString(), "t.name=%7B%22admin%22%3Afalse%7D");
			assert.deepEqual(parseFilters(params, P), { name: [blob] });
		});
	});

	describe("applyPagination", function() {
		it("omits page 1 and the default page size", function() {
			const params = new URLSearchParams();
			applyPagination(params, P, 1, 50, 50);
			assert.equal(params.toString(), "");
		});
		it("writes non-default page and page size", function() {
			const params = new URLSearchParams();
			applyPagination(params, P, 2, 20, 50);
			assert.equal(params.get("t.page"), "2");
			assert.equal(params.get("t.pageSize"), "20");
		});
	});
});
