// Factorio Server interface
import fs from "fs-extra";
import child_process from "child_process";
import path from "path";
import events from "events";
import util from "util";
import crypto from "crypto";
import { Rcon } from "rcon-client";

import * as lib from "@clusterio/lib";


/**
 * Determines the version of Factorio the datadir is pointing to by
 * reading the changelog.txt in it.
 *
 * @param changelogPath - Path to changelog.txt.
 * @internal
 */
async function getVersion(changelogPath: string) {
	let changelog;
	try {
		changelog = await fs.readFile(changelogPath, "utf-8");
	} catch (err: any) {
		if (err.code === "ENOENT") {
			return null;
		}
		throw err;
	}

	for (let line of changelog.split(/[\r\n]+/)) {
		let index = line.indexOf(":");
		if (index !== -1) {
			let name = line.slice(0, index).trim();
			if (name.toLowerCase() === "version") {
				return line.slice(index + 1).trim();
			}
		}
	}

	return null;
}

/**
 * Comparison function for sorting Factorio version strings
 *
 * @param a - Version to compare.
 * @param b - Version to compare.
 * @returns 1 if a < b, 0 if a = b and -1 if a > b.
 * @internal
 */
function versionOrder(a: string, b: string) {
	let aParts = a.split(".").map(s => Number.parseInt(s, 10));
	let bParts = b.split(".").map(s => Number.parseInt(s, 10));

	for (let i = 0; i < aParts.length; i++) {
		if (aParts[i] === bParts[i]) {
			continue;
		} else if (aParts[i] < bParts[i]) {
			return 1;
		} else {
			return -1;
		}
	}

	return 0;
}

/**
 * Find factorio data directory of the given version
 *
 * Searches the given factorio dir for an installation of Factorio of
 * the target version.
 *
 * @param factorioDir - Path to Factorio installation dir(s).
 * @param targetVersion -
 *     Version to look for, supports the special value "latest" for the
 *     latest version available.
 * @returns Array with path to data dir and version found.
 * @internal
 */
async function findVersion(factorioDir: string, targetVersion: string) {

	// There are two supported setups: having the factorio dir be the actual
	// install directory, and having the factorio dir be a folder containing
	// multiple install directories

	let simpleVersion = await getVersion(path.join(factorioDir, "data", "changelog.txt"));
	if (simpleVersion !== null) {
		if (simpleVersion === targetVersion || targetVersion === "latest") {
			return [path.join(factorioDir, "data"), simpleVersion];
		}

		throw new Error(
			`Factorio version ${targetVersion} was requested, but install directory contains ${simpleVersion}`
		);
	}

	let versions = new Map();
	for (let entry of await fs.readdir(factorioDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}

		let version = await getVersion(path.join(factorioDir, entry.name, "data", "changelog.txt"));
		if (version === null) {
			continue;
		}

		if (version === targetVersion) {
			return [path.join(factorioDir, entry.name, "data"), version];
		}

		versions.set(version, entry.name);
	}

	if (!versions.size) {
		throw new Error(`Unable to find any Factorio install in ${factorioDir}`);
	}

	if (targetVersion === "latest") {
		let latest = [...versions.keys()].sort(versionOrder)[0];
		return [path.join(factorioDir, versions.get(latest), "data"), latest];
	}

	throw new Error(`Unable to find Factorio version ${targetVersion}`);
}

/**
 * Give a random dynamic port
 *
 * Returns a random port number in the Dynamic Ports range as defined by
 * RFC 6335.
 *
 * @return a number in the range 49152 to 65535.
 * @internal
 */
function randomDynamicPort() {
	const start = 49152;
	const end = 65535 + 1;

	return Math.floor(Math.random() * (end - start) + start);
}

/**
 * Generate a secure random password of the given length
 *
 * Uses crypto.randomBytes to generate a secure alphanumeric password of
 * the given length.
 *
 * @param length - the length of the password to generate.
 * @return password of the given length
 * @internal
 */
async function generatePassword(length: number) {
	function validChar(byte: number) {
		const ranges = ["az", "AZ", "09"];
		return ranges.some(range => (
			range.codePointAt(0)! <= byte && byte <= range.codePointAt(1)!
		));
	}
	let randomBytesAsync = util.promisify(crypto.randomBytes);

	let password = "";
	while (true) {
		let bytes = await randomBytesAsync((length - password.length) * 3);
		for (let byte of bytes) {

			// Crop to ASCII values only
			byte = byte & 0x7f;

			if (validChar(byte)) {
				password += String.fromCharCode(byte);
				if (password.length === length) {
					return password;
				}
			}
		}
	}
}

