import { useEffect, useContext, useState } from "react";
import ControlContext from "../components/ControlContext";

import * as lib from "@clusterio/lib";


export function useHost(id) {
	let control = useContext(ControlContext);
	let [host, setHost] = useState({ loading: true });

	function updateHost() {
		// XXX optimize by requesting only the host in question
		control.send(new lib.HostListRequest()).then(hosts => {
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

		function updateHandler(newHost) {
			setHost({ ...newHost, present: true });
		}

		control.onHostUpdate(id, updateHandler);
		return () => {
			control.offHostUpdate(id, updateHandler);
		};
	}, [id]);

	return [host, updateHost];
}

export function useHostList() {
	let control = useContext(ControlContext);
	let [hostList, setHostList] = useState([]);

	function updateHostList() {
		control.send(new lib.HostListRequest()).then(hosts => {
			setHostList(hosts);
		});
	}

	useEffect(() => {
		updateHostList();

		function updateHandler(newHost) {
			setHostList(oldList => {
				let newList = oldList.concat();
				let index = newList.findIndex(s => s.id === newHost.id);
				if (index !== -1) {
					newList[index] = newHost;
				} else {
					newList.push(newHost);
				}
				return newList;
			});
		}

		control.onHostUpdate(null, updateHandler);
		return () => {
			control.offHostUpdate(null, updateHandler);
		};
	}, []);


	return [hostList];
}
