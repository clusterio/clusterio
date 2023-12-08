import type { Application, Request, Response } from "express";
import type Controller from "./Controller";

import busboy from "busboy";
import crypto from "crypto";
import events from "events";
import fs from "fs-extra";
import JSZip from "jszip";
import jwt from "jsonwebtoken";
import path from "path";
import nodeStream from "stream";
import util from "util";

import * as lib from "@clusterio/lib";
const { logger } = lib;

const finished = util.promisify(nodeStream.finished);

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		export interface Locals {
			controller: Controller,
			mainBundle: string,
			devPlugins: Map<string, number>,
			streams: Map<string, ProxyStream>
		}
	}
}

// Merges samples from sourceResult to destinationResult
function mergeSamples(destinationResult: lib.CollectorResultSerialized, sourceResult: lib.CollectorResultSerialized) {
	let receivedSamples = new Map(sourceResult.samples);
	for (let [suffix, suffixSamples] of destinationResult.samples) {
		if (receivedSamples.has(suffix)) {
			suffixSamples.push(...receivedSamples.get(suffix) as any[]);
			receivedSamples.delete(suffix);
		}
	}

	for (let entry of receivedSamples) {
		sourceResult.samples.push(entry);
	}
}

// Prometheus polling endpoint
async function getMetrics(req: Request, res: Response, next: any) {
	const controller: Controller = req.app.locals.controller;

	let results: lib.CollectorResult[] = [];
	let pluginResults = await lib.invokeHook(controller.plugins, "onMetrics");
	for (let metricIterator of pluginResults) {
		for await (let metric of metricIterator) {
			results.push(metric);
		}
	}

	let requests: Promise<InstanceType<typeof lib.HostMetricsRequest["Response"]> | null>[] = [];
	let timeout = controller.config.get("controller.metrics_timeout") * 1000;
	for (let [hostId, hostConnection] of controller.wsServer.hostConnections) {
		if (!hostConnection.connected) {
			continue;
		}
		requests.push(lib.timeout(
			hostConnection.send(new lib.HostMetricsRequest()).catch((err: any) => {
				if (!(err instanceof lib.SessionLost)) {
					logger.error(`Unexpected error gathering metrics from host:\n${err.stack}`);
				}
				return null;
			}),
			timeout, null
		));
	}

	for await (let result of lib.defaultRegistry.collect()) {
		results.push(result);
	}

	let resultMap: Map<string, lib.CollectorResultSerialized> = new Map();
	for (let response of await Promise.all(requests)) {
		if (!response) {
			// TODO: Log timeout occured?
			continue;
		}

		for (let result of response.results) {
			if (!resultMap.has(result.metric.name)) {
				resultMap.set(result.metric.name, result);

			} else {
				// Merge metrics received by multiple hosts
				mergeSamples(resultMap.get(result.metric.name)!, result);
			}
		}
	}

	for (let result of resultMap.values()) {
		results.push(lib.deserializeResult(result));
	}

	let text = await lib.exposition(results);
	res.set("Content-Type", lib.expositionContentType);
	res.send(text);
}


