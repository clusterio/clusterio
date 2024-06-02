import * as lib from "@clusterio/lib";
import { BaseHostPlugin } from "@clusterio/host";
//%if multi_context
import { PluginExampleEvent, PluginExampleRequest } from "./messages";
//%endif

export class HostPlugin extends BaseHostPlugin {
//%if multi_context
	async init() {
		this.host.handle(PluginExampleEvent, this.handlePluginExampleEvent.bind(this));
		this.host.handle(PluginExampleRequest, this.handlePluginExampleRequest.bind(this));
	}
//%endif

	async onHostConfigFieldChanged(field: string, curr: unknown, prev: unknown) {
		this.logger.info(`host::onInstanceConfigFieldChanged ${field}`);
	}

	async onShutdown() {
		this.logger.info("host::onShutdown");
	}
//%if multi_context

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
//%endif
}
