import { Static, Type } from "@sinclair/typebox";

/**
 * Represents a permission that can be granted
 */
export default class Permission {
	constructor(
		public name: string,
		public title: string,
		public description: string,
		public grantByDefault?: boolean,
	) { }

	static jsonSchema = Type.Object({
		name: Type.String(),
		title: Type.String(),
		description: Type.String(),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.title, json.description);
	}
}
