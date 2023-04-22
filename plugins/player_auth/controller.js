/**
 * @module
 */
"use strict";
const crypto = require("crypto");
const express = require("express");
const util = require("util");
const jwt = require("jsonwebtoken");

const libPlugin = require("@clusterio/lib/plugin");
const libErrors = require("@clusterio/lib/errors");
const { basicType } = require("@clusterio/lib/helpers");

const { FetchPlayerCodeRequest, SetVerifyCodeRequest } = require("./messages");


async function generateCode(length) {
	// ji1lI, 0oOQ, and 2Z are not present to ease reading.
	let letters = "abcdefghkmnpqrstuvwxyzABCDEFGHJKLMNPRSTUVWXY3456789";
	let asyncRandomBytes = util.promisify(crypto.randomBytes);

	let code = [];
	for (let byte of await asyncRandomBytes(length)) {
		// Due to the 51 characters in the letters not fitting perfectly in
		// 256 there's an ever so slight bias towards a with this algorithm.
		code.push(letters[byte % letters.length]);
	}

	return code.join("");
}


class ControllerPlugin extends libPlugin.BaseControllerPlugin {
	async init() {
		// Store of validation attempts by players
		this.players = new Map();

		// Periodically remove expired entries
		setInterval(() => {
			let now = Date.now();
			for (let [player, entry] of this.players) {
				if (entry.expires < now) {
					this.players.delete(player);
				}
			}
		}, 60e3).unref();

		this.controller.app.get("/api/player_auth/servers", (req, res) => {
			let servers = [];
			for (let instance of this.controller.instances.values()) {
				if (instance.status === "running" && instance.config.get("player_auth.load_plugin")) {
					servers.push(instance.config.get("factorio.settings")["name"] || "unnamed server");
				}
			}
			res.send(servers);
		});

		this.controller.app.post("/api/player_auth/player_code", express.json(), (req, res, next) => {
			this.handlePlayerCode(req, res).catch(next);
		});

		this.controller.app.post("/api/player_auth/verify", express.json(), (req, res, next) => {
			this.handleVerify(req, res).catch(next);
		});

		this.controller.register(FetchPlayerCodeRequest, this.handleFetchPlayerCodeRequest.bind(this));
		this.controller.register(SetVerifyCodeRequest, this.handleSetVerifyCodeRequest.bind(this));
	}

	async handlePlayerCode(req, res) {
		if (basicType(req.body) !== "object") {
			res.sendStatus(400);
			return;
		}

		let playerCode = req.body.player_code;
		if (typeof playerCode !== "string") {
			res.sendStatus(400);
			return;
		}

		for (let entry of this.players.values()) {
			if (entry.playerCode === playerCode && entry.expires > Date.now()) {
				let verifyCode = await generateCode(this.controller.config.get("player_auth.code_length"));
				let secret = Buffer.from(this.controller.config.get("controller.auth_secret"), "base64");
				let verifyToken = jwt.sign(
					{
						aud: "player_auth.verify_code",
						exp: Math.floor(entry.expires / 1000),
						verify_code: verifyCode,
						player_code: playerCode,
					},
					secret
				);

				res.send({ verify_code: verifyCode, verify_token: verifyToken });
				return;
			}
		}

		res.send({ error: true, message: "invalid player_code" });
	}

	async handleVerify(req, res) {
		if (basicType(req.body) !== "object") {
			res.sendStatus(400);
			return;
		}

		let playerCode = req.body.player_code;
		if (typeof playerCode !== "string") {
			res.sendStatus(400);
			return;
		}

		let verifyCode = req.body.verify_code;
		if (typeof verifyCode !== "string") {
			res.sendStatus(400);
			return;
		}

		let verifyToken = req.body.verify_token;
		if (typeof verifyToken !== "string") {
			res.sendStatus(400);
			return;
		}

		let secret = Buffer.from(this.controller.config.get("controller.auth_secret"), "base64");
		try {
			let payload = jwt.verify(verifyToken, secret, { audience: "player_auth.verify_code" });
			if (payload.verify_code !== verifyCode) {
				throw new Error("invalid verify_code");
			}

			if (payload.player_code !== playerCode) {
				throw new Error("invalid player_code");
			}

		} catch (err) {
			res.send({ error: true, message: err.message });
			return;
		}

		for (let [player, entry] of this.players) {
			if (entry.playerCode === playerCode && entry.expires > Date.now()) {
				if (entry.verifyCode === verifyCode) {
					let user = this.controller.userManager.users.get(player);
					if (!user) {
						res.send({ error: true, message: "invalid user" });
						return;
					}

					let token = user.createToken(secret);
					res.send({ verified: true, token });
					return;

				}
				res.send({ verified: false });
				return;

			}
		}

		res.send({ error: true, message: "invalid player_code" });
	}

	async handleFetchPlayerCodeRequest(request) {
		let playerCode = await generateCode(this.controller.config.get("player_auth.code_length"));
		let expires = Date.now() + this.controller.config.get("player_auth.code_timeout") * 1000;
		this.players.set(request.player, { playerCode, verifyCode: null, expires });
		return { player_code: playerCode, controller_url: this.controller.getControllerUrl() };
	}

	async handleSetVerifyCodeRequest(request) {
		let { player, verifyCode } = request;
		if (!this.players.has(player)) {
			throw new libErrors.RequestError("invalid player");
		}

		let entry = this.players.get(player);
		if (entry.expires < Date.now()) {
			throw new libErrors.RequestError("invalid player");
		}

		entry.verifyCode = verifyCode;
	}
}

module.exports = {
	ControllerPlugin,

	// For testing only
	_generateCode: generateCode,
};
