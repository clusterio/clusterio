require("config")
local json = require("json")

function HashPosition(position)
	return 40000 * (position.y) + position.x
end

function OnBuiltEntity(event)
	local entity = event.created_entity
	--only add entities that are not ghosts
	if entity.type ~= "entity-ghost" then
		AddEntity(entity)
	end
end

function AddAllEntitiesOfName(name)
	for k, surface in pairs(game.surfaces) do
		AddEntities(surface.find_entities_filtered({["name"] = name}))
	end
end

function AddEntities(entities)
	for k, entity in pairs(entities) do
		AddEntity(entity)
	end
end

function AddEntity(entity)
	if entity.name == INPUT_CHEST_NAME then
		global.inputChests = global.inputChests or {}
		--add the chests to a lists if these chests so they can be interated over
		global.inputChests[HashPosition(entity.position)] = entity
	elseif entity.name == OUTPUT_CHEST_NAME then
		global.outputChests = global.outputChests or {}
		--add the chests to a lists if these chests so they can be interated over
		global.outputChests[HashPosition(entity.position)] = entity
	elseif entity.name == INPUT_TANK_NAME then
		global.inputTanks = global.inputTanks or {}
		--add the chests to a lists if these chests so they can be interated over
		global.inputTanks[HashPosition(entity.position)] = entity
	elseif entity.name == OUTPUT_TANK_NAME then
		global.outputTanks = global.outputTanks or {}
		--add the chests to a lists if these chests so they can be interated over
		global.outputTanks[HashPosition(entity.position)] = entity
		entity.active = false
	elseif entity.name == TX_COMBINATOR_NAME then
		table.insert(global.txControls, entity.get_or_create_control_behavior())
	elseif entity.name == RX_COMBINATOR_NAME then
		table.insert(global.rxControls, entity.get_or_create_control_behavior())
    entity.operable=false
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
		elseif entity.name == INPUT_TANK_NAME then
			global.inputTanks[HashPosition(entity.position)] = nil
		elseif entity.name == OUTPUT_TANK_NAME then
			global.outputTanks[HashPosition(entity.position)] = nil
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
	global.inputTanks = global.inputTanks or {}
	global.outputTanks = global.outputTanks or {}
	global.outputList = global.outputList or {}
	global.inputList = global.inputList or {}
  global.rxControls = global.rxControls or {}
  global.txControls = global.txControls or {}


  -- TX Combinators must run every tick to catch single pulses
  HandleTXCombinators()

	local todo = game.tick % UPATE_RATE

	local onlinePlayers = GetOnlinePlayerCount()

	if global.previousPlayerCount == nil or global.previousPlayerCount ~= onlinePlayers then
		Reset()
	end
	global.previousPlayerCount = onlinePlayers

	if todo == 0 then
		HandleInputChests()
	elseif todo == 1 then
		HandleInputTanks()
	elseif todo == 2 then
		HandleOutputChests()
	elseif todo == 3 then
		HandleOutputTanks()
	elseif todo == 4 then
		ExportInputList()
	elseif todo == 5 then
		ExportOutputList()
  end

  local rxstate = game.tick % CIRCUIT_UPATE_RATE
  -- RX Combinators are set and then cleared on sequential ticks to create pulses
  if rxstate == 0 then
    SetRXCombinators()
  elseif rxstate == 1 then
    ClearRXCombinators()
	end
end)

function GetOnlinePlayerCount()
	local onlinePlayers = 0
	for k, player in pairs(game.players) do
		if player.connected then
			onlinePlayers = onlinePlayers + 1
		end
	end
	return onlinePlayers
end

function Reset()
	global.outputList = {}
	global.inputList = {}
	global.itemStorage = {}

	global.inputChests = {}
	global.outputChests = {}
	global.inputTanks = {}
	global.outputTanks = {}

	AddAllEntitiesOfName(INPUT_CHEST_NAME)
	AddAllEntitiesOfName(OUTPUT_CHEST_NAME)
	AddAllEntitiesOfName(INPUT_TANK_NAME)
	AddAllEntitiesOfName(OUTPUT_TANK_NAME)
	game.print("reset")
end

function HandleInputChests()
	for k, v in pairs(global.inputChests) do
		if v.valid then
			--get the content of the chest
			local items = v.get_inventory(defines.inventory.chest).get_contents()
			--write everything to the file
			for itemName, itemCount in pairs(items) do
				AddItemToInputList(itemName, itemCount)
			end
			-- clear the inventory
			v.get_inventory(defines.inventory.chest).clear()
		end
	end
