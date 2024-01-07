"use strict";
const assert = require("assert").strict;

const { InstanceInfo } = require("@clusterio/controller");
const lib = require("@clusterio/lib");


describe("controller/InstanceInfo", function() {
	describe("class InstanceInfo", function() {
		it("should round trip serialize", async function() {
			const validate = lib.compile(InstanceInfo.jsonSchema);
			function check(info) {
				const json = JSON.parse(JSON.stringify(info));
				if (!validate(json)) {
					throw validate.errors;
				}
				assert.deepEqual(InstanceInfo.fromJSON(json, info.config), info);
			}

			if (!lib.InstanceConfig._finalized) {
				lib.InstanceConfig.finalize();
			}
			const config = new lib.InstanceConfig("controller");
			await config.init();

			check(InstanceInfo.fromJSON({ config, status: "stopped" }, config));
			check(InstanceInfo.fromJSON({ config, status: "running" }, config));
			check(InstanceInfo.fromJSON({ config, status: "running", gamePort: 34197 }, config));
			check(InstanceInfo.fromJSON({ config, status: "running", updatedAt: Date.now() }, config));

			// All at once
			check(InstanceInfo.fromJSON({
				config,
				status: "unknown",
				gamePort: 10000,
				updateAt: 20000,
			}, config));
		});
	});
});
