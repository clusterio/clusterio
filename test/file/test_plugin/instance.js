import { BaseInstancePlugin } from "@clusterio/host";

export class InstancePlugin extends BaseInstancePlugin {
	async init() {
		this.logger.info("test_plugin instance loaded");
	}
}
