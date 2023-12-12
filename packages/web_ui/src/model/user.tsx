import React, { useCallback, useContext, useSyncExternalStore } from "react";
import { Tag } from "antd";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

function calculateLastSeen(user: lib.User, instanceId?: number) {
	let stats;
	if (instanceId === undefined) {
		stats = user.playerStats;
	} else {
		stats = user.instanceStats.get(instanceId);
		if (!stats) {
			return undefined;
		}
	}
	if ((stats.lastLeaveAt?.getTime() ?? 0) > (stats.lastJoinAt?.getTime() ?? 0)) {
		return stats.lastLeaveAt?.getTime();
	}
	if (stats.lastJoinAt) {
		return stats.lastLeaveAt?.getTime();
	}
	return undefined;
}

export function formatLastSeen(user: lib.User, instanceId?: number) {
	if (user.instances && [...user.instances].some(id => instanceId === undefined || id === instanceId)) {
		return <Tag color="green">Online</Tag>;
	}
	let lastSeen = calculateLastSeen(user, instanceId);
	if (lastSeen === undefined) {
		return undefined;
	}
	return new Date(lastSeen).toLocaleString();
}

export function sortLastSeen(userA: lib.User, userB: lib.User, instanceIdA?: number, instanceIdB?: number) {
	function epoch(user: lib.User, instanceId?: number) {
		return user.instances && [...user.instances].some(id => instanceId === undefined || id === instanceId);
	}

	let epochA = epoch(userA, instanceIdA);
	let epochB = epoch(userB, instanceIdB);
	if (epochA !== epochB) {
		return Number(epochA) - Number(epochB);
	}

	let lastSeenA = calculateLastSeen(userA, instanceIdA) || 0;
	let lastSeenB = calculateLastSeen(userB, instanceIdB) || 0;
	return lastSeenA - lastSeenB;
}

export function useUser(name?: string) {
	const [users, synced] = useUsers();
	return [name !== undefined ? users.get(name) : undefined, synced] as const;
}

export function useUsers() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.users.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.users.getSnapshot());
}
