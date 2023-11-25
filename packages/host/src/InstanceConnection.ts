import * as lib from "@clusterio/lib";
import type Host from "./Host";
import type Instance from "./Instance";


export default class InstanceConnection extends lib.Link {
	plugins = new Map<string, string>();

	constructor(
		connector: lib.VirtualConnector,
		public host: Host,
		public instance: Instance,
	) {
		super(connector);
		this.router = this.host.router;

		this.handle(lib.InstanceInitialisedEvent, this.handleInstanceInitialisedEvent.bind(this));
		this.snoopEvent(lib.InstanceStatusChangedEvent, this.snoopInstanceStatusChangedEvent.bind(this));
	}

	async handleInstanceInitialisedEvent(event: lib.InstanceInitialisedEvent) {
		this.plugins = new Map(Object.entries(event.plugins));
	}

	async snoopInstanceStatusChangedEvent(event: lib.InstanceStatusChangedEvent) {
		if (this.instance.status === "stopped") {
			this.host.instanceConnections.delete(this.instance.id);
		}
	}
}
