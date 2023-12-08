import { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";


export type HostState = Partial<lib.HostDetails> & {
	loading?: boolean,
	present?: boolean,
	missing?: boolean,
}

export function useHost(id: number): [ HostState, () => void ] {
	let control = useContext(ControlContext);
	let [host, setHost] = useState<HostState>({ loading: true });

	function updateHost() {
		// XXX optimize by requesting only the host in question
		control.send(
			new lib.HostListRequest()
		).then((hosts: lib.HostDetails[]) => {
			let match = hosts.find(i => i.id === id);
			if (!match) {
				setHost({ missing: true });
			} else {
				setHost({ ...match, present: true });
			}
		});
	}

	useEffect(() => {
		if (!Number.isInteger(id)) {
			setHost({ missing: true });
			return undefined;
		}
		updateHost();

		function updateHandler(newHosts: lib.HostDetails[]) {
			const newHost = newHosts.find(h => h.id === id);
			if (newHost) {
				setHost({ ...newHost, loading: false, missing: false, present: true });
			}
		}

		control.hostUpdate.subscribe(updateHandler);
		return () => {
			control.hostUpdate.unsubscribe(updateHandler);
		};
	}, [id]);

	return [host, updateHost];
}

export function useHostList() {
	let control = useContext(ControlContext);
	let [hostList, setHostList] = useState<lib.HostDetails[]>([]);

	function updateHostList() {
		control.send(
			new lib.HostListRequest()
		).then((hosts: lib.HostDetails[]) => {
			setHostList(hosts);
		});
	}

	useEffect(() => {
		updateHostList();

		function updateHandler(newHosts: lib.HostDetails[]) {
			setHostList(oldList => {
				let newList = oldList.concat();
				for (const newHost of newHosts) {
					let index = newList.findIndex(s => s.id === newHost.id);
					if (index !== -1) {
						newList[index] = newHost;
					} else {
						newList.push(newHost);
					}
				}
				return newList;
			});
		}

		control.hostUpdate.subscribe(updateHandler);
		return () => {
			control.hostUpdate.unsubscribe(updateHandler);
		};
	}, []);


	return [hostList];
}
