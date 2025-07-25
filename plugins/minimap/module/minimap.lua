local clusterio_api = require("modules/clusterio/api")

minimap = {}

-- Convert RGB565 to RGB888 values
local function rgb565_to_rgb888(rgb565_value)
	local r = math.floor(bit32.rshift(rgb565_value, 11) * 255 / 31)
	local g = math.floor(bit32.rshift(bit32.band(rgb565_value, 0x07E0), 5) * 255 / 63)
	local b = math.floor(bit32.band(rgb565_value, 0x001F) * 255 / 31)
	return r, g, b
end

-- Queue a chunk for update
local function queue_chunk_for_update(chunk_position)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- If the chunk isn't already in the queue, add it
	for _, queued_chunk in pairs(storage.minimap.chunk_update_queue) do
		if queued_chunk.x == chunk_position.x and queued_chunk.y == chunk_position.y then
			return
		end
	end

	table.insert(storage.minimap.chunk_update_queue, chunk_position)
end

-- Send chart tag data to plugin
local function send_chart_tag_data(tag_data)
	clusterio_api.send_json("minimap:chart_tag_data", tag_data)
end

-- Send recipe data to plugin
local function send_recipe_data(recipe_data)
	clusterio_api.send_json("minimap:recipe_data", recipe_data)
end

-- Send player position data to plugin
local function send_player_position_data(player_data)
	clusterio_api.send_json("minimap:player_position", player_data)
end

-- Check if a position has moved significantly (≥1 tile)
local function has_moved_significantly(old_pos, new_pos)
	if not old_pos then
		return true
	end
	local dx = math.abs(new_pos.x - old_pos.x)
	local dy = math.abs(new_pos.y - old_pos.y)
	return dx >= 1 or dy >= 1
end

-- Process and send player position updates
local function process_player_positions()
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	for _, player in pairs(game.connected_players) do
		if player.valid and player.character and player.character.valid then
			local surface = player.character.surface
			local position = player.character.position
			local player_key = player.index

			-- Initialize player tracking data if needed
			if not storage.minimap.player_positions then
				storage.minimap.player_positions = {}
			end

			local last_position = storage.minimap.player_positions[player_key]
			local current_sec = math.floor(game.tick / 60)

			-- Check if position changed significantly or timeout elapsed
			local should_update = false
			if has_moved_significantly(last_position and last_position.position or nil, position) then
				should_update = true
			elseif last_position and (current_sec - last_position.last_update_sec) >= 5 then
				-- Send update every 5 seconds even if not moving (for timeout)
				should_update = true
			elseif not last_position then
				-- First position for this player
				should_update = true
			end

			if should_update then
				local player_data = {
					player_name = player.name,
					surface = surface.name,
					x = position.x,
					y = position.y,
					sec = current_sec,
				}

				send_player_position_data(player_data)

				-- Update tracking data
				storage.minimap.player_positions[player_key] = {
					position = { x = position.x, y = position.y },
					last_update_sec = current_sec,
				}
			end
		end
	end
end

