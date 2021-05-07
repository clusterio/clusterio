// Shared metrics
"use strict";
const libPrometheus = require("@clusterio/lib/prometheus");

exports.endpointHitCounter = new libPrometheus.Counter(
	"clusterio_master_http_endpoint_hits_total",
	"How many requests a particular HTTP endpoint has gotten",
	{ labels: ["route"] }
);
