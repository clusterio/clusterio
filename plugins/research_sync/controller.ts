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
} from "./messages.js";

type Technology = {
	level: number,
	progress: number | null,
	researched: boolean,
}


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
	await lib.safeOutputFile(filePath, JSON.stringify([...technologies.entries()], null, "\t"));
}

export default async function(context: ControllerPluginContext) {
	const { controller, logger, plugin } = context;
	const technologies = await loadTechnologies(controller.config, logger);
	let technologiesDirty = true;
	const progressToBroadcast = new Set<string>();

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

			controller.sendTo("allInstances", new FinishedEvent(name, tech.level));
		}
		technologiesDirty = true;
	});

	controller.handle(FinishedEvent, async (event: FinishedEvent) => {
		let { name, level } = event;
		let tech = technologies.get(name);
		if (!tech || tech.level <= level) {
			controller.sendTo("allInstances", event);
			progressToBroadcast.delete(name);
			technologies.set(name, { level, progress: null, researched: true });
			technologiesDirty = true;
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
				}

			} else {
				if (tech.level > level || tech.level === level && tech.researched) {
					continue;
				}

				if (tech.level < level || researched) {
					// Send update if the unlocked level is greater
					if (level - Number(!researched) > tech.level - Number(!tech.researched)) {
						controller.sendTo("allInstances", new FinishedEvent(name, level - Number(!researched)));
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

		let result = [];
		for (let [name, tech] of technologies) {
			result.push(new TechnologySync(name, tech.level, tech.progress, tech.researched));
		}

		return result;
	});

	controller.hooks.save.attach(plugin.name, async () => {
		if (technologiesDirty) {
			technologiesDirty = false;
			await saveTechnologies(controller.config, technologies, logger);
		}
	});

	controller.hooks.shutdown.attach(plugin.name, async () => {
		progressRateLimiter.cancel();
	});
}
