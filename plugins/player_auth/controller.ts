import crypto from "crypto";
import express, { type Request, type Response } from "express";
import util from "util";
import jwt from "jsonwebtoken";

import { Static } from "@sinclair/typebox";
import type { ControllerPluginContext } from "@clusterio/controller";
import { basicType, RequestError } from "@clusterio/lib";

import { FetchPlayerCodeRequest, PlayerAuthServer, SetVerifyCodeRequest } from "./messages.js";


async function generateCode(length: number): Promise<string> {
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


type PlayerCode = { playerCode: string, verifyCode: string | null, expiresMs: number };

export default async function loadControllerPlugin(context: ControllerPluginContext) {
	const { controller } = context;

	// Store of validation attempts by players
	const players = new Map<string, PlayerCode>();

	// Periodically remove expired entries
	setInterval(() => {
		let now = Date.now();
		for (let [player, entry] of players) {
			if (entry.expiresMs < now) {
				players.delete(player);
			}
		}
	}, 60e3).unref();

	controller.app.get("/api/player_auth/servers", (req: Request, res: Response) => {
		const servers: Static<typeof PlayerAuthServer.jsonSchema>[] = [];

		for (const instance of controller.instances.values()) {
			const pluginLoaded = instance.config.get("player_auth.load_plugin");
			const assignedHost = instance.config.get("instance.assigned_host");
			if (instance.status !== "running" || !pluginLoaded || assignedHost === null) {
				continue;
			}

			const host = controller.hosts.get(assignedHost);
			if (!host) {
				continue;
			}

			const address = instance.gamePort !== undefined
				? `${host.publicAddress}:${instance.gamePort}`
				: host.publicAddress;

			const settings = instance.config.get("factorio.settings");
			const includeAddress = controller.config.get("player_auth.show_connect_address");
			servers.push({
				name: settings["name"] as string || "unnamed server",
				factorioVersion: instance.factorioVersion,
				address: (includeAddress && host.publicAddress !== "") ? address : undefined,
			});
		}

		res.send(servers);
	});

	controller.app.post(
		"/api/player_auth/player_code",
		express.json(),
		(req: Request, res: Response, next: any) => {
			handlePlayerCode(req, res).catch(next);
		}
	);

	controller.app.post(
		"/api/player_auth/verify",
		express.json(),
		(req: Request, res: Response, next: any) => {
			handleVerify(req, res).catch(next);
		}
	);

	controller.handle(FetchPlayerCodeRequest, async (request: FetchPlayerCodeRequest) => {
		let playerCode = await generateCode(controller.config.get("player_auth.code_length"));
		let expiresMs = Date.now() + controller.config.get("player_auth.code_timeout") * 1000;
		players.set(request.player, { playerCode, verifyCode: null, expiresMs });
		return { playerCode, controllerUrl: controller.getControllerUrl() };
	});

	controller.handle(SetVerifyCodeRequest, async (request: SetVerifyCodeRequest) => {
		let { player, verifyCode } = request;

		let entry = players.get(player);
		if (!entry || entry.expiresMs < Date.now()) {
			throw new RequestError("invalid player");
		}

		entry.verifyCode = verifyCode;
	});

	async function handlePlayerCode(req: Request, res: Response) {
		if (basicType(req.body) !== "object") {
			res.sendStatus(400);
			return;
		}

		let playerCode = req.body.player_code;
		if (typeof playerCode !== "string") {
			res.sendStatus(400);
			return;
		}

		for (let entry of players.values()) {
			if (entry.playerCode === playerCode && entry.expiresMs > Date.now()) {
				let verifyCode = await generateCode(controller.config.get("player_auth.code_length"));
				let verifyToken = jwt.sign(
					{
						aud: "player_auth.verify_code",
						exp: Math.floor(entry.expiresMs / 1000),
						verify_code: verifyCode,
						player_code: playerCode,
					},
					controller.authSecret
				);

				res.send({ verify_code: verifyCode, verify_token: verifyToken });
				return;
			}
		}

		res.send({ error: true, message: "invalid player_code" });
	}

	async function handleVerify(req: Request, res: Response) {
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

		try {
			let payload = jwt.verify(
				verifyToken, controller.authSecret, { audience: "player_auth.verify_code" }
			) as jwt.JwtPayload;

			if (payload.verify_code !== verifyCode) {
				throw new Error("invalid verify_code");
			}

			if (payload.player_code !== playerCode) {
				throw new Error("invalid player_code");
			}

		} catch (err: any) {
			res.send({ error: true, message: err.message });
			return;
		}

		for (let [player, entry] of players) {
			if (entry.playerCode === playerCode && entry.expiresMs > Date.now()) {
				if (entry.verifyCode === verifyCode) {
					let user = controller.users.getByName(player);
					if (!user) {
						res.send({ error: true, message: "invalid user" });
						return;
					}

					let token = controller.users.signUserToken(user);
					res.send({ verified: true, token });
					return;

				}
				res.send({ verified: false });
				return;

			}
		}

		res.send({ error: true, message: "invalid player_code" });
	}
}

// For testing only
export const _generateCode = generateCode;
