import { Static, Type } from "@sinclair/typebox";
import { permissions as globalPermissions } from "../users";

/**
 * Represents a collection of granted permissions
 */
export default class Role {
	constructor(
		public id: number,
		public name: string,
		public description: string,
		public permissions: Set<string>,
	) { }

	static jsonSchema = Type.Object({
		id: Type.Number(),
		name: Type.String(),
		description: Type.String(),
		permissions: Type.Array(Type.String()),
	});

	static fromJSON(json: Static<typeof this.jsonSchema>) {
		return new this(
			json.id,
			json.name,
			json.description,
			new Set(json.permissions),
		);
	}

	toJSON() {
		return {
			id: this.id,
			name: this.name,
			description: this.description,
			permissions: [...this.permissions],
		};
	}

	grantDefaultPermissions() {
		for (let permission of globalPermissions.values()) {
			if (permission.grantByDefault) {
				this.permissions.add(permission.name);
			}
		}
	}
}
