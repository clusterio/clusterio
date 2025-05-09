// Configuration classes
import { Type, Static } from "@sinclair/typebox";
import TypedEventEmitter from "../TypedEventEmitter";

import isDeepStrictEqual from "../is_deep_strict_equal";
import { basicType } from "../helpers";
import * as libSchema from "../schema";
import { StringEnum } from "../data/composites";

const ConfigLocation = StringEnum(["controller", "host", "control"]);
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
	 * Value to use for the autocomplete attribute in the Web UI's input element.
	 * Useful for making browsers behave properly with credential inputs.
	 * Only used for string and number fields.
	 */
	autoComplete?: string;
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
	/**
	 * If present treat the config value as a credential.
	 * Only the locations specified will be able to read the current value.
	 * Access can be used to specify which locations are able to overwrite the value.
	 */
	credential?: ConfigLocation[];
	/**
	 * If present treat the config value as readonly.
	 * Only the locations specified will be able to update the config value.
	 * Access can be used to specify which locations are able to read the value.
	 */
	readonly?: ConfigLocation[];
	/**
	 * True if graphical interfaces should hide the config value
	 */
	hidden?: boolean;
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

export enum ConfigAccess {
	read = 0x1,
	write = 0x2,
	readWrite = 0x3,
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

	/**
	 * Handle migration between clusterio versions
	 *
	 * @param config - Input config read and validated from file
	 * @returns Output config to be loaded into the class
	 * @protected
	 */
	static migrations(config: Static<typeof this.jsonSchema>) {
		return config;
	}

	/** Defines the default access locations for the config class */
	static defaultAccess: ConfigLocation[] = ["controller", "host", "control"];

	fields: Fields;
	_unknownFields: Record<string, FieldValue> = {};

