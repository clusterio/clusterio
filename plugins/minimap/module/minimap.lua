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

	-- End the old version
	local end_tick = game.tick
	local old_tag_data = create_tag_data(tag, nil, end_tick)
	send_chart_tag_data(old_tag_data)

	-- Create new tag entry
	local start_tick = game.tick
	local tag_data = create_tag_data(tag, start_tick, nil)

	-- Send to plugin
	send_chart_tag_data(tag_data)
end

local function on_chart_tag_removed(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	local tag = event.tag
	if not tag then
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
		local position = event.created_entity.position
		local chunk_x = math.floor(position.x / 32)
		local chunk_y = math.floor(position.y / 32)

		queue_chunk_for_update({x = chunk_x, y = chunk_y})
	end
end

local function on_entity_removed(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	if event.entity and event.entity.position then
		local position = event.entity.position
		local chunk_x = math.floor(position.x / 32)
		local chunk_y = math.floor(position.y / 32)

		queue_chunk_for_update({x = chunk_x, y = chunk_y})
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

-- Initialize the module
local function init()
	if not storage.minimap then
		storage.minimap = {
			enabled = true,
			chunk_update_queue = {}
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

return minimap
