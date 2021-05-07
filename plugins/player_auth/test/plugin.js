"use strict";
const assert = require("assert").strict;
const phin = require("phin");
const jwt = require("jsonwebtoken");

const mock = require("../../../test/mock");

const master = require("../master");
const instance = require("../instance");
const info = require("../info");
const libErrors = require("@clusterio/lib/errors");


describe("player_auth", function() {
	describe("master.js", function() {
		describe("generateCode()", function() {
			it("should generate a code of the given length", async function() {
				let code = await master._generateCode(20);
				assert.equal(typeof code, "string");
				assert.equal(code.length, 20, "incorrect length");
			});
			it("should only use the easy to recognize letters in the alphabet", async function() {
				let chars = new Set();
				for (let i = 0; i < 20; i++) {
					let code = await master._generateCode(15);
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

		describe("MasterPlugin", function() {
			let masterPlugin;
			let masterUrl;
			before(async function() {
				masterPlugin = await mock.createMasterPlugin(master.MasterPlugin, info);
				masterPlugin.master.mockConfigEntries.set("player_auth.code_length", 10);
				masterPlugin.master.mockConfigEntries.set("player_auth.code_timeout", 1);
				masterUrl = await masterPlugin.master.startServer();
			});
			after(async function() {
				if (masterPlugin) {
					await masterPlugin.master.stopServer();
				}
			});

			describe("/api/player_auth/servers", function() {
				it("should return a list of running servers with player_auth loaded", async function() {
					function addInstance(id, status, load, name) {
						masterPlugin.master.instances.set(id, {
							config: {
								get(field) {
									if (field === "player_auth.load_plugin") {
										return load;
									} else if (field === "factorio.settings") {
										return { name };
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
					let result = await phin({
						url: `${masterUrl}/api/player_auth/servers`,
						parse: "json",
					});
					assert.deepEqual(result.body, ["running loaded", "unnamed server"]);
					for (let id of [1, 2, 3, 4, 5]) {
						masterPlugin.master.instances.delete(id);
					}
				});
			});

			describe("/api/player_auth/player_code", function() {
				it("should return 400 on invalid json", async function() {
					let result = await phin({
						url: `${masterUrl}/api/player_auth/player_code`,
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						data: "invalid",
					});
					assert.equal(result.statusCode, 400);
				});
				it("should return 400 on valid json which is not an object", async function() {
					for (let obj of [true, false, null, "string", 123, ["an", "array"]]) {
						let result = await phin({
							url: `${masterUrl}/api/player_auth/player_code`,
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							data: JSON.stringify(obj),
						});
						assert.equal(result.statusCode, 400);
					}
				});
				it("should return 400 if player_code is not a string", async function() {
					for (let obj of [true, false, null, 123, [], {}]) {
						let result = await phin({
							url: `${masterUrl}/api/player_auth/player_code`,
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							data: JSON.stringify({ player_code: obj }),
						});
						assert.equal(result.statusCode, 400);
					}
				});
				it("should return invalid player_code if the code is expired", async function() {
					let expires = Date.now() - 1000;
					masterPlugin.players.set("expired", { playerCode: "expried", verifyCode: null, expires });
					let result = await phin({
						url: `${masterUrl}/api/player_auth/player_code`,
						method: "POST",
						data: { player_code: "expired" },
						parse: "json",
					});
					assert.deepEqual(result.body, { error: true, message: "invalid player_code" });
				});
				it("should return a verify code and token if code is valid", async function() {
					let expires = Date.now() + 1000;
					masterPlugin.players.set("valid", { playerCode: "valid", verifyCode: null, expires });
					let result = await phin({
						url: `${masterUrl}/api/player_auth/player_code`,
						method: "POST",
						data: { player_code: "valid" },
						parse: "json",
					});
					assert.equal(typeof result.body.verify_code, "string");
					assert.equal(typeof result.body.verify_token, "string");
				});
			});

			describe("/api/player_auth/verify", function() {
				it("should return 400 on invalid json", async function() {
					let result = await phin({
						url: `${masterUrl}/api/player_auth/verify`,
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						data: "invalid",
					});
					assert.equal(result.statusCode, 400);
				});
				it("should return 400 on valid json which is not an object", async function() {
					for (let obj of [true, false, null, "string", 123, ["an", "array"]]) {
						let result = await phin({
							url: `${masterUrl}/api/player_auth/verify`,
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							data: JSON.stringify(obj),
						});
						assert.equal(result.statusCode, 400);
					}
				});
				it("should return 400 if player_code, verify_code or verify_token are not strings", async function() {
					for (let obj of [true, false, null, 123, [], {}]) {
						for (let field of ["player_code", "verify_code", "verify_token"]) {
							let result = await phin({
								url: `${masterUrl}/api/player_auth/verify`,
								method: "POST",
								data: {
									player_code: "str",
									verify_code: "str",
									verify_token: "str",
									[field]: obj,
								},
							});
							assert.equal(result.statusCode, 400);
						}
					}
				});
				it("should return error if verify_token is not valid", async function() {
					async function verify(tokenParams, error) {
						let result = await phin({
							url: `${masterUrl}/api/player_auth/verify`,
							method: "POST",
							data: {
								player_code: "player",
								verify_code: "verify",
								verify_token: jwt.sign({
									aud: "player_auth.verify_code",
									player_code: "player",
									verify_code: "verify",
									...tokenParams,
								}, tokenParams.secret || "TestSecretDoNotUse"),
							},
							parse: "json",
						});
						assert.deepEqual(result.body.error, true);
					}
					await verify({ secret: "InvalidSecret" });
					await verify({ verify_code: "bad" });
					await verify({ player_code: "bad" });
					await verify({ aud: "not_player_auth" });
				});
				it("should return invalid player_code if the code is expired", async function() {
					let expires = Date.now() - 1000;
					masterPlugin.players.set("expired", { playerCode: "expried", verifyCode: "verify", expires });
					let result = await phin({
						url: `${masterUrl}/api/player_auth/verify`,
						method: "POST",
						data: {
							player_code: "expired",
							verify_code: "verify",
							verify_token: jwt.sign({
								aud: "player_auth.verify_code",
								player_code: "expired",
								verify_code: "verify",
							}, "TestSecretDoNotUse"),
						},
						parse: "json",
					});
					assert.deepEqual(result.body, { error: true, message: "invalid player_code" });
				});
				it("should return verified false if verify code has not yet been set", async function() {
					let expires = Date.now() + 1000;
					masterPlugin.players.set("unverified", { playerCode: "unverified", verifyCode: null, expires });
					let result = await phin({
						url: `${masterUrl}/api/player_auth/verify`,
						method: "POST",
						data: {
							player_code: "unverified",
							verify_code: "verify",
							verify_token: jwt.sign({
								aud: "player_auth.verify_code",
								player_code: "unverified",
								verify_code: "verify",
							}, "TestSecretDoNotUse"),
						},
						parse: "json",
					});
					assert.deepEqual(result.body, { verified: false });
				});
				it("should return error if user is missing", async function() {
					let expires = Date.now() + 1000;
					masterPlugin.players.set("missing", { playerCode: "missing", verifyCode: "verify", expires });
					let result = await phin({
						url: `${masterUrl}/api/player_auth/verify`,
						method: "POST",
						data: {
							player_code: "missing",
							verify_code: "verify",
							verify_token: jwt.sign({
								aud: "player_auth.verify_code",
								player_code: "missing",
								verify_code: "verify",
							}, "TestSecretDoNotUse"),
						},
						parse: "json",
					});
					assert.deepEqual(result.body, { error: true, message: "invalid user" });
				});
				it("should return verified true with token if valid verification", async function() {
					let expires = Date.now() + 1000;
					masterPlugin.players.set("player", { playerCode: "player", verifyCode: "verify", expires });
					let result = await phin({
						url: `${masterUrl}/api/player_auth/verify`,
						method: "POST",
						data: {
							player_code: "player",
							verify_code: "verify",
							verify_token: jwt.sign({
								aud: "player_auth.verify_code",
								player_code: "player",
								verify_code: "verify",
							}, "TestSecretDoNotUse"),
						},
						parse: "json",
					});
					assert.equal(result.body.verified, true);
					assert.deepEqual(typeof result.body.token, "string", "missing token");
				});
			});

			describe(".fetchPlayerCodeRequestHandler()", function() {
				it("should return a code", async function() {
					let result = await masterPlugin.fetchPlayerCodeRequestHandler({ data: { player: "test" }});
					assert(typeof result.player_code === "string", "no code returned");
					assert(result.player_code.length === 10, "incorrect code length returned");
					let expires = masterPlugin.players.get("test").expires;
					let msFromExpected = Math.abs(expires - Date.now() - 1000);
					assert(msFromExpected < 100, `expiry time expected outside window (${msFromExpected}ms)`);
				});
			});

			describe(".setVerifyCodeRequestHandler()", function() {
				it("should throw if player does not exist", async function() {
					await assert.rejects(
						masterPlugin.setVerifyCodeRequestHandler(
							{ data: { player: "invalid", verify_code: "invalid" }}
						),
						new libErrors.RequestError("invalid player")
					);
				});
				it("should throw if player code has expired", async function() {
					let expires = Date.now() - 1000;
					masterPlugin.players.set("expired", { playerCode: "expried", verifyCode: null, expires });
					await assert.rejects(
						masterPlugin.setVerifyCodeRequestHandler(
							{ data: { player: "expired", verify_code: "expired" }}
						),
						new libErrors.RequestError("invalid player")
					);
				});
			});

			describe("integration", function() {
				it("should verify a full login flow", async function() {
					let app = masterPlugin.master.app;
					let { player_code } = await masterPlugin.fetchPlayerCodeRequestHandler({ data: { player: "test" }});

					let playerCodeResult = await phin({
						url: `${masterUrl}/api/player_auth/player_code`,
						method: "POST",
						data: { player_code },
						parse: "json",
					});

					let { verify_code, verify_token } = playerCodeResult.body;
					await masterPlugin.setVerifyCodeRequestHandler({ data: { player: "test", verify_code }});

					let verifyResult = await phin({
						url: `${masterUrl}/api/player_auth/verify`,
						method: "POST",
						data: { player_code, verify_code, verify_token },
						parse: "json",
					});
					assert.equal(verifyResult.body.verified, true);
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
					it("should call /web-login error if not connected to master", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.slave.connector.connected = false;
						await instancePlugin.handleEvent({ type: "open_dialog", player: "test" });
						let command = instancePlugin.instance.server.rconCommands[0];
						instancePlugin.slave.connector.connected = true;
						assert.equal(command, "/web-login error test login is temporarily unavailable");
					});
					it("should call /web-login error after error from the master", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message", {
								seq: 1,
								type: "player_auth:fetch_player_code_response",
								data: {
									seq: message.seq,
									error: "master error",
								},
							});
						});
						await instancePlugin.handleEvent({ type: "open_dialog", player: "test" });
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login error test master error");
					});
					it("should call /web-login open after a valid response from the master", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message", {
								seq: 1,
								type: "player_auth:fetch_player_code_response",
								data: {
									seq: message.seq,
									player_code: "code",
									master_url: "master-url",
								},
							});
						});
						await instancePlugin.handleEvent({ type: "open_dialog", player: "test" });
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login open test master-url code");
					});
				});
				describe("open_dialog", async function() {
					it("should call /web-login code_set after a valid response from the master", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message", {
								seq: 1,
								type: "player_auth:set_verify_code_response",
								data: { seq: message.seq },
							});
						});
						await instancePlugin.handleEvent(
							{ type: "set_verify_code", player: "test", verify_code: "verify" }
						);
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login code_set test");
					});
					it("should call /web-login error after error from the master", async function() {
						instancePlugin.instance.server.reset();
						instancePlugin.instance.connector.once("send", message => {
							instancePlugin.instance.connector.emit("message", {
								seq: 1,
								type: "player_auth:set_verify_code_response",
								data: { seq: message.seq, error: "master error" },
							});
						});
						await instancePlugin.handleEvent(
							{ type: "set_verify_code", player: "test", verify_code: "verify" }
						);
						let command = instancePlugin.instance.server.rconCommands[0];
						assert.equal(command, "/web-login error test master error");
					});
				});
			});
		});
	});
});
