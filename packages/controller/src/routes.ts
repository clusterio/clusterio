import express, { type Application, type Request, type Response } from "express";
import Controller from "./Controller.js";
import HostPairingManager, { HostPairingError } from "./HostPairingManager.js";

import busboy from "busboy";
import crypto from "crypto";
import events from "events";
import fs from "node:fs/promises";
import path from "path";
import nodeStream from "stream";
import util from "util";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";

const finished = util.promisify(nodeStream.finished);

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		export interface Locals {
			controller: Controller,
			webBundle: { main: string, imports: Record<string, string> },
			devServer?: import("vite").ViteDevServer,
			staticRoot: string | null,
			devPlugins?: Map<string, string>,
			streams: Map<string, ProxyStream>,
			pendingMetrics?: Promise<string>,
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
		destinationResult.samples.push(entry);
	}
}

// Collect metrics from the controller, its plugins and all connected hosts
async function gatherMetrics(controller: Controller) {
	let results: lib.CollectorResult[] = [];
	let pluginResults = await controller.hooks.metrics.collect();
	for (let metricIterator of pluginResults) {
		for await (let metric of metricIterator) {
			results.push(metric);
		}
	}

	let requests: Promise<InstanceType<typeof lib.HostMetricsRequest["Response"]> | null>[] = [];
	let timeoutMs = controller.config.get("controller.metrics_timeout") * 1000;
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
			timeoutMs, null
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

	return await lib.exposition(results);
}

// Prometheus polling endpoint
async function getMetrics(req: Request, res: Response) {
	try {
		res.locals.user.checkPermission("core.controller.metrics");
	} catch (err: any) {
		res.status(403).json({ request_errors: [err.message] });
		return;
	}

	// Concurrent scrapes share one gather so hosts see at most one
	// metrics request at a time regardless of how many clients poll.
	const locals = req.app.locals;
	if (!locals.pendingMetrics) {
		locals.pendingMetrics = gatherMetrics(locals.controller).finally(() => {
			locals.pendingMetrics = undefined;
		});
	}
	const text = await locals.pendingMetrics;
	res.set("Content-Type", lib.expositionContentType);
	res.send(text);
}


/**
 * Removes the static/ prefix from bundle paths in manifest.json so they can be
 * resolved relative to staticRoot.
 */
