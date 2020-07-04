"use strict";
const needle = require("needle");

const plugin = require("lib/plugin");
const luaTools = require("lib/luaTools");


function unexpectedError(err) {
	console.log("Unexpected error in research_sync");
	console.log("---------------------------------");
	console.log(err);
}

class InstancePlugin extends plugin.BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("research_sync plugin requires save patching.");
		}

		this.instance.server.on("ipc-research_sync:contribution", (tech) => {
			this.researchContribution(tech).catch(unexpectedError);
		});
		this.instance.server.on("ipc-research_sync:finished", (tech) => {
			this.researchFinished(tech).catch(unexpectedError);
		});
	}

	async researchContribution(tech) {
		this.info.messages.contribution.send(this.instance, tech);
	}

	async progressEventHandler(message) {
		let techsJson = luaTools.escapeString(JSON.stringify(message.data.technologies));
		await this.instance.server.sendRcon(`/sc research_sync.update_progress("${techsJson}")`, true);
	}

	async researchFinished(tech) {
		this.info.messages.finished.send(this.instance, tech);
	}

	async finishedEventHandler(message) {
		let { name, level, researched } = message.data;
		await this.instance.server.sendRcon(
			`/sc research_sync.research_technology("${luaTools.escapeString(name)}", ${level})`, true
		);
	}

	async onStart() {
		let dumpJson = await this.instance.server.sendRcon("/sc research_sync.dump_technologies()");
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
			let syncJson = luaTools.escapeString(JSON.stringify(techsToSync));
			await this.instance.server.sendRcon(`/sc research_sync.sync_technologies("${syncJson}")`, true);
		}
	}
}

module.exports = {
	InstancePlugin,
};
