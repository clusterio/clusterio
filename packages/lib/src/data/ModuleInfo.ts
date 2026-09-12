import { Type, type Static } from "@sinclair/typebox";
import { compile } from "../schema.js";

/**
 * Information about a module stored in its module.json file
 */
export default class ModuleInfo {
	/** Name of the module */
	name: string;
	/** Version of this module */
	version: string;
	/** Paths into the module that should be loaded into the event handler */
	load: string[];
	/** Paths into the module that should be required by control.lua */
	require: string[];
	/** Dependencies of this module */
	dependencies: Map<string, string>;

	constructor(
		/** {@inheritDoc name} */
		name: string,
		/** {@inheritDoc version} */
		version: string,
		/** {@inheritDoc load} */
		load: string[] = [],
		/** {@inheritDoc require} */
		require: string[] = [],
		/** {@inheritDoc dependencies} */
		dependencies = new Map<string, string>(),
	) {
		this.name = name;
		this.version = version;
		this.load = load;
		this.require = require;
		this.dependencies = dependencies;
	}

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
