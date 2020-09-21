"use strict";
const fs = require("fs-extra");
const path = require("path");

const plugin = require("@clusterio/lib/plugin");


class MasterPlugin extends plugin.BaseMasterPlugin {
	async init() {
		this.technologies = await loadTechnologies(this.master.config);
		this.lastProgressBroadcast = Date.now();
		this.progressBroadcastId = null;
		this.progressToBroadcast = new Set();
	}

	async onShutdown() {
		if (this.progressBroadcastId) {
			clearTimeout(this.progressBroadcastId);
		}
		await saveTechnologies(this.master.config, this.technologies);
	}

	registerProgress() {
		// Rate limit progress broadcasts to one per second
		if (Date.now() < this.lastProgressBroadcast + 1000) {
			if (!this.progressBroadcastId) {
				this.progressBroadcastId = setTimeout(() => {
					this.broadcastProgress();
					this.progressBroadcastId = null;
				}, 2000);
			}

		} else {
			if (this.progressBroadcastId) {
				clearTimeout(this.progressBroadcastId);
			}
			this.broadcastProgress();
		}
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

		this.lastProgressBroadcast = Date.now();
		if (techs.length) {
			this.broadcastEventToSlaves(this.info.messages.progress, { technologies: techs });
		}
	}

	async contributionEventHandler(message) {
		let { name, level, contribution } = message.data;
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
			this.registerProgress();

		} else {
			tech.researched = true;
			tech.progress = null;
			this.progressToBroadcast.delete(name);

			this.broadcastEventToSlaves(this.info.messages.finished, { name, level: tech.level });
		}
	}

	async finishedEventHandler(message) {
		let { name, level } = message.data;
		let tech = this.technologies.get(name);
		if (!tech || tech.level <= level) {
			this.progressToBroadcast.delete(name);
			this.technologies.set(name, { level, progress: null, researched: true });
		}
	}

	async syncTechnologiesRequestHandler(message) {
		function baseLevel(name) {
			let match = /-(\d+)$/.exec(name);
			if (!match) {
				return 1;
			} else {
				return Number.parseInt(match[1], 10);
			}
		}

		for (let instanceTech of message.data.technologies) {
			let [name, level, progress, researched] = instanceTech;
			let tech = this.technologies.get(name);
			if (!tech) {
				this.technologies.set(name, { level, progress, researched });
				if (progress) {
					this.progressToBroadcast.add(name);
				} else if (researched || baseLevel(name) != level) {
					this.broadcastEventToSlaves(this.info.messages.finished, { name, level });
				}

			} else {
				if (tech.level > level || tech.level === level && tech.researched) {
					continue;
				}

				if (tech.level < level || researched) {
					// Send update if the unlocked level is greater
					if (level - !researched > tech.level - !tech.researched) {
						this.broadcastEventToSlaves(this.info.messages.finished, { name, level: level - !researched });
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
		this.registerProgress();

		let technologies = [];
		for (let [name, tech] of this.technologies) {
			technologies.push([name, tech.level, tech.progress, tech.researched]);
		}

		return { technologies };
	}
}

async function loadTechnologies(masterConfig) {
	let filePath = path.join(masterConfig.get("master.database_directory"), "technologies.json");
	console.log(`Loading ${filePath}`);
	try {
		return new Map(JSON.parse(await fs.readFile(filePath)));

	} catch (err) {
		if (err.code === "ENOENT") {
			console.log("Creating new technologies database");
			return new Map();

		} else {
			throw err;
		}
	}
}

async function saveTechnologies(masterConfig, technologies) {
	let filePath = path.join(masterConfig.get("master.database_directory"), "technologies.json");
	console.log(`writing ${filePath}`);
	await fs.outputFile(filePath, JSON.stringify([...technologies.entries()], null, 4));
}


module.exports = {
	MasterPlugin,
};
