"use strict";
const assert = require("assert").strict;
const jwt = require("jsonwebtoken");

const mock = require("../../../test/mock");

const controller = require("../dist/node/controller");
const instance = require("../dist/node/instance");
const info = require("../dist/node/index").plugin;
const { FetchPlayerCodeRequest, SetVerifyCodeRequest } = require("../dist/node/messages");
const lib = require("@clusterio/lib");

function postJSON(url, body) {
	return fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("player_auth", function() {
	describe("controller.js", function() {
		describe("generateCode()", function() {
			it("should generate a code of the given length", async function() {
				let code = await controller._generateCode(20);
				assert.equal(typeof code, "string");
				assert.equal(code.length, 20, "incorrect length");
			});
			it("should only use the easy to recognize letters in the alphabet", async function() {
				let chars = new Set();
				for (let i = 0; i < 20; i++) {
					let code = await controller._generateCode(15);
					for (let char of code) {
						chars.add(char);
					}
				}

				for (let char of chars) {
					assert(/[A-Za-z0-9]/.test(char), `Contained non-alphanumeric letter ${char}`);
					assert(/[^ji1lI0oOQ2Z]/.test(char), `Contained banned letter ${char}`);
				}
			});
		});

		describe("ControllerPlugin", function() {
			let controllerPlugin;
			let controllerUrl;
			let endpoint;
			before(async function() {
				controllerPlugin = await mock.createControllerPlugin(controller.ControllerPlugin, info);
				controllerPlugin.controller.mockConfigEntries.set("player_auth.code_length", 10);
				controllerPlugin.controller.mockConfigEntries.set("player_auth.code_timeout", 1);
				controllerUrl = await controllerPlugin.controller.startServer();
			});
			after(async function() {
				if (controllerPlugin) {
					await controllerPlugin.controller.stopServer();
				}
			});

			describe("/api/player_auth/servers", function() {
				it("should return a list of running servers with player_auth loaded", async function() {
					function addInstance(id, status, load, name) {
						controllerPlugin.controller.instances.set(id, {
							config: {
								get(field) {
									if (field === "player_auth.load_plugin") {
										return load;
									} else if (field === "factorio.settings") {
										return { name };
									} else if (field === "instance.id") {
										return id;
									}
									throw new Error(`field ${field} not implemented`);
								},
							},
							status,
						});
					}
					addInstance(1, "running", true, "running loaded");
					addInstance(2, "stopped", true, "stopped loaded");
					addInstance(3, "running", false, "running unloaded");
					addInstance(4, "stopped", false, "stopped unloaded");
					addInstance(5, "running", true, undefined);
					const result = await fetch(`${controllerUrl}/api/player_auth/servers`);
					assert.deepEqual(await result.json(), ["running loaded", "unnamed server"]);
					for (let id of [1, 2, 3, 4, 5]) {
						controllerPlugin.controller.instances.delete(id);
					}
				});
			});

			describe("/api/player_auth/player_code", function() {
				before(function() {
					endpoint = `${controllerUrl}/api/player_auth/player_code`;
				});
				it("should return 400 on invalid json", async function() {
					const result = await postJSON(endpoint, "invalid");
					assert.equal(result.status, 400);
				});
				it("should return 400 on valid json which is not an object", async function() {
					for (let obj of [true, false, null, "string", 123, ["an", "array"]]) {
						const result = await postJSON(endpoint, obj);
						assert.equal(result.status, 400);
					}
				});
				it("should return 400 if player_code is not a string", async function() {
					for (let obj of [true, false, null, 123, [], {}]) {
						const result = await postJSON(endpoint, { player_code: obj });
						assert.equal(result.status, 400);
					}
				});
				it("should return invalid player_code if the code is expired", async function() {
					let expiresMs = Date.now() - 1000;
					controllerPlugin.players.set("expired", { playerCode: "expired", verifyCode: null, expiresMs });
					const result = await postJSON(endpoint, { player_code: "expired" });
					assert.deepEqual(await result.json(), { error: true, message: "invalid player_code" });
				});
				it("should return a verify code and token if code is valid", async function() {
					let expiresMs = Date.now() + 1000;
					controllerPlugin.players.set("valid", { playerCode: "valid", verifyCode: null, expiresMs });
					const result = await postJSON(endpoint, { player_code: "valid" });
					const body = await result.json();
					assert.equal(typeof body.verify_code, "string");
					assert.equal(typeof body.verify_token, "string");
				});
			});

			describe("/api/player_auth/verify", function() {
				before(function() {
					endpoint = `${controllerUrl}/api/player_auth/verify`;
				});
				it("should return 400 on invalid json", async function() {
					const result = await postJSON(endpoint, "invalid");
					assert.equal(result.status, 400);
				});
				it("should return 400 on valid json which is not an object", async function() {
					for (let obj of [true, false, null, "string", 123, ["an", "array"]]) {
						const result = await postJSON(endpoint, obj);
						assert.equal(result.status, 400);
					}
				});
				it("should return 400 if player_code, verify_code or verify_token are not strings", async function() {
					for (let obj of [true, false, null, 123, [], {}]) {
						for (let field of ["player_code", "verify_code", "verify_token"]) {
							const result = await postJSON(endpoint, {
								player_code: "str",
								verify_code: "str",
								verify_token: "str",
								[field]: obj,
							});
							assert.equal(result.status, 400);
						}
					}
				});
				it("should return error if verify_token is not valid", async function() {
					async function verify(tokenParams, error) {
						const result = await postJSON(endpoint, {
							player_code: "player",
							verify_code: "verify",
							verify_token: jwt.sign({
								aud: "player_auth.verify_code",
								player_code: "player",
								verify_code: "verify",
								...tokenParams,
							}, Buffer.from(tokenParams.secret || "TestSecretDoNotUse", "base64")),
						});
						assert.deepEqual((await result.json()).error, true);
					}
					await verify({ secret: "InvalidSecret" });
					await verify({ verify_code: "bad" });
					await verify({ player_code: "bad" });
					await verify({ aud: "not_player_auth" });
				});
				it("should return invalid player_code if the code is expired", async function() {
					let expiresMs = Date.now() - 1000;
					controllerPlugin.players.set("expired", { playerCode: "expired", verifyCode: "verify", expiresMs });
					const result = await postJSON(endpoint, {
						player_code: "expired",
						verify_code: "verify",
						verify_token: jwt.sign({
							aud: "player_auth.verify_code",
							player_code: "expired",
							verify_code: "verify",
						}, Buffer.from("TestSecretDoNotUse", "base64")),
					});
					assert.deepEqual(await result.json(), { error: true, message: "invalid player_code" });
				});
				it("should return verified false if verify code has not yet been set", async function() {
					let expiresMs = Date.now() + 1000;
					controllerPlugin.players.set(
						"unverified",
						{ playerCode: "unverified", verifyCode: null, expiresMs },
					);
					const result = await postJSON(endpoint, {
						player_code: "unverified",
						verify_code: "verify",
						verify_token: jwt.sign({
							aud: "player_auth.verify_code",
							player_code: "unverified",
							verify_code: "verify",
						}, Buffer.from("TestSecretDoNotUse", "base64")),
					});
					assert.deepEqual(await result.json(), { verified: false });
				});
				it("should return error if user is missing", async function() {
					let expiresMs = Date.now() + 1000;
					controllerPlugin.players.set("missing", { playerCode: "missing", verifyCode: "verify", expiresMs });
					const result = await postJSON(endpoint, {
						player_code: "missing",
						verify_code: "verify",
						verify_token: jwt.sign({
							aud: "player_auth.verify_code",
							player_code: "missing",
							verify_code: "verify",
						}, Buffer.from("TestSecretDoNotUse", "base64")),
					});
					assert.deepEqual(await result.json(), { error: true, message: "invalid user" });
				});
				it("should return verified true with token if valid verification", async function() {
					let expiresMs = Date.now() + 1000;
					controllerPlugin.players.set("player", { playerCode: "player", verifyCode: "verify", expiresMs });
					const result = await postJSON(endpoint, {
						player_code: "player",
						verify_code: "verify",
						verify_token: jwt.sign({
							aud: "player_auth.verify_code",
							player_code: "player",
							verify_code: "verify",
						}, Buffer.from("TestSecretDoNotUse", "base64")),
					});
					const body = await result.json();
					assert.equal(body.verified, true);
					assert.deepEqual(typeof body.token, "string", "missing token");
				});
			});

			describe(".handleFetchPlayerCodeRequest()", function() {
				it("should return a code", async function() {
					let result = await controllerPlugin.handleFetchPlayerCodeRequest(
						new FetchPlayerCodeRequest("test")
					);
					assert(typeof result.playerCode === "string", "no code returned");
					assert(result.playerCode.length === 10, "incorrect code length returned");
					let expiresMs = controllerPlugin.players.get("test").expiresMs;
					let msFromExpected = Math.abs(expiresMs - Date.now() - 1000);
					assert(msFromExpected < 100, `expiry time expected outside window (${msFromExpected}ms)`);
				});
			});

			describe(".handleSetVerifyCodeRequest()", function() {
				it("should throw if player does not exist", async function() {
					await assert.rejects(
						controllerPlugin.handleSetVerifyCodeRequest(
							new SetVerifyCodeRequest("invalid", "invalid")
						),
						new lib.RequestError("invalid player")
					);
				});
				it("should throw if player code has expired", async function() {
					let expiresMs = Date.now() - 1000;
					controllerPlugin.players.set("expired", { playerCode: "expired", verifyCode: null, expiresMs });
					await assert.rejects(
						controllerPlugin.handleSetVerifyCodeRequest(
							new SetVerifyCodeRequest("expired", "expired")
						),
						new lib.RequestError("invalid player")
					);
				});
			});

			describe("integration", function() {
				it("should verify a full login flow", async function() {
					let app = controllerPlugin.controller.app;
					let { playerCode } = await controllerPlugin.handleFetchPlayerCodeRequest(
						new FetchPlayerCodeRequest("test")
					);

					const playerCodeResult = await postJSON(
						`${controllerUrl}/api/player_auth/player_code`,
						{ player_code: playerCode }
					);

					let { verify_code, verify_token } = await playerCodeResult.json();
					await controllerPlugin.handleSetVerifyCodeRequest(
						new SetVerifyCodeRequest("test", verify_code)
					);

					const user = controllerPlugin.controller.users.getByName("test");
					const token = controllerPlugin.controller.users.signUserToken(user);
					const verifyResult = await postJSON(
						`${controllerUrl}/api/player_auth/verify`,
						{ player_code: playerCode, verify_code, verify_token }
					);
					assert.equal(verifyResult.status, 200);
					assert.deepEqual(await verifyResult.json(), { verified: true, token: token });
				});
			});
		});
	});

	describe("instance.js", function() {
		describe("class InstancePlugin", function() {
			let instancePlugin;
			before(async function() {
				instancePlugin = await mock.createInstancePlugin(instance.InstancePlugin, info);
			});

			describe(".handleEvent()", async function() {
				describe("open_dialog", async function() {
					it("should call /web-login error if not connected to controller", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.host.connector.connected = false;
						await instancePlugin.handleEvent({ type: "open_dialog", player: "test" });
						let command = instancePlugin.instance.server.rconCommands[0];
						instancePlugin.host.connector.connected = true;
						assert.equal(command, "/web-login error test login is temporarily unavailable");
					});
					it("should call /web-login error after error from the controller", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message",
								new lib.MessageResponseError(1, message.dst, message.src,
									new lib.ResponseError("controller error")
								)
							);
						});
						await instancePlugin.handleEvent({ type: "open_dialog", player: "test" });
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login error test controller error");
					});
					it("should call /web-login open after a valid response from the controller", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message",
								new lib.MessageResponse(1, message.dst, message.src,
									new FetchPlayerCodeRequest.Response("code", "controller-url")
								)
							);
						});
						await instancePlugin.handleEvent({ type: "open_dialog", player: "test" });
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login open test controller-url code");
					});
				});
				describe("open_dialog", async function() {
					it("should call /web-login code_set after a valid response from the controller", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message",
								new lib.MessageResponse(1, message.dst, message.src)
							);
						});
						await instancePlugin.handleEvent(
							{ type: "set_verify_code", player: "test", verify_code: "verify" }
						);
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login code_set test");
					});
					it("should call /web-login error after error from the controller", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message",
								new lib.MessageResponseError(1, message.dst, message.src,
									new lib.ResponseError("controller error")
								)
							);
						});
						await instancePlugin.handleEvent(
							{ type: "set_verify_code", player: "test", verify_code: "verify" }
						);
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login error test controller error");
					});
				});
			});
		});
	});
});