/**
 * Interpret lines of output from Factorio
 *
 * Parses a line of output from Factorio and interprets the content
 * based on the broad categories of output that it produces.
 *
 * TODO document output format.
 *
 * @param line - A line of output not including the line terminator
 * @param source - Passed into the output structure as source
 *
 * @returns - An object with interpeted data.
 * @internal
 */
function parseOutput(line: string, source: "stdout" | "stderr"): lib.ParsedFactorioOutput {
	// There are three broad categories of output from Factorio, the first kind
	// starts with the seconds since the server started and has a format of
	// "   0.704 message"
	const secRegex = /^ {0,3}(\d+\.\d+) (.*)$/;
	let secMatch = secRegex.exec(line);
	if (secMatch) {
		const format = "seconds";
		const time = secMatch[1];
		const secContent = secMatch[2];

		// A seconds output has two different kinds of formats: The first is a
		// log level and source location and has a format of
		// "Level File.cpp:123: message"
		// "Script @/path/to/file.lua:123: message"
		// "Script =(command):123: message"
		const secLogRegex = /^(\w+) ((\w+\.cpp:\d+)|([@=].*?:\d+)): (.*)$/;
		let secLogMatch = secLogRegex.exec(secContent);
		if (secLogMatch) {
			return {
				source,
				format,
				time,
				type: "log",
				level: secLogMatch[1],
				file: secLogMatch[2],
				message: secLogMatch[5],
			};
		}

		// The other possibility is that the content is a generic message
		return {
			source,
			format,
			time,
			type: "generic",
			message: secContent,
		};
	}

	// The second category of output starts with a date stamp of the format
	// "yyyy-mm-dd hh:mm:ss message"
	const dateRegex = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (.*)$/;
	let dateMatch = dateRegex.exec(line);
	if (dateMatch) {
		const format = "date";
		const time = dateMatch[1];
		let dateContent = dateMatch[2];

		// A date output has two general formats.  The first is an action
		// followed by a message and has a format of "[ACTION] message"
		const dateActionRegex = /^\[(\w+)\] (.*)$/;
		let dateActionMatch = dateActionRegex.exec(dateContent);
		if (dateActionMatch) {
			return {
				source,
				format,
				time,
				type: "action",
				action: dateActionMatch[1],
				message: dateActionMatch[2],
			};
		}

		// The other format is a generic message
		return {
			source,
			format,
			time,
			type: "generic",
			message: dateContent,
		};
	}

	// The last category of output is simply a generic message with no
	// formating.
	return {
		source,
		format: "none",
		type: "generic",
		message: line,
	};
}

// https://stackoverflow.com/a/49402091
type KeysOfUnion<T> = T extends T ? keyof T : never;

interface Heuristic {
	filter: {
		[P in KeysOfUnion<lib.ParsedFactorioOutput>]?: string | string[] | RegExp;
	},
	action(this: FactorioServer, parsed: lib.ParsedFactorioOutput): void;
}

