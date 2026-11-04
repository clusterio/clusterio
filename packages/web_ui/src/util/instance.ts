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

export type ResolvedModPack = {
	/** ID of the mod pack, undefined if the default is used and not known */
	id?: number;
	modPack?: lib.ModPack;
	isDefault: boolean;
};

/** Resolve the mod pack an instance starts with, falling back to the controller default */
export function instanceModPack(
	modPackId: number | undefined,
	modPacks: ReadonlyMap<number, lib.ModPack>,
	defaultModPack?: lib.ModPack,
): ResolvedModPack {
	if (modPackId !== undefined) {
		return { id: modPackId, modPack: modPacks.get(modPackId), isDefault: false };
	}
	if (!defaultModPack) {
		return { isDefault: true };
	}
	return {
		id: defaultModPack.id,
		modPack: modPacks.get(defaultModPack.id) ?? defaultModPack,
		isDefault: true,
	};
}
