const fs = require("fs-extra");
const path = require("path");

const plugin = require("lib/plugin");


class MasterPlugin extends plugin.BaseMasterPlugin {
	async init() {
		this.technologies = await loadTechnologies(this.master.config);
		this.lastProgressBroadcast = Date.now();
		this.progressBroadcastId = null;
		this.progressToBroadcast = new Set();
	}

	async onExit() {
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
		let techs = []
		for (let name of this.progressToBroadcast) {
			let tech = this.technologies.get(name);
			if (tech.progress) {
				techs.push({ name, level: tech.level, progress: tech.progress });
			}
		}
		this.progressToBroadcast.clear();

		this.lastProgressBroadcast = Date.now();
		if (techs.length) {
			for (let slaveConnection of this.master.slaveConnections.values()) {
				this.info.messages.progress.send(slaveConnection, { technologies: techs });
			}
		}
	}

	async contributionEventHandler(message) {
		let { name, level, contribution } = message.data;
		let tech = this.technologies.get(name);
		if (!tech) {
			tech = { level, progress: 0, researched: false };
			this.technologies.set(name, tech)

		// Ignore contribution to already researched technologies
		} else if (tech.level > level || tech.level === level && tech.researched) {
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

			for (let slaveConnection of this.master.slaveConnections.values()) {
				this.info.messages.finished.send(slaveConnection, {
					name,
					level: tech.level
				});
			}
		}
	}

	async finishedEventHandler(message) {
		let { name, level } = message.data;
		let tech = this.technologies.get(name);
		if (!tech || tech.level <= level) {
			this.progressToBroadcast.delete(name);
			this.technologies.set(name, { level, progress: null, researched: true })
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
			let [name, level, progress, researched] =  instanceTech;
			let tech = this.technologies.get(name);
			if (!tech) {
				this.technologies.set(name, { level, progress, researched });
				if (progress) {
					this.progressToBroadcast.add(name);
				} else if (researched || baseLevel(name) != level) {
					for (let slaveConnection of this.master.slaveConnections.values()) {
						this.info.messages.finished.send(slaveConnection, { name, level });
					}
				}

			} else {
				if (tech.level > level || tech.level === level && tech.researched) {
					continue;
				}

				if (tech.level < level || researched) {
					tech.level = level;
					tech.progress = progress;
					tech.researched = researched;
					for (let slaveConnection of this.master.slaveConnections.values()) {
						this.info.messages.finished.send(slaveConnection, { name, level });
					}

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
			technologies.push([ name, tech.level, tech.progress, tech.researched ])
		}

		return { technologies }
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
	MasterPlugin
}
