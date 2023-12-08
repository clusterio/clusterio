import React, { useEffect, useContext, useState } from "react";
import { Tag } from "antd";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";

const { logger } = lib;

function calculateLastSeen(user: RawUserState, instanceId?: number) {
	let stats;
	if (instanceId === undefined) {
		stats = user.playerStats;
	} else {
		stats = (user.instanceStats || new Map()).get(instanceId);
		if (!stats) {
			return undefined;
		}
	}
	if (stats.lastLeaveAt > stats.lastJoinAt) {
		return stats.lastLeaveAt;
	}
	if (stats.lastJoinAt) {
		return stats.lastLeaveAt;
	}
	return undefined;
}

export function formatLastSeen(user: RawUserState, instanceId?: number) {
	if (user.instances && [...user.instances].some(id => instanceId === undefined || id === instanceId)) {
		return <Tag color="green">Online</Tag>;
	}
	let lastSeen = calculateLastSeen(user, instanceId);
	if (lastSeen === undefined) {
		return undefined;
	}
	return new Date(lastSeen).toLocaleString();
}

export function sortLastSeen(userA:RawUserState, userB:RawUserState, instanceIdA?: number, instanceIdB?: number) {
	function epoch(user:RawUserState, instanceId?: number) {
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

export type RawUserState = Partial<lib.User> & {
	loading?: boolean;
	present?: boolean;
	missing?: boolean;
};

export function useUser(name: string): [RawUserState, () => void] {
	let control = useContext(ControlContext);
	let [user, setUser] = useState<RawUserState>({ loading: true });

	function updateUser() {
		control.send(new lib.UserGetRequest(name)).then(updatedUser => {
			setUser({ ...updatedUser, present: true });
		}).catch(err => {
			logger.error(`Failed to get user: ${err}`);
			setUser({ missing: true });
		});
	}

	useEffect(() => {
		if (typeof name !== "string") {
			setUser({ missing: true });
			return undefined;
		}
		updateUser();

		function updateHandler(newUsers: lib.User[]) {
			const newUser = newUsers.find(u => u.name === name);
			if (newUser) {
				setUser({ ...newUser, present: true });
			}
		}

		control.userUpdate.subscribe(updateHandler);
		return () => {
			control.userUpdate.unsubscribe(updateHandler);
		};
	}, [name]);

	return [user, updateUser];
}

export function useUserList() {
	let control = useContext(ControlContext);
	let [userList, setUserList] = useState<lib.User[]>([]);

	function updateUserList() {
		control.send(new lib.UserListRequest()).then(users => {
			setUserList(users);
		}).catch(err => {
			logger.error(`Failed to list users:\n${err}`);
		});
	}

	useEffect(() => {
		updateUserList();

		function updateHandler(newUsers: lib.User[]) {
			setUserList(oldList => {
				let newList = oldList.concat();
				for (const newUser of newUsers) {
					let index = newList.findIndex(u => u.name === newUser.name);
					if (!newUser.isDeleted) {
						if (index !== -1) {
							newList[index] = newUser;
						} else {
							newList.push(newUser);
						}
					} else if (index !== -1) {
						newList.splice(index, 1);
					}
				}
				return newList;
			});
		}

		control.userUpdate.subscribe(updateHandler);
		return () => {
			control.userUpdate.unsubscribe(updateHandler);
		};
	}, []);

	return [userList];
}
