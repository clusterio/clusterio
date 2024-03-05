import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import { PluginExampleEvent, PluginExampleRequest } from "./messages";
//%if module

type PuginExampleIPC = {
	tick: number,
	player_name: string,
};
//%endif

export class InstancePlugin extends BaseInstancePlugin {
	async init() {
		this.instance.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.instance.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
//%if module
		this.instance.server.handle("ipc-__plugin_name__-plugin_example_ipc", this.handlePluginExampleIPC.bind(this));
//%endif
	}

	async onInstanceConfigFieldChanged(field: string, curr: unknown, prev: unknown) {
		this.logger.info(`instance::onInstanceConfigFieldChanged ${field}`);
	}

	async onStart() {
		this.logger.info("instance::onStart");
	}

	async onStop() {
		this.logger.info("instance::onStop");
	}

	async onPlayerEvent(event: lib.PlayerEvent) {
		this.logger.info(`onPlayerEvent::onPlayerEvent ${JSON.stringify(event)}`);
//%if module
		this.sendRcon("/sc __plugin_name__.foo()");
//%endif
	}

	async handlePluginExampleEvent(event: PluginExampleEvent) {
		this.logger.info(JSON.stringify(event));
	}

	async handlePluginExampleRequest(request: PluginExampleRequest) {
		this.logger.info(JSON.stringify(request));
		return {
			myResponseString: request.myString,
			myResponseNumbers: request.myNumberArray,
		};
	}
//%if module

	async handlePluginExampleIPC(event: PuginExampleIPC) {
		this.logger.info(JSON.stringify(event));
	}
//%endif
}