end

function HandleInputTanks()
	for k, v in pairs(global.inputTanks) do
		if v.valid then
			--get the content of the chest
			local fluid = v.fluidbox[1]
			if fluid ~= nil and math.floor(fluid.amount) > 0 then
				AddItemToInputList(fluid.type, math.floor(fluid.amount))
				fluid.amount = fluid.amount - math.floor(fluid.amount)
			end
			v.fluidbox[1] = fluid
		end
	end

end

function HandleOutputChests()
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
						local additionalItemRequiredCount = requestItem.count - itemsInChest
						local itemCountAllowedToInsert = RequestItemsFromStorage(requestItem.name, additionalItemRequiredCount)
						if itemCountAllowedToInsert > 0 then
							simpleItemStack.name = requestItem.name
							simpleItemStack.count = itemCountAllowedToInsert
							--insert the missing items
							local insertedItemsCount = chestInventory.insert(simpleItemStack)
							local itemsNotInsertedCount = itemCountAllowedToInsert - insertedItemsCount

							if itemsNotInsertedCount > 0 then
								GiveItemsToStorage(requestItem.name, itemsNotInsertedCount)
							end
						else
							local missingItems = additionalItemRequiredCount - itemCountAllowedToInsert
							AddItemToOutputList(requestItem.name, missingItems)
						end
					end
				end
			end
		end
	end
end

function HandleOutputTanks()
	local MAX_FLUID_AMOUNT = 1000
	 for k,v in pairs(global.outputTanks) do
		--.recipe.products[1].name
		if v.recipe ~= nil then
			local fluidName = v.recipe.products[1].name

			--either get the fluid or reset it to the requested fluid
			local fluid = v.fluidbox[1] or {type = fluidName, amount = 0}
			if fluid.type ~= fluidName then
				fluid = {type = fluidName, amount = 0}
			end

			--if any fluid is missing then request the fluid
			--from store and give either what it's missing or
			--the rest of the liquid in the system
			local missingFluid = math.max(math.ceil(MAX_FLUID_AMOUNT - fluid.amount), 0)
			if missingFluid > 0 then
				local fluidToInsert = RequestItemsFromStorage(fluidName, missingFluid)
				if fluidToInsert > 0 then
					fluid.amount = fluid.amount + fluidToInsert
				else
					local fluidToRequestAmount = missingFluid - fluidToInsert
					AddItemToOutputList(fluid.type, fluidToRequestAmount)
				end
			end

		v.fluidbox[1] = fluid
	 end
end
end


function AddItemToInputList(itemName, itemCount)
	global.inputList[itemName] = (global.inputList[itemName] or 0) + itemCount
end

function AddItemToOutputList(itemName, itemCount)
	global.outputList[itemName] = (global.outputList[itemName] or 0) + itemCount
end



