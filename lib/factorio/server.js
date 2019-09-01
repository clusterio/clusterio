/**
 * Factorio interfaces
 *
 * @module
 */

"use strict";
const fs = require("fs-extra");
const child_process = require("child_process");
const path = require("path");
const events = require("events");
const util = require("util");
const crypto = require("crypto");

const ini = require("ini");
const rconClient = require("rcon-client");
const errors = require("lib/errors");


/**
 * Determines the version of Factorio the datadir is pointing to by
 * reading the changelog.txt in it.
 */
async function getVersion(changelogPath) {
	let changelog = await fs.readFile(changelogPath, "utf-8");
	for (let line of changelog.split(/[\r\n]+/)) {
		let index = line.indexOf(":");
		if (index !== -1) {
			let name = line.slice(0, index).trim();
			if (name.toLowerCase() === "version") {
				return line.slice(index + 1).trim();
			}
		}
	}

	throw new Error("Unable to determine the version of Factorio");
}

/**
 * Give a random dynamic port
 *
 * Returns a random port number in the Dynamic Ports range as defined by
 * RFC 6335.
 *
 * @return {number} a number in the range 49152 to 65535.
 */
function randomDynamicPort() {
	const start = 49152;
	const end = 65535 + 1;

	return Math.floor(Math.random() * (end - start) + start)
}

/**
 * Generate a secure random password of the given length
 *
 * Uses crypto.randomBytes to generate a secure alphanumeric password of
 * the given length.
 *
 * @param {number} length - the length of the password to generate.
 * @return {string} password of the given length
 */
async function generatePassword(length) {
	function validChar(byte) {
		const ranges = ['az', 'AZ', '09'];
		return ranges.some(range =>
			range.codePointAt(0) <= byte && byte <= range.codePointAt(1)
		);
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
				if (password.length == length) {
					return password;
				}
			}
		}
	}
}

/**
 * Line splitter for chunked data
 *
 * Splits a stream of bytes into lines terminated by either line feed or
 * carriage return followed by linefeed.  Each line sepparated is passed
 * to the callback one at a time without the line terminator included.
 *
 * Data is streamed via the data method, and once the stream ends the
 * end method should be called.  This ensures an unterminated line at
 * the end of the stream is passed to the callback.
 */
class LineSplitter {

	/**
	 * Create a line splitter
	 *
	 * @param {function(Buffer)} callback - Function called for every line.
	 */
	constructor(callback) {
		this._callback = callback;
		this._partial = null
	}

	/**
	 * Stream in bytes
	 *
	 * Input bytes to split lines over.  Will invoke the callback for every
	 * line found in buf and keep any potential partial line at the end of
	 * buf for the next invocation.
	 *
	 * @param {Buffer} buf - Data to stream in.
	 */
	data(buf) {
		if (this._partial) {
			buf = Buffer.concat([this._partial, buf]);
			this._partial = null;
		}

		while (buf.length) {
			let end = buf.indexOf("\n");
			if (end === -1) {
				this._partial = buf;
				break;
			}

			let next = end + 1;
			// Eat carriage return as well if present
			if (end >= 1 && buf[end-1] === "\r".charCodeAt(0)) {
				end -= 1;
			}

			let line = buf.slice(0, end);
			buf = buf.slice(next);
			this._callback(line);
		}
	}

