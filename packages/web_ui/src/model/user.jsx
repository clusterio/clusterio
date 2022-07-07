import { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import { libLink, libLogging } from "@clusterio/lib";
const { logger } = libLogging;


export function useUser(name) {
	let control = useContext(ControlContext);
	let [user, setUser] = useState({ loading: true });

	function updateUser() {
		libLink.messages.getUser.send(control, { name }).then(result => {
			setUser({ ...result, present: true });
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

		function updateHandler(newUser) {
			setUser({ ...newUser, present: true });
		}

		control.onUserUpdate(name, updateHandler);
		return () => {
			control.offUserUpdate(name, updateHandler);
		};
	}, [name]);

	return [user, updateUser];
}

export function useUserList() {
	let control = useContext(ControlContext);
	let [userList, setUserList] = useState([]);

	function updateUserList() {
		libLink.messages.listUsers.send(control).then(result => {
			setUserList(result.list);
		}).catch(err => {
			logger.error(`Failed to list users:\n${err}`);
		});
	}

	useEffect(() => {
		updateUserList();

		function updateHandler(newUser) {
			setUserList(oldList => {
				let newList = oldList.concat();
				let index = newList.findIndex(u => u.name === newUser.name);
				if (!newUser.is_deleted) {
					if (index !== -1) {
						newList[index] = newUser;
					} else {
						newList.push(newUser);
					}
				} else if (index !== -1) {
					newList.splice(index, 1);
				}
				return newList;
			});
		}

		control.onUserUpdate(null, updateHandler);
		return () => {
			control.offUserUpdate(null, updateHandler);
		};
	}, []);

	return [userList];
}
