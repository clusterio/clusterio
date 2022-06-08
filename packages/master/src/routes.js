"use strict";
const Busboy = require("busboy");
const crypto = require("crypto");
const events = require("events");
const JSZip = require("jszip");
const jwt = require("jsonwebtoken");
const path = require("path");
const util = require("util");

const libErrors = require("@clusterio/lib/errors");
const libFileOps = require("@clusterio/lib/file_ops");
const libHelpers = require("@clusterio/lib/helpers");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libPrometheus = require("@clusterio/lib/prometheus");
const { logger } = require("@clusterio/lib/logging");

const { endpointHitCounter } = require("./metrics");


// Merges samples from sourceResult to destinationResult
function mergeSamples(destinationResult, sourceResult) {
	let receivedSamples = new Map(sourceResult.samples);
	for (let [suffix, suffixSamples] of destinationResult.samples) {
		if (receivedSamples.has(suffix)) {
			suffixSamples.push(...receivedSamples.get(suffix));
			receivedSamples.delete(suffix);
		}
	}

	for (let entry of receivedSamples) {
		sourceResult.samples.push(entry);
	}
}

// Prometheus polling endpoint
async function getMetrics(req, res, next) {
	endpointHitCounter.labels(req.route.path).inc();

	let results = [];
	let pluginResults = await libPlugin.invokeHook(req.app.locals.master.plugins, "onMetrics");
	for (let metricIterator of pluginResults) {
		for await (let metric of metricIterator) {
			results.push(metric);
		}
	}

	let requests = [];
	let timeout = req.app.locals.master.config.get("master.metrics_timeout") * 1000;
	for (let slaveConnection of req.app.locals.master.wsServer.slaveConnections.values()) {
		if (!slaveConnection.connected) {
			continue;
		}
		requests.push(libHelpers.timeout(
			libLink.messages.getMetrics.send(slaveConnection).catch(err => {
				if (!(err instanceof libErrors.SessionLost)) {
					logger.error(`Unexpected error gathering metrics from slave:\n${err.stack}`);
				}
				return null;
			}),
			timeout, null
		));
	}

	for await (let result of await libPrometheus.defaultRegistry.collect()) {
		results.push(result);
	}

	let resultMap = new Map();
	for (let response of await Promise.all(requests)) {
		if (!response) {
			// TODO: Log timeout occured?
			continue;
		}

		for (let result of response.results) {
			if (!resultMap.has(result.metric.name)) {
				resultMap.set(result.metric.name, result);

			} else {
				// Merge metrics received by multiple slaves
				mergeSamples(resultMap.get(result.metric.name), result);
			}
		}
	}

	for (let result of resultMap.values()) {
		results.push(libPrometheus.deserializeResult(result));
	}


	let text = await libPrometheus.exposition(results);
	res.set("Content-Type", libPrometheus.exposition.contentType);
	res.send(text);
}

function getPlugins(req, res) {
	let plugins = [];
	for (let pluginInfo of req.app.locals.master.pluginInfos) {
		let name = pluginInfo.name;
		let loaded = req.app.locals.master.plugins.has(name);
		let enabled = loaded && req.app.locals.master.config.group(pluginInfo.name).get("load_plugin");
		let web = {};
		let devPlugins = req.app.locals.devPlugins;
		if (devPlugins && devPlugins.has(name)) {
			let stats = res.locals.webpack.devMiddleware.stats.stats[devPlugins.get(name)];
			web.main = stats.toJson().assetsByChunkName[name];
		} else if (pluginInfo.manifest) {
			web.main = pluginInfo.manifest[`${pluginInfo.name}.js`];
			if (!web.main) {
				web.error = `Missing ${pluginInfo.name}.js entry in manifest.json`;
			}
		} else {
			web.error = "Missing dist/web/manifest.json";
		}
		if (web.main === "remoteEntry.js") {
			web.error = "Incompatible old remoteEntry.js entrypoint.";
		}
		plugins.push({ name, version: pluginInfo.version, enabled, loaded, web });
	}
	res.send(plugins);
}

function validateSlaveToken(req, res, next) {
	let token = req.header("x-access-token");
	if (!token) {
		res.sendStatus(401);
		return;
	}

	try {
		jwt.verify(
			token,
			Buffer.from(req.app.locals.master.config.get("master.auth_secret"), "base64"),
			{ audience: "slave" }
		);

	} catch (err) {
		res.sendStatus(401);
		return;
	}

	next();
}

