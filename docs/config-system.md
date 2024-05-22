# Configuration System

<sub>This document describes the implementation and inner working of the configuration system in Clusterio, and unless you're developing Clusterio it's probably not going to be very useful for you.</sub>

Clusterio uses a field based configuration system to manage settings for the controller, instances, hosts, and the clusterioctl utility.
Plugins can add their own config fields for the controller and instances configs.
The fields are defined early in the startup, and fields for disabled plugins will still be created.

The built-in config fields are defined in [packages/lib/src/config/definitions.ts](/packages/lib/src/config/definitions.ts) while plugins can add their own config field definitions to the `controllerConfigFields` and `instanceConfigFields` properties of the `plugin` export.
A `<plugin_name>.load_plugin` field is automatically created for each plugin and it's used to enable/disable the loading plugins on startup.


## Defing Fields

Fields are defined as POJS object properties where the name of the property correspond to the name of the configuration field.
The property name is the primary way the field is accessed both in code and on the command line, as such it should follow the lower\_case\_underscore style and consist of a group name and a field name separated by a dot.
For plugins the group name is the name of the plugin, e.g., the `level` field of the `foo_frobber` plugin would be named `foo_frobber.lavel`.

**access**:
    The locations this config field can be read and modified from.
    This is an array of strings which can contain the values `"controller"`, `"host"` and `"control"`.
    If a party is missing in this array then that party will not receive the value of this field when the config is shared, and will be unable to modify the field.
    If not set any party can read and modify this config entry.
    Note that instance config fields should have both `"controller"` and `"host"` or unexpected behaviour may occur.

**type**:
    The type of config value this field will support.
    The supported values are boolean, string, number, and object, and if an attept is made to set the field to a value that is not of the right type it will be reject unless it's a string that can be converted to the right type.

**title** (optional):
    Text used to identify the config field in user interfaces.
    This should not contain the grouping used in `name`.

**description** (optional):
    Text used to describe the config field in user interfaces.

**enum** (optional):
    Array of acceptable values this field can have.
    Attempts to set a value not in this array will be rejected, which makes it useful for making enumareted list of choices.

**optional** (optional):
    True if this field can be set to null.
    Defaults to false.

**initialValue** (optional if optional is true):
    Value this config field should take in a newly initialized config.
    This can also be an async function returning the value to use.

If the value for a field stored in on disk somehow ends up being invalid the field will take on the initial\_value instead when the config is loaded.


## Accessing Fields

On the Config instance there's two ways to access fields: through the set and get methods.
E.g.:

    let value = configInstance.get("group.field");

Or by through the raw fields object (which is best avoided as it doesn't check types or whether the accessed field exists).
E.g.:

    let value = configInstance.fields["group.field"]

The set method also takes an extra argument, which is the value to set the field to.
If the value is not valid this will throw an InvalidValue exception, if the field doesn't exist it will throw an InvalidField exception.


## Config Lifecycle

Values for all config fields are created when the config is initialized, as well as for any fields with missing values when a config is loaded.
Once a field has a value it is never automatically removed, even if the field it was part of no longer exists.
This ensures that plugin configuration is not lost should the server be started up without the plugins that defined the configuration installed.

For instance configs, they are kept on the controller and serialized and sent over to the relevant hosts on startup.
This makes it possible to edit instance configs when the host the instance is on is offline.
A copy is also stored in the instance directory on the host, and this config will be deliverd to the controller on host startup, which enables instances to be copied between clusters as long as their IDs are unique.
