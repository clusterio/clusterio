import fs from "fs-extra";
import asTableModule from "as-table";
import events from "events";
import path from "path";
import phin from "phin";
import stream from "stream";
import util from "util";

import * as lib from "@clusterio/lib";
import { logger } from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";

const asTable = asTableModule.configure({ delimiter: " | " });
const finished = util.promisify(stream.finished);

export const modCommands = new lib.CommandTree({ name: "mod", description: "Manage uploaded mods" });
modCommands.add(new lib.Command({
	definition: ["show <name> <mod-version>", "Show details for a mod stored in the cluster", (yargs) => {
		yargs.positional("name", { describe: "Mod name to show details for", type: "string" });
		yargs.positional("mod-version", { describe: "Version of the mod", type: "string" });
	}],
	handler: async function(args: { name: string, modVersion: string }, control: Control) {
		if (!lib.isFullVersion(args.modVersion)) {
			throw new lib.CommandError("mod-version must match format digit.digit.digit");
		}
		let modInfo = await control.send(new lib.ModGetRequest(args.name, args.modVersion));
		for (let [field, value] of Object.entries(modInfo)) {
			if (value instanceof Array) {
				print(`${field}:`);
				for (let entry of value) {
					print(`  ${entry}`);
				}
			} else {
				print(`${field}: ${value}`);
			}
		}
	},
}));

modCommands.add(new lib.Command({
	definition: [["list", "l"], "List mods stored in the cluster", (yargs) => {
		yargs.options({
			"fields": {
				describe: "Fields to show, supports 'all'.",
				array: true,
				type: "string",
				default: ["name", "version", "title", "factorio_version"],
			},
		});
	}],
	handler: async function(args: { fields: string[] }, control: Control) {
		let mods = await control.send(new lib.ModListRequest());
		if (!args.fields.includes("all")) {
			for (let entry of mods) {
				for (let field of Object.keys(entry)) {
					if (!args.fields.includes(field)) {
						// @ts-expect-error terrible hack
						delete entry[field];
					}
				}
			}
		}
		print(asTable(mods));
	},
}));

modCommands.add(new lib.Command({
	definition: ["search <factorio-version> [query]", "Search mods stored in the cluster", (yargs) => {
		yargs.positional("factorio-version", { describe: "Major version of Factorio to search for", type: "string" });
		yargs.positional("query", { describe: "Search query", type: "string", default: "" });
		yargs.options({
			"page": {
				describe: "Result page to show",
				type: "number",
				default: 1,
			},
			"page-size": {
				describe: "Results per page to show",
				type: "number",
				default: 10,
			},
			"sort": {
				describe: "sort results by given field",
				type: "string",
			},
			"sort-order": {
				describe: "order to sort results in (asc/desc)",
				type: "string",
				default: "asc",
			},
			"fields": {
				describe: "Fields to show, supports 'all'.",
				array: true,
				type: "string",
				default: ["name", "version", "title", "factorio_version"],
			},
		});
	}],
	handler: async function(
		args: {
			factorioVersion: string,
			query: string,
			page: number,
			pageSize: number,
			sort?: string,
			sortOrder: "asc" | "desc",
			fields: string[],
		},
		control: Control
	) {
		let response = await control.send(new lib.ModSearchRequest(
			args.query,
			lib.normaliseApiVersion(args.factorioVersion as any),
			args.page,
			args.pageSize,
			args.sort,
			args.sortOrder
		));
		let results = response.results.flatMap(result => result.versions);
		if (!args.fields.includes("all")) {
			for (let entry of results) {
				for (let field of Object.keys(entry)) {
					if (!args.fields.includes(field)) {
						// @ts-expect-error terrible hack
						delete entry[field];
					}
				}
			}
		}
		for (let issue of response.queryIssues) {
			print(issue);
		}
		print(`page ${args.page} of ${response.pageCount} (${response.resultCount} results)`);
		print(asTable(results));
	},
}));

modCommands.add(new lib.Command({
	definition: ["upload <file>", "Upload mod to the cluster", (yargs) => {
		yargs.positional("file", { describe: "File to upload", type: "string" });
	}],
	handler: async function(args: { file: string }, control: Control) {
		let filename = path.basename(args.file);
		if (!filename.endsWith(".zip")) {
			throw new lib.CommandError("Mod filename must end with .zip");
		}
		// phin doesn't support streaming requests :(
		let content = await fs.readFile(args.file);

		let url = new URL(control.config.get("control.controller_url")!);
		url.pathname += "api/upload-mod";
		url.searchParams.append("filename", filename);

		let result = await phin<
			{ errors?: [], request_errors?: [], mods: Parameters<typeof lib.ModInfo.fromJSON>[0][]}
		>({
			url, method: "POST",
			headers: {
				"X-Access-Token": control.config.get("control.controller_token"),
				"Content-Type": "application/zip",
			},
			core: { ca: control.tlsCa } as object,
			data: content,
			parse: "json",
		});

		for (let error of result.body.errors || []) {
			logger.error(error);
		}

		for (let requestError of result.body.request_errors || []) {
			logger.error(requestError);
		}

		if (result.body.mods && result.body.mods.length) {
			const mod = lib.ModInfo.fromJSON(result.body.mods[0]);
			logger.info(`Successfully uploaded ${mod.filename}`);
		}

		if ((result.body.errors || []).length || (result.body.request_errors || []).length) {
			throw new lib.CommandError("Uploading mod failed");
		}
	},
}));

modCommands.add(new lib.Command({
	definition: ["download <name> <mod-version>", "Download a mod from the cluster", (yargs) => {
		yargs.positional("name", { describe: "Internal name of mod to download", type: "string" });
		yargs.positional("mod-version", { describe: "Version of mod to download", type: "string" });
	}],
	handler: async function(args: { name: string, modVersion: string }, control: Control) {
		if (!lib.isFullVersion(args.modVersion)) {
			throw new lib.CommandError("mod-version must match format digit.digit.digit");
		}
		let streamId = await control.send(new lib.ModDownloadRequest(args.name, args.modVersion));

		let url = new URL(control.config.get("control.controller_url")!);
		url.pathname += `api/stream/${streamId}`;
		let response = await phin({
			url, method: "GET",
			core: { ca: control.tlsCa } as object,
			stream: true,
		});

		let writeStream;
		let filename = `${args.name}_${args.modVersion}.zip`;
		let tempFilename = filename.replace(/(\.zip)?$/, ".tmp.zip");
		while (true) {
			try {
				writeStream = fs.createWriteStream(tempFilename, { flags: "wx" });
				await events.once(writeStream, "open");
				break;
			} catch (err: any) {
				if (err.code === "EEXIST") {
					tempFilename = await lib.findUnusedName(".", tempFilename, ".tmp.zip");
				} else {
					throw err;
				}
			}
		}
		response.pipe(writeStream);
		await finished(writeStream);
		await fs.rename(tempFilename, filename);

		logger.info(`Downloaded ${filename}`);
	},
}));

modCommands.add(new lib.Command({
	definition: ["delete <name> <mod-version>", "Delete a mod stored in the cluster", (yargs) => {
		yargs.positional("name", { describe: "Name of mod to delete", type: "string" });
		yargs.positional("mod-version", { describe: "Version of mod to delete", type: "string" });
	}],
	handler: async function(args: { name: string, modVersion: string }, control: Control) {
		if (!lib.isFullVersion(args.modVersion)) {
			throw new lib.CommandError("mod-version must match format digit.digit.digit");
		}
		await control.send(new lib.ModDeleteRequest(args.name, args.modVersion));
	},
}));
