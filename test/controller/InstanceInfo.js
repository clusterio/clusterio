"use strict";
const assert = require("assert").strict;

const { InstanceInfo } = require("@clusterio/controller");
const lib = require("@clusterio/lib");


describe("controller/InstanceInfo", function() {
	describe("class InstanceInfo", function() {
		it("should round trip serialize", function() {
			const validate = lib.compile(InstanceInfo.jsonSchema);
			function check(info) {
				const json = JSON.parse(JSON.stringify(info));
				if (!validate(json)) {
					throw validate.errors;
				}
				assert.deepEqual(InstanceInfo.fromJSON(json, "controller"), info);
			}

			const config = new lib.InstanceConfig("controller").toJSON();

			check(InstanceInfo.fromJSON({ config, status: "stopped" }, "controller"));
			check(InstanceInfo.fromJSON({ config, status: "running" }, "controller"));
			check(InstanceInfo.fromJSON({ config, status: "running", gamePort: 34197 }, "controller"));
			check(InstanceInfo.fromJSON({ config, status: "running", updatedAt: Date.now() }, "controller"));

			// All at once
			check(InstanceInfo.fromJSON({
				config,
				status: "unknown",
				gamePort: 10000,
				updateAt: 20000,
			}, "controller"));
		});
	});
});
