local function send_json(channel, data)
	data = helpers and helpers.table_to_json(data) or game.table_to_json(data)
	print("\f$ipc:" .. channel .. "?j" .. data)
end

script.on_init(function()
	send_json("mod_list", script.active_mods)
	local mod_settings = prototypes and prototypes.mod_setting or game.mod_setting_prototypes
	for name, mod_setting in pairs(mod_settings) do
		send_json("mod_setting_mod", { name = name, mod = mod_setting.mod })
	end
end)
