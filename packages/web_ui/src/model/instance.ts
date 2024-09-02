import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { Static } from "@sinclair/typebox";
import { Config, InstanceConfigGetRequest } from "@clusterio/lib";
import ControlContext from "../components/ControlContext";

export function useInstance(id?: number) {
	const [instances, synced] = useInstances();
	return [id !== undefined ? instances.get(id) : undefined, synced] as const;
}

export function useInstances() {
	const control = useContext(ControlContext);
	const subscribe = useCallback((callback: () => void) => control.instances.subscribe(callback), [control]);
	return useSyncExternalStore(subscribe, () => control.instances.getSnapshot());
}

export function useInstanceConfig(id?: number) {
	let control = useContext(ControlContext);
	const [config, setConfig] = useState(undefined as undefined | Static<typeof Config.jsonSchema>);

	useEffect(() => {
		if (id) {
			control.send(new InstanceConfigGetRequest(id))
				.then(conf => setConfig(conf));
		}
	}, [id]);

	return config;
};
