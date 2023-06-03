"use strict";
const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");
const {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	Technology,
	SyncTechnologiesRequest,
} = require("./messages");


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
		this.instance.handle(ProgressEvent, this.handleProgressEvent.bind(this));
		this.instance.handle(FinishedEvent, this.handleFinishedEvent.bind(this));
	}

	async researchContribution(tech) {
		this.instance.sendTo(new ContributionEvent(tech.name, tech.level, tech.contribution), "controller");
	}

	async handleProgressEvent(event) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let techsJson = libLuaTools.escapeString(JSON.stringify(event.technologies));
		await this.sendOrderedRcon(`/sc research_sync.update_progress("${techsJson}")`, true);
	}

	async researchFinished(tech) {
		this.instance.sendTo(new FinishedEvent(tech.name, tech.level), "allInstances");
	}

	async handleFinishedEvent(event) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let { name, level } = event;
		await this.sendOrderedRcon(
			`/sc research_sync.research_technology("${libLuaTools.escapeString(name)}", ${level})`, true
		);
	}

	async onStart() {
		let dumpJson = await this.sendOrderedRcon("/sc research_sync.dump_technologies()");
		let techsToSend = [];
		let instanceTechs = new Map();
		for (let tech of JSON.parse(dumpJson)) {
			techsToSend.push(new Technology(
				tech.name,
				tech.level,
				tech.progress || null,
				tech.researched,
			));
			instanceTechs.set(tech.name, tech);
		}

		let controllerTechs = await this.instance.sendTo(new SyncTechnologiesRequest(techsToSend), "controller");
		this.syncStarted = true;
		let techsToSync = [];
		for (let controllerTech of controllerTechs) {
			let { name, level, progress, researched } = controllerTech;
			let instanceTech = instanceTechs.get(name);
			if (
				!instanceTech
				|| instanceTech.level !== level
				|| (instanceTech.progress || null) !== progress
				|| instanceTech.researched !== researched
			) {
				techsToSync.push(controllerTech);
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
