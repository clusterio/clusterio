// Configuration classes
"use strict";

const events = require("events");

const isDeepStrictEqual = require("../is_deep_strict_equal");
const { basicType } = require("@clusterio/lib/helpers");


/**
 * Invalid Value exception
 *
 * Exception class for when invalid values are attempted to be set on a
 * field.
 *
 * @extends Error
 * @memberof module:lib/config
 */
class InvalidValue extends Error { };

/**
 * Invalid Field exception
 *
 * Exception class for when a group or field that does not exist is
 * attempted to be accessed.
 *
 * @extends Error
 * @memberof module:lib/config
 */
class InvalidField extends Error { };

/**
 * Split the given string on the first instance of separator
 *
 * Splits `string` on the first instance of `separator` and returns an
 * array consisting of the string up to the separator and the string
 * after the separator.  Returns an array with the string and an empty
 * string if the separator is not present.
 *
 * @param {string} separator - Separator to split string by.
 * @param {string} string - String to split
 * @returns {Array} string split on separator.
 * @memberof module:lib/config
 * @private
 * @inner
 */
function splitOn(separator, string) {
	let index = string.indexOf(separator);
	if (index === -1) {
		return [string, ""];
	}
	return [string.slice(0, index), string.slice(index + separator.length)];
}

/**
 * Collection of config groups
 *
 * Represents a collection of ConfigGroup instances that can be
 * managed as one.
 *
 * This is an EventEmitter with the following events:
 * - fieldChanged -
 *     invoked after a field has been updated in one of the config groups
 *     belonging to this config.  Takes three parameters: group, field,
 *     prev.
 *
 * @extends events.EventEmitter
 *
 * @memberof module:lib/config
 */
class Config extends events.EventEmitter {
	constructor() {
		super();

		if (!this.constructor._finalized) {
			throw new Error(`Cannot instantiate incomplete Config class ${this.constructor.name}`);
		}

		this._groups = new Map();
		this._unknownGroups = new Map();
	}

	async init() {
		for (let [name, GroupClass] of this.constructor._groups) {
			if (!this._groups.has(name)) {
				let group = new GroupClass();
				await group.init(this);
				this._groups.set(name, group);
			}
		}
		this._initialized = true;
	}

	_validate(serializedConfig) {
		if (basicType(serializedConfig) !== "object") {
			throw new Error(`Expected object, not ${basicType(serializedConfig)} for config`);
		}

		if (basicType(serializedConfig.groups) !== "array") {
			throw new Error(`Expected groups to be an array, not ${basicType(serializedConfig.groups)}`);
		}
	}

	async load(serializedConfig) {
		this._validate(serializedConfig);
		for (let serializedGroup of serializedConfig.groups) {
			let GroupClass = this.constructor._groups.get(serializedGroup.name);
			if (!GroupClass) {
				this._unknownGroups.set(serializedGroup.name, serializedGroup);
				continue;
			}

			let group = new GroupClass();
			await group.load(this, serializedGroup);
			this._groups.set(group.name, group);
		}

		await this.init();
	}

	/**
	 * Serialize the config to a plain JavaScript object
	 *
	 * @returns {Object} JSON serializable representation of the config.
	 */
	serialize() {
		let groups = [...this._unknownGroups.values()];
		for (let group of this._groups.values()) {
			groups.push(group.serialize());
		}

		return { groups };
	}

	/**
	 * Update the configuration based on a serialized config
	 *
	 * Updates all groups in the config with groups in the serialized
	 * config passed.
	 *
	 * @param {Object} serializedConfig - Output from .serialize().
	 * @param {boolean} notify - Invoke fieldChanged events if true.
	 */
	update(serializedConfig, notify) {
		this._validate(serializedConfig);
		for (let serializedGroup of serializedConfig.groups) {
			let group = this._groups.get(serializedGroup.name);
			if (group) {
				group.update(serializedGroup, notify);
			} else {
				this._unknownGroups.set(serializedGroup.name, serializedGroup);
			}
		}
	}

	/**
	 * Get the value for a config field
	 *
	 * @param {string} name - Name of field to get.
	 * @returns {*} the value for the field.
	 */
	get(name) {
		let [group, field] = splitOn(".", name);
		return this.group(group).get(field);
	}

