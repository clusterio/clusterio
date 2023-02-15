local function send_json(channel, data)
	data = game.table_to_json(data)
	print("\f$ipc:" .. channel .. "?j" .. data)
end

script.on_init(function()
	send_json("mod_list", game.active_mods)
	for name, mod_setting in pairs(game.mod_setting_prototypes) do
		send_json("mod_setting_mod", { name = name, mod = mod_setting.mod })
	end
end)
