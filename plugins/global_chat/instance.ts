import * as lib from "@clusterio/lib";
import type { InstancePluginContext } from "@clusterio/host";
import { ChatEvent } from "./messages.js";

/**
 * Removes server-specific tags from messages.
 *
 * @param content - string to strip tags from.
 * @returns stripped string.
 */
function removeTags(content: string): string {
	return content.replace(/\[(?:gps|special-item|train|train-stop)=\S*?\]/gm, "");
}

export default async function(context: InstancePluginContext) {
	const { instance, host, plugin } = context;
	let messageQueue: string[] = [];

	function sendChat(message: string) {
		instance.sendTo("allInstances", new ChatEvent(instance.name, message));
	}

	instance.handle(ChatEvent, async (event: ChatEvent) => {
		// TODO check if cross server chat is enabled
		let content = `[${event.instanceName}] ${removeTags(event.content)}`;
		await instance.sendRcon(`/sc game.print('${lib.escapeString(content)}')`, true, plugin.name);
	});

	instance.hooks.controllerConnectionEvent.attach(plugin.name, (event) => {
		if (event === "connect") {
			for (let message of messageQueue) {
				sendChat(message);
			}
			messageQueue = [];
		}
	});

	instance.hooks.output.attach(plugin.name, async (output) => {
		if (output.type === "action" && output.action === "CHAT") {
			if (host.connector.connected) {
				sendChat(output.message);
			} else {
				messageQueue.push(output.message);
			}
		}
	});

	// TODO implement info command in lua?
}

// For testing only
export const _removeTags = removeTags;
