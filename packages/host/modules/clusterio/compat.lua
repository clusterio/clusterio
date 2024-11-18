--[[
Adds various functions used to ensure compatibly between version including some polyfills
]]

--- @diagnostic disable: deprecated

--- @class LibCompat
local compat = {}

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

--- Raise an error because the current version is unsupported
--- @return any
local function unsupported_version()
	error("Unsupported version: " .. current_version_str, 3)
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
local major_v2 = compat.version_ge("2.0.0")
local major_v1_1 = not major_v2 and compat.version_ge("1.1.0")
-- local major_v1 = not major_v1_1 and compat.version_ge("1.0.0")

--- Returns the table reference used to store script data
--- @return table script_data
function compat.script_data()
	if major_v1_1 then
		--- @diagnostic disable-next-line
		return global
	elseif major_v2 then
		return storage
	end
	return unsupported_version()
end

--- Returns the table reference used to store prototypes
--- @param category string Category of prototype to access, eg "item", "fluid", "recipe"
--- @return table # Table of prototype data
function compat.prototype_data(category)
	if major_v1_1 then
		return game[category .. "_prototypes"]
	elseif major_v2 then
		return prototypes[category]
	end
	return unsupported_version()
end

--- Returns the table reference used to list active mods
--- @return table # Table of active mods
function compat.active_mods()
	if major_v1_1 or major_v2 then
		return script.active_mods
	end
	return unsupported_version()
end

--- @param tbl table
--- @return string
function compat.table_to_json(tbl)
	return unsupported_version()
end

--- @param json string
--- @return table
function compat.json_to_table(json)
	return unsupported_version()
end

--- @param filename string
--- @param data LocalisedString
--- @param append boolean?
--- @param for_player uint?
function compat.write_file(filename, data, append, for_player)
	unsupported_version()
end

--- Select the appropriate polyfill implementation
if major_v1_1 then
	-- Game is not always available so it needs to be called within another function
	-- Can not use ... here because of luals type suggestion breaking when it is used
	-- TODO maybe include a version that does not require game?

	compat.table_to_json = function(tbl) return game.table_to_json(tbl) end
	compat.json_to_table = function(json) return game.json_to_table(json) end
	compat.write_file = function(filename, data, append, for_player) return game.write_file(filename, data, append, for_player) end
elseif major_v2 then
	compat.table_to_json = helpers.table_to_json
	compat.json_to_table = helpers.json_to_table
	compat.write_file = helpers.write_file
end

return compat
