require("util")
require("config")

function ChangePictureFilename(entity, path, newFilename)
	if newFilename ~= nil then
		local filenamePath = entity[path[1]]
		for i = 2, #path do
			filenamePath = filenamePath[path[i]]
		end
		filenamePath.filename = newFilename
	end
end

function MakeLogisticEntity(entity, name, pictureFilename, pictureTablePath, iconPath)
	entity.name = name
	entity.minable.result = name
	--if no picture is defined then use the default one
	ChangePictureFilename(entity, pictureTablePath, pictureFilename)
	--if no icon is defined then use the default one
	entity.icon = iconPath or entity.icon
	
	-- add the entity to a technology so it can be unlocked
	--local wasAddedToTech = AddEntityToTech("construction-robotics", name)
	
	data:extend(
	{
		-- add the entity
		entity,
		-- add the recipe for the entity
		{
			type = "recipe",
			name = name,
			--if the recipe was succesfully attached to the tech then the recipe
			--shouldn't be enabled to begin with.
			--but if the recipe isn't attached to a tech then it should
			--be enabled to begin with because otherwise the player can never use the item ingame
			enabled = true,
			ingredients =
			{
			  {"steel-chest", 1},
			  {"electronic-circuit", 3},
			  {"advanced-circuit", 1}
			},
			result = name,
			requester_paste_multiplier = 4
		},
		{
			type = "item",
			name = name,
			icon = entity.icon,
			flags = {"goes-to-quickbar"},
			subgroup = "storage",
			order = "a[items]-b["..name.."]",
			place_result = name,
			stack_size = 50
		}
	})
	return entity
end

--adds a recipe to a tech and returns true or if that fails returns false
function AddEntityToTech(techName, name)
	--can't add the recipe to the tech if it doesn't exist
	if data.raw["technology"][techName] ~= nil then
		local effects = data.raw["technology"][techName].effects
		--if another mod removed the effects or made it nil then make a new table to put the recipe in
		effects = effects or {}
		--insert the recipe as an unlock when the research is done
		effects[#effects + 1] = {
			type = "unlock-recipe",
			recipe = name
		}
		--if a new table for the effects is made then the effects has to be attached to the 
		-- tech again because the table won't otherwise be owned by the tech
		data.raw["technology"][techName].effects = effects
		return true
	end
	return false
end


--make chests
MakeLogisticEntity(table.deepcopy(data.raw["logistic-container"]["logistic-chest-requester"]), OUTPUT_CHEST_NAME, OUTPUT_CHEST_PICTURE_PATH, { "picture" }, OUTPUT_CHEST_ICON_PATH)
MakeLogisticEntity(table.deepcopy(data.raw["container"]["iron-chest"]), 					    INPUT_CHEST_NAME,  INPUT_CHEST_PICTURE_PATH, { "picture" },  INPUT_CHEST_ICON_PATH)

--make tanks
--MakeLogisticEntity(table.deepcopy(data.raw["storage-tank"]["storage-tank"]), OUTPUT_TANK_NAME, OUTPUT_TANK_PICTURE_PATH, { "pictures", "picture", "sheet" }, OUTPUT_TANK_ICON_PATH)
MakeLogisticEntity(table.deepcopy(data.raw["storage-tank"]["storage-tank"]),  INPUT_TANK_NAME,  INPUT_TANK_PICTURE_PATH, { "pictures", "picture", "sheet" },  INPUT_TANK_ICON_PATH)


data:extend(
{
	{
		type = "recipe-category",
		name = "crafting-fluids"
	}
})

local fluidCreator = MakeLogisticEntity(table.deepcopy(data.raw["assembling-machine"]["assembling-machine-3"]), OUTPUT_TANK_NAME, OUTPUT_TANK_PICTURE_PATH, { "animation" }, OUTPUT_TANK_ICON_PATH)
fluidCreator.fluid_boxes =
{
	{
		production_type = "output",
		pipe_picture = assembler3pipepictures(),
		pipe_covers = pipecoverspictures(),
		base_area = 250,
		base_level = 1,
		pipe_connections = 
		{
			{ 
				type="output", position = {0, 2} 
			},
			{ 
				type="output", position = {0, -2} 
			},
			{ 
				type="output", position = {2, 0} 
			},
			{ 
				type="output", position = {-2, 0} 
			},
		}
	},
	off_when_no_fluid_recipe = false
}
fluidCreator.crafting_categories = {"crafting-fluids"}
--fluidCreator.energy_source = nil
fluidCreator.energy_usage = "1kW"
fluidCreator.ingredient_count = 1
fluidCreator.module_specification.module_slots = 0

for k,v in pairs(data.raw.fluid) do
	data:extend(
	{
		{
			type = "recipe",
			name = v.name,
			icon = v.icon,
			category = "crafting-fluids",
			energy_required = 1,
			subgroup = "barrel",
			order = "b[fill-crude-oil-barrel]",
			enabled = true,
			ingredients =
			{
				{type="item", name="none", amount=1}
			},
			results=
			{
			  {type="fluid", name=v.name, amount=-1}
			}
		}
	})
end

data:extend(
{
	{
		type = "item",
		name = "none",
		icon = "__clusterio__/graphics/icons/none.png",
		flags = { "goes-to-quickbar" },
		subgroup = "intermediate-product",
		order = "c[other]-a[power-switch]",
		stack_size= 1,
  }
})











