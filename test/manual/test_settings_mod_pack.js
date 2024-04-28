"use strict";
const { ModPack } = require("@clusterio/lib");

const pack = new ModPack();
pack.name = "test-settings";
pack.mods.set("test_mod", { name: "test_mod", enabled: true, version: "0.0.0" });
const settingTypes = [
	"bool-setting",
	"int-setting",
	"double-setting",
	"string-setting",
	"color-setting",
];
const settingValues = {
	"bool": false,
	"int": 1,
	"double": 0.5,
	"string": "str",
	"color": { r: 0, g: 1, b: 0, a: 1 },
	// "missing":
};
for (const type of settingTypes) {
	for (const [valueType, value] of Object.entries(settingValues)) {
		pack.settings.startup.set(`${type}-with-${valueType}-value`, { value });
	}
}
/* eslint-disable no-console */
console.log(pack.toModPackString());