	/**
	 * Mark end of stream
	 *
	 * Signal the end of the bytestream.  If the previous invocation of the
	 * data method ended with a partial line this will invoke the callback
	 * with this line.
	 */
	end() {
		if (this._partial) {
			this._callback(this._partial);
			this._partial = null;
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
 * @param {string} line - A line of output not including the line terminator
 * @param {string} source - Passed into the output structure as source
 *
 * @returns {object} - An object with interpeted data.
 */
function parseOutput(line, source) {
	let output = {
		source,
		received: Date.now(),
	}

	// There are three broad categories of output from Factorio, the first kind
	// starts with the seconds since the server started and has a format of
	// "   0.704 message"
	const secRegex = /^ {0,3}(\d+\.\d+) (.*)$/
	let secMatch = secRegex.exec(line);
	if (secMatch) {
		output.format = "seconds";
		output.time = secMatch[1];
		let secContent = secMatch[2];

		// A seconds output has two different kinds of formats: The first is a
		// log level and source location and has a format of
		// "Level File.cpp:123: message"
		const secLogRegex = /^(\w+) (\w+\.cpp:\d+): (.*)$/
		let secLogMatch = secLogRegex.exec(secContent);
		if (secLogMatch) {
			output.type = "log";
			output.level = secLogMatch[1];
			output.file = secLogMatch[2];
			output.message = secLogMatch[3];

		// The other possibility is that the content is a generic message
		} else {
			output.type = "generic";
			output.message = secContent;
		}

	// The second category of output starts with a date stamp of the format
	// "yyyy-mm-dd hh:mm:ss message"
	} else {
		const dateRegex = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (.*)$/
		let dateMatch = dateRegex.exec(line);
		if (dateMatch) {
			output.format = "date";
			output.time = dateMatch[1];
			let dateContent = dateMatch[2];

			// A date output has two general formats.  The first is an action
			// followed by a message and has a format of "[ACTION] message"
			const dateActionRegex = /^\[(\w+)\] (.*)$/
			let dateActionMatch = dateActionRegex.exec(dateContent);
			if (dateActionMatch) {
				output.type = "action";
				output.action = dateActionMatch[1];
				output.message = dateActionMatch[2];

			// The other format is a generic message
			} else {
				output.type = "generic";
				output.message = dateContent;
			}

		// The last category of output is simply a generic message with no
		// formating.
		} else {
			output.format = "none";
			output.type = "generic";
			output.message = line;
		}
	}

	return output;
}

// These are filters applied to the output from Factorio.  The filter
// syntax is a set of properties to test for in the parsed output.  If
// the property is a RegExp it's tested using the RegExp.  If it's an
// array it's tested using the includes method of the array.  Otherwise
// the property must compare strictly equal.
//
// If the filter matches the action is called with the FactorioServer
// instance bound as this.
const outputHeuristics = [
	// Message indicating the RCON interface has started
	{
		filter: { type: 'log', message: /^Starting RCON interface/ },
		action: function(output) {
			this._startRcon().catch((err) => { this.emit('error', err); });
		},
	},

	// Message indicating the server is done starting up
	{
		filter: { type: 'log', message: /^updateTick\(\d+\) changing state from\(CreatingGame\) to\(InGame\)$/ },
		action: function(output) {
			this._notifyGameReady().catch((err) => { this.emit('error', err); });
		}
	},

	// Message indicating the server has finished saving
	{
		filter: {
			type: 'log',
			message: [
				"Saving finished",

				// Outputted when saving failed from --server-start-load-scenario
				"Can't save to default location: Default location not known",
			],
		},
		action: function(output) {
			this.emit('_saved');
		}
	},

	// Message indicating the server is shutting down
	{
		filter: {
			type: 'generic',
			message: /^Quitting: /
		},
		action: function(output) {
			this.emit('_quitting');
		}
	},

	// Messages that might be tha cause of an unexpected shutdown.
	{
		filter: {
			type: 'log',
			level: 'Error',
			message: [
				"MultiplayerManager failed: \"Binding IPv4 socket failed: Permission denied\"",
				"MultiplayerManager failed: Host address is already in use.",
			],
		},
		action: function(output) {
			this._unexpected.push(`Factorio failed to bind to game port: ${output.message}`);
		},
	},
	{
		filter: {
			type: 'log',
			level: 'Error',
			message: [
				"Can't bind socket: Address already in use",
				"Can't bind socket: Permission denied",
			],
		},
		action: function(output) {
			this._unexpected.push(`Factorio failed to bind to RCON port: ${output.message}`);
		},
	},
];


/**
 * Factorio Server interface
 *
 * Handles the interactions with a Factorio server, including running,
 * stopping and sending commands to the server.  It does not deal with
 * creating or managing servers, or downloading Factorio.
 *
 * This is an events emitter with the following events:
 * stdout - invoked when Factorio outputs a line to stdout
 * stderr - invoked when Factorio outputs a line to stderr
 * output - invoked with parsed output from Factorio
 * rcon-ready - invoked when the RCON client has connected
 * game-ready - invoked when the server is finished starting up
 * stopped - invoked when the sterver has exited
 */
class FactorioServer extends events.EventEmitter {
	/**
	 * Create a Factorio server interface
	 *
	 * @param {string} dataDir - Data directory of the Factorio install.
	 * @param {string} writeDir - Directory to write runtime data to.
	 * @param {object} options - Optional parameters.
	 */
	constructor(dataDir, writeDir, options) {
		super();

		this._dataDir = dataDir;
		this._writeDir = writeDir;

		this.gamePort = options.gamePort || randomDynamicPort();
		this.rconPort = options.rconPort || randomDynamicPort();
		this.rconPassword = options.rconPassword;
		this._state = "new";
		this._server = null;
		this._rconClient = null;
		this._rconReady = false;
		this._gameReady = false;

		// Array of possible causes for an unexpected shutdown
		this._unexpected = [];

		this._stdout = new LineSplitter((line) => { this._handleOutput(line, 'stdout'); });
		this._stderr = new LineSplitter((line) => { this._handleOutput(line, 'stderr'); });
	}

	_check(expectedStates) {
		if (!expectedStates.includes(this._state)) {
			throw new Error(
				`Expected state ${expectedStates} but state is ${this._state}`
			);
		}
	}

	async _handleIpc(line) {
		let channelEnd = line.indexOf('?');
		if (channelEnd === -1) {
			throw new Error(`Malformed IPC line "${line.toString()}"`);
		}

		let channel = line
			.slice(6, channelEnd)
			.toString('utf-8')
			.replace(/\\x([0-9a-f]{2})/g, (match, p1) =>
				String.fromCharCode(parseInt(p1, 16))
			)
		;

		let type = line.slice(channelEnd + 1, channelEnd + 2).toString('utf-8');
		let content;
		if (type === 'j') {
			content = JSON.parse(line.slice(channelEnd + 2).toString('utf-8'));

		} else if (type === 'f') {
			let fileName = line.slice(channelEnd + 2).toString('utf-8');
			let filePath = this.writePath('script-output', fileName);

			// Prevent malicious names
			if (/[\\/\0]/.test(fileName)) {
				throw new Error(`Invalid IPC file name '${fileName}'`)
			}

			if (fileName.endsWith('.json')) {
				content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
				await fs.unlink(filePath);

			} else {
				let format = fileName.slice(fileName.lastIndexOf('.') + 1);
				throw new Error(`Unknown IPC file format '${format}'`)
			}

		} else {
			throw new Error(`Unknown IPC type '${type}'`);
		}

		this.emit(`ipc-${channel}`, content);
	}

	_handleOutput(line, source) {
		if (line.slice(0, 6).equals(Buffer.from("\f$ipc:"))) {
			this._handleIpc(line).catch(err => this.emit('error', err));
			return;
		}

		this.emit(source, line);

		let output = parseOutput(line.toString('utf-8'), source);
		heuristicLoop: for (let heuristic of outputHeuristics) {
			for (let [name, expected] of Object.entries(heuristic.filter)) {
				if (!Object.hasOwnProperty.call(output, name)) {
					continue heuristicLoop;
				}

				if (expected instanceof RegExp) {
					if (!expected.test(output[name])) {
						continue heuristicLoop;
					}
				} else if (expected instanceof Array) {
					if (!expected.includes(output[name])) {
						continue heuristicLoop;
					}
				} else {
					if (expected !== output[name]) {
						continue heuristicLoop;
					}
				}
			}

			// If we get here the filter matched the output
			heuristic.action.call(this, output);
		}

		this.emit('output', output);
	}

	async _startRcon() {
		if (this._state === "stopping") {
			return;
		}

		if (this._rconClient !== null) {
			throw Error("RCON client is already started");
		}

		let config = {
			host: "localhost",
			port: this.rconPort,
			password: this.rconPassword,
			timeout: 200000, // 200s, should allow for commands up to 1250kB in length
			maxPending: 5,
		};

		this._rconClient = new rconClient.Rcon(config);
		this._rconClient.on('error', (err) => this.emit('error', err));
		this._rconClient.on('authenticated', () => { this._rconReady = true; this.emit('rcon-ready'); });
		this._rconClient.on('end', () => {/* XXX TODO */});
		await this._rconClient.connect();
	}

	/**
	 * Initialize class instance
	 *
	 * Must be called before instances of this class can be used.
	 */
	async init() {
		this._check(["new"]);
		this._version = await getVersion(this.dataPath("changelog.txt"));
		this.rconPassword = this.rconPassword || await generatePassword(10);
		this._state = "init";
	}

	/**
	 * The version of Factorio that was detected
	 */
	get version() {
		return this._version;
	}

	_attachStdio() {
		this._server.stdout.on('data', chunk => { this._stdout.data(chunk); });
		this._server.stdout.on('close', () => { this._stdout.end(); });
		this._server.stderr.on('data', chunk => { this._stderr.data(chunk); });
		this._server.stderr.on('close', () => { this._stderr.end(); });
	}

	_watchExit() {
		this._server.on('exit', (code, signal) => {
			if (this._state !== "stopping") {
				if (this._unexpected.length === 0) {
					if (signal === 'SIGKILL') {
						this.emit('error', new errors.EnvironmentError(
							"Factorio server was unexpectedly killed, is the system low on memory?"
						));

					} else {
						let msg;
						if (code !== null) {
							msg = `Factorio server unexpectedly shut down with code ${code}`
						} else {
							msg = `Factorio server was unexpectedly shut by down by signal ${signal}`;
						}

						this.emit('error', new Error(msg));
					}

				} else if (this._unexpected.length === 1) {
					this.emit('error', new Error(this._unexpected[0]));

				} else {
					this.emit('error', new Error(
						"Factorio server unexpectedly shut down. Possible causes:\n- "+
						this._unexpected.join("\n- ")
					));
				}
			}

			// Reset server state
			this._state = "init";
			this._server = null;
			this._rconClient = null;
			this._rconReady = false;
			this._gameReady = false;
			this._unexpected = [];

			this.emit('stopped');
		});
	}

	async _notifyGameReady() {
		this._gameReady = true;
		this.emit('game-ready');
	}

	async _waitForReady() {
		if (!this._gameReady) {
			await events.once(this, 'game-ready');
		}
	}

	/**
	 * Create a new save
	 *
	 * Spawns the Factorio server with the --create argument to create a new
	 * map save with the given name.
	 *
	 * @param {string} name -
	 *     Name of the save to create.  Should end with ".zip".
	 */
	async create(name) {
		this._check(["init"]);
		this._state = "create";

		await this._writeConfigIni();
		this._server = child_process.spawn(
			this.dataPath('..', 'bin', 'x64', 'factorio'),
			[
				'--config', this.writePath('config.ini'),
				'--create', this.writePath('saves', name),
			],
			{
				detached: true,
				stdio: 'pipe',
			}
		);

		this._attachStdio();

		try {
			let [code, signal] = await events.once(this._server, 'exit');
			if (code !== 0) {
				throw new Error(`Factorio exited with status ${code}`);
			}
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
	async start(save) {
		this._check(["init"]);
		this._state = "running";

		await this._writeConfigIni();
		this._server = child_process.spawn(
			this.dataPath('..', 'bin', 'x64', 'factorio'),
			[
				'--config', this.writePath('config.ini'),
				'--start-server', this.writePath('saves', save),
				'--port', this.gamePort,
				'--rcon-port', this.rconPort,
				'--rcon-password', this.rconPassword,
			],
			{
				detached: true,
				stdio: 'pipe',
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
	 * @param {string} scenario - Name of the scenario to run.
	 */
	async startScenario(scenario) {
		this._check(["init"]);
		this._state = "running";

		await this._writeConfigIni();
		this._server = child_process.spawn(
			this.dataPath('..', 'bin', 'x64', 'factorio'),
			[
				'--config', this.writePath('config.ini'),
				'--start-server-load-scenario', scenario,
				'--port', this.gamePort,
				'--rcon-port', this.rconPort,
				'--rcon-password', this.rconPassword,
			],
			{
				detached: true,
				stdio: 'pipe',
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
	 * @param {string} message - message to send to server over RCON.
	 * @param {boolean} expectEmpty -
	 *     if true throw if the response is not empty.  Useful for detecting
	 *     errors that might have been sent in response.
	 * @returns {string} response from server.
	 */
	async sendRcon(message, expectEmpty) {
		this._check(["running"])
		if (!this._rconReady) {
			await events.once(this, 'rcon-ready');
		}

		let response = await this._rconClient.send(message);
		if (expectEmpty && response !== '') {
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

		// On Windows we need to save the map as there's no graceful shutdown.
		if (this._rconClient && process.platform === "win32") {
			let saved = events.once(this, '_saved');
			await this.sendRcon("/server-save");
			await saved;
		}

		this._state = "stopping";
		if (this._rconClient) {

			// If RCON is not yet fully connected that operation needs to
			// complete before the RCON connection can be closed cleanly.
			if (!this._rconReady) {
				await events.once(this, 'rcon-ready');
			}

			await this._rconClient.end();
		}

		// On linux this sends SIGTERM to the process.  On windows this
		// will terminate the process with no cleanup.  You can send your
		// complaint for the lack of graceful shutdown to the Factorio
		// developers.  Rcon does not recognize /quit, stdin is not
		// recognized, and there's no "send CTRL+C to process" on Windows.
		this._server.kill();

		// There appears to be an race condition where sending SIGTERM
		// immediatly before the RCON interface comes online causes the
		// Factorio server to hang.  It's also possible the server doesn't
		// stop if it's stuck with an infinite lua code loop.  In either
		// case there's no recovering from it.
		if (process.platform !== "win32") {
			let hanged = true;
			function setAlive(output) { hanged = false; }
			this.on('_quitting', setAlive);

			let timeoutId = setTimeout(() => {
				if (hanged) {
					console.error("Factorio appears to have hanged, sending SIGKILL");
					this._server.kill('SIGKILL');
				}
			}, 5000);

			await events.once(this._server, 'exit');

			clearTimeout(timeoutId);
			this.off('_quitting', setAlive);

		// On windows the process is terminated immediately, but to keep
		// ordering wait until after the exit event here.
		} else {
			await events.once(this._server, 'exit');
		}
	}

	/**
	 * Disable achievements on the running server
	 *
	 * Ensures achievements are disabled on the save that's running.  This is
	 * necessary in order to run any commands at all.
	 *
	 * @returns {boolean}
	 *     True if acheivements got disabled and false if they already where
	 *     disabled.
	 */
	async disableAchievements() {
		this._check(["running"]);

		let check = await this.sendRcon("/sc rcon.print('disabled')");
		if (check === 'disabled\n') {
			return false;
		}

		// Factorio will print a warning to the console and ask for the command
		// to be runned again before disabling achievements and allowing commands.
		check = await this.sendRcon("/sc rcon.print('disabled')");
		if (check === 'disabled\n') {
			return true;
		}

		throw new Error("An error occured trying to disable acheivements");
	}

	/**
	 * Return path in data directory
	 *
	 * Creates a path using path.join with the given parts that's relative to
	 * the data directory of the Factorio server.
	 */
	dataPath(...parts) {
		return path.join(this._dataDir, ...parts);
	}

	/**
	 * Return path in write directory
	 *
	 * Creates a path using path.join with the given parts that's relative to
	 * the write directory of the Factorio server.
	 */
	writePath(...parts) {
		return path.join(this._writeDir, ...parts);
	}

	/**
	 * Get example server settings
	 *
	 * Loads server-settings.example.json from the data dir.
	 *
	 * @returns {object} the parsed server-settings.
	 */
	async exampleSettings(dataDir) {
		return JSON.parse(await fs.readFile(this.dataPath("server-settings.example.json"), "utf-8"));
	}

	async _writeConfigIni() {
		let content = ini.encode({
			path: {
				"read-data": this.dataPath(),
				"write-data": this.writePath(),
			}
		});
		await fs.outputFile(this.writePath("config.ini"), content);
	}
}


module.exports = {
	FactorioServer,

	// For testing only
	_getVersion: getVersion,
	_randomDynamicPort: randomDynamicPort,
	_generatePassword: generatePassword,
	_LineSplitter: LineSplitter,
	_parseOutput: parseOutput,
};
