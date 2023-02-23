# Configuration System

<sub>This document describes the implementation and inner working of the configuration system in Clusterio, and unless you're developing Clusterio it's probably not going to be very useful for you.</sub>

Clusterio uses a group based configuration system to manage settings for the controller, instances, hosts, and the clusterioctl utility.
Plugins get their own config group for the controller and instances which they can add their own fields to.
The fields are defined early in the startup, and the groups and their fields for disabled plugins will still be created.

The built-in config groups and their fields are defined in [packages/lib/config/definitions.js](/packages/lib/config/definitions.js) while plugins can add their own config groups to the `ControllerConfigGroup` and `InstanceConfigGroup` properties of the `info.js` export using subclasses of `PluginConfigGroup`.
The plugin group has the enabled field pre-defined on it, and it's used to enable/disable plugins.


## Defing Fields

Fields are defined using the `define` class method on group classes after the groupName have been set and before the class has been finalized.
The `define` method takes an object as argument with the following properties:

**access**:
    The locations this config field can be read and modified from.
    This is an array of strings which can contain the values `"controller"`, `"host"` and `"control"`.
    If a party is missing in this array then that party will not receive the value of this field when the config is shared, and will be unable to modify the field.
    Takes the value of `defaultAccess` set on the config group class if not passed.
    Note that instance config groups should have both `"controller"` and `"host"` for all of its fields or unexpected behaviour may occur.

**type**:
    The type of config value this field will support.
    The supported values are boolean, string, number, and object, and if an attept is made to set the field to a value that is not of the right type it will be reject unless it's a string that can be converted to the right type.

**name**:
    Name of the configuration field, this is the primary way the field is accessed, both in code and on the command line.
    As such it should follow the lower\_case\_underscore style and not contain any spaces or dots.

**title** (optional):
    Text used to identify the config field in user interfaces.

**description** (optional):
    Text used to describe the config field in user interfaces.

**enum** (optional):
    Array of acceptable values this field can have.
    Attempts to set a value not in this array will be rejected, which makes it useful for making enumareted list of choices.

**optional** (optional):
    True if this field can be set to null.
    Defaults to false.

**initial_value** (optional if optional is true):
    Value this config field should take in a newly initialized config.
    This can also be an async function returning the value to use.

If the value for a field stored in on disk somehow ends up being invalid the field will take on the initial\_value instead when the config is loaded.


## Accessing Fields

On the Config instance there's two ways to access fields: through the set and get methods using dot notation.
E.g.:

    let value = configInstance.get("group.field");

Or by getting the group first and then calling set or get on that.
E.g.:

    let value = configInstance.group("group").get("field")

The set method takes an extra argument, which is the value to set the field to.
If the value is not valid this will throw an InvalidValue exception, if the group or field doesn't exist it will throw an InvalidField exception.


## Config Lifecycle

Values for all config fields are created when the config is initialized, as well as for any fields with missing values when a config is loaded.
Once a field has a value it is never automatically removed, even if the field or group it was part of no longer exists.
This ensures that plugin configuration is not lost should the server be started up without the plugins that defined the configuration installed.

For instance configs, they are kept on the controller and serialized and sent over to the relevant hosts on startup.
This makes it possible to edit instance configs when the host the instance is on is offline.
A copy is also stored in the instance directory on the host, and this config will be deliverd to the controller on host startup, which enables instances to be copied between clusters as long as their IDs are unique.
