"use strict";
const child_process = require("child_process");
const events = require("events");
const fs = require("fs-extra");
const path = require("path");
const phin = require("phin");
const stream = require("stream");
const getAvailableVersions = require("./getAvailableVersions");

const { logger } = require("../../logging");

class LineSplitter extends stream.Transform {
	constructor(options) {
		super(options);
		this._partial = null;
	}

	_transform(chunk, encoding, callback) {
		if (this._partial) {
			chunk = Buffer.concat([this._partial, chunk]);
			this._partial = null;
		}

		while (chunk.length) {
			let end = chunk.indexOf("\n");
			if (end === -1) {
				this._partial = chunk;
				break;
			}

			let next = end + 1;
			// Eat carriage return as well if present
			if (end >= 1 && chunk[end - 1] === "\r".charCodeAt(0)) {
				end -= 1;
			}

			let line = chunk.slice(0, end);
			chunk = chunk.slice(next);
			this.push(line);
		}
		callback();
	}

	_flush(callback) {
		if (this._partial) {
			this.push(this._partial);
			this._partial = null;
		}
		callback();
	}
}

async function execFile(cmd, args) {
	logger.verbose(`executing ${cmd} ${args.join(" ")}`);
	return new Promise((resolve, reject) => {
		let child = child_process.execFile(cmd, args, (err, stdout, stderr) => {
			if (err) {
				reject(err);
			} else {
				resolve({ stdout, stderr });
			}
		});
		let stdout = new LineSplitter({ readableObjectMode: true });
		stdout.on("data", line => { logger.verbose(line.toString()); });
		child.stdout.pipe(stdout);
		let stderr = new LineSplitter({ readableObjectMode: true });
		stderr.on("data", line => { logger.verbose(`err: ${line.toString()}`); });
		child.stderr.pipe(stderr);
	});
}

async function downloadLinuxServer({
	download_url = "https://factorio.com/get-download/stable/headless/linux64",
	version,
} = {}) {
	if (version) {
		// Check that version is available for download
		let versions = await getAvailableVersions();
		if (!versions.find(v => v.version === version)) {
			return false;
		}

		// Version specified instead of URL so we need to construct the URL
		download_url = `https://factorio.com/get-download/${version}/headless/linux64`;
	}
	let res = await phin(download_url);

	const url = new URL(res.headers.location);
	// get the filename of the latest factorio archive from redirected url
	const filename = path.posix.basename(url.pathname);
	const downloaded_version = filename.match(/(?<=factorio_headless_x64_).*(?=\.tar\.xz)/)[0];

	const tmpDir = "temp/create-temp/";
	const archivePath = tmpDir + filename;
	const tmpArchivePath = `${archivePath}.tmp`;
	const factorioDir = `factorio/${downloaded_version}/`;
	const tmpFactorioDir = tmpDir + downloaded_version;

	if (await fs.pathExists(factorioDir)) {
		logger.warn(`setting downloadDir to ${factorioDir}, but not downloading because already existing`);
	} else {
		await fs.ensureDir(tmpDir);
		await fs.ensureDir(factorioDir);

		// follow the redirect
		res = await phin({
			url: url.href,
			stream: true,
		});

		logger.info(`Downloading Factorio ${downloaded_version} server release. This may take a while.`);
		const writeStream = fs.createWriteStream(tmpArchivePath);
		res.pipe(writeStream);

		await events.once(res, "end");

		await fs.rename(tmpArchivePath, archivePath);
		try {
			await fs.ensureDir(tmpFactorioDir);
			await execFile("tar", [
				"xf", archivePath, "-C", tmpFactorioDir, "--strip-components", "1",
			]);
		} catch (e) {
			logger.error("error executing command- do you have 'xz-utils' installed?");
			throw e;
		}

		await fs.unlink(archivePath);
		await fs.rename(tmpFactorioDir, factorioDir);
	}
	return true;
}

module.exports = downloadLinuxServer;
