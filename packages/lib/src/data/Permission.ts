import { type Static, Type } from "@sinclair/typebox";

/**
 * Represents a permission that can be granted
 */
export default class Permission {
	name: string;
	title: string;
	description: string;
	grantByDefault: boolean;

	constructor(
		name: string,
		title: string,
		description: string,
		grantByDefault: boolean = false,
	) {
		this.name = name;
		this.title = title;
		this.description = description;
		this.grantByDefault = grantByDefault;
	}

	static jsonSchema = Type.Object({
		name: Type.String(),
		title: Type.String(),
		description: Type.String(),
		grantByDefault: Type.Optional(Type.Boolean()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(json.name, json.title, json.description, Boolean(json.grantByDefault));
	}
}
