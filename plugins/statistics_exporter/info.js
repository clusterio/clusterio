"use strict";
let link = require("@clusterio/lib/link");

module.exports = {
	name: "statistics_exporter",
	title: "Prometheus Statistics Export",
	description: "Exports statistics to Prometheus",
	instanceEntrypoint: "instance",
};
