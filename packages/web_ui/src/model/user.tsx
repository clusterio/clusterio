import React, { useCallback, useContext, useSyncExternalStore } from "react";
import { Tag } from "antd";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

function getInstanceStats(user: lib.UserDetails, instanceId?: number) {
	if (instanceId === undefined) {
		return user.playerStats;
	}
	return user.instanceStats.get(instanceId);
}

function calculateFirstSeen(user: lib.UserDetails, instanceId?: number) {
	const stats = getInstanceStats(user, instanceId);
	return stats?.firstJoinAt?.getTime();
}

function calculateLastSeen(user: lib.UserDetails, instanceId?: number) {
	const stats = getInstanceStats(user, instanceId);
	if (!stats) {
		return undefined;
	}
	if (stats.lastLeaveAt && stats.lastLeaveAt.getTime() > (stats.lastJoinAt?.getTime() ?? 0)) {
		return stats.lastLeaveAt.getTime();
	}
	if (stats.lastJoinAt) {
		return stats.lastJoinAt.getTime();
	}
	return undefined;
}

export function formatFirstSeen(user: lib.UserDetails, instanceId?: number) {
	const firstSeen = calculateFirstSeen(user, instanceId);
	if (firstSeen === undefined) {
		return undefined;
	}
	return new Date(firstSeen).toLocaleString();
}

export function formatLastSeen(user: lib.UserDetails, instanceId?: number) {
	if (user.instances && [...user.instances].some(id => instanceId === undefined || id === instanceId)) {
		return <Tag color="green">Online</Tag>;
	}
	let lastSeen = calculateLastSeen(user, instanceId);
	if (lastSeen === undefined) {
		return undefined;
	}
	return new Date(lastSeen).toLocaleString();
}

export function sortFirstSeen(
	userA: lib.UserDetails,
	userB: lib.UserDetails,
	instanceIdA?: number,
	instanceIdB?: number
) {
	const firstSeenA = calculateFirstSeen(userA, instanceIdA) || 0;
	const firstSeenB = calculateFirstSeen(userB, instanceIdB) || 0;
	return firstSeenA - firstSeenB;
}

export function sortLastSeen(
	userA: lib.UserDetails,
	userB: lib.UserDetails,
	instanceIdA?: number,
	instanceIdB?: number
) {
	function epoch(user: lib.UserDetails, instanceId?: number) {
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
	return [name !== undefined ? users.get(name.toLowerCase()) : undefined, synced] as const;
}

export function useUsers() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.users.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.users.getSnapshot());
}
