/**
 * @module
 */
"use strict";
const lib = require("@clusterio/lib");
const { ChatEvent } = require("./messages");


/**
 * Removes gps and train tags from messags
 *
 * @param {string} content - string to strip tags from.
 * @returns {string} stripped string.
 */
function removeTags(content) {
	return content.replace(/(\[gps=-?\d+,-?\d+\]|\[train=\d+\])/g, "");
}

class InstancePlugin extends lib.BaseInstancePlugin {
	async init() {
		this.messageQueue = [];
		this.instance.handle(ChatEvent, this.handleChatEvent.bind(this));
	}

	onControllerConnectionEvent(event) {
		if (event === "connect") {
			for (let message of this.messageQueue) {
				this.sendChat(message);
			}
			this.messageQueue = [];
		}
	}

	async handleChatEvent(event) {
		// TODO check if cross server chat is enabled
		let content = `[${event.instanceName}] ${removeTags(event.content)}`;
		await this.sendRcon(`/sc game.print('${lib.escapeString(content)}')`, true);
	}

	sendChat(message) {
		this.instance.sendTo("allInstances", new ChatEvent(this.instance.name, message));
	}

	async onOutput(output) {
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

module.exports = {
	InstancePlugin,

	// For testing only
	_removeTags: removeTags,
};