// These are filters applied to the output from Factorio.  The filter
// syntax is a set of properties to test for in the parsed output.  If
// the property is a RegExp it's tested using the RegExp.  If it's an
// array it's tested using the includes method of the array.  Otherwise
// the property must compare strictly equal.
//
// If the filter matches the action is called with the FactorioServer
// instance bound as this.
const outputHeuristics: Heuristic[] = [
	// Message indicating the RCON interface has started
	{
		filter: { type: "log", message: /^Starting RCON interface/ },
		action: function() {
			this._startRcon().catch((err) => { this.emit("error", err); });
		},
	},

	// Message indicating the server is done starting up
	{
		filter: { type: "log", message: /^(update|map)Tick\(\d+\) changing state from\(CreatingGame\) to\(InGame\)$/ },
		action: function() {
			this._notifyGameReady().catch((err) => { this.emit("error", err); });
		},
	},

	// Message indicating the server has started an autosave
	{
		filter: {
			type: "log",
			message: /^Saving to _autosave\d+ \((non-)?blocking\)\.$/,
		},
		action: function(parsed) {
			let name = /^Saving to (_autosave\d+) /.exec(parsed.message)![1];
			this.emit("_autosave", name);
		},
	},

	// Message indicating the server has started saving
	{
		filter: {
			type: "log",
			message: /^Saving game as /,
		},
		action: function() {
			this.emit("_saving");
		},
	},

	// Message indicating the server has finished saving
	{
		filter: {
			type: "log",
			message: [
				"Saving finished",

				// Outputted when saving failed from --server-start-load-scenario
				"Can't save to default location: Default location not known",
			],
		},
		action: function() {
			this.emit("_saved");
		},
	},

	// Message indicating the server is shutting down
	{
		filter: {
			type: "generic",
			message: /^Quitting: /,
		},
		action: function(parsed) {
			this.emit("_quitting");

			// On windows the Factorio server will wait for input on the console input buffer
			// when an error occurs.  Since we can't send input there we terminate the server
			// process when this happens.
			if (process.platform === "win32" && parsed.message === "Quitting: multiplayer error.") {
				this._server!.kill();
			}
		},
	},

	// Messages that might be tha cause of an unexpected shutdown.
	{
		filter: {
			type: "log",
			level: "Error",
			message: [
				"MultiplayerManager failed: \"Binding IPv4 socket failed: Permission denied\"",
				"MultiplayerManager failed: Host address is already in use.",
			],
		},
		action: function(parsed) {
			this._unexpected.push(`Factorio failed to bind to game port: ${parsed.message}`);
		},
	},
	{
		filter: {
			type: "log",
			level: "Error",
			message: [
				"Can't bind socket: Address already in use",
				"Can't bind socket: Permission denied",
			],
		},
		action: function(parsed) {
			this._unexpected.push(`Factorio failed to bind to RCON port: ${parsed.message}`);
		},
	},
];


export interface FactorioServerOptions {
	/** Logger to use for reporting errors. */
	logger?: lib.Logger,
	/**
	 * Version of Factorio to use.  Can also be the string "latest" to use
	 * the latest version found in `factorioDir`.
	 */
	version?: string,
	/** UDP port to host game on. */
	gamePort?: number,
	/** TCP port to use for RCON. */
	rconPort?: number,
	/** Password use for RCON. */
	rconPassword?: string,
	/** Turn on whitelisting. */
	enableWhitelist?: boolean,
	/** Enable Factorio.com based multiplayer bans. */
	enableAuthserverBans?: boolean,
	/** Enable verbose logging. */
	verboseLogging?: boolean,
	/** Strip paths in the console. */
	stripPaths?: boolean,
	/**
	 * Maximum number of RCON commands transmitted in parallel on the RCON
	 * connection.
	 */
	maxConcurrentCommands?: number
	/** Timeout in ms to wait for a response to a shutdown command. */
	hangTimeoutMs?: number,
}

/**
 * Factorio Server interface
 *
 * Handles the interactions with a Factorio server, including running,
 * stopping and sending commands to the server.  It does not deal with
 * creating or managing servers, or downloading Factorio.
 *
 * This is an EventEmitter with the following events:
 * - stdout - invoked when Factorio outputs a line to stdout
 * - stderr - invoked when Factorio outputs a line to stderr
 * - output - invoked with parsed output from Factorio
 * - rcon-ready - invoked when the RCON client has connected
 * - game-ready - invoked when the server is finished starting up
 * - autosave-start - invoked when the server starts an autosave
 * - autosave-fnished - invoked when the autosave finished
 * - save-finished - invoked when the server has finished a manual save
 * - exit - invoked when the sterver has exited
 * @extends events.EventEmitter
 */
export class FactorioServer extends events.EventEmitter {
	/** UDP port used for hosting the Factorio game server on */
	gamePort: number;
	/** TCP port used for RCON on the Factorio game server */
	rconPort: number;
	/** Password used for RCON on the Factorio game server */
	rconPassword: string;
	/** Enable player whitelist */
	enableWhitelist: boolean;
	/** Enable Factorio.com based multiplayer bans **/
	enableAuthserverBans: boolean;
	/** Enable verbose logging */
	verboseLogging: boolean;
	/** Timeout in ms to wait for a response to a shutdown command */
	hangTimeoutMs = 5000;

	_factorioDir: string;
	_writeDir: string;

	// Resolved in init
	_version: string | null = null;
	_dataDir: string | null = null;


	_logger: lib.Logger;
	_targetVersion: string;
	_state: "new" | "init" | "create" | "running" | "stopping" = "new";
	_server: child_process.ChildProcessWithoutNullStreams | null = null;
	_rconClient: Rcon | null= null;
	_rconReady = false;
	_gameReady = false;
	_stripRegExp?: RegExp;
	_maxConcurrentCommands = 5;

	// Array of possible causes for an unexpected shutdown
	_unexpected: string[] = [];
	_killed = false;
	_runningAutosave: string | null = null;


