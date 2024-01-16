// Configuration classes
import { Type, Static } from "@sinclair/typebox";
import TypedEventEmitter from "../TypedEventEmitter";

import isDeepStrictEqual from "../is_deep_strict_equal";
import { basicType } from "../helpers";
import * as libSchema from "../schema";
import { StringEnum } from "../data/composites";

const ConfigLocation = StringEnum(["controller", "host", "instance", "control"]);
export type ConfigLocation = Static<typeof ConfigLocation>;

/**
 * Invalid Access exception
 *
 * Exception class for when an access attempt is made to a field that
 * does not permitt this access is done.
 *
 * @extends Error
 */
export class InvalidAccess extends Error { };

/**
 * Invalid Value exception
 *
 * Exception class for when invalid values are attempted to be set on a
 * field.
 *
 * @extends Error
 */
export class InvalidValue extends Error { };

/**
 * Invalid Field exception
 *
 * Exception class for when a group or field that does not exist is
 * attempted to be accessed.
 *
 * @extends Error
 */
export class InvalidField extends Error { };


const OldConfigGroupSchema = Type.Object({
	"name": Type.String(),
	"fields": Type.Record(Type.String(), Type.Unknown()),
});
type OldConfigGroupSchema = Static<typeof OldConfigGroupSchema>;

const OldConfigSchema = Type.Object({
	"groups": Type.Array(OldConfigGroupSchema),
});
export type OldConfigSchema = Static<typeof OldConfigSchema>

export const ConfigSchema = Type.Record(Type.String(), Type.Union([
	Type.Null(),
	Type.Boolean(),
	Type.Number(),
	Type.String(),
	Type.Object({}),
]));
export type ConfigSchema = Static<typeof ConfigSchema>;

type FieldType = "boolean" | "string" | "number" | "object";
type FieldValue = null | boolean | string | number | object;
export interface FieldDefinition {
	/**
	 * string declaring the type of the config value, supports boolean,
	 * string, number and object.
	 */
	type: FieldType;
	/**
	 * Text used to identify the config field in user interfaces.
	 */
	title?: string;
	/**
	 * Text used to describe the config field in user interfaces.
	 */
	description?: string;
	/**
	 * Web UI component to use for rending this input. Can be extended by
	 * @{link "@clusterio/web_ui".BaseWebPlugin.inputComponents}
	 */
	inputComponent?: string;
	/**
	 * True if this field can be set to null.  Defaults to false.
	 */
	optional?: boolean;
	/**
	 * Value this config field should take in a newly initialized config.
	 * This can also be an function returning the value to use.
	 */
	initialValue?: unknown | (() => unknown);
	/**
	 * Array of all values that are acceptible.  Useful for making
	 * enumerated values.
	 */
	enum?: unknown[];
	/**
	 * True if a restart of the entity this config is attached to is
	 * required for changes to take effect.  Informative only, defaults to
	 * false.
	 */
	restartRequired?: boolean;
	/**
	 * Properties to invert the value of restartRequired for if present.
	 */
	restartRequiredProps?: string[];
	/**
	 * Array of strings declaring where this config entry can be read and
	 * modified from.
	 */
	access?: ConfigLocation[];
}

export type ConfigDefs<Fields> = {
	[Prop in keyof Fields]: FieldDefinition;
}

function defaultValue(def: FieldDefinition) {
	if (def.initialValue === undefined) {
		return null;
	}
	if (typeof def.initialValue === "function") {
		return def.initialValue();
	}
	return def.initialValue;
}

export type ConfigEvents = {
	fieldChanged: (name: string, curr: FieldValue, prev: FieldValue) => void;
}

/**
 * Collection of config entries
 *
 * Type checks and stores a collection of related config entries.  Attempt
 * to set invalid values for fields will result in an error thrown while
 * loading a config with invalid values will result in those being replaced
 * by the innitial value for those fields.
 *
 * This is an EventEmitter with the following events:
 * - fieldChanged -
 *     invoked after a field has been updated. Takes three parameters: name,
 *     curr, prev.
 *
 * @extends events.EventEmitter
 */
export class Config<
	Fields extends { [Field in keyof Fields]: FieldValue },
> extends TypedEventEmitter<
	keyof ConfigEvents,
	ConfigEvents