	/**
	 * Set the value for a config field
	 *
	 * @param {string} name - Name of field to set.
	 * @param {*} value - the value to set on field
	 */
	set(name, value) {
		let [group, field] = splitOn(".", name);
		this.group(group).set(field, value);
	}

	/**
	 * Set property of an object value for a config field
	 *
	 * @param {string} name - Name of field to set property on.
	 * @param {string} prop - Name of property to set on field.
	 * @param {*} value - the value to set the property to.
	 */
	setProp(name, prop, value) {
		let [group, field] = splitOn(".", name);
		this.group(group).setProp(field, prop, value);
	}

	/**
	 * Get the config group instance with the given name
	 *
	 * @param {string} name - Name of group to get.
	 * @returns {module:lib/config.ConfigGroup} config group.
	 */
	group(name) {
		if (!this._initialized) {
			throw new Error(`${this.constructor.name} instance is uninitialized`);
		}
		let group = this._groups.get(name);
		if (!group) {
			throw new InvalidField(`No config group named '${name}'`);
		}
		return group;
	}

	static _initSubclass() {
		// These properties are initialized here in order to ensure that
		// they end up on the sub-class.
		if (!this._initialized) {
			this._initialized = true;
			this._finalized = false;
			this._groups = new Map();
		}
	}

	/**
	 * Mapping of group name to group class
	 *
	 * Returns the internal mapping of group names to group classes that
	 * mave been registered with this config.  Note that mutating this
	 * object will lead to unexpected behaviour.
	 *
	 * @returns {Map<string, GroupClass>} config groups
	 */
	static get groups() {
		this._initSubclass();
		return this._groups;
	}

	/**
	 * Locks this Config class from adding more groups.
	 */
	static finalize() {
		this._initSubclass();
		this._finalized = true;
	}

	/**
	 * Register a ConfigGroup with this Config
	 *
	 * Adds the ConfigGroup to this config as a group that will get
	 * initialized, loaded and serialized with this config class.
	 *
	 * @param {module:lib/config.ConfigGroup} group - class to register.
	 */
	static registerGroup(group) {
		this._initSubclass();

		if (this._finalized) {
			throw new Error("Cannot register group on finalized config");
		}

		if (!group._finalized) {
			throw new Error("Group must be finalized before it can be registered");
		}

		if (this._groups.has(group.groupName)) {
			throw new Error(`${group.groupName} has already been registered`);
		}

		this._groups.set(group.groupName, group);
	}
}


/**
 * Collection of related config entries
 *
 * Type checks and stores a collection of related config entries.  Attempt
 * to set invalid values for fields will result in an error thrown while
 * loading a config with invalid values will result in those being replaced
 * by the innitial value for those fields.
 *
 * @memberof module:lib/config
 */
class ConfigGroup {
	/**
	 * Creates a new config group.
	 *
	 * After the creation of the new config group you have to call
	 * either .init() or .load() on it in order to fully initialize it.
	 */
	constructor() {
		if (!this.constructor._finalized) {
			throw new Error(`Cannot instantiate incomplete ConfigGroup class ${this.constructor.name}`);
		}

		this._fields = new Map();
		this._unknownFields = new Map();
		this._config = null;
	}

	/**
	 * Initialize new config group
	 *
	 * Computes and assigns the initial values for all fields of the
	 * config group.
	 *
	 * @param {module:lib/config.Config} config - Config group belongs to.
	 */
	async init(config) {
		this._config = config;

		for (let [name, def] of this.constructor._definitions) {
			if (this._fields.has(name)) {
				continue;
			}

			let value = null;
			if (typeof def.initial_value === "function") {
				value = await def.initial_value();

			} else if (def.initial_value !== undefined) {
				value = def.initial_value;
			}

			this._fields.set(name, value);
		}
	}

	/**
	 * Load from serialized group
	 *
	 * Loads all the values from the passed serialized version of the
	 * group and then initializes any possible missing fields from it to
	 * their default values.
	 *
	 * @param {module:lib/config.Config} config - Config group belongs to.
	 * @param {Object} serializedGroup -
	 *     Result from a previous call to .serialize().
	 */
	async load(config, serializedGroup) {
		this.update(serializedGroup, false);
		await this.init(config);
	}

	/**
	 * Name of the group
	 *
	 * Shortcut for `group.constructor.groupName`
	 */
	get name() {
		return this.constructor.groupName;
	}