function validateUserToken(req, res, next) {
	let token = req.header("x-access-token");
	if (!token) {
		res.sendStatus(401);
		return;
	}

	try {
		let tokenPayload = jwt.verify(
			token,
			Buffer.from(req.app.locals.master.config.get("master.auth_secret"), "base64"),
			{ audience: "user" }
		);
		let user = req.app.locals.master.userManager.users.get(tokenPayload.user);
		if (!user) {
			throw new Error("invalid user");
		}
		if (tokenPayload.iat < user.tokenValidAfter) {
			throw new Error("invalid token");
		}
		res.locals.user = user;

	} catch (err) {
		res.sendStatus(401);
		return;
	}

	next();
}

// Handle an uploaded export package.
async function uploadExport(req, res) {
	endpointHitCounter.labels(req.route.path).inc();
	if (req.get("Content-Type") !== "application/zip") {
		res.sendStatus(415);
		return;
	}

	let data = [];
	for await (let chunk of req) {
		data.push(chunk);
	}
	data = Buffer.concat(data);
	let zip = await JSZip.loadAsync(data);
	data = null;

	// This is hardcoded to prevent path expansion attacks
	let exportFiles = [
		"export/item-spritesheet.png",
		"export/item-metadata.json",
		"export/locale.json",
	];

	for (let filePath of exportFiles) {
		let file = zip.file(filePath);
		if (!file) {
			continue;
		}

		let name = path.posix.basename(filePath);
		await libFileOps.safeOutputFile(path.join("static", "export", name), await file.async("nodebuffer"));
	}

	res.sendStatus(200);
}

async function createProxyStream(app) {
	let asyncRandomBytes = util.promisify(crypto.randomBytes);
	let id = (await asyncRandomBytes(8)).toString("hex");
	let stream = {
		id,
		flowing: false,
		size: null,
		mime: null,
		filename: null,
		events: new events.EventEmitter(),
		timeout: setTimeout(() => {
			stream.events.emit("timeout");
		}, app.locals.master.config.get("master.proxy_stream_timeout") * 1000),
	};
	stream.events.on("close", () => {
		clearTimeout(stream.timeout);
		app.locals.streams.delete(id);
	});
	stream.events.on("timeout", () => {
		stream.events.emit("close");
	});
	app.locals.streams.set(id, stream);
	return stream;
}

async function putStream(req, res) {
	let stream = req.app.locals.streams.get(req.params.id);
	if (!stream || stream.source) {
		res.sendStatus(404);
		return;
	}
	stream.source = req;
	stream.mime = req.get("Content-Type");
	stream.size = req.get("Content-Length");

	stream.events.emit("source");
	stream.events.on("close", () => {
		if (!stream.flowing) {
			req.resume();
			res.sendStatus(500);
		} else {
			res.sendStatus(200);
		}
	});
}

async function getStream(req, res) {
	let stream = req.app.locals.streams.get(req.params.id);
	if (!stream || stream.flowing) {
		res.sendStatus(404);
		return;
	}

	function startStream() {
		res.append("Content-Type", stream.mime);
		if (stream.size) {
			res.append("Content-Length", stream.size);
		}
		if (stream.filename) {
			res.append("Content-Disposition", `attachment; filename="${stream.filename}"`);
		} else {
			res.append("Content-Disposition", "attachment");
		}
		stream.source.pipe(res);
		stream.flowing = true;
		res.on("finish", () => {
			stream.events.emit("close");
		});
		clearTimeout(stream.timeout);
	}

	if (stream.source) {
		startStream();
	} else {
		stream.events.on("source", startStream);
		stream.events.on("timeout", () => {
			res.sendStatus(500);
		});
	}
}


const zipMimes = [
	"application/zip",
	"application/x-zip-compressed",
];

