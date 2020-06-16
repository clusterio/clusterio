/**
 * @module
 */
const plugin = require("lib/plugin");
const luaTools = require("lib/luaTools");


/**
 * Removes gps and train tags from messags
 */
function removeTags(content) {
	return content.replace(/(\[gps=-?\d+,-?\d+\]|\[train=\d+\])/g, "");
}

class InstancePlugin extends plugin.BaseInstancePlugin {
	async init() {
		this.messageQueue = [];
	}

	onMasterConnectionEvent(event) {
		if (event === "connect") {
			for (let message of this.messageQueue) {
				this.sendChat(message);
			}
			this.messageQueue = [];
		}
	}

	async chatEventHandler(message) {
		// TODO check if cross server chat is enabled
		let content = `[${message.data.instance_name}] ${removeTags(message.data.content)}`;
		await this.instance.server.sendRcon(`/sc game.print('${luaTools.escapeString(content)}')`, true);
	}

	sendChat(message) {
		this.info.messages.chat.send(this.instance, {
			instance_name: this.instance.name,
			content: message,
		});
	}

	async onOutput(output) {
		if (output.type === "action" && output.action === "CHAT") {
			if (this.slave.connector.connected) {
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