	/**
	 * Get value for field
	 *
	 * @param {string} name - Name of field to get.
	 * @returns {*} Value stored for the field.
	 */
	get(name) {
		if (!this.constructor._definitions.has(name)) {
			throw new InvalidField(`No field named '${name}'`);
		}

		return this._fields.get(name);
	}

	/**
	 * Set value of field
	 *
	 * The field must be defined for the config group and the value is
	 * type checked against the field definition.
	 *
	 * @param {string} name - Name of field to set.
	 * @param {*} value - Value to set for field.
	 * @throws {module:lib/config.InvalidField} if field is not defined.
	 * @throws {module:lib/config.InvalidValue} if value is not allowed for the field.
	 */
	set(name, value) {
		let def = this.constructor._definitions.get(name);
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}

		// Empty strings are treates as null
		if (value === "") {
			value = null;
		}

		if (def.enum && !def.enum.includes(value)) {
			throw new InvalidValue(`Expected one of [${def.enum.join(", ")}], not ${value}`);
		}

		if (basicType(value) === "string") {
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
				} catch (err) {
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

		let prev = this._fields.get(name);
		this._fields.set(name, value);
		if (this._config && !isDeepStrictEqual(value, prev)) {
			this._config.emit("fieldChanged", this, name, prev);
		}
	}

	/**
	 * Set property of object field
	 *
	 * Update value of stored object field by setting the specified property
	 * on it.  The field must be defined as an object for the config group.
	 *
	 * @param {string} name - Name of field to set property on.
	 * @param {string} prop - Name of property to set on field.
	 * @param {*} value - the value to set the property to.
	 * @throws {module:lib/config.InvalidField} if field is not defined.
	 * @throws {module:lib/config.InvalidValue} if field is not an object.
	 */
	setProp(name, prop, value) {
		let def = this.constructor._definitions.get(name);
		if (!def) {
			throw new InvalidField(`No field named '${name}'`);
		}

		if (def.type !== "object") {
			throw new InvalidValue(`Cannot set property on non-object field '${name}'`);
		}

		let prev = this._fields.get(name);
		let updated = {...prev || {}};

		if (value !== undefined) {
			updated[prop] = value;
		} else {
			delete updated[prop];
		}
		this._fields.set(name, updated);
		if (this._config && !isDeepStrictEqual(updated, prev)) {
			this._config.emit("fieldChanged", this, name, prev);
		}
	}

