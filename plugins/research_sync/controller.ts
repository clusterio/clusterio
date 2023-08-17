"use strict";
const fs = require("fs-extra");
const path = require("path");

const lib = require("@clusterio/lib");
const { RateLimiter } = lib;

const {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	Technology,
	SyncTechnologiesRequest,
} = require("./messages");


async function loadTechnologies(controllerConfig, logger) {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "technologies.json");
	logger.verbose(`Loading ${filePath}`);
	try {
		return new Map(JSON.parse(await fs.readFile(filePath)));

	} catch (err) {
		if (err.code === "ENOENT") {
			logger.verbose("Creating new technologies database");
			return new Map();

		}
		throw err;
	}
}

async function saveTechnologies(controllerConfig, technologies, logger) {
	let filePath = path.join(controllerConfig.get("controller.database_directory"), "technologies.json");
	logger.verbose(`writing ${filePath}`);
	await lib.safeOutputFile(filePath, JSON.stringify([...technologies.entries()], null, 4));
}

class ControllerPlugin extends lib.BaseControllerPlugin {
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
			if (tech.progress) {
				techs.push({ name, level: tech.level, progress: tech.progress });
			}
		}
		this.progressToBroadcast.clear();

		if (techs.length) {
			this.controller.sendTo("allInstances", new ProgressEvent(techs));
		}
	}

	async handleContributionEvent(event) {
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

		let newProgress = tech.progress + contribution;
		if (newProgress < 1) {
			tech.progress = newProgress;
			this.progressToBroadcast.add(name);
			this.progressRateLimiter.activate();

		} else {
			tech.researched = true;
			tech.progress = null;
			this.progressToBroadcast.delete(name);

			this.controller.sendTo("allInstances", new FinishedEvent(name, tech.level));
		}
	}

	async handleFinishedEvent(event) {
		let { name, level } = event;
		let tech = this.technologies.get(name);
		if (!tech || tech.level <= level) {
			this.progressToBroadcast.delete(name);
			this.technologies.set(name, { level, progress: null, researched: true });
		}
	}

	async handleSyncTechnologiesRequest(request) {
		function baseLevel(name) {
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
					this.controller.sendTo("allInstances", new FinishedEvent(name, tech));
				}

			} else {
				if (tech.level > level || tech.level === level && tech.researched) {
					continue;
				}

				if (tech.level < level || researched) {
					// Send update if the unlocked level is greater
					if (level - !researched > tech.level - !tech.researched) {
						this.controller.sendTo("allInstances", new FinishedEvent(name, level - !researched));
					}
					tech.level = level;
					tech.progress = progress;
					tech.researched = researched;

					if (progress) {
						this.progressToBroadcast.add(name);
					} else {
						this.progressToBroadcast.delete(name);
					}

				} else if (tech.progress < progress) {
					tech.progress = progress;
					this.progressToBroadcast.add(name);
				}
			}
		}
		this.progressRateLimiter.activate();

		let technologies = [];
		for (let [name, tech] of this.technologies) {
			technologies.push(new Technology(name, tech.level, tech.progress, tech.researched));
		}

		return technologies;
	}
}


module.exports = {
	ControllerPlugin,
};
