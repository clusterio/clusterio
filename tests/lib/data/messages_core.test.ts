import t from "tap";
import * as lib from "@clusterio/lib";

const { Address } = lib;

t.test("Address", async t1 => {
	t1.test("Address.fromShorthand()", async t2 => {
		t2.test("returns an Address as is", async t3 => {
			const address = new Address(Address.host, 3);
			t3.equal(Address.fromShorthand(address), address);
		});
		t2.test("translates named shorthands", async t3 => {
			t3.strictSame(Address.fromShorthand("controller"), new Address(Address.controller, 0));
			t3.strictSame(Address.fromShorthand("allHosts"), new Address(Address.broadcast, Address.host));
			t3.strictSame(Address.fromShorthand("allInstances"), new Address(Address.broadcast, Address.instance));
			t3.strictSame(Address.fromShorthand("allControls"), new Address(Address.broadcast, Address.control));
		});
		t2.test("translates id shorthands", async t3 => {
			t3.strictSame(Address.fromShorthand({ hostId: 1 }), new Address(Address.host, 1));
			t3.strictSame(Address.fromShorthand({ instanceId: 2 }), new Address(Address.instance, 2));
			t3.strictSame(Address.fromShorthand({ controlId: 3 }), new Address(Address.control, 3));
		});
		t2.test("throws on unrecognised shorthands", async t3 => {
			const error = new Error("Unrecognized shorthand");
			t3.throws(() => Address.fromShorthand("allThings" as any), error);
			t3.throws(() => Address.fromShorthand({ userId: 1 } as any), error);
			t3.throws(() => Address.fromShorthand({ hostId: 1, instanceId: 2 } as any), error);
		});
	});

	t1.test("toString()", async t2 => {
		t2.test("names the address type", async t3 => {
			t3.equal(String(new Address(Address.controller, 0)), "[Address controller:0]");
			t3.equal(String(new Address(Address.instance, 5)), "[Address instance:5]");
			t3.equal(String(new Address(Address.control, 5, 9)), "[Address control:5:9]");
		});
		t2.test("names the target type of broadcasts", async t3 => {
			t3.equal(String(new Address(Address.broadcast, Address.host)), "[Address 4:host]");
			t3.equal(String(new Address(Address.broadcast, 7)), "[Address 4:7]");
		});
		t2.test("prints unknown types as numbers", async t3 => {
			t3.equal(String(new Address(9, 1)), "[Address 9:1]");
		});
	});
});

t.test("Message", async t1 => {
	t1.test("Message.fromJSON()", async t2 => {
		t2.test("throws on an unknown type", async t3 => {
			t3.throws(() => lib.Message.fromJSON({ type: "bogus" }), new Error("Unrecognized message type bogus"));
		});
	});
});