export function stripStaticPrefix(bundlePath: string) {
	return bundlePath.replace(/^static\//, "");
}

function getPlugins(req: Request, res: Response) {
	let plugins: lib.PluginWebApi[] = [];
	for (let pluginInfo of req.app.locals.controller.pluginInfos) {
		let name = pluginInfo.name;
		const loaded = req.app.locals.controller.loadedPlugins.has(pluginInfo);
		const enabled = loaded && req.app.locals.controller.config.get(`${pluginInfo.name}.load_plugin`);
		// Note: Cast through unknown is needed because load_plugin is
		// defined at runtime and no other fields in the controller config
		// currently have the boolean type.
		let web: { main: any, error: string|undefined } = { main: undefined, error: undefined};
		let devPlugins = req.app.locals.devPlugins;
		if (devPlugins && devPlugins.has(name)) {
			web.main = devPlugins.get(name);
		} else if (pluginInfo.manifest) {
			web.main = pluginInfo.manifest.main;
			if (!web.main) {
				web.error = "Incompatible dist/web/manifest.json, the plugin must be rebuilt with Vite";
			}
		} else if (lib.pluginNeedsWebBuild(pluginInfo)) {
			web.error = "Missing dist/web/manifest.json";
		}
		if (web.main) {
			web.main = stripStaticPrefix(web.main);
		}
		plugins.push({ name, version: pluginInfo.version, enabled, loaded, web, npmPackage: pluginInfo.npmPackage });
	}
	res.send(plugins);
}

function getClusterName(req: Request, res: Response) {
	const controller: Controller = req.app.locals.controller;
	const clusterName = controller.config.get("controller.name");
	res.json({ name: clusterName });
}

// Reads the access token from X-Access-Token or Authorization: Bearer
function getAccessToken(req: Request) {
	const token = req.header("x-access-token");
	if (token) {
		return token;
	}
	const authorization = req.header("authorization");
	if (authorization && /^Bearer /i.test(authorization)) {
		return authorization.slice("Bearer ".length).trim();
	}
	return undefined;
}

function validateHostToken(req: Request, res: Response, next: any) {
	let token = getAccessToken(req);
	if (!token) {
		res.sendStatus(401);
		return;
	}

	try {
		req.app.locals.controller.hosts.verifyHostToken(token);
	} catch (err) {
		res.sendStatus(401);
		return;
	}

	next();
}

function validateUserToken(req: Request, res: Response, next: any) {
	let token = getAccessToken(req);
	if (!token) {
		res.sendStatus(401);
		return;
	}

	try {
		res.locals.user = req.app.locals.controller.users.verifyUserToken(token);
	} catch (err) {
		res.sendStatus(401);
		return;
	}

	next();
}

// Responds with the status of a pairing error, returns false for other errors.
function sendHostPairingError(res: Response, err: unknown) {
	if (!(err instanceof HostPairingError)) {
		return false;
	}
	if (err.retryAfter !== undefined) {
		res.set("Retry-After", String(err.retryAfter));
	}
	res.status(err.status).json({ error: err.message });
	return true;
}

// Checks recovery mode and the request id for the pairing endpoints, returns false if responded to.
function checkHostPairingRequest(req: Request, res: Response, needsRequestId: boolean) {
	if (req.app.locals.controller.recoveryMode) {
		res.status(503).json({ error: "Controller is in recovery mode" });
		return false;
	}
	if (needsRequestId && typeof req.body?.requestId !== "string") {
		res.status(400).json({ error: "requestId is required" });
		return false;
	}
	return true;
}

// Request from a host for a host to join the cluster.
function createHostPairing(req: Request, res: Response) {
	if (!checkHostPairingRequest(req, res, false)) {
		return;
	}
	const controller = req.app.locals.controller;
	const remoteAddress = controller.wsServer.remoteAddr(req);
	try {
		const name = HostPairingManager.validateName(req.body?.name);
		const version = typeof req.body?.version === "string" ? req.body.version.slice(0, 64) : "";

		// A user allowed to approve hosts can skip the wait by passing their token.
		const token = getAccessToken(req);
		if (token !== undefined) {
			let user;
			try {
				user = controller.users.verifyUserToken(token);
			} catch (err) {
				res.status(401).json({ error: "Invalid user token" });
				return;
			}
			try {
				user.checkPermission("core.host.approve");
			} catch (err) {
				logger.audit(
					`User ${user.name} tried to approve host ${name} from ${remoteAddress} without permission`
				);
				res.status(403).json({ error: `User ${user.name} is not allowed to approve hosts` });
				return;
			}
			const host = controller.hosts.createHost(name);
			logger.audit(
				`User ${user.name} approved host ${host.name} (${host.id}) from ${remoteAddress} with their token`
			);
			res.status(200).json({ hostId: host.id, token: controller.hosts.signHostToken(host.id), name: host.name });
			return;
		}

		res.status(202).json(controller.hostPairing.create(name, version, remoteAddress));
	} catch (err) {
		if (!sendHostPairingError(res, err)) {
			throw err;
		}
	}
}

// Poll from a host for the result of its request.
function pollHostPairing(req: Request, res: Response) {
	if (!checkHostPairingRequest(req, res, true)) {
		return;
	}
	try {
		const result = req.app.locals.controller.hostPairing.poll(req.body.requestId);
		if (result) {
			res.status(200).json(result);
		} else {
			res.status(202).json({ status: "pending" });
		}
	} catch (err) {
		if (!sendHostPairingError(res, err)) {
			throw err;
		}
	}
}

// Cancel from a host that stopped waiting.
function cancelHostPairing(req: Request, res: Response) {
	if (!checkHostPairingRequest(req, res, true)) {
		return;
	}
	req.app.locals.controller.hostPairing.cancel(req.body.requestId);
	res.sendStatus(204);
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
	let modPack = res.app.locals.controller.modPacks.getMutable(modPackId);
	if (!modPack) {
		res.sendStatus(400);
		return;
	}

	let data = [];
	for await (let chunk of req) {
		data.push(chunk);
	}
	let zip = await lib.ZipArchive.fromBuffer(Buffer.concat(data));

	// This is hardcoded to prevent path expansion attacks
	let exportFiles = [
		"export/settings.json",
		"export/prototypes.json",
		"export/locale.json",
		"export/defines.json",
		"export/spritesheet.png",
		"export/metadata.json",
	];

	let assets: any = {};
	let settingPrototypes: lib.ExportSettings = {};
	for (let filePath of exportFiles) {
		let file = zip.file(filePath);
		if (!file) {
			continue;
		}

		let content = await zip.readEntry(file);
		if (filePath === "export/settings.json") {
			settingPrototypes = JSON.parse(content.toString("utf8"));
		}

		let { name, ext } = path.posix.parse(filePath);
		let hash = await lib.hashStream(await zip.openStream(file));
		assets[name] = `${name}.${hash}${ext}`;
		await lib.atomicOverwriteFile(path.join("static", `${name}.${hash}${ext}`), content);
	}

	modPack.exportManifest = new lib.ExportManifest(assets, new Date().toISOString());
	modPack.fillDefaultSettings(settingPrototypes, logger);
	res.app.locals.controller.modPacks.set(modPack);

	res.sendStatus(200);
}

// Reached when no static file matched, drops exports whose files were removed
export function missingExportAsset(req: Request, res: Response, next: any) {
	const file = req.path.slice(1);
	if (!["GET", "HEAD"].includes(req.method) || !file) {
		next();
		return;
	}
	const modPacks = res.app.locals.controller.modPacks;
	const affected = [...modPacks.valuesMutable()].filter(
		modPack => modPack.exportManifest && Object.values(modPack.exportManifest.assets).includes(file)
	);
	if (!affected.length) {
		next();
		return;
	}
	for (const modPack of affected) {
		Controller.dropExport(modPack, `${file} was removed from disk`);
	}
	modPacks.setMany(affected);
	res.status(404).type("text/plain").send(
		`Export data file ${file} is missing, run export-data on an instance to regenerate it`
	);
}

type ProxyStreamEvents = {
	"error": [ err: any ],
	"close": [],
	"timeout": [],
	"source": [],
};

export interface ProxyStream {
	id: string;
	source: nodeStream.Readable | null;
	flowing: boolean;
	size?: string;
	mime?: string;
	filename: string | null;
	events: events.EventEmitter<ProxyStreamEvents>;
	timeout: ReturnType<typeof setTimeout>;
	closed: boolean;
	/** Bytes the receiver has taken, set once the stream is flowing */
	progress?: () => number;
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
		closed: false,
	};
	stream.events.on("close", () => {
		stream.closed = true;
		clearTimeout(stream.timeout);
		app.locals.streams.delete(id);
	});
	stream.events.on("timeout", () => {
		stream.events.emit("close");
	});
	app.locals.streams.set(id, stream);
	return stream;
}

