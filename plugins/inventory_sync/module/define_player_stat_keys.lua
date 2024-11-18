local compat = require("modules/clusterio/compat")

local keys = {
	"character_crafting_speed_modifier",
	"character_mining_speed_modifier",
	"character_additional_mining_categories",
	"character_running_speed_modifier",
	"character_build_distance_bonus",
	"character_item_drop_distance_bonus",
	"character_reach_distance_bonus",
	"character_resource_reach_distance_bonus",
	"character_item_pickup_distance_bonus",
	"character_loot_pickup_distance_bonus",
	"character_inventory_slots_bonus",
	"character_trash_slot_count_bonus",
	"character_maximum_following_robot_count_bonus",
	"character_health_bonus",
}

if compat.version_le("1.1.110") then
	keys[#keys + 1] = "character_personal_logistic_requests_enabled"
end

return keys
