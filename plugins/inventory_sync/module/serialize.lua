local compat = require("modules/clusterio/compat")
local clusterio_serialize = require("modules/clusterio/serialize")
local character_inventories = require("modules/inventory_sync/define_player_inventories")
local character_stat_keys = require("modules/inventory_sync/define_player_stat_keys")
local game_view_settings_keys = require("modules/inventory_sync/define_game_view_settings")
local serialize = {}

local v2_logistic_api = compat.version_ge("2.0.0")
local v2_storage_api = compat.version_ge("2.0.0")
local v2_remote_controller = compat.version_ge("2.0.0")
local v2_space_platform = compat.version_ge("2.0.0")
local v2_exit_remote_view = compat.version_ge("2.0.56")
local recipe_notifications_api = compat.version_ge("2.0.67")
local v2_0_quick_bar_api = compat.version_ge("2.0.0")
local v2_1_quick_bar_api = compat.version_ge("2.1.0")

function serialize.serialize_inventories(source, inventories)
	local serialized = {}

	for name, index in pairs(inventories) do
		local inventory = source.get_inventory(index)
		if inventory ~= nil then
			serialized[name] = clusterio_serialize.serialize_inventory(inventory)
		end
	end

	return serialized
end

-- Characters are serialized into a table with the following fields:
--   character_crafting_speed_modifier
--   character_mining_speed_modifier
--   character_additional_mining_categories
--   character_running_speed_modifier
--   character_build_distance_bonus
--   character_item_drop_distance_bonus
--   character_reach_distance_bonus
--   character_resource_reach_distance_bonus
--   character_item_pickup_distance_bonus
--   character_loot_pickup_distance_bonus
--   character_inventory_slots_bonus
--   character_trash_slot_count_bonus
--   character_maximum_following_robot_count_bonus
--   character_health_bonus
--   character_personal_logistic_requests_enabled
--   allow_dispatching_robots
--   inhibit_movement_bonus (optional, from the armor equipment grid)
--   inventories: table of character inventory name to inventory content
function serialize.serialize_character(character)
	local serialized = { }

	-- Serialize character stats
	for _, key in pairs(character_stat_keys) do
		serialized[key] = character[key]
	end

	-- Serialize character inventories
	serialized.inventories = serialize.serialize_inventories(character, character_inventories)

	-- Serialize armor grid state
	local grid = character.grid
	if grid then
		serialized.inhibit_movement_bonus = grid.inhibit_movement_bonus
	end

	return serialized
end

--- Restore the stats of a character, the inventories are restored with place_items
function serialize.deserialize_character(character, serialized)
	for _, key in pairs(character_stat_keys) do
		character[key] = serialized[key]
	end
end

--- Restore the armor grid state, the grid exists after the armor inventory is restored
function serialize.deserialize_character_grid(character, serialized)
	local grid = character.grid
	if grid and serialized.inhibit_movement_bonus ~= nil then
		grid.inhibit_movement_bonus = serialized.inhibit_movement_bonus
	end
end

-- Inventories by the names used in serialized data in the order they are filled, armor first as it adds slots to main
local fill_order = { "armor", "guns", "ammo", "main", "trash" }
-- Inventories items which do not fit into the inventory they came from are inserted into, in order
local overflow_order = { "main", "guns", "ammo", "armor" }

--- Number of slots a serialized inventory uses
--- @param serialized table
--- @return number
local function serialized_size(serialized)
	local last = 0
	for _, entry in ipairs(serialized.i) do
		last = (entry.s or last + 1) + (entry.r or 0)
	end
	return last
end

--- Copy of a serialized inventory without slot filters, for inventories which do not support them
--- @param serialized table
--- @return table
local function without_filters(serialized)
	local copy = { i = {} }
	for _, entry in ipairs(serialized.i) do
		local item = {}
		for key, value in pairs(entry) do
			item[key] = value
		end
		item.f = nil
		table.insert(copy.i, item)
	end
	return copy
end

--- Inventories the items of a player go into, by the names used in serialized data
--- @param player LuaPlayer
--- @return table<string, LuaInventory>
function serialize.item_destinations(player)
	local destinations = {}
	local character = player.character
	if character then
		for name, index in pairs(character_inventories) do
			destinations[name] = character.get_inventory(index)
		end
	elseif player.controller_type == defines.controllers.god
		or v2_remote_controller and player.physical_controller_type == defines.controllers.god
	then
		destinations.main = player.get_inventory(defines.inventory.god_main) --[[@as LuaInventory]]
	end
	return destinations