/**
 * Options for the HTTP servers the routes are served from
 *
 * Node closes requests that have not been received in full after 5 minutes
 * by default, which would cut off large uploads over slow connections.
 * Requests are instead closed by guardRequest when they move too little.
 * Turning the limit off also turns off the limit on receiving the headers,
 * which guardRequest can't cover, so that is set back to its default.
 */
export const httpServerOptions = { requestTimeout: 0, headersTimeout: 60_000 };

/** Time an upload is read and thrown away after it was answered, before its connection is closed */
const answeredUploadDrainMs = 1000;

/**
 * Guard requests against wasted and stalled transfers
 *
 * Node reads and discards the body of a request answered before it was
 * read to keep the connection open. A client, or a proxy in front of the
 * controller, that keeps sending would upload the whole body for nothing,
 * so the connection is closed if the body hasn't ended shortly after the
 * response. Closing it right away could make the client lose the response.
 *
 * The connection is also closed if the request moved less than
 * controller.transfer_min_progress during a check interval, so that a
 * request which stalled or is trickled in does not stay open forever while
 * a slow one can take the time it needs. For a request body this is what
 * was received of it. For both ends of a proxy stream it is what the
 * receiver has taken, as the sender is held back when the receiver is the
 * slow one. Time spent waiting for a proxy stream to start is not counted,
 * controller.proxy_stream_timeout limits that.
 * @param checkIntervalMs - Interval to check the progress of requests on.
 * @returns Express middleware.
 */