	/** Set to true when a field in the config is changed. */
	dirty = false;
	/** Set to true when a 'restart required' field in the config is changed. */
	restartRequired = false;

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
	) {
		if (typeof location !== "string") {
			throw new Error("location must be a string");
		}
		super();

		this.fields = Object.fromEntries(
			Object.entries(
				this.constructor.fieldDefinitions
			).filter(
				([name, def]) => this._checkAccess(name, def, location, ConfigAccess.read, false)
			).map(
				([name, def]) => [name, defaultValue(def)]
			)
		) as Fields;

		if (fields) {
			this.update(this.constructor.migrations(fields), false, location);
		}
	}

	/**
	 * Check access for a field
	 *
	 * @param name - Name of the field to check.
	 * @param def - definition for for the field to check.
	 * @param location - location to check access for.
	 * @param mode - type of access to check for.
	 * @param error - throw on failure to pass check.
	 * @throws {InvalidAccess}
	 *     if access is not granted and error is true.
	 * @returns true if access is granted
	 * @private
	 */
	_checkAccess(name: string, def: FieldDefinition, location: ConfigLocation, mode: ConfigAccess, error: boolean) {
		// If credential array is present it acts as read permission and the access array as write permission,
		// If readonly array is present it acts as write permission and the access array as the read permission.
		// If neither is present access array acts as a combined read/write permission check.
		if (
			def.credential && mode & ConfigAccess.read && !(def.credential).includes(location)
			|| def.readonly && mode & ConfigAccess.write && !(def.readonly).includes(location)
			|| (
				(!def.credential || mode & ConfigAccess.write)
				&& (!def.readonly || mode & ConfigAccess.read)
				&& !(def.access ?? this.constructor.defaultAccess).includes(location)
			)
		) {
			if (error) {
				throw new InvalidAccess(`Field '${name}' is not accessible from ${location}`);
			} else {
				return false;
			}
		}
		return true;
	}

	/**
	 * Set the value of a field, while also settings the required flags and events.
	 * This method does not perform any validation on the value being set
	 *
	 * @param name - Name of the field to set
	 * @param value - The new value of the field
	 * @param notify - False to skip setting dirty flags and emitting events
	 */
	_set(name: keyof Fields & string, value: FieldValue, notify: boolean = true) {
		const prev = this.fields[name];
		this.fields[name] = value as any;
		if (notify && !isDeepStrictEqual(value, prev)) {
			const def = this.constructor.fieldDefinitions[name];
			if (def.restartRequired) {
				this.restartRequired = true;
			}
			this.dirty = true;
			this.emit("fieldChanged", name, value, prev);
		}
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
	 * @param remote - Location this serialised representation is for
	 * @param filter - When provided, only the given fields are serialized
	 * @returns JSON serializable representation of the config.
	 */
	toRemote(remote: ConfigLocation, filter?: (keyof Fields)[]): Static<typeof Config.jsonSchema> {
		let fields: Record<string, FieldValue> = {};
		for (let [name, value] of Object.entries(this.fields)) {
			if (filter && !filter.includes(name as keyof Fields)) {
				continue;
			}

			let def = this.constructor.fieldDefinitions[name];
			if (
				this.location !== "control" && !this._checkAccess(name, def, this.location, ConfigAccess.write, false)
				|| this.location !== remote && !this._checkAccess(name, def, remote, ConfigAccess.read, false)
			) {
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
	 * @param remote - Location this serialised representation was received from.
	 */
	update(
		json: Static<typeof Config.jsonSchema>,
		notify: boolean,
		remote = this.location
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

			if (
				this.location !== "control" && !this._checkAccess(name, def, remote, ConfigAccess.write, false)
			) {
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

			this._set(name, value, notify);
		}
	}

	/**
	 * Check if field can be accessed from the given location
	 *
	 * @param name - Name of field to check.
	 * @param mode - Mode to access the field as.
	 * @param location - Location used for access control.
	 * @returns true if field is accessible
	 */
	canAccess(name: string, mode: ConfigAccess, location = this.location) {
		if (typeof mode !== "number") {
			throw new TypeError("mode argument is required to canAccess");
		}
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		return this._checkAccess(name, def, location, mode, false);
	}

	/**
	 * Get value for field
	 *
	 * @param name - Name of field to get.
	 * @param remote - Location this value is being read from.
	 * @returns Value stored for the field.
	 */
	get<Field extends keyof Fields & string>(name: Field, remote = this.location) {
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		// If remote access is requested require it to be able to read the field
		if (remote !== this.location) {
			this._checkAccess(name, def, remote, ConfigAccess.read, true);
		}
		// Require that the field is either read or writable locally so that you can get the value
		// back of write only fields recently written to.
		if (
			!this._checkAccess(name, def, this.location, ConfigAccess.write, false)
			&& !this._checkAccess(name, def, this.location, ConfigAccess.read, false)
		) {
			throw new InvalidAccess(`Field '${name}' is not accessible from ${this.location}`);
		}

		return this.fields[name];
	}

	/**
	 * Set value of field
	 *
	 * The field must be defined for the config and the value is
	 * type checked against the field definition.
	 *
	 * @param name - Name of field to set.
	 * @param newValue - Value to set for field.
	 * @param remote - Location this field is being set from.
	 * @throws {InvalidField} if field is not defined.
	 * @throws {InvalidValue} if value is not allowed for the field.
	 */
	set<Field extends keyof Fields & string>(name: Field, newValue: Fields[Field], remote = this.location) {
		let value: FieldValue = newValue;
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		this._checkAccess(name, def, remote, ConfigAccess.write, true);
		if (remote !== this.location) {
			this._checkAccess(name, def, this.location, ConfigAccess.write, true);
		}

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

		this._set(name, value);
	}

	/**
	 * Set property of object field
	 *
	 * Update value of stored object field by setting the specified property
	 * on it.  The field must be defined as an object for the config.
	 *
	 * @param name - Name of field to set property on.
	 * @param prop - Name of property to set on field.
	 * @param value - the value to set the property to.
	 * @param remote - Location this property is being set from
	 * @throws {InvalidField} if field is not defined.
	 * @throws {InvalidValue} if field is not an object.
	 */
	setProp<Field extends keyof Fields & string>(
		name: Field,
		prop: string,
		value?: unknown,
		remote = this.location,
	) {
		let def = this.constructor.fieldDefinitions[name];
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}
		this._checkAccess(name, def, remote, ConfigAccess.write, true);
		if (remote !== this.location) {
			this._checkAccess(name, def, this.location, ConfigAccess.write, true);
		}

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

		this._set(name, updated);
	}
}
