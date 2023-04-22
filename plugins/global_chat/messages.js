"use strict";

class ChatEvent {
	static type = "event";
	static src = ["control", "instance"];
	static dst = "instance";
	static plugin = "global_chat";

	/** @type {string} */
	instanceName;
	/** @type {string} */
	content;

	constructor(instanceName, content) {
		this.instanceName = instanceName;
		this.content = content;
	}

	static jsonSchema = {
		type: "object",
		required: ["instanceName", "content"],
		properties: {
			instanceName: { type: "string" },
			content: { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.instanceName, json.content);
	}
}

module.exports = {
	ChatEvent,
};