> {
	/**
	 * Mapping of config name to field meta data
	 * Note that mutating this object will lead to unexpected behaviour.
	 */
	declare static fieldDefinitions: ConfigDefs<any>;
	declare ["constructor"]: typeof Config;


	fields: Fields;
	_unknownFields: Record<string, FieldValue> = {};

	/** Set to true when a field in the config is changed. */
	dirty = false;

	/**
	 * Create a new instance of the given config
	 *
	 * @param location -
	 *     Location to evaluate access for this instance from
	 * @param fields -
	 *     Serialized representation of fields to load.
	 */
	constructor(
		public location: ConfigLocation,
		fields?: Static<typeof Config.jsonSchema>,
		public defaultAccess: ConfigLocation[] = ["controller", "host", "control"],
	) {
		if (typeof location !== "string") {
			throw new Error("location must be a string");
		}
		super();

		this.fields = Object.fromEntries(
			Object.entries(
				this.constructor.fieldDefinitions
			).filter(
				([name, def]) => this._checkAccess(name, def, location, false)
			).map(
				([name, def]) => [name, defaultValue(def)]
			)
		) as Fields;

		if (fields) {
			this.update(fields, false, location);
		}
	}

	/**
	 * Check access for a field
	 *
	 * @param name - Name of the field to check.
	 * @param def - definition for for the field to check.
	 * @param remote - location of remote access to check for.
	 * @param error - throw on failure to pass check.
	 * @throws {InvalidAccess}
	 *     if access is not granted and error is true.
	 * @returns true if access is granted
	 * @private
	 */
	_checkAccess(name: string, def: FieldDefinition, remote: ConfigLocation, error: boolean) {
		for (let loc of [remote, this.location]) {
			if (!(def.access ?? this.defaultAccess).includes(loc)) {
				if (error) {
					throw new InvalidAccess(`Field '${name}' is not accessible from ${loc}`);
				} else {
					return false;
				}
			}
		}
		return true;
	}

	static jsonSchema = ConfigSchema;

	static validate = libSchema.compile(this.jsonSchema as any);

	/**
	 * Create config from a serialized object
	 *
	 * @param json - Serialized config to load.
	 * @param location - Location used for access control.
	 * @returns Instance of this config
	 */
	static fromJSON(
		json: Static<typeof this.jsonSchema>,
		location: ConfigLocation,
	) {
		// migrate: Pre alpha 14 config format
		if (typeof json === "object" && json !== null && json.groups instanceof Array) {
			json = Object.fromEntries(
				(json.groups as unknown as OldConfigGroupSchema[]).flatMap(
					group => Object.entries(group.fields).map(
						([name, value]) => [`${group.name}.${name}`, value as FieldValue]
					),
				),
			);
		}
		const valid = Config.validate(json);
		if (!valid) {
			throw new Error("Invalid config");
		}
		return new this(location, json);
	}

	toJSON() {
		return this.toRemote(this.location);
	}

	/**
	 * Serialize the config to a plain JavaScript object
	 *
	 * @param location - Location used for access control.
	 * @returns JSON serializable representation of the group.
	 */
	toRemote(location: ConfigLocation): Static<typeof Config.jsonSchema> {
		let fields: Record<string, FieldValue> = {};
		for (let [name, value] of Object.entries(this.fields)) {
			let def = this.constructor.fieldDefinitions[name];
			if (!this._checkAccess(name, def, location, false)) {
				continue;
			}

			fields[name] = value as FieldValue;
		}

		for (let [name, value] of Object.entries(this._unknownFields)) {
			fields[name] = value;
		}

		return fields;
	}

	/**
	 * Update a config from a serialized config
	 *
	 * Overwrites the values of all the fields in this config that has a
	 * valid value in the passed serialized config with that value.
	 *
	 * @param json -
	 *     Result from a previous call to .toRemote().
	 * @param notify - Invoke fieldChanged events if true.
	 * @param location - Location used for access control.
	 */
	update(
		json: Static<typeof Config.jsonSchema>,
		notify: boolean,
		location = this.location
	) {
		const valid = Config.validate(json);
		if (!valid) {
			throw new Error("Invalid config");
		}

		if (basicType(json) !== "object") {
			throw new Error(`Expected object, not ${basicType(json)} for Config`);
		}

		for (let [name, value] of Object.entries(json) as [keyof Fields & string, FieldValue][]) {
			let def = this.constructor.fieldDefinitions[name];
			if (!def) {
				this._unknownFields[name as string] = value;
				continue;
			}

			if (!this._checkAccess(name, def, location, false)) {
				continue;
			}

			if (def.optional) {
				if (value !== null && basicType(value) !== def.type) {
					continue;
				}

			} else if (basicType(value) !== def.type) {
				continue;
			}

			if (def.enum && !def.enum.includes(value)) {
				continue;
			}

			let prev = this.fields[name];
			this.fields[name] = value as any;
			if (notify && !isDeepStrictEqual(value, prev)) {
				this.dirty = true;
				this.emit("fieldChanged", name, value, prev);
			}
		}
	}

	/**
	 * Check if field can be accessed from the given location
	 *
	 * @param name - Name of field to check.
	 * @param location - Location used for access control.
	 * @returns true if field is accessible
	 */
	canAccess(name: string, location = this.location) {
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		return this._checkAccess(name, def, location, false);
	}

	/**
	 * Get value for field
	 *
	 * @param name - Name of field to get.
	 * @param location - Location used for access control.
	 * @returns Value stored for the field.
	 */
	get<Field extends keyof Fields & string>(name: Field, location = this.location) {
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		this._checkAccess(name, def, location, true);

		return this.fields[name];
	}

	/**
	 * Set value of field
	 *
	 * The field must be defined for the config group and the value is
	 * type checked against the field definition.
	 *
	 * @param name - Name of field to set.
	 * @param newValue - Value to set for field.
	 * @param location - Location used for access control.
	 * @throws {InvalidField} if field is not defined.
	 * @throws {InvalidValue} if value is not allowed for the field.
	 */
	set<Field extends keyof Fields & string>(name: Field, newValue: Fields[Field], location = this.location) {
		let value: FieldValue = newValue;
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		this._checkAccess(name, def, location, true);

		// Empty strings are treates as null
		if (value === "") {
			value = null;
		}

		if (def.enum && !def.enum.includes(value)) {
			throw new InvalidValue(`Expected one of [${def.enum.join(", ")}], not ${value}`);
		}

		if (typeof value === "string") {
			if (def.type === "boolean") {
				if (value === "true") {
					value = true;
				} else if (value === "false") {
					value = false;
				}

			} else if (def.type === "number") {
				let numberRegExp = /^[+-]?(Infinity|\d+\.(\d+)?([eE][+-]?\d+)?|\.?\d+([eE][+-]?\d+)?)$/;
				if (numberRegExp.test(value.trim())) {
					value = Number.parseFloat(value);
				}

			} else if (def.type === "object") {
				try {
					value = JSON.parse(value);
				} catch (err: any) {
					throw new InvalidValue(`Error parsing value for ${name}: ${err.message}`);
				}
			}
		}

		if (value === null) {
			if (!def.optional) {
				throw new InvalidValue(`Field ${name} cannot be null`);
			}

		} else if (basicType(value) !== def.type) {
			throw new InvalidValue(`Expected type of ${name} to be ${def.type}, not ${basicType(value)}`);
		}

		let prev = this.fields[name];
		this.fields[name] = value as Fields[Field];
		if (!isDeepStrictEqual(value, prev)) {
			this.dirty = true;
			this.emit("fieldChanged", name, value, prev);
		}
	}

	/**
	 * Set property of object field
	 *
	 * Update value of stored object field by setting the specified property
	 * on it.  The field must be defined as an object for the config group.
	 *
	 * @param name - Name of field to set property on.
	 * @param prop - Name of property to set on field.
	 * @param value - the value to set the property to.
	 * @param location - Location used for access control.
	 * @throws {InvalidField} if field is not defined.
	 * @throws {InvalidValue} if field is not an object.
	 */
	setProp<Field extends keyof Fields & string>(
		name: Field,
		prop: string,
		value: unknown,
		location = this.location,
	) {
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		this._checkAccess(name, def, location, true);

		if (def.type !== "object") {
			throw new InvalidValue(`Cannot set property on non-object field '${name}'`);
		}

		let prev = this.fields[name] as Record<string, unknown>;
		let updated = {...prev || {}};

		if (value !== undefined) {
			updated[prop] = value;
		} else {
			delete updated[prop];
		}
		this.fields[name] = updated as Fields[Field];
		if (!isDeepStrictEqual(updated, prev)) {
			this.dirty = true;
			this.emit("fieldChanged", name, updated, prev);
		}
	}
}
