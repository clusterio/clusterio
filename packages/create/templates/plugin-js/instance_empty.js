"use strict";
const { BaseInstancePlugin } = require("@clusterio/host");

class InstancePlugin extends BaseInstancePlugin {
	// This class is empty because an instance plugin must be defined for a module to be injected
	// This requirement may change in the future to allow for standalone modules
}

module.exports = {
	InstancePlugin,
};
