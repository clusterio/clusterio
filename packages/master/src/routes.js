"use strict";
const fs = require("fs-extra");
const JSZip = require("jszip");
const jwt = require("jsonwebtoken");
const path = require("path");

const libHelpers = require("@clusterio/lib/helpers");
const libLink = require("@clusterio/lib/link");
const libPlugin = require("@clusterio/lib/plugin");
const libPrometheus = require("@clusterio/lib/prometheus");

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
		requests.push(libHelpers.timeout(libLink.messages.getMetrics.send(slaveConnection), timeout, null));
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
		plugins.push({ name, version: pluginInfo.version, enabled, loaded });
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
		jwt.verify(token, req.app.locals.master.config.get("master.auth_secret"), { audience: "slave" });

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
		await fs.outputFile(path.join("static", "export", name), await file.async("nodebuffer"));
	}

	res.sendStatus(200);
}

function addRouteHandlers(app) {
	app.get("/metrics", (req, res, next) => getMetrics(req, res, next).catch(next));
	app.get("/api/plugins", getPlugins);
	app.put("/api/upload-export",
		validateSlaveToken,
		(req, res, next) => uploadExport(req, res).catch(next)
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
};
