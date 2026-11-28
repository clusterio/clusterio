import t from "tap";
import * as lib from "@clusterio/lib";

t.test("HostDetails", async t1 => {
	t1.test("toJSON()", async t2 => {
		t2.test("leaves out default values", async t3 => {
			t3.strictSame(new lib.HostDetails("2.0.0", "Host", 1, false).toJSON(), {
				version: "2.0.0", name: "Host", id: 1, connected: false,
			});
		});
		t2.test("includes values that differ from the defaults", async t3 => {
			const host = new lib.HostDetails("2.0.0", "Host", 1, true, "10.0.0.1", "example.com", 100, 200, true);
			t3.strictSame(host.toJSON(), {
				version: "2.0.0", name: "Host", id: 1, connected: true,
				remoteAddress: "10.0.0.1", publicAddress: "example.com",
				tokenValidAfter: 100, updatedAtMs: 200, isDeleted: true,
			});
		});
	});

	t1.test("fromJSON()", async t2 => {
		t2.test("fills in defaults for missing fields", async t3 => {
			const host = lib.HostDetails.fromJSON({ version: "2.0.0", name: "Host", id: 1, connected: true });
			t3.equal(host.remoteAddress, "");
			t3.equal(host.publicAddress, "");
			t3.equal(host.tokenValidAfter, 0);
			t3.equal(host.updatedAtMs, 0);
			t3.equal(host.isDeleted, false);
		});
	});
});
