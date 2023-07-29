// Shared metrics
"use strict";
const lib = require("@clusterio/lib");
const util = require("util");

exports.endpointHitCounter = new lib.Counter(
	"clusterio_controller_http_endpoint_hits_total",
	"How many requests a particular HTTP endpoint has gotten",
	{ labels: ["route"], register: false }
);

exports.endpointHitCounter.labels = util.deprecate(
	exports.endpointHitCounter.labels, "incrementing endpointHitCounter is no longer needed and has no effect"
);