function ExportInputList()
	local exportStrings = {}
	for k,v in pairs(global.inputList) do
		exportStrings[#exportStrings + 1] = k.." "..v.."\n"
	end
	global.inputList = {}
	if #exportStrings > 0 then

		--only write to file once as i/o is slow
		--it's much faster to concatenate all the lines with table.concat
		--instead of doing it with the .. operator
		game.write_file(OUTPUT_FILE, table.concat(exportStrings), true)
	end
end

function ExportOutputList()
	local exportStrings = {}
	for k,v in pairs(global.outputList) do
		exportStrings[#exportStrings + 1] = k.." "..v.."\n"
	end
	global.outputList = {}
	if #exportStrings > 0 then

		--only write to file once as i/o is slow
		--it's much faster to concatenate all the lines with table.concat
		--instead of doing it with the .. operator
		game.write_file(ORDER_FILE, table.concat(exportStrings), true)
	end
end


function RequestItemsFromStorage(itemName, itemCount)
	global.itemStorage = global.itemStorage or {}
	--if result is nil then there is no items in storage
	--which means that no items can be given
	if global.itemStorage[itemName] == nil then
		return 0
	end
	--if the number of items in storage is lower than the number of items
	--requested then take the number of items there are left otherwise take the requested amount
	local itemsTakenFromStorage = math.min(global.itemStorage[itemName], itemCount)
	global.itemStorage[itemName] = global.itemStorage[itemName] - itemsTakenFromStorage

	return itemsTakenFromStorage
end

function GiveItemsToStorage(itemName, itemCount)
	global.itemStorage = global.itemStorage or {}
	--if this is called for the first time for an item then the result
	--is nil. if that's the case then set the result to 0 so it can
	--be used in arithmetic operations
	global.itemStorage[itemName] = global.itemStorage[itemName] or 0
	global.itemStorage[itemName] = global.itemStorage[itemName] + itemCount
end



function AddFrameToRXBuffer(frame)
  -- Add a frame to the buffer. return remaining space in buffer
  local validsignals = {
    ["virtual"] = game.virtual_signal_prototypes,
    ["fluid"]   = game.fluid_prototypes,
    ["item"]    = game.item_prototypes
  }

  global.rxBuffer = global.rxBuffer or {}

  -- if buffer is full, drop frame
  if #global.rxBuffer >= MAX_RX_BUFFER_SIZE then return 0 end

  -- frame = {{count=42,name="signal-grey",type="virtual"},{...},...}
  local signals = {}
  local index = 1

  for _,signal in pairs(frame) do
    if validsignals[signal.type] and validsignals[signal.type][signal.name] then
      signals[index] =
        {
          index=index,
          count=signal.count,
          signal={ name=signal.name, type=signal.type }
        }
      index = index + 1
      --TODO: break if too many?
      --TODO: error token on mismatched signals? maybe mismatch1-n signals?
    end
  end

  if index > 1 then table.insert(global.rxBuffer,signals) end

  return MAX_RX_BUFFER_SIZE - #global.rxBuffer
end

function HandleTXCombinators()
  -- Check all TX Combinators, and if condition satisfied, add frame to transmit buffer

  -- frame = {{count=42,name="signal-grey",type="virtual"},{...},...}
  local signals = {["item"]={},["virtual"]={},["fluid"]={}}
  for i,txControl in pairs(global.txControls) do
    if txControl.valid then
      local frame = txControl.signals_last_tick
      if frame then
        for _,signal in pairs(frame) do
          signals[signal.signal.type][signal.signal.name]=
            (signals[signal.signal.type][signal.signal.name] or 0) + signal.count
        end
      end
    else
      table.remove(global.txControls,i)
    end
  end

  local frame = {}
  for type,arr in pairs(signals) do
    for name,count in pairs(arr) do
      table.insert(frame,{count=count,name=name,type=type})
    end
  end

  if #frame > 0 then
    table.insert(frame,{count=game.tick,name="signal-srctick",type="virtual"})
    game.write_file(TX_BUFFER_FILE, json:encode(frame).."\n", true)

    -- Loopback for testing
    --AddFrameToRXBuffer(frame)

  end
end

function SetRXCombinators()
  -- if the RX buffer is not empty, get a frame from it and output on all RX Combinators
  if global.rxBuffer and #global.rxBuffer > 0 then
    local frame = table.remove(global.rxBuffer)
    for i,rxControl in pairs(global.rxControls) do
      if rxControl.valid then
        rxControl.parameters={parameters=frame}
        rxControl.enabled=true
      else
        table.remove(global.rxControls,i)
      end
    end
  end
end

function ClearRXCombinators()
  -- Clear all RX Combinators.
  -- This makes them emit pulses, which are easier to
  -- detect than slowly changing continusous signals.
  for i,rxControl in pairs(global.rxControls) do
    if rxControl.valid then
      rxControl.enabled=false
    else
      table.remove(global.rxControls,i)
    end
  end
end

--[[ Remote Thing ]]--
remote.add_interface("clusterio",
{
  import = function(itemName, itemCount)
		GiveItemsToStorage(itemName, itemCount)
	end,
	importMany = function(jsonString)
		local items = json:decode(jsonString)
		for k, item in pairs(items) do
			for itemName, itemCount in pairs(item) do
				GiveItemsToStorage(itemName, itemCount)
			end
		end
	end,
	printStorage = function()
		local items = ""
		for itemName, itemCount in pairs(global.itemStorage) do
			items = items.."\n"..itemName..": "..tostring(itemCount)
		end
		game.print(items)
	end,
	reset = Reset,
	receiveFrame = function(jsonframe)
		local frame = json:decode(jsonframe)
		-- frame = {tick=123456,frame={{count=42,name="signal-grey",type="virtual"},{...},...}}
		return AddFrameToRXBuffer(frame)
	end,
	receiveMany = function(jsonframes)
		local frames = json:decode(jsonframes)
		local buffer
		for _,frame in pairs(frames) do
			buffer = AddFrameToRXBuffer(frame)
			if buffer==0 then return 0 end
		end
		return buffer
	end,
})
