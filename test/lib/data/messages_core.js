"use strict";
const assert = require("assert").strict;
const lib = require("@clusterio/lib");
const { Address } = lib;

describe("lib/data/messages_core", function() {
	describe("class Address", function() {
		const controller = new Address(Address.controller, 0);
		const host1 = new Address(Address.host, 1);
		const host2 = new Address(Address.host, 2);
		const instance1 = new Address(Address.instance, 1);
		const instance2 = new Address(Address.instance, 2);
		const control1 = new Address(Address.control, 1);
		const control2 = new Address(Address.control, 2);
		const hostBr = new Address(Address.broadcast, Address.host);
		const instanceBr = new Address(Address.broadcast, Address.instance);
		const controlBr = new Address(Address.broadcast, Address.control);

		it("Should correctly resolve addressedTo", function() {
			assert(controller.addressedTo(controller));
			assert(!controller.addressedTo(host1));
			assert(!controller.addressedTo(instance1));
			assert(!controller.addressedTo(control1));
			assert(!controller.addressedTo(hostBr));
			assert(!controller.addressedTo(instanceBr));
			assert(!controller.addressedTo(controlBr));

			assert(!host1.addressedTo(controller));
			assert(host1.addressedTo(host1));
			assert(!host1.addressedTo(host2));
			assert(!host1.addressedTo(instance1));
			assert(!host1.addressedTo(control1));
			assert(!host1.addressedTo(hostBr));
			assert(!host1.addressedTo(instanceBr));
			assert(!host1.addressedTo(controlBr));

			assert(!instance1.addressedTo(controller));
			assert(!instance1.addressedTo(host1));
			assert(instance1.addressedTo(instance1));
			assert(!instance1.addressedTo(instance2));
			assert(!instance1.addressedTo(control1));
			assert(!instance1.addressedTo(hostBr));
			assert(!instance1.addressedTo(instanceBr));
			assert(!instance1.addressedTo(controlBr));

			assert(!control1.addressedTo(controller));
			assert(!control1.addressedTo(host1));
			assert(!control1.addressedTo(instance1));
			assert(control1.addressedTo(control1));
			assert(!control1.addressedTo(control2));
			assert(!control1.addressedTo(hostBr));
			assert(!control1.addressedTo(instanceBr));
			assert(!control1.addressedTo(controlBr));

			assert(!hostBr.addressedTo(controller));
			assert(hostBr.addressedTo(host1));
			assert(hostBr.addressedTo(host2));
			assert(!hostBr.addressedTo(instance1));
			assert(!hostBr.addressedTo(control1));
			assert(!hostBr.addressedTo(hostBr));
			assert(!hostBr.addressedTo(instanceBr));
			assert(!hostBr.addressedTo(controlBr));

			assert(!instanceBr.addressedTo(controller));
			assert(!instanceBr.addressedTo(host1));
			assert(instanceBr.addressedTo(instance1));
			assert(instanceBr.addressedTo(instance2));
			assert(!instanceBr.addressedTo(control1));
			assert(!instanceBr.addressedTo(hostBr));
			assert(!instanceBr.addressedTo(instanceBr));
			assert(!instanceBr.addressedTo(controlBr));

			assert(!controlBr.addressedTo(controller));
			assert(!controlBr.addressedTo(host1));
			assert(!controlBr.addressedTo(instance1));
			assert(controlBr.addressedTo(control1));
			assert(controlBr.addressedTo(control2));
			assert(!controlBr.addressedTo(hostBr));
			assert(!controlBr.addressedTo(instanceBr));
			assert(!controlBr.addressedTo(controlBr));
		});
	});
});
