import * as lib from "@clusterio/lib";
import {
	ContributionEvent,
	ProgressEvent,
	FinishedEvent,
	TechnologySync,
	SyncTechnologiesRequest,
} from "./messages";

// ./module/sync.lua
type IpcContribution = {
	name: string,
	level: number,
	contribution: number,
};
type IpcFinished = {
	name: string,
	level: number,
};

export class InstancePlugin extends lib.BaseInstancePlugin {
	syncStarted!: boolean;

	unexpectedError(err: Error) {
		this.logger.error(`Unexpected error:\n${err.stack}`);
	}

	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("research_sync plugin requires save patching.");
		}

		this.instance.server.on("ipc-research_sync:contribution", (tech: IpcContribution) => {
			this.researchContribution(tech).catch(err => this.unexpectedError(err));
		});
		this.instance.server.on("ipc-research_sync:finished", (tech: IpcFinished) => {
			this.researchFinished(tech).catch(err => this.unexpectedError(err));
		});

		this.syncStarted = false;
		this.instance.handle(ProgressEvent, this.handleProgressEvent.bind(this));
		this.instance.handle(FinishedEvent, this.handleFinishedEvent.bind(this));
	}

	async researchContribution(tech: IpcContribution) {
		this.instance.sendTo("controller", new ContributionEvent(tech.name, tech.level, tech.contribution));
	}

	async handleProgressEvent(event: ProgressEvent) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let techsJson = lib.escapeString(JSON.stringify(event.technologies));
		await this.sendOrderedRcon(`/sc research_sync.update_progress("${techsJson}")`, true);
	}

	async researchFinished(tech: IpcFinished) {
		this.instance.sendTo("allInstances", new FinishedEvent(tech.name, tech.level));
	}

	async handleFinishedEvent(event: FinishedEvent) {
		if (!this.syncStarted || !["starting", "running"].includes(this.instance.status)) {
			return;
		}
		let { name, level } = event;
		await this.sendOrderedRcon(
			`/sc research_sync.research_technology("${lib.escapeString(name)}", ${level})`, true
		);
	}

	async onStart() {
		let dumpJson = await this.sendOrderedRcon("/sc research_sync.dump_technologies()");
		let techsToSend = [];
		let instanceTechs = new Map();
		for (let tech of JSON.parse(dumpJson)) {
			techsToSend.push(new TechnologySync(
				tech.name,
				tech.level,
				tech.progress || null,
				tech.researched,
			));
			instanceTechs.set(tech.name, tech);
		}

		let controllerTechs = await this.instance.sendTo("controller", new SyncTechnologiesRequest(techsToSend));
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
			let syncJson = lib.escapeString(JSON.stringify(techsToSync));
			await this.sendOrderedRcon(`/sc research_sync.sync_technologies("${syncJson}")`, true);
		}
	}
}