-- Handle player session start
local function on_player_joined_game(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	local player = game.get_player(event.player_index)
	if not player or not player.valid then
		return
	end

	-- Clear any existing position data for this player to ensure fresh tracking
	if storage.minimap.player_positions then
		storage.minimap.player_positions[player.index] = nil
	end

	-- The next position update will be sent when the player moves or in process_player_positions
end

-- Handle player session end
local function on_player_left_game(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- Clean up position tracking data
	if storage.minimap.player_positions then
		storage.minimap.player_positions[event.player_index] = nil
	end
end

-- Helper for creating and sending recipe start/stop events
local function update_entity_recipe(entity)
	if not entity or not entity.valid then
		return
	end

	-- Ensure storage.minimap exists
	if not storage.minimap then
		storage.minimap = { enabled = true, chunk_update_queue = {}, recipe_cache = {} }
	end

	if not storage.minimap.recipe_cache then
		storage.minimap.recipe_cache = {}
	end

	-- Only consider entities that can have recipes
	local recipe = nil
	if entity.type == "assembling-machine" then
		local rec_obj = entity.get_recipe()
		if rec_obj then
			recipe = rec_obj.name
		end
	elseif entity.type == "furnace" then
		-- Furnaces often idle with get_recipe() = nil; fall back to previous_recipe
		local prev = entity.previous_recipe
		if prev and prev.name then
			recipe = prev.name.name -- Recipe prototype name
		end
	end

	local cache = storage.minimap.recipe_cache
	if not cache then
		cache = {}
		storage.minimap.recipe_cache = cache
	end
	local unit_number = entity.unit_number
	if not unit_number then
		return -- Cannot track entities without persistent ID
	end

	local previous = cache[unit_number]
	if previous and previous.recipe_name == recipe then
		return -- No change
	end

	local position = entity.position
	local data_common = {
		position = { position.x, position.y },
		surface = entity.surface.name,
		force = entity.force.name,
	}

	-- Close previous recipe if it existed
	if previous and previous.recipe_name then
		local end_data = {
			position = data_common.position,
			surface = data_common.surface,
			force = data_common.force,
			start_tick = nil,
			end_tick = game.tick,
			recipe = nil,
		}
		send_recipe_data(end_data)
	end

	-- Open new recipe interval if recipe now set
	if recipe then
		local icon_signal = nil
		local recipe_proto = prototypes.recipe[recipe]
		if recipe_proto and recipe_proto.main_product then
			icon_signal = { type = recipe_proto.main_product.type, name = recipe_proto.main_product.name }
		end
		local start_data = {
			position = data_common.position,
			surface = data_common.surface,
			force = data_common.force,
			start_tick = game.tick,
			end_tick = nil,
			recipe = recipe,
			icon = icon_signal,
		}
		send_recipe_data(start_data)
		cache[unit_number] = { recipe_name = recipe }
	else
		-- Recipe cleared
		cache[unit_number] = nil
	end
end

-- Create tag data structure
local function create_tag_data(tag, start_tick, end_tick)
	return {
		tag_number = tag.tag_number,
		start_tick = start_tick,
		end_tick = end_tick,
		force = tag.force.name,
		surface = tag.surface.name,
		position = {tag.position.x, tag.position.y},
		text = tag.text,
		icon = tag.icon or nil,
		last_user = tag.last_user and tag.last_user.name or nil
	}
end

local function dump_chunk_chart(chunk_position)
	local data = {}
	local surfaces = game.surfaces
	local forces = game.forces
	for _, force in pairs(forces) do
		for _, surface in pairs(surfaces) do
			local chart_data = force.get_chunk_chart(surface, chunk_position)
			if chart_data then
				-- Use Factorio's built-in deflate compression and base64 encoding
				local encoded_data = helpers.encode_string(chart_data)
				table.insert(data, {surface = surface.name, force = force.name, chart_data = encoded_data})
			end
		end
	end

	-- Calculate world position from chunk position
	local world_x = chunk_position.x * 32
	local world_y = chunk_position.y * 32

	-- Send tile data to the plugin
	clusterio_api.send_json("minimap:tile_data", {
		type = "chart",
		position = {world_x, world_y},
		tick = game.tick,
		data = data,
	})
end

-- Chart tag event handlers
local function on_chart_tag_added(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	local tag = event.tag
	if not tag or not tag.valid then
		return
	end

	local start_tick = game.tick
	local tag_data = create_tag_data(tag, start_tick, nil)

	-- Send to plugin
	send_chart_tag_data(tag_data)
end

local function on_chart_tag_modified(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	local tag = event.tag
	if not tag or not tag.valid then
		return
	end

	-- End the old version at current tick
	local end_tick = game.tick
	local old_tag_data = create_tag_data(tag, nil, end_tick)
	send_chart_tag_data(old_tag_data)

	-- Create new tag entry starting at next tick
	local start_tick = game.tick + 1
	local tag_data = create_tag_data(tag, start_tick, nil)

	-- Send to plugin
	send_chart_tag_data(tag_data)
end

local function on_chart_tag_removed(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	local tag = event.tag
	if not tag or not tag.valid then
		return
	end

	-- End the tag
	local end_tick = game.tick
	local tag_data = create_tag_data(tag, nil, end_tick)
	send_chart_tag_data(tag_data)
end

-- Event handlers
local function on_chunk_charted(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- Convert area to chunk position
	local chunk_x = math.floor(event.area.left_top.x / 32)
	local chunk_y = math.floor(event.area.left_top.y / 32)

	queue_chunk_for_update({x = chunk_x, y = chunk_y})
end

local function on_entity_built(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	if event.created_entity and event.created_entity.valid then
		local entity = event.created_entity
		local position = entity.position
		local chunk_x = math.floor(position.x / 32)
		local chunk_y = math.floor(position.y / 32)

		queue_chunk_for_update({x = chunk_x, y = chunk_y})
		-- Track recipe for newly built crafting entities
		update_entity_recipe(entity)
	end
end

local function on_entity_removed(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	if event.entity and event.entity.position then
		local entity = event.entity
		local position = entity.position
		local chunk_x = math.floor(position.x / 32)
		local chunk_y = math.floor(position.y / 32)

		queue_chunk_for_update({x = chunk_x, y = chunk_y})
		-- End recipe interval for removed entity
		update_entity_recipe(entity)
	end
end

local function on_tile_changed(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- Get unique chunks that were affected
	local affected_chunks = {}
	for _, tile in pairs(event.tiles) do
		local chunk_x = math.floor(tile.position.x / 32)
		local chunk_y = math.floor(tile.position.y / 32)
		local chunk_key = chunk_x .. "," .. chunk_y

		if not affected_chunks[chunk_key] then
			affected_chunks[chunk_key] = {x = chunk_x, y = chunk_y}
		end
	end

	-- Update each affected chunk
	for _, chunk_pos in pairs(affected_chunks) do
		queue_chunk_for_update(chunk_pos)
	end
end

-- Handle recipe change via settings paste
local function on_entity_settings_pasted(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end
	if event.destination and event.destination.valid then
		update_entity_recipe(event.destination)
	end
end

local function on_gui_closed(event)
    if not storage.minimap or not storage.minimap.enabled then
        return
    end

    -- We're only interested in entity GUIs
    if event.gui_type ~= defines.gui_type.entity then
        return
    end

    local entity = event.entity
    if entity and entity.valid and (entity.type == "assembling-machine" or entity.type == "furnace") then
        update_entity_recipe(entity)
    end
end

-- Initialize the module
local function init()
	if not storage.minimap then
		storage.minimap = {
			enabled = true,
			chunk_update_queue = {},
			recipe_cache = {},
			player_positions = {}
		}
	end

	if not storage.minimap.enabled then
		return
	end

	-- Remove previous queue
	storage.minimap.chunk_update_queue = {}

	-- Queue all existing charted chunks for update
	local chunks_queued = 0

	for _, force in pairs(game.forces) do
		for _, surface in pairs(game.surfaces) do
			-- Iterate through all generated chunks on this surface
			for chunk in surface.get_chunks() do
				local chunk_position = {x = chunk.x, y = chunk.y}

				-- Check if this chunk is charted for this force
				if force.is_chunk_charted(surface, chunk_position) then
					table.insert(storage.minimap.chunk_update_queue, chunk_position)
					chunks_queued = chunks_queued + 1
				end
			end

			-- Initialize existing chart tags
			local existing_tags = force.find_chart_tags(surface)
			for _, tag in pairs(existing_tags) do
				local start_tick = game.tick
				local tag_data = create_tag_data(tag, start_tick, nil)

				-- Send to plugin
				send_chart_tag_data(tag_data)
			end

			-- Initialize existing crafting recipes on this surface and force
			local crafting_entities = surface.find_entities_filtered{
				type = {
					"assembling-machine",
					"furnace",
				}
			}
			for _, entity in pairs(crafting_entities) do
				if entity.valid and entity.force == force then
					local recipe
					if entity.type == "assembling-machine" then
						recipe = entity.get_recipe()
					elseif entity.type == "furnace" then
						local prev = entity.previous_recipe
						if prev and prev.name then
							recipe = { name = prev.name.name }
						end
					end
					if recipe then
						local data = {
							position = { entity.position.x, entity.position.y },
							surface = surface.name,
							force = force.name,
							start_tick = game.tick,
							end_tick = nil,
							recipe = recipe.name,
							icon = (function()
								local rp = prototypes.recipe[recipe.name]
								if rp and rp.main_product then
									return { type = rp.main_product.type, name = rp.main_product.name }
								end
								return nil
							end)()
						}
						send_recipe_data(data)

						-- Cache for tracking
						storage.minimap.recipe_cache[entity.unit_number] = { recipe_name = recipe.name }
					end
				end
			end
		end
	end
end

local function on_tick(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- Process the chunk update queue
	if #storage.minimap.chunk_update_queue > 0 then
		local chunk_position = table.remove(storage.minimap.chunk_update_queue, 1)
		dump_chunk_chart(chunk_position)
	end

	-- Process player position updates every 250ms (15 ticks at 60 UPS)
	if game.tick % 15 == 0 then
		process_player_positions()
	end
end

-- Export functions
minimap.dump_chunk_chart = dump_chunk_chart

minimap.events = {}
minimap.events[clusterio_api.events.on_server_startup] = init
minimap.events[defines.events.on_tick] = on_tick
minimap.events[defines.events.on_chunk_charted] = on_chunk_charted
minimap.events[defines.events.on_built_entity] = on_entity_built
minimap.events[defines.events.on_robot_built_entity] = on_entity_built
minimap.events[defines.events.on_entity_died] = on_entity_removed
minimap.events[defines.events.on_player_mined_entity] = on_entity_removed
minimap.events[defines.events.on_robot_mined_entity] = on_entity_removed
minimap.events[defines.events.on_player_built_tile] = on_tile_changed
minimap.events[defines.events.on_robot_built_tile] = on_tile_changed
minimap.events[defines.events.on_player_mined_tile] = on_tile_changed
minimap.events[defines.events.on_robot_mined_tile] = on_tile_changed
minimap.events[defines.events.script_raised_set_tiles] = on_tile_changed
minimap.events[defines.events.on_chart_tag_added] = on_chart_tag_added
minimap.events[defines.events.on_chart_tag_modified] = on_chart_tag_modified
minimap.events[defines.events.on_chart_tag_removed] = on_chart_tag_removed
minimap.events[defines.events.on_entity_settings_pasted] = on_entity_settings_pasted
minimap.events[defines.events.on_gui_closed] = on_gui_closed
minimap.events[defines.events.on_player_joined_game] = on_player_joined_game
minimap.events[defines.events.on_player_left_game] = on_player_left_game

return minimap