	/**
	 * Create a Factorio server interface
	 *
	 * @param factorioDir - Directory of the Factorio install(s).
	 * @param writeDir - Directory to write runtime data to.
	 * @param options - Optional parameters.
	 */
	constructor(factorioDir: string, writeDir: string, options: FactorioServerOptions) {
		super();

		this._factorioDir = factorioDir;
		this._writeDir = writeDir;

		this._logger = options.logger || lib.logger;
		this._targetVersion = options.version || "latest";
		/** UDP port used for hosting the Factorio game server on */
		this.gamePort = options.gamePort || randomDynamicPort();
		/** TCP port used for RCON on the Factorio game server */
		this.rconPort = options.rconPort || randomDynamicPort();
		/** Password used for RCON on the Factorio game server */
		this.rconPassword = options.rconPassword as string; // init will generate one if not there
		/** Enable player whitelist */
		this.enableWhitelist = options.enableWhitelist || false;
		/** Enable Factorio.com based multiplayer bans **/
		this.enableAuthserverBans = options.enableAuthserverBans || false;
		/** Enable verbose logging */
		this.verboseLogging = options.verboseLogging || false;
		/** Maximum number of RCON commands transmitted in parallel on the RCON connection  */
		this.maxConcurrentCommands = options.maxConcurrentCommands || 5;
		/** Timeout in ms to wait for a response to a shutdown command */
		this.hangTimeoutMs = options.hangTimeoutMs ?? 5000;

		if (options.stripPaths) {
			let charSet = new Set(path.resolve(this.writePath("temp")));
			charSet.delete(":"); // Having a colon could lead to matching the line number
			let chars = [...charSet].join("");

			let tempPath = `${path.resolve(this.writePath("temp", "currently-playing"))}${path.sep}`;
			let writePath = `${path.resolve(this.writePath())}${path.sep}`;
			this._stripRegExp = new RegExp(
				// The script printer formats paths using / on both windows and linux.
				// But the save path is printed with \ on windows and / on linux.
				`(${lib.escapeRegExp(tempPath.replace(/\\/g, "/"))})|` +
				`(${lib.escapeRegExp(writePath)})|` +
				`(\\.\\.\\.[${lib.escapeRegExp(chars)}/]*?currently-playing/)`,
				"g"
			);
		}

		// Track autosaving
		this.on("_autosave", name => {
			this.emit("autosave-start", name);
			this._runningAutosave = name;
		});

		this.on("_saved", () => {
			if (this._runningAutosave) {
				this.emit("autosave-finished", this._runningAutosave);
				this._runningAutosave = null;
			} else {
				this.emit("save-finished");
			}
		});
	}

	_check(expectedStates: FactorioServer["_state"][]) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	// TODO at the moment this is just a helper function, it has the potential for schema checking
	handle<Event>(eventName: string, handler: (event: Event) => Promise<void>) {
		this.on(eventName, (event) => handler(event).catch(err => {
			this._logger.error(`Error handling ipc event:\n${err.stack}`);
		}));
	}

	async _handleIpc(line: Buffer) {
		let channelEnd = line.indexOf("?");
		if (channelEnd === -1) {
			throw new Error(`Malformed IPC line "${line.toString()}"`);
		}

		let channel = line
			.subarray(6, channelEnd)
			.toString("utf-8")
			.replace(/\\x([0-9a-f]{2})/g, (match, p1) => (
				String.fromCharCode(parseInt(p1, 16))
			))
		;

		let type = line.subarray(channelEnd + 1, channelEnd + 2).toString("utf-8");
		let content;
		if (type === "j") {
			try {
				content = JSON.parse(line.subarray(channelEnd + 2).toString("utf-8"));
			} catch (err) {
				throw new Error(`Malformed JSON to ${channel}: ${line.subarray(channelEnd + 2).toString("utf-8")}`);
			}

		} else if (type === "f") {
			let fileName = line.subarray(channelEnd + 2).toString("utf-8");
			let filePath = this.writePath("script-output", fileName);

			// Prevent malicious names
			if (/[\\/\0]/.test(fileName)) {
				throw new Error(`Invalid IPC file name '${fileName}'`);
			}

			if (fileName.endsWith(".json")) {
				content = JSON.parse(await fs.readFile(filePath, "utf-8"));
				await fs.unlink(filePath);

			} else {
				let format = fileName.slice(fileName.lastIndexOf(".") + 1);
				throw new Error(`Unknown IPC file format '${format}'`);
			}

		} else {
			throw new Error(`Unknown IPC type '${type}'`);
		}

		if (!this.emit(`ipc-${channel}`, content)) {
			this._logger.warn(`Warning: Unhandled ipc-${channel}`, { content });
		}
	}