async function uploadSave(req, res) {
	try {
		res.locals.user.checkPermission("core.instance.save.upload");
	} catch (err) {
		res.status(403).json({ request_errors: [err.message] });
		return;
	}

	let contentType = req.get("Content-Type");
	let match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+)/.exec(contentType);
	if (!match) {
		res.status(415).json({ request_errors: ["invalid Content-Type"] });
		return;
	}
	let mimeType = match[1].toLowerCase();

	let tasks = [];
	let errors = [];
	let requestErrors = [];
	let saves = [];

	async function handleFile(instanceId, stream, filename, streamMime) {
		let proxyStream = await createProxyStream(req.app);
		proxyStream.source = stream;
		proxyStream.mime = streamMime;
		let timeout = new Promise((_, reject) => {
			proxyStream.events.on("timeout", () => {
				stream.resume();
				reject(new Error("Timed out establishing stream to slave"));
			});
		});

		try {
			let result = await Promise.race([
				req.app.locals.master.forwardRequestToInstance(libLink.messages.pullSave, {
					instance_id: instanceId,
					stream_id: proxyStream.id,
					filename,
				}),
				timeout,
			]);
			saves.push(result.save);

		} catch (err) {
			proxyStream.events.emit("close");
			logger.error(`Error uploading save: ${err.message}`);
			errors.push(err.message);
			stream.resume();
		}
	}

	if (mimeType === "multipart/form-data") {
		await new Promise(resolve => {
			let fields = {};
			let busboy = new Busboy({ headers: req.headers });
			busboy.on("file", (fieldname, stream, filename, transferEncoding, fileMime) => {
				if (fields.instanceId === undefined) {
					requestErrors.push("instance_id must come before files uploaded");
				}

				if (!zipMimes.includes(fileMime)) {
					requestErrors.push("invalid file Content-Type");
				}

				if (!filename.endsWith(".zip")) {
					requestErrors.push("filename must end with .zip");
				}

				if (errors.length || requestErrors.length) {
					stream.resume();
					return;
				}

				tasks.push(handleFile(fields.instanceId, stream, filename, fileMime));
			});
			busboy.on("field", (fieldname, value, fieldnameTruncated, valueTruncated, transferEncoding, valueMime) => {
				if (fieldname === "instance_id") {
					fields.instanceId = Number.parseInt(value, 10);
					if (Number.isNaN(fields.instanceId)) {
						requestErrors.push("invalid instance_id");
					}
				}
			});
			busboy.on("finish", resolve);
			busboy.on("error", (err) => {
				logger.error(`Error parsing multipart request in upload-save:\n${err.stack}`);
				errors.push(err.message);
			});
			req.pipe(busboy);
		});

	} else if (zipMimes.includes(mimeType)) {
		let filename = req.query.filename;
		if (typeof filename !== "string") {
			requestErrors.push("Missing or invalid filename parameter");
		} else if (!filename.endsWith(".zip")) {
			requestErrors.push("filename must end with .zip");
		}
		let instanceId = Number.parseInt(req.query.instance_id, 10);
		if (Number.isNaN(instanceId)) {
			requestErrors.push("Missing or invalid instance_id parameter");
		}

		if (errors.length || requestErrors.length) {
			req.resume();
		} else {
			tasks.push(handleFile(instanceId, req, filename, mimeType));
		}

	} else {
		res.status(415).json({ request_errors: ["invalid Content-Type"] });
		return;
	}

	await Promise.all(tasks);

	if (errors.length) {
		res.status(500);
		res.json({ errors, request_errors: requestErrors });
		return;
	}
	if (requestErrors.length) {
		res.status(400);
		res.json({ request_errors: requestErrors });
		return;
	}

	res.json({ saves });
}

function addRouteHandlers(app) {
	app.get("/metrics", (req, res, next) => getMetrics(req, res, next).catch(next));
	app.get("/api/plugins", getPlugins);
	app.put("/api/upload-export",
		validateSlaveToken,
		(req, res, next) => uploadExport(req, res).catch(next)
	);
	app.put("/api/stream/:id", (req, res, next) => putStream(req, res).catch(next));
	app.get("/api/stream/:id", (req, res, next) => getStream(req, res).catch(next));
	app.post("/api/upload-save",
		validateUserToken,
		(req, res, next) => uploadSave(req, res).catch(next)
	);
}

// Routes used in the web interface and served by the master server
const webRoutes = [
	"/",
	"/master",
	"/slaves",
	"/slaves/:id/view",
	"/instances",
	"/instances/:id/view",
	"/users",
	"/users/:id/view",
	"/roles",
	"/roles/:id/view",
	"/plugins",
	"/plugins/:name/view",
];

module.exports = {
	addRouteHandlers,
	webRoutes,
	createProxyStream,
};
