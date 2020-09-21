"use strict";
let link = require("@clusterio/lib/link");

module.exports = {
	name: "statistics_exporter",
	title: "Prometheus Statistics Export",
	description: "Exports statistics to Prometheus",
	version: "2.0.0-alpha",
	instanceEntrypoint: "instance",
};