function guardRequest(checkIntervalMs: number) {
	return function(req: Request, res: Response, next: any) {
		const socket = req.socket;
		res.once("finish", () => {
			if (req.complete || socket.destroyed) {
				return;
			}
			const timeout = setTimeout(() => socket.destroy(), answeredUploadDrainMs);
			const onClose = () => clearTimeout(timeout);
			socket.once("close", onClose);
			// The connection may be kept open for more requests, so don't leave a listener on it
			req.once("end", () => {
				clearTimeout(timeout);
				socket.off("close", onClose);
			});
		});

		const received = () => socket.bytesRead;
		let measure: (() => number) | undefined = received;
		let last = received();
		const check = setInterval(() => {
			const stream: ProxyStream | undefined = res.locals.proxyStream;
			let current: (() => number) | undefined;
			if (stream && !stream.closed) {
				current = stream.progress;
			} else if (!req.complete) {
				current = received;
			}
			const minProgress = req.app.locals.controller.config.get("controller.transfer_min_progress");
			if (current !== measure || !current || !minProgress) {
				// What to measure changed, start over from here.
				measure = current;
				last = current ? current() : 0;
				return;
			}
			const progress = current();
			if (progress - last < minProgress * 1024) {
				logger.warn(
					`Closing ${req.method} ${req.path}, it moved less than ${minProgress} KiB ` +
					`in ${checkIntervalMs / 1000} seconds`
				);
				socket.destroy();
			}
			last = progress;
		}, checkIntervalMs);
		res.once("close", () => clearInterval(check));
		next();
	};
}

