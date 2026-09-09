import asTableModule from "as-table";

import * as lib from "@clusterio/lib";
import type { Control } from "../ctl";
import { print } from "./command_ops";

const asTable = asTableModule.configure({ delimiter: " | " });

export const noteCommands = new lib.CommandTree({
	name: "note", description: "Notes attached to hosts, instances, users and other resources",
});
noteCommands.add(new lib.Command({
	definition: [["list", "l"], "List notes in the cluster", (yargs) => {
		yargs.options({
			"type": { describe: "Only list notes for this resource type", nargs: 1, type: "string" },
		});
	}],
	handler: async function(args: { type?: string }, control: Control) {
		let notes = await control.send(new lib.NoteListRequest());
		if (args.type !== undefined) {
			notes = notes.filter(note => note.resourceType === args.type);
		}
		print(asTable(notes.map(note => ({
			type: note.resourceType,
			id: note.resourceId,
			updatedBy: note.updatedBy,
			content: note.content,
		}))));
	},
}));

noteCommands.add(new lib.Command({
	definition: ["get <type> <id>", "Show the note of a resource", (yargs) => {
		yargs.positional("type", {
			describe: "Resource type, one of host, instance, user, role, mod_pack, mod, save", type: "string",
		});
		yargs.positional("id", { describe: "Id of the resource", type: "string" });
	}],
	handler: async function(args: { type: string, id: string }, control: Control) {
		const notes = await control.send(new lib.NoteListRequest());
		const note = notes.find(n => n.resourceType === args.type && n.resourceId === args.id);
		if (!note) {
			throw new lib.CommandError(`No note for ${args.type} ${args.id}`);
		}
		print(note.content);
	},
}));

noteCommands.add(new lib.Command({
	definition: ["set <type> <id> <content>", "Set the note of a resource", (yargs) => {
		yargs.positional("type", {
			describe: "Resource type, one of host, instance, user, role, mod_pack, mod, save", type: "string",
		});
		yargs.positional("id", { describe: "Id of the resource", type: "string" });
		yargs.positional("content", { describe: "Text of the note", type: "string" });
	}],
	handler: async function(args: { type: string, id: string, content: string }, control: Control) {
		await control.send(new lib.NoteSetRequest(args.type, args.id, args.content));
	},
}));

noteCommands.add(new lib.Command({
	definition: ["delete <type> <id>", "Remove the note of a resource", (yargs) => {
		yargs.positional("type", {
			describe: "Resource type, one of host, instance, user, role, mod_pack, mod, save", type: "string",
		});
		yargs.positional("id", { describe: "Id of the resource", type: "string" });
	}],
	handler: async function(args: { type: string, id: string }, control: Control) {
		await control.send(new lib.NoteSetRequest(args.type, args.id, ""));
	},
}));
