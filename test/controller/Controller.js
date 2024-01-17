"use strict";
const assert = require("assert").strict;
const { Controller } = require("@clusterio/controller");
const { ControllerConfig } = require("@clusterio/lib");

describe("controller/src/Controller", function() {
	describe("class Controller", function() {
		/** @type {Controller} */
		let controller;
		before(function() {
			controller = new Controller({}, [], "", new ControllerConfig("controller"));
		});
		function check(list, ip, present = true) {
			if (present === false) {
				assert(!list.check(ip), `${ip} unexpectedly in list`);
			} else {
				assert(list.check(ip), `${ip} missing from list`);
			}
		}
		describe(".parseTrustedProxies()", function() {
			it("should parse addresses", function() {
				controller.config.set("controller.trusted_proxies", "10.0.0.1");
				let list = controller.parseTrustedProxies();
				check(list, "10.0.0.1");
				check(list, "10.0.0.2", false);
				controller.config.set("controller.trusted_proxies", "10.0.0.1, 10.0.0.2, 10.1.2.3");
				list = controller.parseTrustedProxies();
				check(list, "10.0.0.1");
				check(list, "10.0.0.2");
				check(list, "10.0.0.3", false);
			});
			it("should ignore invalid entries", function() {
				controller.config.set("controller.trusted_proxies", "10.0.0.1, invalid, 0.0.0.0/200, 10.0.0.2");
				const list = controller.parseTrustedProxies();
				check(list, "10.0.0.1");
				check(list, "10.0.0.2");
				check(list, "10.0.0.3", false);
			});
			it("should parse CIDR blocks", function() {
				controller.config.set("controller.trusted_proxies", "10.0.0.1/24, 192.168.0.16/31");
				const list = controller.parseTrustedProxies();
				check(list, "10.0.0.0");
				check(list, "10.0.0.1");
				check(list, "10.0.0.10");
				check(list, "10.0.0.255");
				check(list, "10.0.1.0", false);
				check(list, "192.168.0.15", false);
				check(list, "192.168.0.16");
				check(list, "192.168.0.17");
				check(list, "192.168.0.18", false);
			});
		});
	});
});