async function putStream(req: Request<{ id: string }>, res: Response) {
	const stream = req.app.locals.streams.get(req.params.id);
	if (!stream || stream.source) {
		res.sendStatus(404);
		return;
	}
	res.locals.proxyStream = stream;
	stream.source = req;
	stream.mime = req.get("Content-Type");
	stream.size = req.get("Content-Length");

	stream.events.emit("source");
	stream.events.on("close", () => {
		// The stream also closes when it timed out or the receiver disconnected.
		res.sendStatus(stream.flowing && req.complete ? 200 : 500);
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
	const source = stream.source!;
	const socket = res.socket!;
	source.pipe(res);
	stream.flowing = true;
	// Counts completed writes, so data waiting in a buffer is not progress.
	stream.progress = () => socket.bytesWritten - socket.writableLength;
	// Pipe does not pass on a source that was cut short, the receiver would wait forever.
	const onSourceClose = () => {
		if (!res.writableEnded) {
			res.destroy();
		}
	};
	source.once("close", onSourceClose);
	res.on("close", () => {
		source.off("close", onSourceClose);
		source.unpipe(res);
		stream.events.emit("close");
	});
	clearTimeout(stream.timeout);
}

async function getStream(req: Request<{ id: string }>, res: Response) {
	const stream = req.app.locals.streams.get(req.params.id);
	if (!stream || stream.flowing) {
		res.sendStatus(404);
		return;
	}
	res.locals.proxyStream = stream;

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

/** Error in an upload that is the fault of the request */
class UploadRequestError extends Error {
	constructor(message: string, public status = 400) {
		super(message);
	}
}

interface UploadedZip {
	/** Content of the file, ends with an error if the upload is cut short */
	stream: nodeStream.Readable;
	filename: string;
	mime: string;
	/** Form fields received before the file, or the query parameters of a zip upload */
	fields: Map<string, string>;
	/** True if the file is part of a multipart form */
	multipart: boolean;
}

/**
 * Receive zip files uploaded as either the request body or a multipart form
 *
 * Responds with the first error, without reading the rest of the upload.
 * Errors other than UploadRequestError are logged and responded to with 500.
 * @param req - The upload.
 * @param res - Response to the upload.
 * @param kind - What is uploaded, for the log.
 * @param handleFile -
 *     Called with each file, the next file is not read before the stream of
 *     the previous has been consumed.
 * @returns true if all files were handled, false if an error was responded with.
 */
async function receiveZipUpload(
	req: Request,
	res: Response,
	kind: string,
	handleFile: (file: UploadedZip) => Promise<void>,
): Promise<boolean> {
	function fail(err: any) {
		if (res.headersSent) {
			return;
		}
		if (err instanceof UploadRequestError) {
			res.status(err.status).json({ request_errors: [err.message] });
			return;
		}
		logger.error(`Error uploading ${kind}: ${err.message}`);
		res.status(500).json({ errors: [err.message], request_errors: [] });
	}

	const match = contentTypeRegExp.exec(req.get("Content-Type") || "");
	const contentMime = match ? match[1].toLowerCase() : "";

	if (zipMimes.includes(contentMime)) {
		try {
			const filename = req.query.filename;
			if (typeof filename !== "string") {
				throw new UploadRequestError("Missing or invalid filename parameter");
			}
			if (!filename.endsWith(".zip")) {
				throw new UploadRequestError("filename must end with .zip");
			}
			const fields = new Map<string, string>();
			for (const [name, value] of Object.entries(req.query)) {
				if (typeof value === "string") {
					fields.set(name, value);
				}
			}
			await handleFile({ stream: req, filename, mime: contentMime, fields, multipart: false });
		} catch (err: any) {
			fail(err);
			return false;
		}
		return true;
	}

	if (contentMime !== "multipart/form-data") {
		fail(new UploadRequestError("invalid Content-Type", 415));
		return false;
	}

	let parser: busboy.Busboy;
	try {
		parser = busboy({ headers: req.headers });
	} catch (err: any) {
		fail(new UploadRequestError(err.message));
		return false;
	}

	return await new Promise<boolean>(resolve => {
		const fields = new Map<string, string>();
		const tasks: Promise<void>[] = [];
		let failed = false;
		function onError(err: any) {
			if (failed) {
				return;
			}
			failed = true;
			fail(err);
			// Stop reading the upload, this ends the file being read with an error.
			req.unpipe(parser);
			parser.destroy();
			resolve(false);
		}
		parser.on("field", (name, value) => {
			fields.set(name, value);
		});
		parser.on("file", (name, stream, { filename, mimeType }) => {
			// The handler may be done with the stream by the time it fails.
			stream.on("error", () => {});
			if (failed) {
				stream.resume();
			} else if (!zipMimes.includes(mimeType)) {
				onError(new UploadRequestError("invalid file Content-Type"));
			} else if (!filename?.endsWith(".zip")) {
				onError(new UploadRequestError("filename must end with .zip"));
			} else {
				tasks.push(handleFile({
					stream, filename, mime: mimeType, fields: new Map(fields), multipart: true,
				}).catch(onError));
			}
		});
		parser.on("error", onError);
		parser.on("close", () => {
			Promise.all(tasks).then(() => resolve(!failed));
		});
		// Pipe does not end the parser if the upload is cut short.
		req.once("close", () => {
			if (!req.complete) {
				onError(new Error("Upload was aborted"));
			}
		});
		req.pipe(parser);
	});
}

async function uploadSave(req: Request, res: Response) {
	try {
		res.locals.user.checkPermission("core.instance.save.upload");
	} catch (err: any) {
		res.status(403).json({ request_errors: [err.message] });
		return;
	}

	let saves: string[] = [];
	async function handleFile(file: UploadedZip) {
		const value = file.fields.get("instance_id");
		if (value === undefined && file.multipart) {
			throw new UploadRequestError("instance_id must come before files uploaded");
		}
		const instanceId = Number.parseInt(String(value), 10);
		if (Number.isNaN(instanceId)) {
			throw new UploadRequestError(
				file.multipart ? "invalid instance_id" : "Missing or invalid instance_id parameter"
			);
		}

		let proxyStream = await createProxyStream(req.app);
		res.locals.proxyStream = proxyStream;
		proxyStream.source = file.stream;
		proxyStream.mime = file.mime;
		let timeout = new Promise<never>((_, reject) => {
			proxyStream.events.on("timeout", () => {
				reject(new Error("Timed out establishing stream to host"));
			});
		});

		try {
			let storedName: string = await Promise.race([
				req.app.locals.controller.sendToHostByInstanceId(
					new lib.InstancePullSaveRequest(
						instanceId,
						proxyStream.id,
						file.filename,
					)
				),
				timeout,
			]);
			saves.push(storedName);

		} catch (err: any) {
			proxyStream.events.emit("close");
			throw err;
		}
	}

	if (await receiveZipUpload(req, res, "save", handleFile)) {
		res.json({ saves });
	}
}

function checkModName(name: string) {
	try {
		lib.checkFilename(name);
	} catch (err: any) {
		throw new lib.ValidationError(`Mod name ${err.message}`);
	}
}

async function uploadMod(req: Request, res: Response) {
	try {
		res.locals.user.checkPermission("core.mod.upload");
	} catch (err: any) {
		res.status(403).json({ request_errors: [err.message] });
		return;
	}

	let mods: any[] = [];
	async function handleFile(file: UploadedZip) {
		checkModName(file.filename);

		const modsDirectory = req.app.locals.controller.config.get("controller.mods_directory");
		const filePath = path.join(modsDirectory, file.filename);
		const [tempFilePath, writeStream] = await lib.createTempWriteStream(filePath);

		try {
			file.stream.pipe(writeStream);
			// Pipe does not pass on an upload that was cut short.
			await Promise.all([finished(file.stream), finished(writeStream)]);

			const modInfo = await lib.ModInfo.fromModFile(tempFilePath);
			checkModName(modInfo.filename);
			await fs.rename(tempFilePath, path.join(modsDirectory, modInfo.filename));
			req.app.locals.controller.modStore.addMod(modInfo);
			mods.push(modInfo.toJSON());

		} catch (err: any) {
			// Attempt to clean up.
			file.stream.unpipe(writeStream);
			writeStream.destroy();

			try {
				await fs.unlink(tempFilePath);
			} catch (unlinkErr: any) {
				if (unlinkErr.code !== "ENOENT") {
					logger.error(`Error removing ${tempFilePath}: ${unlinkErr.message}`);
				}
			}
			throw err;
		}
	}

	if (await receiveZipUpload(req, res, "mod", handleFile)) {
		res.json({ mods });
	}
}


export function addRouteHandlers(app: Application, progressCheckIntervalMs = 30_000) {
	app.use(guardRequest(progressCheckIntervalMs));
	app.get("/metrics",
		validateUserToken,
		(req:Request, res:Response, next:any) => getMetrics(req, res).catch(next)
	);
	app.get("/api/plugins", getPlugins);
	app.get("/api/cluster-name", getClusterName);
	// Set before parsing so errors from the body parser and token check are not cached either.
	const noStore = (req: Request, res: Response, next: any) => {
		res.set("Cache-Control", "no-store");
		next();
	};
	const pairingJson = express.json({ limit: "4kb" });
	app.post("/api/host-pairing", noStore, pairingJson, createHostPairing);
	app.post("/api/host-pairing/poll", noStore, pairingJson, pollHostPairing);
	app.post("/api/host-pairing/cancel", noStore, pairingJson, cancelHostPairing);
	app.get("/api/host-pairing/check", noStore, validateHostToken, (req: Request, res: Response) => {
		res.json({ valid: true });
	});
	app.put("/api/upload-export",
		validateHostToken,
		(req:Request, res:Response, next:any) => uploadExport(req, res).catch(next)
	);
	app.put("/api/stream/:id",
		(req:Request<{ id: string }>, res:Response, next:any) => putStream(req, res).catch(next)
	);
	app.get("/api/stream/:id",
		(req:Request<{ id: string }>, res:Response, next:any) => getStream(req, res).catch(next)
	);
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
	"/mods/mod-packs/:id/icon-reference",
	"/users",
	"/users/:id/view",
	"/roles",
	"/roles/:id/view",
	"/plugins",
	"/plugins/:name/view",
	"/error",
];
