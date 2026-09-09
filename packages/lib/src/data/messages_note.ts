import { Type, Static } from "@sinclair/typebox";
import { jsonArray } from "./composites";
import Note from "./Note";

export class NoteListRequest {
	declare ["constructor"]: typeof NoteListRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.note.list" as const;
	static Response = jsonArray(Note);
}

export class NoteUpdatesEvent {
	declare ["constructor"]: typeof NoteUpdatesEvent;
	static type = "event" as const;
	static src = "controller" as const;
	static dst = "control" as const;
	static permission = "core.note.subscribe" as const;

	constructor(
		public updates: Note[],
	) { }

	static jsonSchema = Type.Object({
		"updates": Type.Array(Note.jsonSchema),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.updates.map(update => Note.fromJSON(update)));
	}
}

/**
 * Set the note of a resource. An empty content removes the note.
 */
export class NoteSetRequest {
	declare ["constructor"]: typeof NoteSetRequest;
	static type = "request" as const;
	static src = "control" as const;
	static dst = "controller" as const;
	static permission = "core.note.update" as const;

	constructor(
		public resourceType: string,
		public resourceId: string,
		public content: string,
	) { }

	static jsonSchema = Type.Object({
		"resourceType": Type.String(),
		"resourceId": Type.String(),
		"content": Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.resourceType, json.resourceId, json.content);
	}
}
