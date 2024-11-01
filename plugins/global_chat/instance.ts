import * as lib from "@clusterio/lib";
import { BaseInstancePlugin } from "@clusterio/host";
import { ChatEvent } from "./messages";

/**
 * Removes gps and train tags from messags
 *
 * @param content - string to strip tags from.
 * @returns stripped string.
 */
function removeTags(content: string): string {
	return content.replace(/(\[gps=-?\d+,-?\d+\]|\[train=\d+\])/g, "");
}

export class InstancePlugin extends BaseInstancePlugin {
	messageQueue: string[] = [];

	async init() {
		if (!this.instance.config.get("factorio.enable_script_commands")) {
			throw new Error("global_chat plugin requires script commands.");
		}

		this.instance.handle(ChatEvent, this.handleChatEvent.bind(this));
	}

	onControllerConnectionEvent(event: string) {
		if (event === "connect") {
			for (let message of this.messageQueue) {
				this.sendChat(message);
			}
			this.messageQueue = [];
		}
	}

	async handleChatEvent(event: ChatEvent) {
		// TODO check if cross server chat is enabled
		let content = `[${event.instanceName}] ${removeTags(event.content)}`;
		await this.sendRcon(`/sc game.print('${lib.escapeString(content)}')`, true);
	}

	sendChat(message: string) {
		this.instance.sendTo("allInstances", new ChatEvent(this.instance.name, message));
	}

	async onOutput(output: lib.ParsedFactorioOutput) {
		if (output.type === "action" && output.action === "CHAT") {
			if (this.host.connector.connected) {
				this.sendChat(output.message);
			} else {
				this.messageQueue.push(output.message);
			}
		}
	}

	// TODO implement info command in lua?
}

// For testing only
export const _removeTags = removeTags;
