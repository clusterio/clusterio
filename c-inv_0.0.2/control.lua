script.on_init(function()
	if global.timer == nil then
		global.timer = 0
	end
	if global.guitimer == nil then
		global.guitimer = 0
	end
	global.spentItems = {}
	global.items = {}
	global.items["iron-plate"] = 100
end)
-- GUI functions
--[[
/c game.player.gui.left.clusterio.destroy()
game.player.gui.left.add{type="frame", name="clusterio", caption="Clusterio"}
game.player.gui.left.clusterio.add{type="label", name="clusterioInputLabel", caption="Iron plates: "}
game.player.gui.left.clusterio.add{type="textfield", name="clusterioInput"}
game.player.gui.left.clusterio.add{type="button", name="clusterioButtonSave", caption="Save"}
game.player.gui.left.clusterio.style.maximal_height=10
]]--
global.items = {}
-- request items
script.on_event(defines.events.on_tick, function(event)
	if global.guitimer > 1800 then
		global.guitimer = 0
		-- request spentItems * 2 - items left
		for k, v in pairs(spentItems) do
			_print(k, v, " | ", (v * 2) - items[k])
			game.write_file("order.txt", k .. " " .. (v * 2) - items[k] .. "\n", true)
			global.spentItems[k] = 0
		end
		
	else
		global.guitimer = global.guitimer + 1
	end
end)
remote.add_interface("clusterio", {
	hello = function() game.player.print("Hi!") end,
	import = function(name, value)
		_print(name)
		_print(value)
		if(type(name) == "string" and type(tonumber(value)) == "number") then
			if(global.items == nil) then global.items = {} end
			global.items[name] = tonumber(value);
		end
	end
})
script.on_load(function()
	if global.timer == nil then
		global.timer = 0
	end
	if global.guitimer == nil then
		global.guitimer = 0
	end
	if global.spentItems == nil then
		global.spentItems = {}
	end
	global.items = {}
end)
script.on_event(defines.events.on_tick, function(event)
	if global.timer > 9 then
		global.timer = 0
		voidChests()
	else
		global.timer = global.timer + 1
	end
end)
script.on_event(defines.events.on_built_entity, function(event)
	if event.created_entity.name == "c-inv_voidChest" then
		if global.voidChests == nil then global.voidChests = {} end
		table.insert(global.voidChests, event.created_entity)
	end
end)

function voidChests()
	if global.voidChests ~= nil then
		for i = 1, #global.voidChests do
			if global.voidChests[i].valid then
				local chest = global.voidChests[i].get_inventory(1)
				if global.voidChests[i].get_inventory(defines.inventory.chest).get_contents() ~= nil then
					for k,v in pairs(global.voidChests[i].get_inventory(defines.inventory.chest).get_contents()) do
						-- WTF, string conectation in lua is done with .. instead of +?
						game.write_file("output.txt", k .. " " .. v .. "\n", true)
					end
				end
				global.voidChests[i].clear_items_inside()
			else
				table.remove(global.voidChests, i)
				break
			end
		end
	end
end

-- spawn belts

local belts
local spawn_item = "iron-ore"
local chest_detection_rate = 50


remote.add_interface("spawnbelt", {
  setitem = function(item)
	global.spawn_item = item;
	spawn_item = global.spawn_item;
  end
})

script.on_load(function(event)
  if global.belts ~= nil then
	belts = global.belts;
	script.on_event(defines.events.on_tick, tick_belts);
  end
  if global.spawn_item ~= nil then
	spawn_item = global.spawn_item;
  end
end)

script.on_event(defines.events.on_built_entity, function(event)
  if event.created_entity.name == "spawn-belt" 
  or event.created_entity.name == "void-belt" then
	initalize_globals();
	new_belt = {};
	new_belt["entity"] = event.created_entity;
	new_belt["item"] = spawn_item;
	new_belt["chest"] = nil;
	table.insert(belts, new_belt)
  end
end)

function _print(...)
  local args = { n = select("#", ...); ... };
  local string = "";
  for i, player in pairs(game.players) do
	for i = 1, args.n do
		string = string .. serpent.block(args[i]) .. "\t";
	end
	player.print(string);
  end
end


function initalize_globals()
  if global.belts == nil then
	global.belts = {};
	global.pumps = {};
	belts = global.belts;
	pumps = global.pumps;
	script.on_event(defines.events.on_tick, tick_belts)
  end
end

function destroy_globals()
  if #global.belts == 0 then
	belts = nil;
	pumps = nil;
	global.pumps = nil;
	global.pumps = nil;
	script.on_event(defines.events.on_tick, nil);
  end
end

function tick_belts(tick)
  for k, belt in ipairs(belts) do
	if belt.entity.valid ~= true then
	  table.remove(belts, k)
	  destroy_globals();
	else
	  if belt.entity.name == "spawn-belt" then
		
		-- On a lower interval rate, look for chests behind the belt to copy item type
		if tick.tick % chest_detection_rate == 0 then
		  x = belt.entity.position.x;
		  y = belt.entity.position.y;
		  if belt.entity.direction == 0 then
			y = y + 1;
		  elseif belt.entity.direction == 2 then
			x = x - 1;
		  elseif belt.entity.direction == 4 then
			y = y - 1;
		  elseif belt.entity.direction == 6 then
			x = x + 1;
		  end

		  chests = belt.entity.surface.find_entities_filtered({area = {{x,y},{x,y}}, type="container"});
		  if #chests > 0 then
			inventory = chests[1].get_inventory(defines.inventory.chest);
			if inventory ~= nil
			and inventory.valid == true 
			and inventory.is_empty() == false 
			and inventory[1].valid == true
			and inventory[1].valid_for_read == true then
				belt.item = inventory[1].name;
			end
		  end
		end
		
		-- Fill the belt with selected item
		line1 = belt.entity.get_transport_line(1);
		if line1.can_insert_at_back() then
			if(global.items ~= nil and global.spentItems ~= nil) then
				if(global.items[belt.item] ~= nil and global.spentItems[belt.item] ~= nil) then
					if(global.items[belt.item] > 1) then
						global.items[belt.item] = global.items[belt.item] - 1;
						global.spentItems[belt.item] = global.spentItems[belt.item] + 1;
						line1.insert_at_back({name = belt.item});
					end
				else
					global.items[belt.item] = 0
					global.spentItems[belt.item] = 0
				end
			end
		end
		line2 = belt.entity.get_transport_line(2);
		if line2.can_insert_at_back() then
			if(global.items ~= nil) then
				if(global.items[belt.item] ~= nil) then
					if(global.items[belt.item] > 1) then
						global.items[belt.item] = global.items[belt.item] - 1;
						global.spentItems[belt.item] = global.spentItems[belt.item] + 1;
						line2.insert_at_back({name = belt.item});
					end
				else
					global.items[belt.item] = 0
				end
			end
		end

		elseif belt.entity.name == "void-belt" then
			belt.entity.get_transport_line(1).clear();
			belt.entity.get_transport_line(2).clear();
		end
	end
  end
end