function getPlugins(req: Request, res: Response) {
	let plugins: lib.PluginWebApi[] = [];
	for (let pluginInfo of req.app.locals.controller.pluginInfos) {
		let name = pluginInfo.name;
		let loaded = req.app.locals.controller.plugins.has(name);
		let enabled = loaded && req.app.locals.controller.config.group(pluginInfo.name).get("load_plugin") as boolean;
		let web: { main:any, error:string|undefined } = { main: undefined, error: undefined};
		let devPlugins = req.app.locals.devPlugins;
		if (devPlugins && devPlugins.has(name)) {
			let stats = res.locals.webpack.devMiddleware.stats.stats[devPlugins.get(name)!];
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
		plugins.push({ name, version: pluginInfo.version, enabled, loaded, web, npmPackage: pluginInfo.npmPackage });
	}
	res.send(plugins);
}

function validateHostToken(req: Request, res: Response, next: any) {
	let token = req.header("x-access-token");
	if (!token) {
		res.sendStatus(401);
		return;
	}

	try {
		const tokenPayload = jwt.verify(
			token,
			Buffer.from(req.app.locals.controller.config.get("controller.auth_secret"), "base64"),
			{ audience: "host" }
		);

		if (typeof tokenPayload === "string") {
			throw new Error("unexpected JsonWebToken type");
		}
		let host = req.app.locals.controller.hosts.get(tokenPayload.host);
		if (!host) {
			throw new Error("invalid host");
		}
		if (!tokenPayload.iat || tokenPayload.iat < (host.token_valid_after??0)) {
			throw new Error("invalid token");
		}
	} catch (err) {
		res.sendStatus(401);
		return;
	}

	next();
}

function validateUserToken(req: Request, res: Response, next: any) {
	let token = req.header("x-access-token");
	if (!token) {
		res.sendStatus(401);
		return;
	}

	try {
		let tokenPayload = jwt.verify(
			token,
			Buffer.from(req.app.locals.controller.config.get("controller.auth_secret"), "base64"),
			{ audience: "user" }
		);

		if (typeof tokenPayload === "string") {
			throw new Error("unexpected JsonWebToken type");
		}
		let user = req.app.locals.controller.userManager.users.get(tokenPayload.user);
		if (!user) {
			throw new Error("invalid user");
		}
		if (!tokenPayload.iat || tokenPayload.iat < user.tokenValidAfter) {
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
async function uploadExport(req: Request, res: Response) {
	if (req.get("Content-Type") !== "application/zip") {
		res.sendStatus(415);
		return;
	}

	if (typeof req.query.mod_pack_id !== "string") {
		res.sendStatus(400);
		return;
	}
	let modPackId = Number.parseInt(req.query.mod_pack_id, 10);
	if (!Number.isInteger(modPackId)) {
		res.sendStatus(400);
		return;
	}
	let modPack = res.app.locals.controller.modPacks.get(modPackId);
	if (!modPack) {
		res.sendStatus(400);
		return;
	}

	let data = [];
	for await (let chunk of req) {
		data.push(chunk);
	}
	let buffer: Buffer | null = Buffer.concat(data);
	let zip = await JSZip.loadAsync(buffer);
	buffer = null;

	// This is hardcoded to prevent path expansion attacks
	let exportFiles = [
		"export/settings.json",
		"export/prototypes.json",
		"export/item-spritesheet.png",
		"export/item-metadata.json",
		"export/locale.json",
	];

	let assets: any = {};
	let settingPrototypes = {};
	for (let filePath of exportFiles) {
		let file = zip.file(filePath);
		if (!file) {
			continue;
		}

		if (filePath === "export/settings.json") {
			settingPrototypes = JSON.parse(await file.async("text"));
		}

		let { name, ext } = path.posix.parse(filePath);
		let hash = await lib.hashStream(file.nodeStream());
		assets[name] = `${name}.${hash}${ext}`;
		await lib.safeOutputFile(path.join("static", `${name}.${hash}${ext}`), await file.async("nodebuffer"));
	}

	modPack.exportManifest = new lib.ExportManifest(assets);
	modPack.fillDefaultSettings(settingPrototypes, logger);
	res.app.locals.controller.modPacksUpdated([modPack]);

	res.sendStatus(200);
}


export interface ProxyStream {
	id: string;
	source: nodeStream.Readable | null;
	flowing: boolean;
	size?: string;
	mime?: string;
	filename: string | null;
	events: events.EventEmitter;
	timeout: ReturnType<typeof setTimeout>;
}

export async function createProxyStream(app: Application): Promise<ProxyStream> {
	let asyncRandomBytes = util.promisify(crypto.randomBytes);
	let id = (await asyncRandomBytes(8)).toString("hex");
	let stream: ProxyStream = {
		id,
		source: null,
		flowing: false,
		size: undefined,
		mime: undefined,
		filename: null,
		events: new events.EventEmitter(),
		timeout: setTimeout(() => {
			stream.events.emit("timeout");
		}, app.locals.controller.config.get("controller.proxy_stream_timeout") * 1000),
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

async function putStream(req: Request, res: Response) {
	const stream = req.app.locals.streams.get(req.params.id);
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

function startStream(res: Response, stream: ProxyStream) {
	res.append("Content-Type", stream.mime);
	if (stream.size) {
		res.append("Content-Length", stream.size);
	}
	if (stream.filename) {
		res.append("Content-Disposition", `attachment; filename="${stream.filename}"`);
	} else {
		res.append("Content-Disposition", "attachment");
	}
	stream.source!.pipe(res);
	stream.flowing = true;
	res.on("close", () => {
		stream.events.emit("close");
	});
	clearTimeout(stream.timeout);
}

async function getStream(req: Request, res: Response) {
	const stream = req.app.locals.streams.get(req.params.id);
	if (!stream || stream.flowing) {
		res.sendStatus(404);
		return;
	}

	if (stream.source) {
		startStream(res, stream);
	} else {
		stream.events.on("source", () => startStream(res, stream));
		stream.events.on("timeout", () => {
			res.sendStatus(500);
		});
	}
}


const zipMimes = [
	"application/zip",
	"application/x-zip-compressed",
];

const contentTypeRegExp = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+)/;

async function uploadSave(req: Request, res: Response) {
	try {
		res.locals.user.checkPermission("core.instance.save.upload");
	} catch (err: any) {
		res.status(403).json({ request_errors: [err.message] });
		return;
	}

	let contentType = req.get("Content-Type") || "";
	let match = contentTypeRegExp.exec(contentType);
	if (!match) {
		res.status(415).json({ request_errors: ["invalid Content-Type"] });
		return;
	}
	let contentMime = match[1].toLowerCase();

	let tasks = [];
	let errors: string[] = [];
	let requestErrors = [];
	let saves: string[] = [];

	async function handleFile(instanceId:number, stream: nodeStream.Readable, filename: string, streamMime: string) {
		let proxyStream = await createProxyStream(req.app);
		proxyStream.source = stream;
		proxyStream.mime = streamMime;
		let timeout = new Promise<never>((_, reject) => {
			proxyStream.events.on("timeout", () => {
				stream.resume();
				reject(new Error("Timed out establishing stream to host"));
			});
		});

		try {
			let storedName: string = await Promise.race([
				req.app.locals.controller.sendToHostByInstanceId(
					new lib.InstancePullSaveRequest(
						instanceId,
						proxyStream.id,
						filename,
					)
				),
				timeout,
			]);
			saves.push(storedName);

		} catch (err: any) {
			proxyStream.events.emit("close");
			logger.error(`Error uploading save: ${err.message}`);
			errors.push(err.message);
			stream.resume();
		}
	}

	if (contentMime === "multipart/form-data") {
		await new Promise(resolve => {
			let instanceId: number | undefined;
			function fileHandler(
				name: string,
				stream: nodeStream.Readable,
				{ filename, mimeType }: { filename: string, mimeType: string }
			) {
				if (instanceId === undefined) {
					requestErrors.push("instance_id must come before files uploaded");
				}
				if (!zipMimes.includes(mimeType)) {
					requestErrors.push("invalid file Content-Type");
				}
				if (!filename.endsWith(".zip")) {
					requestErrors.push("filename must end with .zip");
				}
				if (errors.length || requestErrors.length) {
					stream.resume();
					return;
				}
				tasks.push(handleFile(instanceId as number, stream, filename, mimeType));
			}
			let parser = busboy({ headers: req.headers });
			parser.on("file", fileHandler);
			parser.on("field", (name, value, info) => {
				if (name === "instance_id") {
					instanceId = Number.parseInt(value, 10);
					if (Number.isNaN(instanceId)) {
						requestErrors.push("invalid instance_id");
					}
				}
			});
			parser.on("close", resolve);
			parser.on("error", (err: any) => {
				logger.error(`Error parsing multipart request in upload-save:\n${err.stack}`);
				errors.push(err.message);
			});
			req.pipe(parser);
		});

	} else if (zipMimes.includes(contentMime)) {
		let filename = req.query.filename;
		if (typeof filename !== "string") {
			requestErrors.push("Missing or invalid filename parameter");
		} else if (!filename.endsWith(".zip")) {
			requestErrors.push("filename must end with .zip");
		}
		let instanceId = Number.parseInt(String(req.query.instance_id), 10);
		if (Number.isNaN(instanceId)) {
			requestErrors.push("Missing or invalid instance_id parameter");
		}

		if (errors.length || requestErrors.length) {
			req.resume();
		} else {
			tasks.push(handleFile(instanceId, req, filename as string, contentMime));
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

function checkModName(name: string) {
	try {
		lib.checkFilename(name);
	} catch (err: any) {
		throw new lib.RequestError(`Mod name ${err.message}`);
	}
}

async function uploadMod(req: Request, res: Response) {
	try {
		res.locals.user.checkPermission("core.mod.upload");
	} catch (err: any) {
		res.status(403).json({ request_errors: [err.message] });
		return;
	}

	let contentType = req.get("Content-Type")!;
	let match = contentTypeRegExp.exec(contentType);
	if (!match) {
		res.status(415).json({ request_errors: ["invalid Content-Type"] });
		return;
	}
	let contentMime = match[1].toLowerCase();

	let tasks = [];
	let errors: string[] = [];
	let requestErrors = [];
	let mods: any[] = [];

	async function handleFile(stream: nodeStream.Readable, filename: string) {
		try {
			checkModName(filename);

		} catch (err: any) {
			logger.error(`Error uploading mod: ${err.message}`);
			errors.push(err.message);
			stream.resume();
			return;
		}

		const modsDirectory = req.app.locals.controller.config.get("controller.mods_directory");
		let tempFilename = filename.replace(/(\.zip)?$/, ".tmp.zip");

		let writeStream;
		try {

			while (true) {
				try {
					writeStream = fs.createWriteStream(path.join(modsDirectory, tempFilename), { flags: "wx" });
					await events.once(writeStream, "open");
					break;
				} catch (err: any) {
					if (err.code === "EEXIST") {
						tempFilename = await lib.findUnusedName(modsDirectory, tempFilename, ".tmp.zip");
					} else {
						throw err;
					}
				}
			}
			stream.pipe(writeStream);
			await finished(writeStream);

			const modInfo = await lib.ModInfo.fromModFile(path.join(modsDirectory, tempFilename));
			checkModName(modInfo.filename);
			await fs.rename(path.join(modsDirectory, tempFilename), path.join(modsDirectory, modInfo.filename));
			req.app.locals.controller.modStore.addMod(modInfo);
			mods.push(modInfo.toJSON());

		} catch (err: any) {
			logger.error(`Error uploading mod: ${err.message}`);
			errors.push(err.message);
			stream.resume();

			// Attempt to clean up.
			if (writeStream) {
				writeStream.destroy();
			}

			try {
				await fs.unlink(path.join(modsDirectory, tempFilename));
			} catch (unlinkErr: any) {
				if (unlinkErr.code !== "ENOENT") {
					logger.error(`Error removing ${tempFilename}: ${unlinkErr.message}`);
				}
			}
		}
	}

	if (contentMime === "multipart/form-data") {
		await new Promise(resolve => {
			function fileHandler(
				name: string,
				stream: nodeStream.Readable,
				{ filename, mimeType }: { filename: string, mimeType: string }
			) {
				if (!zipMimes.includes(mimeType)) {
					requestErrors.push("invalid file Content-Type");
				}
				if (!filename.endsWith(".zip")) {
					requestErrors.push("filename must end with .zip");
				}
				if (errors.length || requestErrors.length) {
					stream.resume();
					return;
				}
				tasks.push(handleFile(stream, filename));
			}

			let parser = busboy({ headers: req.headers });
			parser.on("file", fileHandler);
			parser.on("close", resolve);
			parser.on("error", (err: any) => {
				logger.error(`Error parsing multipart request in upload-mod:\n${err.stack}`);
				errors.push(err.message);
			});
			req.pipe(parser);
		});

	} else if (zipMimes.includes(contentMime)) {
		let filename = req.query.filename;
		if (typeof filename !== "string") {
			requestErrors.push("Missing or invalid filename parameter");
		} else if (!filename.endsWith(".zip")) {
			requestErrors.push("filename must end with .zip");
		}

		if (errors.length || requestErrors.length) {
			req.resume();
		} else {
			tasks.push(handleFile(req, filename as string));
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

	res.json({ mods });
}


export function addRouteHandlers(app: Application) {
	app.get("/metrics", (req:Request, res:Response, next:any) => getMetrics(req, res, next).catch(next));
	app.get("/api/plugins", getPlugins);
	app.put("/api/upload-export",
		validateHostToken,
		(req:Request, res:Response, next:any) => uploadExport(req, res).catch(next)
	);
	app.put("/api/stream/:id", (req:Request, res:Response, next:any) => putStream(req, res).catch(next));
	app.get("/api/stream/:id", (req:Request, res:Response, next:any) => getStream(req, res).catch(next));
	app.post("/api/upload-save",
		validateUserToken,
		(req:Request, res:Response, next:any) => uploadSave(req, res).catch(next)
	);
	app.post("/api/upload-mod",
		validateUserToken,
		(req:Request, res:Response, next:any) => uploadMod(req, res).catch(next)
	);
}

// Routes used in the web interface and served by the controller
export const webRoutes = [
	"/",
	"/controller",
	"/hosts",
	"/hosts/:id/view",
	"/instances",
	"/instances/:id/view",
	"/mods",
	"/mods/mod-packs/:id/view",
	"/users",
	"/users/:id/view",
	"/roles",
	"/roles/:id/view",
	"/plugins",
	"/plugins/:name/view",
];