	_handleOutput(rawLine: Buffer, source: "stdout" | "stderr") {
		if (rawLine.subarray(0, 6).equals(Buffer.from("\f$ipc:"))) {
			this._handleIpc(rawLine).catch(err => this.emit("error", err));
			return;
		}

		this.emit(source, rawLine);

		let line = rawLine.toString("utf-8");
		if (this._stripRegExp) {
			line = line.replace(this._stripRegExp, "");
		}


		let parsed = parseOutput(line, source);
		heuristicLoop: for (let heuristic of outputHeuristics) {
			for (let [name, expected] of Object.entries(heuristic.filter)) {
				if (!Object.hasOwnProperty.call(parsed, name)) {
					continue heuristicLoop;
				}

				if (expected instanceof RegExp) {
					if (!expected.test((parsed as any)[name])) {
						continue heuristicLoop;
					}
				} else if (expected instanceof Array) {
					if (!expected.includes((parsed as any)[name])) {
						continue heuristicLoop;
					}
				} else if (expected !== (parsed as any)[name]) {
					continue heuristicLoop;
				}
			}

			// If we get here the filter matched the output
			heuristic.action.call(this, parsed);
		}

		this.emit("output", parsed, line);
	}

	async _startRcon() {
		if (this._state === "stopping") {
			return;
		}

		if (this._rconClient !== null) {
			throw Error("RCON client is already started");
		}

		let config = {
			host: "127.0.0.1", // localhost may resolve to ::1 while Factorio listen to only IPv4 by default.
			port: this.rconPort,
			password: this.rconPassword,
			timeout: 200000, // 200s, should allow for commands up to 1250kB in length
			maxPending: this.maxConcurrentCommands,
		};

		this._rconClient = new Rcon(config);
		this._rconClient.on("error", () => { /* Ignore */ });
		this._rconClient.on("authenticated", () => { this._rconReady = true; this.emit("rcon-ready"); });
		this._rconClient.on("end", () => {
			this._rconClient = null;
		});
		// XXX: Workaround to suppress bogus event listener warning
		if (this._rconClient.emitter instanceof events.EventEmitter) {
			this._rconClient.emitter.setMaxListeners(this.maxConcurrentCommands + 5);
		}
		await this._rconClient.connect();
	}

	/** Maximum number of RCON commands transmitted in parallel on the RCON connection  */
	get maxConcurrentCommands() {
		return this._maxConcurrentCommands;
	}

	set maxConcurrentCommands(value: number) {
		this._maxConcurrentCommands = value;
		this.setMaxListeners(value + 5);
		if (this._rconClient) {
			// @ts-expect-error sendQueue is private
			if (this._rconClient.sendQueue) {
				// @ts-expect-error sendQueue is private
				this._rconClient.sendQueue.maxConcurrent = value;
			}
			// XXX: Workaround to suppress bogus event listener warning
			if (this._rconClient.emitter instanceof events.EventEmitter) {
				this._rconClient.emitter.setMaxListeners(value + 5);
			}
		}
	}

	/**
	 * Initialize class instance
	 *
	 * Must be called before instances of this class can be used.
	 * @throws {Error} if the requested version of Factorio was not found.
	 */
	async init() {
		this._check(["new"]);
		[this._dataDir, this._version] = await findVersion(this._factorioDir, this._targetVersion);
		this.rconPassword = this.rconPassword as string | undefined ?? await generatePassword(10);
		this._state = "init";
	}

	/**
	 * The version of Factorio in use.  This will be the actual version if
	 * "latest" (the default) was specified as `factorioVersion` to the
	 * constructor.
	 */
	get version() {
		return this._version!;
	}

	/**
	 * The pid of the server process, or null if not running
	 */
	get pid() {
		if (!this._server) {
			return null;
		}
		return this._server.pid;
	}

	_attachStdio() {
		let stdout = new lib.LineSplitter({ readableObjectMode: true });
		stdout.on("data", line => { this._handleOutput(line, "stdout"); });
		this._server!.stdout.pipe(stdout);
		let stderr = new lib.LineSplitter({ readableObjectMode: true });
		stderr.on("data", line => { this._handleOutput(line, "stderr"); });
		this._server!.stderr.pipe(stderr);
	}

