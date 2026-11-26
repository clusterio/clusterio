import path from "node:path";
import type { Test } from "tap";
import * as lib from "@clusterio/lib";
import Host from "@clusterio/host/dist/node/src/Host.js";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { HostConnector } from "@clusterio/host/dist/node/host.js";
import { testInstance } from "./instance.ts";

/**
 * Host that is not connected to a controller.
 *
 * Messages to the controller are dropped. Instance.fromConfig makes
 * instances with testInstance, so starting one never spawns Factorio.
 *
 * @param t - Test the host belongs to.
 * @returns the host, the instances it created by ID and helpers.
 */
export function testHost(t: Test) {
	const dir = t.testdir();
	const config = new lib.HostConfig("host", { "host.instances_directory": dir });
	const host = new Host(new HostConnector(config, []), config, []);
	t.intercept(host, "send", { value: () => {} });
	t.intercept(host.connector, "forward", { value: () => {} });

	const instances = new Map<number, ReturnType<typeof testInstance>>();
	let held: (() => void)[] | undefined;
	t.intercept(Instance, "fromConfig", {
		value: async (
			instanceConfig: lib.InstanceConfig, fromHost: Host, connector: lib.VirtualConnector, instanceDir: string,
		) => {
			if (held) {
				await new Promise<void>(resolve => held!.push(resolve));
			}
			const made = testInstance(t, { config: instanceConfig, host: fromHost, connector, dir: instanceDir });
			made.instance._status = "starting";
			instances.set(made.instance.id, made);
			return made.instance;
		},
	});

	/** Assign an instance to the host */
	function assign(id: number, configure?: (config: lib.InstanceConfig) => void) {
		const instanceConfig = new lib.InstanceConfig("host", { "instance.id": id, "instance.name": `test ${id}` });
		configure?.(instanceConfig);
		host.assignedInstances.set(id, { config: instanceConfig, path: path.join(dir, String(id)) });
	}

	/**
	 * Hold Instance.fromConfig calls made after this until released
	 *
	 * @returns function releasing the held calls.
	 */
	function holdStarts() {
		const releases: (() => void)[] = [];
		held = releases;
		return () => {
			held = undefined;
			for (const release of releases) {
				release();
			}
		};
	}

	/** Connect an assigned instance and return it */
	async function connect(id: number) {
		await host._connectInstance(id);
		return instances.get(id)!;
	}

	return { host, dir, instances, assign, holdStarts, connect };
}
