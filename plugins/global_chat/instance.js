const plugin = require("lib/plugin");


/**
 * Removes gps and train tags from messags
 */
function removeTags(content) {
	return content.replace(/(\[gps=-?\d+,-?\d+\]|\[train=\d+\])/g, "");
}

/**
 * Escapes a string for inclusion into a lua string
 */
function escapeLuaString(content) {
	return content
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/'/g, "\\'")
		.replace(/\0/g, "\\0")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
	;
}

class InstancePlugin extends plugin.BaseInstancePlugin {
	constructor(...args) {
		super(...args);
	}

	async init() {
		// XXX Nothing?
	}

	async chatEventHandler(message) {
		// TODO check if cross server chat is enabled
		let content = `[${message.data.instance_name}] ${removeTags(message.data.content)}`;
		await this.instance.server.sendRcon(`/sc game.print('${escapeLuaString(content)}')`, true);
	}

	async onOutput(output) {
		if (output.type === "action" && output.action === "CHAT") {
			this.info.messages.chat.send(this.instance, {
				instance_name: this.instance.name,
				content: output.message,
			});
		}
	}

	// TODO implement info command in lua?
}

module.exports = {
	InstancePlugin,

	// For testing only
	_removeTags: removeTags,
	_escapeLuaString: escapeLuaString,
}