	_resetState() {
		this._state = "init";
		this._server = null;
		this._rconClient = null;
		this._rconReady = false;
		this._gameReady = false;
		this._unexpected = [];
		this._runningAutosave = null;
	}

	_watchExit() {
		this._server!.on("exit", (code, signal) => {
			if (this._state !== "stopping") {
				if (signal === "SIGKILL") {
					if (this._killed) {
						this.emit("error", new lib.EnvironmentError("Factorio server was killed"));
					} else {
						this.emit("error", new lib.EnvironmentError(
							"Factorio server was unexpectedly killed, is the system low on memory?"
						));
					}

				} else if (this._unexpected.length === 0) {
					let msg;
					if (code !== null) {
						msg = `Factorio server unexpectedly shut down with code ${code}`;
					} else {
						msg = `Factorio server was unexpectedly shut by down by signal ${signal}`;
					}

					this.emit("error", new lib.EnvironmentError(msg));

				} else if (this._unexpected.length === 1) {
					this.emit("error", new lib.EnvironmentError(this._unexpected[0]));

				} else {
					this.emit("error", new lib.EnvironmentError(
						"Factorio server unexpectedly shut down. Possible causes:"+
						`\n- ${this._unexpected.join("\n- ")}`
					));
				}
			}

			if (this._rconClient) {
				this._rconClient.end().catch(() => {});
			}

			this._resetState();
			this.emit("exit");
		});
		this._server!.on("error", (err: any) => {
			if (err.code === "EACCES") {
				this.emit("error", new lib.EnvironmentError("Unable to run server: Permission denied"));
			} else {
				this.emit("error", new lib.EnvironmentError(`Unexpected error:\n${err.stack}`));
			}

			if (this._rconClient) {
				this._rconClient.end().catch(() => {});
			}

			this._resetState();
			this.emit("exit");
		});
	}

	async _notifyGameReady() {
		this._gameReady = true;
		this.emit("game-ready");
	}

	async _waitForReady() {
		if (!this._gameReady) {
			await events.once(this, "game-ready");
		}
	}

	/**
	 * Create a new save
	 *
	 * Spawns the Factorio server with the --create argument to create a new
	 * map save with the given name.
	 *
	 * @param name -
	 *     Name of the save to create.  Should end with ".zip".
	 * @param seed - Seed to pass via --map-gen-seed
	 * @param mapGenSettings -
	 *     Map get settings to pass via --map-gen-settings.
	 * @param mapSettings -
	 *     Map setting to pass via --map-settings.
	 */
	async create(name: string, seed?: number, mapGenSettings?: object, mapSettings?: object) {
		this._check(["init"]);
		this._state = "create";

		await this._writeConfigIni();
		await this._writeMapSettings(mapGenSettings, mapSettings);
		this._server = child_process.spawn(
			this.binaryPath(),
			[
				"--config", this.writePath("config.ini"),
				"--create", this.writePath("saves", name),
				...(seed !== undefined ? ["--map-gen-seed", String(seed)] : []),
				...(mapGenSettings !== undefined
					? ["--map-gen-settings", this.writePath("map-gen-settings.json")] : []
				),
				...(mapSettings !== undefined ? ["--map-settings", this.writePath("map-settings.json")] : []),
				...(this.verboseLogging ? ["--verbose"] : []),
			],
			{
				detached: true,
				stdio: "pipe",
			}
		);

		this._attachStdio();
		this._server.once("exit", () => this.emit("exit"));

		try {
			let [code, signal] = await events.once(this._server, "exit");
			void signal;
			if (code !== 0) {
				throw new Error(`Factorio exited with status ${code}`);
			}
		} catch (err: any) {
			if (err.code === "EACCES") {
				throw new lib.EnvironmentError("Unable to run server: Permission denied");
			}
			throw err;
		} finally {
			this._state = "init";
		}
	}

	/**
	 * Start server
	 *
	 * Spawn the Factorio server with the --start-server argument to
	 * start the given save
	 *
	 * @param {string} save - Name of the save to run.
	 */
	async start(save: string) {
		this._check(["init"]);
		this._state = "running";

		await this._writeConfigIni();
		this._server = child_process.spawn(
			this.binaryPath(),
			[
				"--config", this.writePath("config.ini"),
				"--start-server", this.writePath("saves", save),
				"--port", String(this.gamePort),
				"--rcon-port", String(this.rconPort),
				"--rcon-password", this.rconPassword,
				...(this.enableWhitelist ? ["--use-server-whitelist"] : []),
				...(this.enableAuthserverBans ? ["--use-authserver-bans"] : []),
				...(this.verboseLogging ? ["--verbose"] : []),
			],
			{
				detached: true,
				stdio: "pipe",
			}
		);

		this._attachStdio();
		this._watchExit();
		await this._waitForReady();
	}

