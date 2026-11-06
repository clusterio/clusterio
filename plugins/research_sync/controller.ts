import fs from "node:fs/promises";
import path from "path";
import type { ControllerPluginContext } from "@clusterio/controller";
import { Static } from "@sinclair/typebox";

import * as lib from "@clusterio/lib";
import { RateLimiter } from "@clusterio/lib";

import {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	TechnologySync,
	SyncTechnologiesRequest,
	TechnologyProgress,
	QueueUpdateEvent,
	QueueEvent,
	QueueChange,
	QueueSyncRequest,
} from "./messages.js";

type Technology = {
	level: number,
	progress: number | null,
	researched: boolean,
};


async function loadTechnologies(
	controllerConfig: lib.ControllerConfig,
	logger: lib.Logger
): Promise<Map<string, Technology>> {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "technologies.json");
	logger.verbose(`Loading ${filePath}`);
	try {
		return new Map(JSON.parse(await fs.readFile(filePath, "utf8")));
	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new technologies database");
			return new Map();
		}
		throw err;
	}
}

async function saveTechnologies(
	controllerConfig: lib.ControllerConfig,
	technologies: Map<string, Technology>,
	logger: lib.Logger
) {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "technologies.json");
	logger.verbose(`writing ${filePath}`);
	await lib.atomicOverwriteFile(filePath, JSON.stringify([...technologies.entries()], null, "\t"));
}

const MAX_QUEUE = 7;

async function loadQueue(controllerConfig: lib.ControllerConfig, logger: lib.Logger): Promise<string[]> {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "research_queue.json");
	logger.verbose(`Loading ${filePath}`);
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8"));
	} catch (err: any) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new research queue");
			return [];
		}
		throw err;
	}
}

async function saveQueue(controllerConfig: lib.ControllerConfig, queue: string[], logger: lib.Logger) {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "research_queue.json");
	logger.verbose(`writing ${filePath}`);
	await lib.atomicOverwriteFile(filePath, JSON.stringify(queue, null, "\t"));
}

/**
 * Lists the entries removed, added and moved between two queues. An entry is identified by its name and how many
 * entries for the same name come before it, so extra levels of an infinite technology count as added or removed
 * at the end. Moved entries are those outside the longest common subsequence of the kept entries.
 */
