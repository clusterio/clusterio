require("config")

function HashPosition(position)
	return 40000 * (position.y) + position.x
end

function OnBuiltEntity(event)
	local entity = event.created_entity
	--only add entities that are not ghosts
	if entity.type ~= "entity-ghost" then
		if entity.name == INPUT_CHEST_NAME then
			--if the table hasn't been initialized then do it
			global.inputChests = global.inputChests or {}
			--add the chests to a lists if these chests so they can be interated over
			global.inputChests[HashPosition(entity.position)] = entity
		elseif entity.name == OUTPUT_CHEST_NAME then
			--if the table hasn't been initialized then do it
			global.outputChests = global.outputChests or {}
			--add the chests to a lists if these chests so they can be interated over
			global.outputChests[HashPosition(entity.position)] = entity
		end
	end
end

function OnKilledEntity(event)
	local entity = event.entity
	if entity.type ~= "entity-ghost" then	
		--remove the entities from the tables as they are dead
		if entity.name == INPUT_CHEST_NAME then
			global.inputChests[HashPosition(entity.position)] = nil
		elseif entity.name == OUTPUT_CHEST_NAME then
			global.outputChests[HashPosition(entity.position)] = nil
		end
	end
end



--[[ Thing Creation Events ]]--
script.on_event(defines.events.on_built_entity, function(event)
	OnBuiltEntity(event)
end)
script.on_event(defines.events.on_robot_built_entity, function(event)
	OnBuiltEntity(event)
end)



--[[ Thing Killing Events ]]--
script.on_event(defines.events.on_entity_died, function(event)
	OnKilledEntity(event)
end)
script.on_event(defines.events.on_robot_pre_mined, function(event)
	OnKilledEntity(event)
end)
script.on_event(defines.events.on_preplayer_mined_item, function(event)
	OnKilledEntity(event)
end)




script.on_event(defines.events.on_tick, function(event)
	global.inputChests = global.inputChests or {}
	global.outputChests = global.outputChests or {}
	
	HandleInputChests()
	HandleOutputChests()
end)

function HandleInputChests()
	local linesToWriteToFile = {}
	for k, v in pairs(global.inputChests) do
		if v.valid then
			--get the content of the chest
			local items = v.get_inventory(defines.inventory.chest).get_contents()
			--write everything to the file
			for itemName, itemCount in pairs(items) do
				linesToWriteToFile[#linesToWriteToFile + 1] = itemName.. " " ..itemCount.."\n"
			end
			-- clear the inventory
			v.get_inventory(defines.inventory.chest).clear()
		end
	end
	if #linesToWriteToFile > 0 then
		--only write to file once as i/o is slow
		--it's much faster to concatenate all the lines with table.concat 
		--instead of doing it with the .. operator
		game.write_file(INPUT_CHEST_FILE, table.concat(linesToWriteToFile), true)
	end
end

function HandleOutputChests()
	local linesToWriteToFile = {}
	local simpleItemStack = {}
	for k, v in pairs(global.outputChests) do
		if v.valid and not v.to_be_deconstructed(v.force) then
			--get the inventory here once for faster execution
			local chestInventory = v.get_inventory(defines.inventory.chest)
			for i = 1, 10 do
				--the item the chest wants
				local requestItem = v.get_request_slot(i)
				if requestItem ~= nil then
					local itemsInChest = chestInventory.get_item_count(requestItem.name)
					--if there isn't enough items in the chest
					if itemsInChest < requestItem.count then
						simpleItemStack.name = requestItem.name
						simpleItemStack.count = requestItem.count - itemsInChest
						--insert the missing items
						local insertedItemsCount = chestInventory.insert(simpleItemStack)
						--write how many items was inserted
						linesToWriteToFile[#linesToWriteToFile + 1] = simpleItemStack.name..", "..insertedItemsCount.."\n"
					end
				end
			end
		end
	end
	if #linesToWriteToFile > 0 then
		--only write to file once as i/o is slow
		--it's much faster to concatenate all the lines with table.concat 
		--instead of doing it with the .. operator
		game.write_file(OUTPUT_CHEST_FILE, table.concat(linesToWriteToFile), true)
	end
end


















