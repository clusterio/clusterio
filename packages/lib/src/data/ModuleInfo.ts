import { Type, Static } from "@sinclair/typebox";
import { compile } from "../schema";

/**
 * Information about a module stored in its module.json file
 */
export default class ModuleInfo {
	constructor(
		/** Name of the module */
		public name: string,
		/** Version of this module */
		public version: string,
		/** Paths into the module that should be loaded into the event handler */
		public load: string[] = [],
		/** Paths into the module that should be required by control.lua */
		public require: string[] = [],
		/** Dependencies of this module */
		public dependencies = new Map<string, string>(),
	) { }

	static jsonSchema = Type.Object({
		"name": Type.String(),
		"version": Type.String(),
		"dependencies": Type.Optional(Type.Record(Type.String(), Type.String())),
		"files": Type.Optional(Type.Array(Type.String())),
		"require": Type.Optional(Type.Array(Type.String())),
		"load": Type.Optional(Type.Array(Type.String())),
	});

	static validate = compile<Static<typeof this.jsonSchema>>(this.jsonSchema as any);

	toJSON() {
		return {
			name: this.name,
			version: this.version,
			dependencies: Object.fromEntries(this.dependencies),
			require: this.require,
			load: this.load,
		};
	}

	static fromJSON(json: Static<typeof ModuleInfo.jsonSchema>) {
		return new this(
			json.name,
			json.version,
			json.load,
			json.require,
			json.dependencies ? new Map(Object.entries(json.dependencies)) : undefined,
		);
	}
}
