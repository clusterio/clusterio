"use strict";


class FetchPlayerCodeRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "player_auth";

	/** @type {string} */
	player;

	constructor(player) {
		this.player = player;
	}

	static jsonSchema = {
		type: "object",
		required: ["player"],
		properties: {
			"player": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.player);
	}
}
FetchPlayerCodeRequest.Response = class Response {
	/** @type {string} */
	playerCode;
	/** @type {string} */
	controllerUrl;

	constructor(playerCode, controllerUrl) {
		this.playerCode = playerCode;
		this.controllerUrl = controllerUrl;
	}

	static jsonSchema = {
		type: "object",
		required: ["playerCode", "controllerUrl"],
		properties: {
			"playerCode": { type: "string" },
			"controllerUrl": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.playerCode, json.controllerUrl);
	}
};

class SetVerifyCodeRequest {
	static type = "request";
	static src = "instance";
	static dst = "controller";
	static plugin = "player_auth";

	/** @type {string} */
	player;
	/** @type {string} */
	verifyCode;

	constructor(player, verifyCode) {
		this.player = player;
		this.verifyCode = verifyCode;
	}

	static jsonSchema = {
		type: "object",
		required: ["player", "verifyCode"],
		properties: {
			"player": { type: "string" },
			"verifyCode": { type: "string" },
		},
	};

	static fromJSON(json) {
		return new this(json.playerCode, json.verifyCode);
	}
}

module.exports = {
	FetchPlayerCodeRequest,
	SetVerifyCodeRequest,
};
