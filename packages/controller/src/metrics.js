// Shared metrics
"use strict";
const libPrometheus = require("@clusterio/lib/prometheus");
const util = require("util");

exports.endpointHitCounter = new libPrometheus.Counter(
	"clusterio_controller_http_endpoint_hits_total",
	"How many requests a particular HTTP endpoint has gotten",
	{ labels: ["route"], register: false }
);

exports.endpointHitCounter.labels = util.deprecate(
	exports.endpointHitCounter.labels, "incrementing endpointHitCounter is no longer needed and has no effect"
);
