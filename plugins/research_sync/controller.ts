import fs from "fs-extra";
import path from "path";
import { Static } from "@sinclair/typebox";

import * as lib from "@clusterio/lib";
const { RateLimiter } = lib;

import {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	TechnologySync,
	SyncTechnologiesRequest,
	TechnologyProgress,
} from "./messages";

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
	await lib.safeOutputFile(filePath, JSON.stringify([...technologies.entries()], null, 4));
}

export class ControllerPlugin extends lib.BaseControllerPlugin {
	technologies!: Map<string, Technology>;
	progressRateLimiter!: lib.RateLimiter;
	progressBroadcastId!: ReturnType<typeof setInterval> | null;
	progressToBroadcast!: Set<string>;

	async init() {
		this.technologies = await loadTechnologies(this.controller.config, this.logger);
		this.progressRateLimiter = new RateLimiter({
			maxRate: 1,
			action: () => this.broadcastProgress(),
		});

		this.progressBroadcastId = null;
		this.progressToBroadcast = new Set();

		this.controller.handle(ContributionEvent, this.handleContributionEvent.bind(this));
		this.controller.handle(FinishedEvent, this.handleFinishedEvent.bind(this));
		this.controller.handle(SyncTechnologiesRequest, this.handleSyncTechnologiesRequest.bind(this));
	}

	async onShutdown() {
		this.progressRateLimiter.cancel();
		await saveTechnologies(this.controller.config, this.technologies, this.logger);
	}

	broadcastProgress() {
		let techs = [];
		for (let name of this.progressToBroadcast) {
			let tech = this.technologies.get(name);
			if (tech && tech.progress) {
				techs.push(new TechnologyProgress(name, tech.level, tech.progress));
			}
		}
		this.progressToBroadcast.clear();

		if (techs.length) {
			this.controller.sendTo("allInstances", new ProgressEvent(techs));
		}
	}

	async handleContributionEvent(event: ContributionEvent) {
		let { name, level, contribution } = event;
		let tech = this.technologies.get(name);
		if (!tech) {
			tech = { level, progress: 0, researched: false };
			this.technologies.set(name, tech);

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
			this.progressToBroadcast.add(name);
			this.progressRateLimiter!.activate();

		} else {
			tech.researched = true;
			tech.progress = null;
			this.progressToBroadcast.delete(name);

			this.controller.sendTo("allInstances", new FinishedEvent(name, tech.level));
		}
	}

	async handleFinishedEvent(event: FinishedEvent) {
		let { name, level } = event;
		let tech = this.technologies.get(name);
		if (!tech || tech.level <= level) {
			this.progressToBroadcast.delete(name);
			this.technologies.set(name, { level, progress: null, researched: true });
		}
	}

	async handleSyncTechnologiesRequest(request: SyncTechnologiesRequest): Promise<TechnologySync[]> {
		function baseLevel(name: string): number {
			let match = /-(\d+)$/.exec(name);
			if (!match) {
				return 1;
			}
			return Number.parseInt(match[1], 10);
		}

		for (let instanceTech of request.technologies) {
			let { name, level, progress, researched } = instanceTech;
			let tech = this.technologies.get(name);
			if (!tech) {
				this.technologies.set(name, { level, progress, researched });
				if (progress) {
					this.progressToBroadcast.add(name);
				} else if (researched || baseLevel(name) !== level) {
					this.controller.sendTo("allInstances", new FinishedEvent(name, level));
				}

			} else {
				if (tech.level > level || tech.level === level && tech.researched) {
					continue;
				}

				if (tech.level < level || researched) {
					// Send update if the unlocked level is greater
					if (level - Number(!researched) > tech.level - Number(!tech.researched)) {
						this.controller.sendTo("allInstances", new FinishedEvent(name, level - Number(!researched)));
					}
					tech.level = level;
					tech.progress = progress;
					tech.researched = researched;

					if (progress) {
						this.progressToBroadcast.add(name);
					} else {
						this.progressToBroadcast.delete(name);
					}

				} else if (tech.progress && progress && tech.progress < progress) {
					tech.progress = progress;
					this.progressToBroadcast.add(name);
				}
			}
		}
		this.progressRateLimiter.activate();

		let technologies = [];
		for (let [name, tech] of this.technologies) {
			technologies.push(new TechnologySync(name, tech.level, tech.progress, tech.researched));
		}

		return technologies;
	}
}