export function queueChanges(oldQueue: string[], newQueue: string[]): QueueChange[] {
	function keyed(queue: string[]) {
		const seen = new Map<string, number>();
		return queue.map((name, index) => {
			const offset = seen.get(name) ?? 0;
			seen.set(name, offset + 1);
			return { name, offset, position: index + 1, key: `${offset}:${name}` };
		});
	}
	const oldEntries = keyed(oldQueue);
	const newEntries = keyed(newQueue);
	const oldKeys = new Set(oldEntries.map(e => e.key));
	const newKeys = new Set(newEntries.map(e => e.key));
	const keptOld = oldEntries.filter(e => newKeys.has(e.key));
	const keptNew = newEntries.filter(e => oldKeys.has(e.key));

	// lcs[i][j] is the length of the longest common subsequence of keptOld[i..] and keptNew[j..]
	const lcs = Array.from({ length: keptOld.length + 1 }, () => new Array<number>(keptNew.length + 1).fill(0));
	for (let i = keptOld.length - 1; i >= 0; i--) {
		for (let j = keptNew.length - 1; j >= 0; j--) {
			lcs[i][j] = keptOld[i].key === keptNew[j].key
				? lcs[i + 1][j + 1] + 1
				: Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const inPlace = new Set<string>();
	for (let i = 0, j = 0; i < keptOld.length && j < keptNew.length;) {
		if (keptOld[i].key === keptNew[j].key) {
			inPlace.add(keptOld[i].key);
			i += 1;
			j += 1;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			i += 1;
		} else {
			j += 1;
		}
	}

	const change = (type: QueueChange["type"], e: { name: string, offset: number, position: number }) => (
		new QueueChange(type, e.name, e.offset, e.position)
	);
	return [
		...oldEntries.filter(e => !newKeys.has(e.key)).map(e => change("removed", e)),
		...newEntries.filter(e => !oldKeys.has(e.key)).map(e => change("added", e)),
		...keptNew.filter(e => !inPlace.has(e.key)).map(e => change("moved", e)),
	];
}

export default async function(context: ControllerPluginContext) {
	const { controller, logger, plugin } = context;
	const technologies = await loadTechnologies(controller.config, logger);
	let technologiesDirty = true;
	let queue = await loadQueue(controller.config, logger);
	let queueDirty = false;
	const progressToBroadcast = new Set<string>();

	function instanceName(src: lib.Address) {
		return controller.instances.get(src.id)?.config.get("instance.name") ?? String(src.id);
	}

	// Removes one entry per level that finished, returns whether any was removed
	function removeFinished(name: string, levels = 1): boolean {
		let removed = false;
		for (let i = 0; i < levels; i++) {
			let index = queue.indexOf(name);
			if (index === -1) {
				break;
			}
			queue.splice(index, 1);
			queueDirty = true;
			removed = true;
		}
		return removed;
	}

	// Instances only advance the technology on a finish, so they need the queue without it.
	// No player or instance: the finished research prints its own chat line.
	function broadcastQueueSilently() {
		controller.sendTo("allInstances", new QueueEvent(queue, null, null));
	}

	function setQueue(newQueue: string[], player: string | null, src: lib.Address) {
		newQueue = newQueue.slice(0, MAX_QUEUE);
		if (newQueue.length === queue.length && newQueue.every((name, i) => name === queue[i])) {
			return;
		}
		const changes = queueChanges(queue, newQueue);
		queue = newQueue;
		queueDirty = true;
		controller.sendTo("allInstances", new QueueEvent(queue, player, instanceName(src), changes));
	}

	function broadcastProgress() {
		let techs = [];
		for (let name of progressToBroadcast) {
			let tech = technologies.get(name);
			if (tech && tech.progress) {
				techs.push(new TechnologyProgress(name, tech.level, tech.progress));
			}
		}
		progressToBroadcast.clear();

		if (techs.length) {
			controller.sendTo("allInstances", new ProgressEvent(techs));
		}
	}

	const progressRateLimiter = new RateLimiter({
		maxRate: 1,
		action: broadcastProgress,
	});

	controller.handle(ContributionEvent, async (event: ContributionEvent) => {
		let { name, level, contribution } = event;
		let tech = technologies.get(name);
		if (!tech) {
			tech = { level, progress: 0, researched: false };
			technologies.set(name, tech);
			technologiesDirty = true;

		// Ignore contribution to already researched technologies
		} else if (tech.level > level || tech.level === level && tech.researched) {
			return;
		}

		// Handle contributon to the next level of a researched technology
		if (tech.level === level - 1 && tech.researched) {
			tech.researched = false;
			tech.level = level;
		}

		// Ignore contributions to higher levels
		if (tech.level < level) {
			return;
		}

		let newProgress = tech.progress! + contribution;
		if (newProgress < 1) {
			tech.progress = newProgress;
			progressToBroadcast.add(name);
			progressRateLimiter.activate();

		} else {
			tech.researched = true;
			tech.progress = null;
			progressToBroadcast.delete(name);
			let removed = removeFinished(name);

			controller.sendTo("allInstances", new FinishedEvent(name, tech.level));
			if (removed) {
				broadcastQueueSilently();
			}
		}
		technologiesDirty = true;
	});

	controller.handle(FinishedEvent, async (event: FinishedEvent) => {
		let { name, level } = event;
		let tech = technologies.get(name);
		let removed = false;
		if (!tech || tech.level < level || (tech.level === level && !tech.researched)) {
			removed = removeFinished(name);
		}
		if (!tech || tech.level <= level) {
			controller.sendTo("allInstances", event);
			progressToBroadcast.delete(name);
			technologies.set(name, { level, progress: null, researched: true });
			technologiesDirty = true;
		}
		if (removed) {
			broadcastQueueSilently();
		}
	});

	controller.handle(SyncTechnologiesRequest, async (request: SyncTechnologiesRequest): Promise<TechnologySync[]> => {
		function baseLevel(name: string): number {
			let match = /-(\d+)$/.exec(name);
			if (!match) {
				return 1;
			}
			return Number.parseInt(match[1], 10);
		}

		let removed = false;
		for (let instanceTech of request.technologies) {
			let { name, level, progress, researched } = instanceTech;
			let tech = technologies.get(name);
			if (!tech) {
				technologies.set(name, { level, progress, researched });
				technologiesDirty = true;
				if (progress) {
					progressToBroadcast.add(name);
				} else if (researched || baseLevel(name) !== level) {
					controller.sendTo("allInstances", new FinishedEvent(name, level));
					// One queue entry per level unlocked
					let levels = Math.max(level - Number(!researched) - baseLevel(name) + 1, 1);
					removed = removeFinished(name, levels) || removed;
				}

			} else {
				if (tech.level > level || tech.level === level && tech.researched) {
					continue;
				}

				if (tech.level < level || researched) {
					// Send update if the unlocked level is greater
					let unlocked = level - Number(!researched) - (tech.level - Number(!tech.researched));
					if (unlocked > 0) {
						controller.sendTo("allInstances", new FinishedEvent(name, level - Number(!researched)));
						removed = removeFinished(name, unlocked) || removed;
					}
					tech.level = level;
					tech.progress = progress;
					tech.researched = researched;

					if (progress) {
						progressToBroadcast.add(name);
					} else {
						progressToBroadcast.delete(name);
					}
					technologiesDirty = true;

				} else if (tech.progress && progress && tech.progress < progress) {
					tech.progress = progress;
					progressToBroadcast.add(name);
					technologiesDirty = true;
				}
			}
		}
		progressRateLimiter.activate();
		if (removed) {
			broadcastQueueSilently();
		}

		let result = [];
		for (let [name, tech] of technologies) {
			result.push(new TechnologySync(name, tech.level, tech.progress, tech.researched));
		}

		return result;
	});

	controller.handle(QueueUpdateEvent, async (event: QueueUpdateEvent, src: lib.Address) => {
		setQueue(event.queue, event.player, src);
	});

	controller.handle(QueueSyncRequest, async (request: QueueSyncRequest, src: lib.Address): Promise<string[]> => {
		if (request.queue?.length && !queue.length) {
			setQueue(request.queue, request.player, src);
		}
		return queue;
	});

	controller.hooks.save.attach(plugin.name, async () => {
		if (queueDirty) {
			queueDirty = false;
			await saveQueue(controller.config, queue, logger);
		}
		if (technologiesDirty) {
			technologiesDirty = false;
			await saveTechnologies(controller.config, technologies, logger);
		}
	});

	controller.hooks.shutdown.attach(plugin.name, async () => {
		progressRateLimiter.cancel();
	});
}