end

--- Insert as much of a stack as possible, starting with the inventory it came from
--- @param stack LuaItemStack
--- @param destinations table<string, LuaInventory>
--- @param from string?
local function insert_stack(stack, destinations, from)
	local function insert(destination)
		if destination and stack.valid_for_read then
			local inserted = destination.insert(stack)
			if inserted >= stack.count then
				stack.clear()
			elseif inserted > 0 then
				stack.count = stack.count - inserted
			end
		end
	end
	if from then
		insert(destinations[from])
	end
	for _, name in ipairs(overflow_order) do
		insert(destinations[name])
	end
end

--- Replace the items in destinations with the serialized inventories and loose items
---
--- Each inventory goes slot for slot into the destination of the same name when it fits, otherwise its items are
--- inserted where there is space. Returns a script inventory with what did not fit, to be put into a corpse.
--- @param destinations table<string, LuaInventory>
--- @param inventories table<string, table>?
--- @param items { name: string, count: integer, quality: string? }[]?
--- @return LuaInventory?
function serialize.place_items(destinations, inventories, items)
	for _, destination in pairs(destinations) do
		destination.clear()
	end

	local leftovers = {}
	for _, name in ipairs(fill_order) do
		local serialized = inventories and inventories[name]
		local size = serialized and serialized_size(serialized) or 0
		local destination = destinations[name]
		if serialized and destination and size <= #destination then
			if not destination.supports_filters() then
				serialized = without_filters(serialized)
			end
			clusterio_serialize.deserialize_inventory(destination, serialized)
		elseif serialized and size > 0 then
			-- Slot filters belong to the slot they were set on
			local inventory = game.create_inventory(size)
			clusterio_serialize.deserialize_inventory(inventory, without_filters(serialized))
			table.insert(leftovers, { from = name, inventory = inventory })
		end
	end

	if items and next(items) then
		local inventory = game.create_inventory(#items)
		for _, item in pairs(items) do
			local remaining = item.count
			while remaining > 0 do
				local inserted = inventory.insert({ name = item.name, count = remaining, quality = item.quality })
				remaining = remaining - inserted
				if remaining > 0 then
					if inserted == 0 and not inventory.is_full() then
						log("ERROR: Unable to place " .. remaining .. " " .. item.name .. ", voiding it")
						break
					end
					inventory.resize(#inventory * 2)
				end
			end
		end
		table.insert(leftovers, { inventory = inventory })
	end

	local spill
	local spilled = 0
	for _, leftover in ipairs(leftovers) do
		local inventory = leftover.inventory
		for i = 1, #inventory do
			local stack = inventory[i]
			if stack.valid_for_read then
				insert_stack(stack, destinations, leftover.from)
			end
			if stack.valid_for_read then
				spill = spill or game.create_inventory(1)
				if spilled == #spill then
					spill.resize(#spill * 2)
				end
				spilled = spilled + 1
				spill[spilled].transfer_stack(stack)
			end
		end
		inventory.destroy()
	end
	return spill
end

--- Put items which did not fit into a corpse below the player
--- @param player LuaPlayer
--- @param spill LuaInventory?
function serialize.spill_items(player, spill)
	if not spill then
		return
	end
	spill.sort_and_merge()
	local count = #spill - spill.count_empty_stacks()
	local corpse = player.surface.create_entity({
		name = "character-corpse",
		position = player.position,
		inventory_size = count,
		player_index = player.index,
	})
	if corpse then
		local inventory = assert(corpse.get_inventory(defines.inventory.character_corpse))
		for i = 1, #spill do
			if spill[i].valid_for_read then
				assert(inventory.find_empty_stack()).transfer_stack(spill[i])
			end
		end
		player.print(
			"Some of your synced items do not fit into your inventory here and have been placed in a corpse below you."
		)
	else
		log("ERROR: Unable to create a corpse for " .. player.name .. ", voiding " .. count .. " stacks of items")
	end
	spill.destroy()
end

-- Personal logistic slots is a table mapping string indexes to a table with the following fields:
--   name
--   min
--   max
function serialize.serialize_personal_logistic_slots(player)
	-- Check if logistics technology is researched
	local force = player.force
	if not force.technologies["logistic-robotics"] or not force.technologies["logistic-robotics"].researched then
		return nil
	end

	if v2_logistic_api then
		local logistic_point = player.get_requester_point()
		if logistic_point == nil then
			return nil
		end
		local serialized = {
			enabled = logistic_point.enabled,
			trash_not_requested = logistic_point.trash_not_requested,
			sections = {},
		}
		for i = 1, logistic_point.sections_count do
			local section = logistic_point.get_section(i)
			serialized.sections[i] = {
				group = section.group,
				active = section.active,
				multiplier = section.multiplier,
				filters = section.filters,
			}
		end
		return serialized
	end

	local serialized = nil

	-- Serialize personal logistic slots
	local last_valid = 0
	for i = 1, 65536 do
		local slot = player.get_personal_logistic_slot(i)
		if slot.name then
			last_valid = i
			if not serialized then
				serialized = {}
			end
			serialized[tostring(i)] = {
				name = slot.name,
				min = slot.min,
				max = slot.max,
			}

		-- Stop after 100 empty slots
		elseif last_valid + 100 <= i then
			break
		end
	end

	return serialized
end

function serialize.deserialize_personal_logistic_slots(player, serialized)
	if not serialized then
		return
	end

	-- Check if logistics technology is researched
	local force = player.force
	if not force.technologies["logistic-robotics"] or not force.technologies["logistic-robotics"].researched then
		return
	end

	-- Load personal logistic slots
	if v2_logistic_api then
		local logistic_point = player.get_requester_point()
		if logistic_point == nil then
			return
		end

		-- Remove old sections up to section_count
		for i = logistic_point.sections_count, 1, -1 do
			logistic_point.remove_section(i)
		end

		-- If this is an array instead of a table, migrate to v2 format
		if serialized[1] ~= nil then
			local section = logistic_point.add_section()
			for i, slot in pairs(serialized) do
				section.set_slot(i, {
					value = {
						name = slot.name,
						quality = "normal",
					},
					min = slot.min,
					max = slot.max,
				})
			end
		else
			-- Regular 2.0+ deserialization
			logistic_point.enabled = serialized.enabled
			logistic_point.trash_not_requested = serialized.trash_not_requested
			for i, section in pairs(serialized.sections) do
				local sec = logistic_point.add_section()
				sec.active = section.active
				sec.multiplier = section.multiplier
				if section.group ~= "" then -- "" is the default group name, which is truthy
					-- Named groups get added with name only - this avoids overwriting existing groups on the server
					sec.group = section.group
				else
					-- Unnamed groups get added with filters
					sec.filters = section.filters
				end
			end
		end
	else
		for i, slot in pairs(serialized) do
			if slot ~= nil then
				player.set_personal_slogistic_slot(tonumber(i), slot)
			end
		end
	end
end

-- name is a custom type where quality is "normal" and comparator is "=" (most common case)
--- @alias QuickBarSlotEncoded.name string
--- @alias QuickBarSlotEncoded.filter { t: "f", n: string, q: string, c: string }
--- @alias QuickBarSlotEncoded QuickBarSlotEncoded.name | QuickBarSlotEncoded.filter

--- @param filter ItemFilter
--- @return QuickBarSlotEncoded
local function serialize_filter(filter)
	if filter.quality == "normal" and filter.comparator == "=" then
		return filter.name --[[@as string]]
	end

	return {
		t = "f",
		n = filter.name --[[@as string]],
		q = filter.quality --[[@as string]],
		c = filter.comparator --[[@as string]],
	}
end

--- @param slot QuickBarSlot | ItemFilter | LuaItemPrototype
--- @return QuickBarSlotEncoded | nil
function serialize.serialize_quick_bar_slot(slot)
	if v2_1_quick_bar_api then
		-- 2.1 has a dedicated type for quick bar slots
		--- @cast slot QuickBarSlot
		if slot.type == "filter" then
			return serialize_filter(slot.filter)
		end

		print("Warning: Unsupported quick bar slot type '" .. slot.type .. "'")
		return nil
	end

	if v2_0_quick_bar_api then
		-- 2.0 gives us an item filter which supports quality
		--- @cast slot -QuickBarSlot, -LuaItemPrototype
		return serialize_filter(slot)
	end

	-- pre 2.0 quality did not exist
	--- @cast slot LuaItemPrototype
	return slot.name
end

--- @param entry string | QuickBarSlotEncoded
--- @return QuickBarSlot | ItemWithQualityID | nil
function serialize.deserialize_quick_bar_slot(entry)
	if v2_1_quick_bar_api then
		-- Return a quick bar slot
		if type(entry) == "string" then
			return {
				type = "filter",
				filter = {
					name = entry,
					quality = "normal",
					comparator = "=",
				},
			}
		end

		if entry.t == "f" then
			return {
				type = "filter",
				filter = {
					name = entry.n,
					quality = entry.q,
					comparator = entry.c,
				},
			} --[[@as QuickBarSlot]]
		end

		print("Warning: Unsupported serialized quick bar slot type '" .. tostring(entry.t) .. "'")
		return nil
	end

	if v2_0_quick_bar_api then
		-- Return a ItemIDAndQualityIDPair (member of ItemWithQualityID)
		if type(entry) == "string" then
			return {
				name = entry,
				quality = "normal",
			}
		end

		-- entry.t == "f" is only remaining case for 2.0
		return {
			name = entry.n,
			quality = entry.q,
		}
	end

	-- Return a string (member of ItemPrototypeIdentification)
	-- Pre 2.0 this was the only method of encoding used
	return entry --[[@as string]]
end

--- @param player LuaPlayer
--- @return table<string, QuickBarSlotEncoded>?
function serialize.serialize_quick_bar(player)
	local serialized
	local width = v2_1_quick_bar_api and player.quick_bar_width

	for i = 1, 100 do
		local slot

		if v2_1_quick_bar_api then
			local page = math.floor((i - 1) / width) + 1
			local page_slot = ((i - 1) % width) + 1
			slot = player.get_quick_bar_slot(page, page_slot)
		else
			--- @diagnostic disable-next-line: missing-parameter
			slot = player.get_quick_bar_slot(i)
		end

		if slot ~= nil then
			local entry = serialize.serialize_quick_bar_slot(slot)
			if entry ~= nil then
				serialized = serialized or {}
				serialized[tostring(i)] = entry
			end
		end
	end

	return serialized
end

--- @param player LuaPlayer
--- @param serialized table<string, string | QuickBarSlotEncoded>?
function serialize.deserialize_quick_bar(player, serialized)
	if not serialized then
		return
	end

	local width = v2_1_quick_bar_api and player.quick_bar_width
	for i = 1, 100 do
		local entry = serialized[tostring(i)]
		if entry ~= nil then
			local slot = serialize.deserialize_quick_bar_slot(entry)
			if slot ~= nil then
				if v2_1_quick_bar_api then
					local page = math.floor((i - 1) / width) + 1
					local page_slot = ((i - 1) % width) + 1
					player.set_quick_bar_slot(page, page_slot, slot)
				else
					--- @diagnostic disable-next-line: param-type-mismatch
					player.set_quick_bar_slot(i, slot)
				end
			end
		end
	end
end

-- Crafting queue is a table with the following fields:
--  crafting_queue
--  ingredients
function serialize.serialize_crafting_queue(player)
	local crafting_queue = {}

	-- Give player some more inventory space to avoid duplicating items
	player.character_inventory_slots_bonus = player.character_inventory_slots_bonus + 1000

	-- Save current items
	local inventory = player.character.get_main_inventory()
	local old_items = inventory.get_contents()
	local crafting_queue_progress = player.crafting_queue_progress

	-- Cancel old crafts to get the items back
	while player.crafting_queue_size > 0 do
		local old_queue = player.crafting_queue

		-- Cancel craft
		player.cancel_crafting {
			index = 1,
			count = 1,
		}

		local rightmost_right_index = 0 -- 0 indexed since it is subtractive in a 1 indexed language
		local new_queue = player.crafting_queue
		while
			new_queue ~= nil and
			new_queue[#new_queue - rightmost_right_index] ~= nil and
			new_queue[#new_queue - rightmost_right_index].count >= old_queue[#old_queue - rightmost_right_index].count
		do
			rightmost_right_index = rightmost_right_index + 1
		end
		local oldItem = old_queue[#old_queue - rightmost_right_index]
		local newItem = nil
		if new_queue ~= nil then
			newItem = new_queue[#new_queue - rightmost_right_index]
		end

		-- Figure out how many items to add to queue
		local added = oldItem.count
		if newItem ~= nil then
			added = oldItem.count - newItem.count
			if oldItem.recipe ~= newItem.recipe then
				log("ERROR: Old item "..oldItem.recipe.." is not equal "..newItem.recipe)
			end
		end

		-- If the last item we added was of the same type, merge them in the queue
		if #crafting_queue > 0 and crafting_queue[#crafting_queue].recipe == oldItem.recipe then
			crafting_queue[#crafting_queue].count = crafting_queue[#crafting_queue].count + added
		else
			-- If the last item was of a different type, add a new item to the queue
			table.insert(crafting_queue, {
				recipe = oldItem.recipe,
				count = added,
			})
		end
		-- game.print("Saved craft "..oldItem.recipe)
	end

	local difference = {}
	if v2_storage_api then
		-- Find amount of items added and remove from inventory
		local new_items = inventory.get_contents()
		-- Build map of old counts by item name and quality
		local old_counts = {}
		for _, item in ipairs(old_items) do
			local key = item.name .. ":" .. item.quality
			old_counts[key] = (old_counts[key] or 0) + item.count
		end

		-- Compare with new items to find differences
		for _, item in ipairs(new_items) do
			local key = item.name .. ":" .. item.quality
			local old_count = old_counts[key] or 0
			local diff = item.count - old_count

			if diff > 0 then
				-- We don't have to worry about quality because quality can't be handcrafted
				local ingredient = {
					name = item.name,
					count = diff
				}
				inventory.remove(ingredient)
				table.insert(difference, ingredient)
			end
		end
	else
		-- Find amount of items added and remove from inventory
		local new_items = inventory.get_contents()
		for k,v in pairs(new_items) do
			local old_count = old_items[k]
			local diff = v
			if old_count ~= nil then
				diff = diff - old_count
			end
			if diff > 0 then
				local ingredient = {
					name = k,
					count = diff,
				}
				inventory.remove(ingredient)
				table.insert(difference, ingredient)
			end
		end
	end

	-- Remove extra inventory slots
	player.character_inventory_slots_bonus = player.character_inventory_slots_bonus - 1000

	local serialized = {
		crafting_queue = crafting_queue,
		crafting_queue_progress = crafting_queue_progress,
		ingredients = difference,
	}

	-- Restore the crafting queue that was just destructively serialized
	serialize.deserialize_crafting_queue(player, serialized)

	return serialized
end

function serialize.deserialize_crafting_queue(player, serialized)
	local inventory = player.character.get_main_inventory()

	-- Give player some more inventory space to avoid duplicating items
	player.character_inventory_slots_bonus = player.character_inventory_slots_bonus + 1000

	-- Add items to inventory
	for _, item in pairs(serialized.ingredients) do
		inventory.insert(item)
	end

	-- Load crafting queue
	for _, queueItem in pairs(serialized.crafting_queue) do
		-- Start crafting (consume items)
		player.begin_crafting {
			count = queueItem.count,
			recipe = queueItem.recipe,
			-- silent = true, -- Fail silently if items are missing
		}
	end

	-- Remove extra inventory slots
	player.character_inventory_slots_bonus = player.character_inventory_slots_bonus - 1000
	-- Set progress of current craft
	player.crafting_queue_progress = serialized.crafting_queue_progress
end

---@param player LuaPlayer
---@param failed string[]?
---@return string?
function serialize.serialize_crafting_notifications(player, failed)
	-- Get all unlocked recipes
	local recipes = {}
	for _, recipe in pairs(player.force.recipes) do
		if recipe.enabled and not recipe.hidden then
			recipes[recipe.name] = true
		end
	end

	-- Remove those with notifications
	for _, recipe in pairs(player.get_recipe_notifications()) do
		recipes[recipe.name] = nil
	end

	-- Convert to a list of names, including previously failed recipes if any
	local recipe_names = {}
	for _, name in ipairs(failed or {}) do
		recipe_names[#recipe_names + 1] = name
	end
	for name in pairs(recipes) do
		recipe_names[#recipe_names + 1] = name
	end

	return helpers.encode_string(helpers.table_to_json(recipe_names))
end

--- @class CraftingNotificationDelta
--- @field add string[]? Recipes cleared elsewhere that still have a notification here
--- @field remove string[]? Recipes with a notification elsewhere that are cleared here

--- @param player LuaPlayer
--- @param serialized string Encoded delta against the state sent with the download request
--- @return string[]? failed Recipe names that do not exist
function serialize.deserialize_crafting_notifications(player, serialized)
	--- @type CraftingNotificationDelta
	local delta = helpers.json_to_table(assert(helpers.decode_string(serialized)))
	assert(type(delta) == "table", "wrong type decoded from json_to_table")

	-- Recipes which can have a notification on this server
	local enabled = {}
	for _, recipe in pairs(player.force.recipes) do
		if recipe.enabled and not recipe.hidden then
			enabled[recipe.name] = true
		end
	end

	-- Clear notifications the player has cleared elsewhere, this means "add seen notification"
	local failed = {}
	for _, recipe_name in pairs(delta.add or {}) do
		if enabled[recipe_name] then
			player.clear_recipe_notification(recipe_name)
		else
			failed[#failed + 1] = recipe_name -- Recipe does not exist on this server
		end
	end

	-- Add notifications the player has elsewhere, this means "remove seen notification"
	for _, recipe_name in pairs(delta.remove or {}) do
		if enabled[recipe_name] then
			player.add_recipe_notification(recipe_name)
		end
	end

	return next(failed) and failed or nil
end

local controller_to_name = {}
for name, value in pairs(defines.controllers) do
	controller_to_name[value] = name
end

--- @class SerializedPlayerData
--- @field generation number
--- @field name string
--- @field controller string?
--- @field color Color?
--- @field chat_color Color?
--- @field tag string?
--- @field force string?
--- @field cheat_mode boolean?
--- @field flashlight boolean?
--- @field shortcuts table<string, boolean>?
--- @field game_view_settings table<string, boolean>?
--- @field ticks_to_respawn number?
--- @field components SyncComponents Components this was serialized with
--- @field character table<string, any>?
--- @field inventories table<string, table>?
--- @field hotbar table<string, string>?
--- @field quick_bar table<string, QuickBarSlotEncoded>?
--- @field personal_logistic_slots table?
--- @field crafting_queue table?
--- @field recipe_notifications string?

--- @param player LuaPlayer
--- @return table<string, boolean>
function serialize.serialize_shortcuts(player)
	local shortcuts = {}
	for name, prototype in pairs(compat.prototypes.shortcut) do
		if prototype.toggleable then
			shortcuts[name] = player.is_shortcut_toggled(name)
		end
	end
	return shortcuts
end

--- @param player LuaPlayer
--- @param serialized table<string, boolean>
function serialize.deserialize_shortcuts(player, serialized)
	local shortcut_prototypes = compat.prototypes.shortcut
	for name, toggled in pairs(serialized) do
		local prototype = shortcut_prototypes[name]
		if prototype and prototype.toggleable then
			player.set_shortcut_toggled(name, toggled)
		end
	end
end

--- @param player LuaPlayer
--- @return table<string, boolean>
function serialize.serialize_game_view_settings(player)
	local settings = player.game_view_settings
	local serialized = {}
	for _, key in pairs(game_view_settings_keys) do
		serialized[key] = settings[key]
	end
	return serialized
end

--- @param player LuaPlayer
--- @param serialized table<string, boolean>
function serialize.deserialize_game_view_settings(player, serialized)
	local settings = player.game_view_settings
	for _, key in pairs(game_view_settings_keys) do
		if serialized[key] ~= nil then
			settings[key] = serialized[key]
		end
	end
end

--- Components which are synced, nil when all of them are
--- @alias SyncComponents table<string, boolean>?

--- @param components SyncComponents
--- @param name string
--- @return boolean
local function syncs(components, name)
	return components == nil or components[name] == true
end
serialize.syncs = syncs

local component_names = {
	"controller", "force", "appearance", "inventories", "logistics", "quick_bar", "settings", "recipe_notifications",
}

--- True if a component synced in new_components was not synced in old_components
--- @param old_components SyncComponents
--- @param new_components SyncComponents
--- @return boolean
function serialize.newly_synced(old_components, new_components)
	for _, name in ipairs(component_names) do
		if syncs(new_components, name) and not syncs(old_components, name) then
			return true
		end
	end
	return false
end

--- @param player LuaPlayer
--- @param failed_deserialization FailedDeserializationPlayerData
--- @param components SyncComponents
--- @return SerializedPlayerData
function serialize.serialize_player(player, failed_deserialization, components)
	local sync_controller = syncs(components, "controller")
	local sync_inventories = syncs(components, "inventories")
	local sync_logistics = syncs(components, "logistics")

	--- @type SerializedPlayerData
	local serialized = {
		generation = 0, -- Gets replaced later
		name = player.name,
		components = components,
	}

	if sync_controller then
		serialized.controller = controller_to_name[player.controller_type]
		serialized.cheat_mode = player.cheat_mode
		serialized.ticks_to_respawn = player.ticks_to_respawn

		-- In 2.0 we want to sync the physical controller to ignore remote view
		if v2_remote_controller then
			serialized.controller = controller_to_name[player.physical_controller_type]
		end
	end

	if syncs(components, "appearance") then
		serialized.color = player.color
		serialized.chat_color = player.chat_color
		serialized.tag = player.tag
	end

	if syncs(components, "force") then
		serialized.force = player.force.name
	end

	if syncs(components, "settings") then
		serialized.flashlight = player.is_flashlight_enabled()
		serialized.shortcuts = serialize.serialize_shortcuts(player)
		serialized.game_view_settings = serialize.serialize_game_view_settings(player)
	end

	-- For the waiting to respawn state the inventory logistic requests and filters are hidden on the player
	if (sync_inventories or sync_logistics)
		and player.controller_type == defines.controllers.ghost and player.ticks_to_respawn
	then
		local ticks_to_respawn = player.ticks_to_respawn
		player.ticks_to_respawn = nil -- Respawn now

		if sync_logistics then
			serialized.personal_logistic_slots = serialize.serialize_personal_logistic_slots(player)
		end
		if sync_inventories then
			serialized.inventories = serialize.serialize_inventories(player, character_inventories)
		end

		-- Go back to waiting for respawn
		local character = player.character
		player.ticks_to_respawn = ticks_to_respawn
		if character and character.valid then
			character.destroy()
		end
	end

	-- Serialize character
	if player.character then
		if sync_inventories then
			serialized.character = serialize.serialize_character(player.character)
		end
		if sync_logistics then
			serialized.personal_logistic_slots = serialize.serialize_personal_logistic_slots(player)
		end
	end

	-- Serialize non-character inventories
	if sync_inventories and (
		player.controller_type == defines.controllers.god
		or v2_remote_controller and player.physical_controller_type == defines.controllers.god
	) then
		serialized.inventories = serialize.serialize_inventories(player, { main = defines.inventory.god_main })
	end

	-- Serialize quick bar
	if syncs(components, "quick_bar") then
		serialized.quick_bar = serialize.serialize_quick_bar(player)
	end

	-- Serialize crafting queue
	if sync_inventories and player.character then
		serialized.crafting_queue = serialize.serialize_crafting_queue(player)
	end

	-- Serialize recipe notifications
	if recipe_notifications_api and syncs(components, "recipe_notifications") then
		serialized.recipe_notifications = serialize.serialize_crafting_notifications(player, failed_deserialization.recipe_notifications)
	end

	return serialized
end

--- The controller a player has on this instance, restored in place of the synced one when it is not synced
--- @class LocalControllerState
--- @field controller string?
--- @field ticks_to_respawn number?

--- @param player LuaPlayer
--- @return LocalControllerState
function serialize.serialize_local_controller(player)
	local controller_type = v2_remote_controller and player.physical_controller_type or player.controller_type
	return {
		controller = controller_to_name[controller_type],
		ticks_to_respawn = player.ticks_to_respawn,
	}
end

--- Find a surface characters can exist on, used when the player is on a space platform surface
--- @param platform LuaSpacePlatform
--- @return LuaSurface
local function find_planet_surface(platform)
	local location = platform.space_location
	local planet = location and game.planets[location.name]
	if planet and planet.surface then
		return planet.surface
	end
	for _, surface in pairs(game.surfaces) do
		if not surface.platform then
			return surface
		end
	end
	error("No surface found which can hold a character")
end

--- Ensure a player has a character, works from any controller type
--- @param player LuaPlayer
--- @return LuaEntity
local function ensure_character(player)
	-- Do nothing if the player has a valid character
	local character = player.character
	if character and character.valid then
		return character
	end

	-- Exit remote view before switching controllers, this can fail if the player is on a platform
	if v2_exit_remote_view and player.controller_type == defines.controllers.remote then
		player.exit_remote_view()
	end

	-- Switch to god controller if create_character would fail
	if player.controller_type ~= defines.controllers.god then
		player.set_controller{ type = defines.controllers.god }
	end

	-- Characters can not be created on platform surfaces, restore_position will move them back into the hub
	local surface = player.surface
	if v2_space_platform and surface.platform then
		local planet_surface = find_planet_surface(surface.platform)
		local force = player.force --[[@as LuaForce]]
		player.teleport(force.get_spawn_position(planet_surface), planet_surface)
	end

	-- Create and return the character
	if not player.create_character() then
		error(string.format(
			"Failed to create character (controller: %s, physical: %s, surface: %s, connected: %s, driving: %s)",
			controller_to_name[player.controller_type],
			v2_remote_controller and controller_to_name[player.physical_controller_type] or "n/a",
			player.surface.name, tostring(player.connected), tostring(player.driving)
		))
	end
	return assert(player.character)
end

--- @class FailedDeserializationPlayerData
--- @field recipe_notifications string[]?

--- @param player LuaPlayer
--- @param serialized SerializedPlayerData
--- @param components SyncComponents
--- @param local_controller LocalControllerState? Controller to restore when the controller is not synced
--- @return FailedDeserializationPlayerData?, LuaInventory? Items which did not fit, see spill_items
function serialize.deserialize_player(player, serialized, components, local_controller)
	local failed_deserialization = {}
	local sync_controller = syncs(components, "controller")
	local sync_inventories = syncs(components, "inventories")
	local sync_logistics = syncs(components, "logistics")

	-- Stored data from instances which do not sync a component lacks its fields
	local restore_controller = sync_controller and serialized.controller ~= nil

	--- @type LocalControllerState?
	local state = local_controller
	if restore_controller then
		state = { controller = serialized.controller, ticks_to_respawn = serialized.ticks_to_respawn }
	end

	-- Items can come from a character, a god or a ghost and go to whatever controller the player ends up with
	local inventories = serialized.character and serialized.character.inventories or serialized.inventories
	local queue = serialized.crafting_queue
	local spill

	local target_controller = state and defines.controllers[state.controller]
	local to_ghost = state and state.controller == "ghost"
	if state and (
		player.controller_type ~= target_controller
		or to_ghost and (restore_controller or sync_inventories or sync_logistics)
	) then
		if state.controller == "character" then
			-- Create a character but do not destroy an existing one
			ensure_character(player)
			if player.controller_type ~= target_controller then
				player.set_controller{ type = target_controller }
			end

		elseif state.controller == "ghost" then
			-- Ghost state stores hidden logistic and filters which are only accessible in the character controller
			local character = ensure_character(player)
			if sync_logistics and serialized.personal_logistic_slots then
				serialize.deserialize_personal_logistic_slots(player, serialized.personal_logistic_slots)
			end
			if sync_inventories then
				spill = serialize.place_items(
					serialize.item_destinations(player), inventories, queue and queue.ingredients
				)
			end
			if state.ticks_to_respawn then
				player.ticks_to_respawn = state.ticks_to_respawn
			else
				-- We have to set ticks to respawn to save the hidden state into the player but we
				-- can't unset tick_to_respawn by setting it back to nil as that triggers a respawn.
				player.ticks_to_respawn = 0
				player.set_controller{ type = defines.controllers.god }
				player.set_controller{ type = defines.controllers.ghost }
			end
			if character and character.valid then
				character.destroy()
			end

		elseif state.controller ~= "remote" then
			-- All other controllers should not have a character
			local character = player.character
			if character and character.valid then
				character.destroy()
			end
			if player.controller_type ~= target_controller then
				player.set_controller{ type = target_controller }
			end

		else
			error("Remote should not be 'serialized.controller'")
		end
	end

	if syncs(components, "appearance") and serialized.color then
		player.color = serialized.color
		player.chat_color = serialized.chat_color
		player.tag = serialized.tag
	end
	if syncs(components, "force") and serialized.force then
		player.force = serialized.force
	end
	if restore_controller and serialized.cheat_mode ~= nil then
		player.cheat_mode = serialized.cheat_mode
	end
	if syncs(components, "settings") then
		if serialized.flashlight == true then
			player.enable_flashlight()
		elseif serialized.flashlight == false then
			player.disable_flashlight()
		end
		if serialized.shortcuts then
			serialize.deserialize_shortcuts(player, serialized.shortcuts)
		end
		if serialized.game_view_settings then
			serialize.deserialize_game_view_settings(player, serialized.game_view_settings)
		end
	end

	-- Deserialize items, a ghost got them while it had a character above
	local character = player.character
	if sync_inventories and not to_ghost then
		local stats = character and serialized.character
		if stats then
			serialize.deserialize_character(character, stats)
		end
		local craft = character and queue
		spill = serialize.place_items(
			serialize.item_destinations(player), inventories, not craft and queue and queue.ingredients or nil
		)
		if stats then
			serialize.deserialize_character_grid(character, stats)
		end
		if craft then
			serialize.deserialize_crafting_queue(player, queue)
		end
	end
	if character and sync_logistics then
		serialize.deserialize_personal_logistic_slots(player, serialized.personal_logistic_slots)
	end

	-- Deserialize quick bar (named hotbar in old data)
	if syncs(components, "quick_bar") then
		serialize.deserialize_quick_bar(player, serialized.quick_bar or serialized.hotbar)
	end

	-- Deserialize recipe notifications
	if recipe_notifications_api and syncs(components, "recipe_notifications") and serialized.recipe_notifications then
		failed_deserialization.recipe_notifications =
			serialize.deserialize_crafting_notifications(player, serialized.recipe_notifications)
	end

	return next(failed_deserialization) and failed_deserialization or nil, spill
end

return serialize
