local clusterio_api = require("modules/clusterio/api")

minimap = {}

local function dump_mapview(position_a, position_b)
	-- Only process on the server
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	local tiles = game.surfaces[1].find_tiles_filtered{area = {position_a, position_b}}
	local map_data = {}
	local CHUNK_SIZE = position_b[1] - position_a[1]
	
	-- Fill map_data with black squares initially
	for x = 1, CHUNK_SIZE * CHUNK_SIZE do
		map_data[x] = string.format("%02x%02x%02x", 0, 0, 0)
	end
	
	-- Process each tile
	for _, tile in pairs(tiles) do
		local map_color = tile.prototype.map_color
		local position = tile.position
		local index = (position.x - position_a[1] + 1) + (position.y - position_a[2]) * CHUNK_SIZE
		if index >= 1 and index <= #map_data then
			map_data[index] = string.format("%02x%02x%02x", map_color.r, map_color.g, map_color.b)
		end
	end

	-- Send tile data to the plugin
	clusterio_api.send_json("minimap:tile_data", {
		type = "tiles",
		position = position_a,
		size = CHUNK_SIZE,
		data = table.concat(map_data, ";"),
		layer = "tiles_"
	})
end

local function dump_entities(entities)
	-- Only process on the server
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	local ignored_entities = {
		["character"] = true,
		["character-corpse"] = true,
		["highlight-box"] = true,
		["item-request-proxy"] = true,
		["tile-ghost"] = true,
	}

	local map_data = {}
	
	for _, entity in pairs(entities) do
		if entity and entity.valid and not ignored_entities[entity.type] then
			local position = entity.position
			local map_color = entity.prototype.friendly_map_color or 
			                 entity.prototype.map_color or 
			                 entity.prototype.enemy_map_color or 
			                 {r = 255, g = 255, b = 255, a = 255}
			
			-- Determine entity size for drawing
			local size_x = math.max(1, math.ceil(math.abs(entity.bounding_box.right_bottom.x - entity.bounding_box.left_top.x)))
			local size_y = math.max(1, math.ceil(math.abs(entity.bounding_box.right_bottom.y - entity.bounding_box.left_top.y)))
			
			-- Add pixels for entity
			for x = 0, size_x - 1 do
				for y = 0, size_y - 1 do
					local pixel_x = position.x + x - (size_x - 1) / 2
					local pixel_y = position.y + y - (size_y - 1) / 2
					
					table.insert(map_data, pixel_x)
					table.insert(map_data, pixel_y)
					
					if entity.type == "entity-ghost" then
						-- Render ghosts as transparent purple
						table.insert(map_data, string.format("%02x%02x%02x%02x", 168, 0, 168, 127))
					else
						table.insert(map_data, string.format("%02x%02x%02x%02x", 
							map_color.r or 255, 
							map_color.g or 255, 
							map_color.b or 255, 
							map_color.a or 255))
					end
				end
			end
		end
	end

	if #map_data > 0 then
		-- Send entity data to the plugin
		clusterio_api.send_json("minimap:tile_data", {
			type = "pixels",
			data = table.concat(map_data, ";"),
			layer = ""
		})
	end
end

local function on_chunk_generated(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- Process new entities in the generated chunk
	local entities = event.surface.find_entities_filtered({area = event.area})
	if #entities > 0 then
		dump_entities(entities)
	end

	-- Process tiles in the generated chunk
	local left_top = event.area.left_top
	local right_bottom = event.area.right_bottom
	dump_mapview({left_top.x, left_top.y}, {right_bottom.x, right_bottom.y})
end

local function on_entity_built(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	if event.created_entity and event.created_entity.valid then
		dump_entities({event.created_entity})
	end
end

local function on_entity_removed(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- For removed entities, we send a transparent pixel to "erase" them
	if event.entity and event.entity.position then
		local position = event.entity.position
		local map_data = {
			position.x, position.y, "00000000" -- Transparent pixel
		}
		
		clusterio_api.send_json("minimap:tile_data", {
			type = "pixels",
			data = table.concat(map_data, ";"),
			layer = ""
		})
	end
end

local function on_tile_changed(event)
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- Process changed tiles
	local tiles = {}
	for _, tile in pairs(event.tiles) do
		table.insert(tiles, tile.position)
	end
	
	if #tiles > 0 then
		local map_data = {}
		for _, position in pairs(tiles) do
			local tile = game.surfaces[1].get_tile(position)
			local map_color = tile.prototype.map_color
			table.insert(map_data, position.x)
			table.insert(map_data, position.y)
			table.insert(map_data, string.format("%02x%02x%02x%02x", 
				map_color.r, map_color.g, map_color.b, 255))
		end
		
		clusterio_api.send_json("minimap:tile_data", {
			type = "pixels",
			data = table.concat(map_data, ";"),
			layer = "tiles_"
		})
	end
end

local function on_nth_tick_update()
	if not storage.minimap or not storage.minimap.enabled then
		return
	end

	-- Periodic update of entities (every ~5 seconds)
	storage.minimap.update_timer = (storage.minimap.update_timer or 0) + 1
	if storage.minimap.update_timer >= 300 then -- 5 seconds at 60 UPS
		storage.minimap.update_timer = 0
		
		-- Find all entities in a reasonable area around spawn
		local entities = game.surfaces[1].find_entities_filtered({
			area = {{-512, -512}, {512, 512}}
		})
		
		if #entities > 0 then
			dump_entities(entities)
		end
	end
end

-- Initialize the module
local function init()
	if not storage.minimap then
		storage.minimap = {
			enabled = true,
			update_timer = 0
		}
	end
end

-- Export functions
minimap.dump_mapview = dump_mapview
minimap.dump_entities = dump_entities
minimap.init = init

-- Event handlers
script.on_event(defines.events.on_chunk_generated, on_chunk_generated)
script.on_event(defines.events.on_built_entity, on_entity_built)
script.on_event(defines.events.on_robot_built_entity, on_entity_built)
script.on_event(defines.events.on_entity_died, on_entity_removed)
script.on_event(defines.events.on_player_mined_entity, on_entity_removed)
script.on_event(defines.events.on_robot_mined_entity, on_entity_removed)
script.on_event(defines.events.on_player_built_tile, on_tile_changed)
script.on_event(defines.events.on_robot_built_tile, on_tile_changed)
script.on_event(defines.events.on_player_mined_tile, on_tile_changed)
script.on_event(defines.events.on_robot_mined_tile, on_tile_changed)
script.on_event(defines.events.script_raised_set_tiles, on_tile_changed)

-- Periodic updates
script.on_nth_tick(60, on_nth_tick_update) -- Every second

-- Initialize on load
minimap.events = {}
minimap.events[clusterio_api.events.on_server_startup] = init

return minimap
