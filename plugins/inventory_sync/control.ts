import fs from "node:fs/promises";
import * as lib from "@clusterio/lib";
import { BaseCtlPlugin, type Control } from "@clusterio/ctl";
import * as msg from "./messages";
import { summarizePlayerInventories } from "./player_data";

function print(...content: any) {
	// eslint-disable-next-line no-console
	console.log(...content);
}

async function instanceName(control: Control, instanceId: number | undefined) {
	if (instanceId === undefined) {
		return "-";
	}
	let instance = await control.send(new lib.InstanceDetailsGetRequest(instanceId));
	return `${instance.name} (${instanceId})`;
}

const inventorySyncCommands = new lib.CommandTree({
	name: "inventory-sync", description: "Inventory sync plugin commands",
});
inventorySyncCommands.add(new lib.Command({
	definition: [["list", "l"], "List player data stored on the controller"],
	handler: async function(args: object, control: Control) {
		let players = await control.send(new msg.ListPlayersRequest());
		players.sort((a, b) => a.name.localeCompare(b.name));
		print("name | generation | size | acquired by");
		for (let player of players) {
			print(
				`${player.name} | ${player.generation ?? "-"} | ` +
				`${player.size === undefined ? "-" : lib.formatBytes(player.size)} | ` +
				`${await instanceName(control, player.instanceId)}`
			);
		}
	},
}));

inventorySyncCommands.add(new lib.Command({
	definition: ["show <player>", "Show a summary of the stored player data", (yargs) => {
		yargs.positional("player", { describe: "Name of the player", type: "string" });
	}],
	handler: async function(args: { player: string }, control: Control) {
		let response = await control.send(new msg.GetPlayerDataRequest(args.player));
		print(`acquired by: ${await instanceName(control, response.instanceId)}`);
		let playerData = response.playerData;
		if (!playerData) {
			print(`No player data stored for ${args.player}`);
			return;
		}
		print(`generation: ${playerData.generation}`);
		print(`size: ${lib.formatBytes(JSON.stringify(playerData).length)}`);
		print(`controller: ${playerData.controller}`);
		print(`force: ${playerData.force}`);
		for (let inventory of summarizePlayerInventories(playerData)) {
			print(`${inventory.name}:`);
			for (let item of inventory.items) {
				let quality = item.quality ? ` (${item.quality})` : "";
				let size = item.exportSize ? ` ${lib.formatBytes(item.exportSize)}` : "";
				print(`  ${item.count} ${item.name}${quality}${size}`);
			}
		}
	},
}));

inventorySyncCommands.add(new lib.Command({
	definition: ["export <player> [file]", "Export stored player data as JSON", (yargs) => {
		yargs.positional("player", { describe: "Name of the player", type: "string" });
		yargs.positional("file", { describe: "File to write to, prints to stdout if omitted", type: "string" });
	}],
	handler: async function(args: { player: string, file?: string }, control: Control) {
		let response = await control.send(new msg.GetPlayerDataRequest(args.player));
		if (!response.playerData) {
			throw new lib.CommandError(`No player data stored for ${args.player}`);
		}
		let content = JSON.stringify(response.playerData, null, "\t");
		if (args.file) {
			await fs.writeFile(args.file, content);
			print(`Wrote player data for ${args.player} to ${args.file}`);
		} else {
			print(content);
		}
	},
}));

inventorySyncCommands.add(new lib.Command({
	definition: ["import <player> <file>", "Replace stored player data with JSON from a file", (yargs) => {
		yargs.positional("player", { describe: "Name of the player", type: "string" });
		yargs.positional("file", { describe: "File to read player data from", type: "string" });
	}],
	handler: async function(args: { player: string, file: string }, control: Control) {
		let playerData = JSON.parse(await fs.readFile(args.file, "utf8"));
		if (typeof playerData !== "object" || playerData === null || Array.isArray(playerData)) {
			throw new lib.CommandError("Player data must be a JSON object");
		}
		playerData.name = args.player;
		playerData.generation ??= 0;
		let response = await control.send(new msg.SetPlayerDataRequest(args.player, playerData));
		print(`Stored player data for ${args.player} as generation ${response.generation}`);
	},
}));

inventorySyncCommands.add(new lib.Command({
	definition: ["delete <player>", "Delete stored player data", (yargs) => {
		yargs.positional("player", { describe: "Name of the player", type: "string" });
	}],
	handler: async function(args: { player: string }, control: Control) {
		await control.send(new msg.DeletePlayerDataRequest(args.player));
	},
}));

inventorySyncCommands.add(new lib.Command({
	definition: ["release <player>", "Release the lock an instance holds on a player", (yargs) => {
		yargs.positional("player", { describe: "Name of the player", type: "string" });
	}],
	handler: async function(args: { player: string }, control: Control) {
		await control.send(new msg.ForceReleaseRequest(args.player));
	},
}));

export class CtlPlugin extends BaseCtlPlugin {
	async addCommands(rootCommand: lib.CommandTree) {
		rootCommand.add(inventorySyncCommands);
	}
}
