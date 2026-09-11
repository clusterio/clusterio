local compat = require("modules/clusterio/compat")

local keys = {
	"show_alert_gui",
	"show_controller_gui",
	"show_crafting_queue",
	"show_entity_info",
	"show_entity_tooltip",
	"show_hotkey_suggestions",
	"show_map_view_options",
	"show_minimap",
	"show_quickbar",
	"show_rail_block_visualisation",
	"show_research_info",
	"show_shortcut_bar",
	"show_side_menu",
	"show_tool_bar",
	"update_entity_selection",
}

if compat.version_ge("2.0.22") then
	keys[#keys + 1] = "show_surface_list"
end

if compat.version_ge("2.1.7") then
	keys[#keys + 1] = "hide_tall_entities"
	keys[#keys + 1] = "show_pins_gui"
end

return keys