	/**
	 * Update a config group from a serialized group
	 *
	 * Overwrites the values of all the fields in this config group that
	 * has a valid value in the passed serialized group with that value.
	 *
	 * @param {Object} serializedGroup -
	 *     Result from a previous call to .serialize().
	 * @param {boolean} notify - Invoke fieldChanged events if true.
	 */
	update(serializedGroup, notify) {
		if (basicType(serializedGroup) !== "object") {
			throw new Error(`Expected object, not ${basicType(serializedGroup)} for ConfigGroup`);
		}

		if (serializedGroup.name !== this.name) {
			throw new Error(`Expected group name ${this.name}, not ${serializedGroup.name}`);
		}

		if (basicType(serializedGroup.fields) !== "object") {
			throw new Error(`Expected fields to be an object, not ${basicType(serializedGroup.fields)}`);
		}

		for (let [name, value] of Object.entries(serializedGroup.fields)) {
			let def = this.constructor._definitions.get(name);
			if (!def) {
				this._unknownFields.set(name, value);
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

			let prev = this._fields.get(name);
			this._fields.set(name, value);
			if (notify && this._config && !isDeepStrictEqual(value, prev)) {
				this._config.emit("fieldChanged", this, name, prev);
			}
		}
	}

	/**
	 * Serialize the config to a plain JavaScript object
	 *
	 * @returns {Object} JSON serializable representation of the group.
	 */
	serialize() {
		let fields = {};
		for (let [name, value] of this._fields) {
			fields[name] = value;
		}

		for (let [name, value] of this._unknownFields) {
			fields[name] = value;
		}

		return {
			name: this.name,
			fields,
		};
	}

	static _initSubclass() {
		// These properties are initialized here in order to ensure that
		// they end up on the sub-class.
		if (!this._initialized) {
			this._initialized = true;
			this._definitions = new Map();
		}
	}

	/**
	 * Mapping of config name to field meta data
	 *
	 * Returns the internal meta data for the fields of this class.
	 * Note that mutating this object will lead to unexpected behaviour.
	 *
	 * @returns {Map<string, Object>} field meta data
	 */
	static get definitions() {
		this._initSubclass();
		return this._definitions;
	}

	/**
	 * Define a new configuration field
	 *
	 * @param {Object} item - Field definition.
	 * @param {string} item.type -
	 *     string declaring the type of the config value, supports
	 *     boolean, string, number and object.
	 * @param {string} item.name -
	 *     Name of the configuration field.  Should follow the
	 *     lower_case_underscore style.
	 * @param {string} item.title -
	 *     Text used to identify the config field in user interfaces.
	 * @param {string} item.description -
	 *     Text used to describe the config field in user interfaces.
	 * @param {Array=} item.enum -
	 *     Array of all values that are acceptible.  Useful for making
	 *     enumerated values.
	 * @param {boolean=} item.optional -
	 *     True if this field can be set to null.  Defaults to false.
	 * @param {*=} item.initial_value -
	 *     Value this config field should take in a newly initialized
	 *     config.  This can also be an async function returning the
	 *     value to use.
	 */
	static define(item) {
		if (this._finalized) {
			throw new Error(`Cannot define field for ConfigGroup class ${this.name} after it has been finalized`);
		}

		if (basicType(this.groupName) !== "string") {
			throw new Error(`Expected ConfigGroup class ${this.name} to have the groupName property set to a string`);
		}

		this._initSubclass();

		let itemKeys = Object.keys(item);

		// Check for required properties
		["name", "type"].forEach(prop => {
			if (!itemKeys.includes(prop)) {
				throw new Error(`${prop} is required when defining an field`);
			}
		});

		// Validate properties
		let validTypes = ["boolean", "string", "number", "object"];
		Object.keys(item).forEach(key => {
			let value = item[key];
			let valueType = basicType(value);
			switch (key) {
				case "type":
					if (!validTypes.includes(value)) {
						throw new Error(`${value} is not a valid type`);
					}
					break;

				case "enum":
					if (valueType !== "array") {
						throw new Error("enum must be an array");
					}
					break;

				case "name":
					if (valueType !== "string") {
						throw new Error("name must be a string");
					}
					break;

				case "title":
					if (valueType !== "string") {
						throw new Error("title must be a string");
					}
					break;

				case "description":
					if (valueType !== "string") {
						throw new Error("description must be a string");
					}
					break;

				case "optional":
					if (valueType !== "boolean") {
						throw new Error("optional must be a boolean");
					}
					break;

				case "initial_value":
					if (valueType !== item.type && valueType !== "function") {
						throw new Error("initial_value must match the type or be a function");
					}
					break;

				default:
					throw new Error(`Unknown property ${key}`);
			}
		});

		if (this._definitions.has(item.name)) {
			throw new Error(`Config field ${item.name} has already been defined`);
		}

		let computed = {
			optional: false,
			fullName: `${this.groupName}.${item.name}`,
			...item,
		};

		if (!computed.optional && computed.initial_value === undefined) {
			throw new Error(`Non-optional field ${item.name} needs an initial_value`);
		}

		this._definitions.set(item.name, computed);
	}

	/**
	 * Locks this ConfigGroup class from adding more definitons.
	 */
	static finalize() {
		if (basicType(this.groupName) !== "string") {
			throw new Error(`Expected ConfigGroup class ${this.name} to have the groupName property set to a string`);
		}

		this._initSubclass();
		this._finalized = true;
	}
}

/**
 * Config group for plugins
 *
 * Grouping that includes per plugin fields clusterio uses to manage
 * plugins.  This is currently only the enabled field.  It is otherwise
 * identical to the ConfigGroup class.
 *
 * @extends module:lib/config.ConfigGroup
 * @memberof module:lib/config
 */
class PluginConfigGroup extends ConfigGroup {
	static _initSubclass() {
		if (!this._initialized) {
			super._initSubclass();
			this.define({
				name: "enabled",
				description: "Enable plugin",
				type: "boolean",
				initial_value: true,
			});
		}
	}
}


module.exports = {
	InvalidField,
	InvalidValue,

	Config,
	ConfigGroup,
	PluginConfigGroup,
};