	/**
	 * Start scenario
	 *
	 * Spawn the Factorio server with the --start-server-load-scenario
	 * argument to start the given scenario.
	 *
	 * @param scenario - Name of the scenario to run.
	 * @param seed - Seed to pass via --map-gen-seed
	 * @param mapGenSettings -
	 *     Map get settings to pass via --map-gen-settings.
	 * @param mapSettings -
	 *     Map setting to pass via --map-settings.
	 */
	async startScenario(scenario: string, seed?: number, mapGenSettings?: object, mapSettings?: object) {
		this._check(["init"]);
		this._state = "running";

		await this._writeConfigIni();
		await this._writeMapSettings(mapGenSettings, mapSettings);
		this._server = child_process.spawn(
			this.binaryPath(),
			[
				"--config", this.writePath("config.ini"),
				"--start-server-load-scenario", scenario,
				...(seed !== undefined ? ["--map-gen-seed", String(seed)] : []),
				...(mapGenSettings !== undefined
					? ["--map-gen-settings", this.writePath("map-gen-settings.json")] : []
				),
				...(mapSettings !== undefined ? ["--map-settings", this.writePath("map-settings.json")] : []),
				"--port", String(this.gamePort),
				"--rcon-port", String(this.rconPort),
				"--rcon-password", this.rconPassword,
				...(this.enableWhitelist ? ["--use-server-whitelist"] : []),
				...(this.enableAuthserverBans ? ["--use-authserver-bans"] : []),
				...(this.verboseLogging ? ["--verbose"] : []),
			],
			{
				detached: true,
				stdio: "pipe",
			}
		);

		this._attachStdio();
		this._watchExit();
		await this._waitForReady();
	}


	/**
	 * Send message over RCON
	 *
	 * If the rcon connection hasn't been established yet, this will
	 * wait until it is establied and then send the message.
	 *
	 * @param message - message to send to server over RCON.
	 * @param expectEmpty -
	 *     if true throw if the response is not empty.  Useful for detecting
	 *     errors that might have been sent in response.
	 * @returns response from server.
	 */
	async sendRcon(message: string, expectEmpty?: boolean) {
		this._check(["running", "stopping"]);
		if (!this._rconReady) {
			await events.once(this, "rcon-ready");
		}
		if (!this._rconClient) {
			throw new Error("RCON connection lost");
		}

		let response = await this._rconClient.send(message);
		if (expectEmpty && response !== "") {
			throw new Error(`Expected empty response but got "${response}"`);
		}
		return response;
	}

	/**
	 * Stop the server
	 *
	 * Send stop signal to the server process and wait for it to shut
	 * down.
	 */
	async stop() {
		this._check(["running"]);

		let hanged = true;
		let stopped = false;
		function setAlive() { hanged = false; }

		let timeoutId = setTimeout(() => {
			if (hanged) {
				this._logger.error("Factorio appears to have hanged, sending SIGKILL");
				if (this._rconClient) {
					this._rconClient.end().catch(() => {});
				}
				this._server!.kill("SIGKILL");
			}
		}, this.hangTimeoutMs);

		// It's possible the server decides to exit on its own, in which
		// case the stop operation has to be cancelled.
		this._server!.once("exit", () => {
			stopped = true;
			clearTimeout(timeoutId);
		});

		this._state = "stopping";
		// On Windows we need to save the map as there's no graceful shutdown.
		if (this._rconClient && process.platform === "win32") {
			// Not using events.once here as that will reject on error.
			let saved = new Promise(resolve => this.once("_saved", resolve));
			this.on("_saving", setAlive);

			try {
				await this.sendRcon("/server-save");
				await saved;

			} catch (err) {
				// Ignore
			}

			clearTimeout(timeoutId);
			this.off("_saving", setAlive);
		}

		if (this._rconClient) {

			// If RCON is not yet fully connected that operation needs to
			// complete before the RCON connection can be closed cleanly.
			if (!this._rconReady) {
				await events.once(this, "rcon-ready");
			}

			await this._rconClient.end();
		}

		// The Factorio server may have decided to get ahead of us and
		// stop by itself before we had the chance to signal it.
		if (stopped) {
			return;
		}

		// On linux this sends SIGTERM to the process.  On windows this
		// will terminate the process with no cleanup.  You can send your
		// complaint for the lack of graceful shutdown to the Factorio
		// developers.  Rcon does not recognize /quit, stdin is not
		// recognized, and there's no "send CTRL+C to process" on Windows.
		this._server!.kill();

		// There appears to be an race condition where sending SIGTERM
		// immediatly before the RCON interface comes online causes the
		// Factorio server to hang.  It's also possible the server doesn't
		// stop if it's stuck with an infinite lua code loop.  In either
		// case there's no recovering from it.
		if (process.platform !== "win32") {
			this.on("_quitting", setAlive);
			await events.once(this._server!, "exit");

			clearTimeout(timeoutId);
			this.off("_quitting", setAlive);

		// On windows the process is terminated immediately, but to keep
		// ordering wait until after the exit event here.
		} else {
			await events.once(this._server!, "exit");
		}
	}

