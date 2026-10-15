# Configuration System

<sub>This document describes the implementation and inner working of the configuration system in Clusterio, and unless you're developing Clusterio it's probably not going to be very useful for you.</sub>

Clusterio uses a field based configuration system to manage settings for the controller, instances, hosts, and the clusterioctl utility.
Plugins can add their own config fields for the controller, host, instance, and ctl configs.
The fields are defined early in the startup, and fields for disabled plugins will still be created.

The built-in config fields are defined in [packages/lib/src/config/definitions.ts](/packages/lib/src/config/definitions.ts) while plugins add fields through `controllerConfigFields`, `hostConfigFields`, `instanceConfigFields`, and `ctlConfigFields` on the `plugin` export.
Controller, host, and instance configs also receive `<plugin_name>.load_plugin` to enable/disable loading on startup and a hidden `<plugin_name>.version` for migrations.
These automatic fields are not added to ctl configs.


## Defining Fields

Fields are defined as POJS object properties where the name of the property correspond to the name of the configuration field.
The property name is the primary way the field is accessed both in code and on the command line, as such it should follow the lower\_case\_underscore style and consist of a group name and a field name separated by a dot.
For plugins the group name is the name of the plugin, e.g., the `level` field of the `foo_frobber` plugin would be named `foo_frobber.level`.

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
    This can also be a synchronous function returning the value to use.
    The current implementation calls this function without awaiting its result; an async function stores a Promise instead of the intended value.
    Earlier documentation advertised async defaults, but these are not implemented correctly and must not be used until that mismatch is resolved.

**validator** (optional):
    Function called with the value being set and the config it belongs to.
    It should throw an error if the value is not acceptable, and the message of the error is passed on to whoever tried to set it.
    Common validators such as `greaterThanZero`, `greaterThanEqualZero`, `integer` and `filePath` are available on `Config.validators`, along with `optional` to skip null and `all` to combine several.
    The config is read only while the validator runs.

**dependsOn** (optional):
    Names of other fields the validator reads the value of.
    When one of those fields is changed the validator of this field is run again against the new value, and the change is rejected if it fails.

**restartRequired** (optional):
    True if a restart of the controller, host or instance the config belongs to is needed for changes to take effect.
    Changing such a field sets the `restartRequired` flag on the config, which the web interface uses to show that a restart is pending.
    Defaults to false.

**restartRequiredProps** (optional):
    For object fields, names of properties that have the opposite of `restartRequired`.
    Only used by the web interface to show which properties need a restart, `factorio.settings` uses it to mark the settings that are applied live.

**credential** (optional):
    Locations allowed to read the value of this field.
    Other locations can still change the value if allowed by `access`, which is what you want for tokens and passwords.

**readonly** (optional):
    Locations allowed to change the value of this field.
    Other locations can still read the value if allowed by `access`.

**hidden** (optional):
    True if the web interface should not show this field.
    Used for internal values that are managed by Clusterio.

**autoComplete** (optional):
    Value for the autocomplete attribute of the input in the web interface, e.g. `section-factorio new-password`.
    Only used for string and number fields.

**inputComponent** (optional):
    Name of the input component the web interface should render for this field instead of the default for its type.
    Plugins register components with the `control.hooks.inputComponents` hook in their web entrypoint.
    The hook returns an object whose keys match the field's `inputComponent` value.
    The old `BaseWebPlugin.inputComponents` property remains supported for compatibility but is deprecated with the class-based entrypoint.

For example, with `inputComponent: "foo_frobber_level"` on a field:

```js
import LevelInput from "./LevelInput.js";

export default async function({ control, plugin }) {
    control.hooks.inputComponents.attach(plugin.name, () => ({
        foo_frobber_level: LevelInput,
    }));
}
```

`LevelInput` must implement the `InputComponent` contract exported by `@clusterio/web_ui`.

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
