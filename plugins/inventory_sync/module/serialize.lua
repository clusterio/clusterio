local compat = require("modules/clusterio/compat")
local clusterio_serialize = require("modules/clusterio/serialize")
local character_inventories = require("modules/inventory_sync/define_player_inventories")
local character_stat_keys = require("modules/inventory_sync/define_player_stat_keys")
local serialize = {}

local v2_logistic_api = compat.version_ge("2.0.0")
local v2_storage_api = compat.version_ge("2.0.0")

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

function serialize.deserialize_inventories(destination, serialized, inventories)
	for name, index in pairs(inventories) do
		local inventory = destination.get_inventory(index)
		if inventory ~= nil and serialized[name] ~= nil then
			inventory.clear()
			clusterio_serialize.deserialize_inventory(inventory, serialized[name])
		end
	end
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
--   inventories: table of character inventory name to inventory content
function serialize.serialize_character(character)
	local serialized = { }

	-- Serialize character stats
	for _, key in pairs(character_stat_keys) do
		serialized[key] = character[key]
	end

	-- Serialize character inventories
	serialized.inventories = serialize.serialize_inventories(character, character_inventories)

	return serialized
end

function serialize.deserialize_character(character, serialized)
	-- Deserialize character stats
	for _, key in pairs(character_stat_keys) do
		character[key] = serialized[key]
	end

	-- Deserialize character inventories
	serialize.deserialize_inventories(character, serialized.inventories, character_inventories)
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

-- Crafting queue is a table with the following fields:
--  crafting_queue
--  ingredients
function serialize.serialize_crafting_queue(player)
	local crafting_queue = {}

	-- Give player some more inventory space to avoid duplicating items
	player.character_inventory_slots_bonus = player.character_inventory_slots_bonus + 1000

	-- Save current items
	local inventory = player.get_main_inventory()
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
	local inventory = player.get_main_inventory()

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

local controller_to_name = {}
for name, value in pairs(defines.controllers) do
	controller_to_name[value] = name
end

-- Players are serialized into a table with the following fields:
--   name
--   controller: may not be cutscene or editor
--   color
--   chat_color
--   tag
--   force
--   cheat_mod
--   flashlight
--   ticks_to_respawn (optional)
--   character (optional)
--   inventories: non-character inventories
--   hotbar: table of string indexes to names (optional)
--   personal_logistic_slots (optional)
--   crafting_queue (optional)
function serialize.serialize_player(player)
	local serialized = {
		controller = controller_to_name[player.controller_type],
		name = player.name,
		color = player.color,
		chat_color = player.chat_color,
		tag = player.tag,
		force = player.force.name,
		cheat_mode = player.cheat_mode,
		flashlight = player.is_flashlight_enabled(),
		ticks_to_respawn = player.ticks_to_respawn,
	}

	-- For the waiting to respawn state the inventory logistic requests and filters are hidden on the player
	if player.controller_type == defines.controllers.ghost and player.ticks_to_respawn then
		player.ticks_to_respawn = nil -- Respawn now

		serialized.personal_logistic_slots = serialize.serialize_personal_logistic_slots(player)
		serialized.inventories = serialize.serialize_inventories(player, character_inventories)

		-- Go back to waiting for respawn
		local character = player.character
		player.ticks_to_respawn = serialized.ticks_to_respawn
		character.destroy()
	end

	-- Serialize character
	if player.character then
		serialized.character = serialize.serialize_character(player.character)
		serialized.personal_logistic_slots = serialize.serialize_personal_logistic_slots(player)
	end

	-- Serialize non-character inventories
	if player.controller_type == defines.controllers.god then
		serialized.inventories = serialize.serialize_inventories(player, { main = defines.inventory.god_main })
	end

	-- Serialize hotbar
	for i = 1, 100 do
		local slot = player.get_quick_bar_slot(i)
		if slot ~= nil and slot.name ~= nil then
			if not serialized.hotbar then
				serialized.hotbar = {}
			end
			serialized.hotbar[tostring(i)] = slot.name
		end
	end

	-- Serialize crafting queue
	if player.character then
		serialized.crafting_queue = serialize.serialize_crafting_queue(player)
	end

	return serialized
end

function serialize.deserialize_player(player, serialized)
	if player.controller_type ~= defines.controllers[serialized.controller] or serialized.controller == "ghost" then
		-- If targeting the character or ghost controller then create a character
		if serialized.controller == "character" or serialized.controller == "ghost" then
			if player.controller_type == defines.controllers.ghost or player.controller_type == defines.controllers.spectator then
				player.set_controller({ type = defines.controllers.god })
			end
			if player.controller_type == defines.controllers.god then
				player.create_character()
			end

			-- The ghost state stores hidden logistic and filters which are only accessible in the character controller
			if serialized.controller == "ghost" then
				serialize.deserialize_personal_logistic_slots(player, serialized.personal_logistic_slots)
				serialize.deserialize_inventories(player, serialized.inventories, character_inventories)
				local character = player.character
				if serialized.ticks_to_respawn then
					player.ticks_to_respawn = serialized.ticks_to_respawn
				else
					-- We have to set ticks to respawn to save the hidden state into the player but we
					-- can't unset tick_to_respawn by setting it back to nil as that triggers a respawn.
					player.ticks_to_respawn = 0
					player.set_controller({ type = defines.controllers.god })
					player.set_controller({ type = defines.controllers.ghost })
				end
				character.destroy()
			end

		else
			-- Targeting the god or spectator controller, if coming from the
			-- character controller then destroy the character
			if player.controller_type == defines.controllers.character then
				player.character.destroy()
			end

			-- Switching to god or spectator is a matter of setting the controller
			if player.controller_type ~= defines.controllers[serialized.controller] then
				player.set_controller({ type = defines.controllers[serialized.controller] })
			end
		end
	end

	player.color = serialized.color
	player.chat_color = serialized.chat_color
	player.tag = serialized.tag
	player.force = serialized.force
	player.cheat_mode = serialized.cheat_mode
	if serialized.flashlight then
		player.enable_flashlight()
	else
		player.disable_flashlight()
	end

	-- Deserialize character
	if player.character then
		serialize.deserialize_character(player.character, serialized.character)
		serialize.deserialize_personal_logistic_slots(player, serialized.personal_logistic_slots)
	end

	-- Deserialize non-character inventories
	if player.controller_type == defines.controllers.god then
		serialize.deserialize_inventories(player, serialized.inventories, { main = defines.inventory.god_main })
	end

	-- Deserialize hotbar
	if serialized.hotbar then
		for i = 1, 100 do
			if serialized.hotbar[tostring(i)] ~= nil then
				player.set_quick_bar_slot(i, serialized.hotbar[tostring(i)])
			end
		end
	end

	-- Deserialize crafting queue
	if player.character and serialized.crafting_queue then
		serialize.deserialize_crafting_queue(player, serialized.crafting_queue)
	end

end

return serialize
