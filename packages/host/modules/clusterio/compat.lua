--[[
Adds various functions used to ensure compatibly between version including some polyfills.

Implementation Guidelines
- If a function is only available at runtime in one version, then all versions must be made to error.
- Where possible, directly assign the function / table to the member of compat.
- When not possible, then it should replace itself with a direct assignment asap.
- Versions are handled in ascending order covering all supported versions and ending with an error.
]]

local lib_json = require("json")

--- @diagnostic disable: deprecated

--- @class LibCompat
--- @field script_data table
--- @field prototypes LuaPrototypes
--- @field active_mods table<string, string>
--- @field write_file fun(filename: string, data: LocalisedString, append: boolean?, for_player: uint?)
--- @field table_to_json fun(data: table): string
--- @field json_to_table fun(json: string): AnyBasic?
local compat = {}

--- @class LibCompatMt
--- @package
local compat_mt = {}

--- @alias VersionTable { [1]: number, [2]: number, [3]: number }

--- Concert a version string into a version table
--- @param version string
--- @return VersionTable
local function version_to_table(version)
	local index = 0
	local rtn = { 0, 0, 0 }
	for part in version:gmatch("%d+") do
		index = index + 1
		rtn[index] = tonumber(part)
	end
	return rtn
end

--- The current version of factorio, the earliest supported is 0.17.69
local current_version_str = "0.17.69"
local current_version = version_to_table(current_version_str)
do
	local success, base_version = pcall(function()
		return script.active_mods.base
	end)
	if success then
		current_version_str = base_version
		current_version = version_to_table(current_version_str)
	end
end

--- Returns true if the current version is equal to the provided version
--- @param version string Version to compare against
--- @return boolean # True if versions are equal
function compat.version_eq(version)
	local version_tbl = version_to_table(version)
	for i = 1, 3 do
		if version_tbl[i] ~= current_version[i] then
			return false
		end
	end
	return true
end

--- Returns true if the current version is greater than or equal to the the provided version
--- @param version string Version to compare against
--- @return boolean # True if the version is greater or equal to provided
function compat.version_ge(version)
	local version_tbl = version_to_table(version)
	for i = 1, 3 do
		if version_tbl[i] > current_version[i] then
			return false
		elseif version_tbl[i] < current_version[i] then
			return true
		end
	end
	return true
end

--- Returns true if the current version is less than or equal to the the provided version
--- @param version string Version to compare against
--- @return boolean # True if the version is less or equal to provided
function compat.version_le(version)
	local version_tbl = version_to_table(version)
	for i = 1, 3 do
		if version_tbl[i] < current_version[i] then
			return false
		elseif version_tbl[i] > current_version[i] then
			return true
		end
	end
	return true
end

--- The major versions of factorio we support
local v2 = compat.version_ge("2.0")
local v1 = compat.version_ge("1.0")  and not compat.version_ge("2.0")
local v0 = compat.version_ge("0.17") and not compat.version_ge("1.0")

--- The minor versions of factorio we support
local v2_0  = compat.version_ge("2.0")
local v1_1  = compat.version_ge("1.1")  and not compat.version_ge("2.0")
local v1_0  = compat.version_ge("1.0")  and not compat.version_ge("1.1")
local v0_18 = compat.version_ge("0.18") and not compat.version_ge("1.0")
local v0_17 = compat.version_ge("0.17") and not compat.version_ge("0.18")

--- Raise an error because the current version is unsupported
local function unsupported_version()
	error("Unsupported version: " .. current_version_str, 3)
end

--- Raise an error because the function is only available at runtime
local function runtime_only()
	error("To maintain compatibly, this value can only be used during runtime.", 3)
end

--- Keys of this table will raise an unsupported error when accessed
local unsupported_properties = {}

--- Keys of this table can only be accessed at runtime
--- The value is a function which returns the real value
local runtime_properties = {}

--- Handles the indexing of the tables above
function compat_mt:__index(key)
	if unsupported_properties[key] then
		return unsupported_version()
	elseif runtime_properties[key] then
		if game == nil then
			return runtime_only()
		end
		local value = runtime_properties[key]()
		if value == nil then
			return unsupported_version()
		end
		rawset(self, key, value)
		return value
	end
end

--- Prototype data contains all the definitions for the game, it is only available during runtime
function runtime_properties.prototypes()
	if v0 or v1 then
		--- Lazy loading of prototype data
		--- Iteration is UB, we can fix this once someone actually needs it
		return setmetatable({}, {
			__index = function(self, key)
				local value = game[key .. "_prototypes"]
				rawset(self, key, value)
				return value
			end
		})
	elseif v2 then
		return prototypes
	end
end

--- List of all active mods
function runtime_properties.active_mods()
	if v0_17 then
		return game.active_mods
	elseif v0 or v1 or v2 then
		return script.active_mods
	end
end

--- Writes a string to file
function runtime_properties.write_file()
	if v0 or v1 then
		return game.write_file
	elseif v2 then
		return helpers.write_file
	end
end

--- Convert tables to and from json, we have backported this to work before runtime
if v0 or v1 then
	compat.table_to_json = function(tbl)
		if game then
			compat.table_to_json = game.table_to_json
			return game.table_to_json(tbl)
		end
		return lib_json.encode(tbl)
	end
	compat.json_to_table = function(json)
		if game then
			compat.json_to_table = game.json_to_table
			return game.json_to_table(json)
		end
		return lib_json.decode(json)
	end
elseif v2 then
	compat.table_to_json = helpers.table_to_json
	compat.json_to_table = helpers.json_to_table
else
	unsupported_properties.table_to_json = true
	unsupported_properties.json_to_table = true
end

--- Script data refers to lua data which is persisted between loads
--- This is called immediately, during init and during load
local function set_script_data()
	if v0 or v1 then
		--- @diagnostic disable-next-line
		compat.script_data = global
	elseif v2 then
		compat.script_data = storage
	else
		unsupported_properties.script_data = true
	end
end

set_script_data()
compat.on_init = set_script_data --- @package
compat.on_load = set_script_data --- @package

return setmetatable(compat, compat_mt)