	/**
	 * Kill the server
	 *
	 * Terminates the server without any cleanup or saving.
	 * @param unexpected -
	 *     If true raise an error event as a result of killing the Factorio
	 *     process.
	 */
	async kill(unexpected = false) {
		this._check(["running", "stopping"]);
		this._killed = true;
		if (!unexpected) {
			this._state = "stopping";
		}
		this._server!.kill("SIGKILL");
		await new Promise(resolve => this._server!.once("exit", resolve));
	}

	/**
	 * Disable achievements on the running server
	 *
	 * Ensures achievements are disabled on the save that's running.  This is
	 * necessary in order to run any commands at all.
	 *
	 * @returns
	 *     True if acheivements got disabled and false if they already where
	 *     disabled.
	 */
	async disableAchievements() {
		this._check(["running"]);

		let check = await this.sendRcon("/sc rcon.print('disabled')");
		if (check === "disabled\n") {
			return false;
		}

		// Factorio will print a warning to the console and ask for the command
		// to be runned again before disabling achievements and allowing commands.
		check = await this.sendRcon("/sc rcon.print('disabled')");
		if (check === "disabled\n") {
			return true;
		}

		throw new Error("An error occured trying to disable acheivements");
	}

	/**
	 * Return path in data directory
	 *
	 * Creates a path using path.join with the given parts that's relative to
	 * the data directory of the Factorio server.  Not valid before init has
	 * been called.
	 *
	 * @param parts - Extra parts to add to the data path.
	 * @returns Data directory path.
	 */
	dataPath(...parts: string[]) {
		return path.join(this._dataDir!, ...parts);
	}

	/**
	 * Get Factorio binary path
	 *
	 * Get the path to the factorio binary depending on the platform (MacOS support)
	 *
	 * @returns Path to factorio binary
	 */
	binaryPath() {
		if (process.platform === "darwin") {
			return this.dataPath("..", "MacOS", "factorio");
		}
		return this.dataPath("..", "bin", "x64", "factorio");
	}

	/**
	 * Return path in write directory
	 *
	 * Creates a path using path.join with the given parts that's relative to
	 * the write directory of the Factorio server.
	 *
	 * @param parts - Extra parts to add to the write path.
	 * @returns Write directory path.
	 */
	writePath(...parts: string[]) {
		return path.join(this._writeDir, ...parts);
	}

	/**
	 * Get example server settings
	 *
	 * Loads server-settings.example.json from the data dir.
	 *
	 * @returns the parsed server-settings.
	 */
	async exampleSettings() {
		return JSON.parse(await fs.readFile(this.dataPath("server-settings.example.json"), "utf-8"));
	}

	async _writeConfigIni() {
		let content = lib.stringify({
			path: {
				"read-data": this.dataPath(),
				"write-data": this.writePath(),
			},
		});
		await lib.safeOutputFile(this.writePath("config.ini"), content);
	}

	async _writeMapSettings(mapGenSettings?: object, mapSettings?: object) {
		if (mapGenSettings) {
			await lib.safeOutputFile(
				this.writePath("map-gen-settings.json"), JSON.stringify(mapGenSettings, null, "\t")
			);
		}
		if (mapSettings) {
			await lib.safeOutputFile(
				this.writePath("map-settings.json"), JSON.stringify(mapSettings, null, "\t")
			);
		}
	}
}


// For testing only
export const _getVersion = getVersion;
export const _versionOrder = versionOrder;
export const _findVersion = findVersion;
export const _randomDynamicPort = randomDynamicPort;
export const _generatePassword = generatePassword;
export const _parseOutput = parseOutput;
