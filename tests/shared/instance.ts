import type { Test } from "tap";
import * as lib from "@clusterio/lib";
import Instance from "@clusterio/host/dist/node/src/Instance.js";
import { FactorioServer } from "@clusterio/host/dist/node/src/server.js";
import { addr } from "./link.ts";

// Methods that spawn or talk to the Factorio process
const processMethods = [
	"create", "start", "startScenario", "stop", "kill", "sendRcon", "sendUdp", "disableAchievements",
] as const;

/**
 * Instance on a real FactorioServer that cannot reach Factorio.
 *
 * The server's process methods throw until the test intercepts them, the
 * instance directory is a test dir and the instance logger is captured.
 *
 * @param t - Test the instance belongs to.
 * @param configure - Called with the instance config before the instance is created.
 * @returns the instance, its server, the messages it sent and its logs.
 */
export function testInstance(t: Test, configure?: (config: lib.InstanceConfig) => void) {
	const dir = t.testdir();
	const config = new lib.InstanceConfig("host");
	config.set("instance.name", "test");
	configure?.(config);

	const server = new FactorioServer(dir, dir, dir, "2.0.0", { rconPassword: "test" });
	for (const name of processMethods) {
		t.intercept(server, name, {
			value: async () => { throw new Error(`FactorioServer.${name} not stubbed by the test`); },
		});
	}

	const src = addr({ instanceId: config.get("instance.id") });
	const [connector, peer] = lib.VirtualConnector.makePair(src, addr({ hostId: 1 }));
	const sent: lib.Message[] = [];
	peer.on("message", message => { sent.push(message); });

	const host = { _crashRetryAttempts: new Map(), _shuttingDown: false };
	const instance = new Instance(host as any, connector, dir, config, server);
	// Not awaited by notifyExit, so writing it would race the test dir removal
	t.intercept(instance, "_saveStats", { value: async () => {} });
	const logs = {
		error: t.capture(instance.logger, "error"),
		warn: t.capture(instance.logger, "warn"),
		info: t.capture(instance.logger, "info"),
		verbose: t.capture(instance.logger, "verbose"),
	};

	/** Statuses the instance has reported to the controller */
	function statuses() {
		return sent
			.filter((m: any) => m.type === "event" && m.name === lib.InstanceStatusChangedEvent.name)
			.map((m: any) => m.data.status);
	}

	return { instance, server, host, dir, sent, statuses, logs };
}
