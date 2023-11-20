import * as lib from "@clusterio/lib";
import util from "util";

export const endpointHitCounter = new lib.Counter(
	"clusterio_controller_http_endpoint_hits_total",
	"How many requests a particular HTTP endpoint has gotten",
	{ labels: ["route"], register: false }
);

endpointHitCounter.labels = util.deprecate(
	endpointHitCounter.labels,
	"incrementing endpointHitCounter is no longer needed and has no effect"
);
