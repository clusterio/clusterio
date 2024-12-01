import * as lib from "@clusterio/lib";

export function instancePublicAddress(instance: lib.InstanceDetails, host?: lib.HostDetails | null) {
	if (instance.assignedHost === undefined || !host || !host.publicAddress) {
		return "";
	}
	if (instance.gamePort === undefined) {
		return host.publicAddress;
	}
	return `${host.publicAddress}:${instance.gamePort}`;
} 
