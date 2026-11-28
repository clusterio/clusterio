import t from "tap";
import * as lib from "@clusterio/lib";

t.test("HostPairingDetails", async t1 => {
	t1.test("id", async t2 => {
		t2.test("is the pairing code", async t3 => {
			t3.equal(new lib.HostPairingDetails("ABCD", "Host", "10.0.0.1").id, "ABCD");
		});
	});

	t1.test("toJSON()", async t2 => {
		t2.test("leaves out default values", async t3 => {
			t3.strictSame(new lib.HostPairingDetails("ABCD", "Host", "10.0.0.1").toJSON(), {
				code: "ABCD", name: "Host", remoteAddress: "10.0.0.1",
			});
		});
		t2.test("includes values that differ from the defaults", async t3 => {
			const pairing = new lib.HostPairingDetails("ABCD", "Host", "10.0.0.1", "2.0.0", 10, 20, true);
			t3.strictSame(pairing.toJSON(), {
				code: "ABCD", name: "Host", remoteAddress: "10.0.0.1",
				version: "2.0.0", createdAtMs: 10, updatedAtMs: 20, isDeleted: true,
			});
		});
	});

	t1.test("fromJSON()", async t2 => {
		t2.test("fills in defaults for missing fields", async t3 => {
			const pairing = lib.HostPairingDetails.fromJSON({ code: "A", name: "H", remoteAddress: "r" });
			t3.equal(pairing.version, "");
			t3.equal(pairing.createdAtMs, 0);
			t3.equal(pairing.updatedAtMs, 0);
			t3.equal(pairing.isDeleted, false);
		});
	});
});
