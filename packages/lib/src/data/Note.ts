import { Type, Static } from "@sinclair/typebox";

/**
 * Free text note attached to a resource in the cluster.
 *
 * Notes are keyed by the type of resource and the id of the resource within
 * that type. Core resource types are "host", "instance", "user", "role",
 * "mod_pack", "mod" and "save", plugins may define their own.
 */
export default class Note {
	constructor(
		/** Type of resource this note is attached to. */
		public resourceType: string,
		/** Id of the resource within its type, as a string. */
		public resourceId: string,
		/** Text of the note. */
		public content: string,
		/** Name of the user that last changed the note. */
		public updatedBy = "",
		/** Millisecond Unix timestamp this entry was last updated at. */
		public updatedAtMs = 0,
		/** True if this note has been removed. */
		public isDeleted = false,
	) { }

	/** Unique key for this note, resource type and id joined with a slash. */
	get id() {
		return Note.idFor(this.resourceType, this.resourceId);
	}

	static idFor(resourceType: string, resourceId: string | number) {
		return `${resourceType}/${resourceId}`;
	}

	static jsonSchema = Type.Object({
		"resourceType": Type.String(),
		"resourceId": Type.String(),
		"content": Type.String(),
		"updatedBy": Type.Optional(Type.String()),
		"updatedAtMs": Type.Optional(Type.Number()),
		"isDeleted": Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.resourceType,
			json.resourceId,
			json.content,
			json.updatedBy,
			json.updatedAtMs,
			json.isDeleted,
		);
	}

	toJSON() {
		const json = {
			resourceType: this.resourceType,
			resourceId: this.resourceId,
			content: this.content,
		} as Static<typeof Note.jsonSchema>;

		if (this.updatedBy !== "") {
			json.updatedBy = this.updatedBy;
		}
		if (this.updatedAtMs !== 0) {
			json.updatedAtMs = this.updatedAtMs;
		}
		if (this.isDeleted !== false) {
			json.isDeleted = this.isDeleted;
		}

		return json;
	}
}
