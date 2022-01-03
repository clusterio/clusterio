"use strict";
const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");


class InstancePlugin extends libPlugin.BaseInstancePlugin {
	unexpectedError(err) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("research_sync plugin requires save patching.");
		}

		this.instance.server.on("ipc-research_sync:contribution", (tech) => {
			this.researchContribution(tech).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-research_sync:finished", (tech) => {
			this.researchFinished(tech).catch(err => this.unexpectedError(err));
		});

		this.syncStarted = false;
	}

	async researchContribution(tech) {
		this.info.messages.contribution.send(this.instance, tech);
	}

	async progressEventHandler(message) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let techsJson = libLuaTools.escapeString(JSON.stringify(message.data.technologies));
		await this.sendOrderedRcon(`/sc research_sync.update_progress("${techsJson}")`, true);
	}

	async researchFinished(tech) {
		this.info.messages.finished.send(this.instance, tech);
	}

	async finishedEventHandler(message) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let { name, level } = message.data;
		await this.sendOrderedRcon(
			`/sc research_sync.research_technology("${libLuaTools.escapeString(name)}", ${level})`, true
		);
	}

	async onStart() {
		let dumpJson = await this.sendOrderedRcon("/sc research_sync.dump_technologies()");
		let techsToSend = [];
		let instanceTechs = new Map();
		for (let tech of JSON.parse(dumpJson)) {
			techsToSend.push([
				tech.name,
				tech.level,
				tech.progress || null,
				tech.researched,
			]);
			instanceTechs.set(tech.name, tech);
		}

		let response = await this.info.messages.syncTechnologies.send(this.instance, { technologies: techsToSend });
		this.syncStarted = true;
		let techsToSync = [];
		for (let masterTech of response.technologies) {
			let [name, level, progress, researched] = masterTech;
			let instanceTech = instanceTechs.get(name);
			if (
				!instanceTech
				|| instanceTech.level !== level
				|| (instanceTech.progress || null) !== progress
				|| instanceTech.researched !== researched
			) {
				techsToSync.push(masterTech);
			}
		}

		if (techsToSync.length) {
			let syncJson = libLuaTools.escapeString(JSON.stringify(techsToSync));
			await this.sendOrderedRcon(`/sc research_sync.sync_technologies("${syncJson}")`, true);
		}
	}
}

module.exports = {
	InstancePlugin,
};
