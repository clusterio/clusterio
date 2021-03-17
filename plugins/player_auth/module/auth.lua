local clusterio_api = require("modules/clusterio/api")
local auth = {}

function open_dialog(player, url, code)
	if player.gui.screen.player_auth_dialog then
		player.gui.screen.player_auth_dialog.destroy()
	end

	local frame = player.gui.screen.add {
		name = "player_auth_dialog",
		type = "frame",
		direction = "vertical",
	}

	local titlebar = frame.add {
		type = "flow",
	}
	titlebar.drag_target = frame

	local title = titlebar.add {
		type = "label",
		style = "frame_title",
		caption = "Web Interface Login",
	}
	title.drag_target = frame

	local filler = titlebar.add {
		type = "empty-widget",
		style = "draggable_space_header",
	}
	filler.style.horizontally_stretchable = "on"
	filler.style.right_margin = 4
	filler.style.height = 24
	filler.drag_target = frame

	titlebar.add {
		name = "player_auth_dialog_close_button",
		type = "sprite-button",
		sprite = "utility/close_white",
		hovered_sprite = "utility/close_black",
		clicked_sprite = "utility/close_black",
		style = "frame_action_button",
	}

	local content = frame.add {
		name = "player_auth_dialog_content",
		type = "frame",
		direction = "vertical",
		style = "inside_shallow_frame_with_padding",
	}
	content.style.width = 300

	local p1 = content.add {
		type = "label",
		caption = "Login to the web interface is a 3 step process:",
	}
	p1.style.single_line = false
	p1.style.bottom_margin = 8

	local p2 = content.add {
		type = "label",
		caption = "1. Open the web interface in a browser, the url to it is shown below:",
	}
	p2.style.single_line = false
	p2.style.bottom_margin = 8

	local url_textfield = content.add {
		type = "textfield",
		text = url,
	}
	url_textfield.style.bottom_margin = 8
	url_textfield.style.width = 300 - 24

	local p3 = content.add {
		type = "label",
		caption = "2. Enter the following code into step 2 of the Factorio login:",
	}
	p3.style.single_line = false
	p3.style.bottom_margin = 8

	local player_code_textfield = content.add {
		type = "textfield",
		text = code,
	}
	player_code_textfield.style.bottom_margin = 8
	player_code_textfield.style.width = 180

	local p4 = content.add {
		type = "label",
		caption = "3. Enter the code in step 3 of the Factorio login here:"
	}
	p4.style.single_line = false
	p4.style.bottom_margin = 8

	local verify_code_row = content.add {
		type = "flow",
	}
	local verify_code_input = verify_code_row.add {
		name = "player_auth_verify_code_input",
		type = "textfield",
	}
	verify_code_input.style.bottom_margin = 8
	verify_code_input.style.width = 180
	local verify_code_button = verify_code_row.add {
		name = "player_auth_verify_code_button",
		type = "button",
		style = "green_button",
		sprite = "utility/check_mark",
		caption = "Log in",
	}
	verify_code_button.style.minimal_width = 80

	frame.force_auto_center()
	player.opened = frame
end

function auth.add_commands()
	commands.add_command("web-login", "Login to the web interface", function(event)
		if event.player_index then
			local player = game.players[event.player_index]
			clusterio_api.send_json("player_auth", {
				type = "open_dialog",
				player = player.name,
			})
			return
		end

		if event.parameter then
			local args = {}
			for w in string.gmatch(event.parameter, "[^ ]+") do
				args[#args + 1] = w
			end
			if #args < 1 then
				rcon.print("Incorrect number of parameters")
				return
			end

			local command = table.remove(args, 1)
			if command == "open" then
				if #args ~= 3 then
					rcon.print("Incorrect number of parameters")
					return
				end

				local player_name, url, code = table.unpack(args)
				local player = game.players[player_name]
				if not player then
					rcon.print("Player " .. player_name .. " does not exist")
					return
				end

				open_dialog(player, url, code)

			elseif command == "code_set" then
				local player_name = args[1]
				local player = game.players[player_name]
				if not player then
					rcon.print("Player " .. player_name .. " does not exist")
					return
				end

				if player.gui.screen.player_auth_dialog then
					player.gui.screen.player_auth_dialog.destroy()
				end

			elseif command == "error" then
				local player_name = table.remove(args, 1)
				local player = game.players[player_name]
				if not player then
					rcon.print("Player " .. player_name .. " does not exist")
					return
				end

				player.print("Error: " .. table.concat(args, " "))
			end
		end
	end)
end

auth.events = {}
auth.events[defines.events.on_gui_click] = function(event)
	if not event.element or not event.element.valid then
		return
	end

	if event.element.name == "player_auth_dialog_close_button" then
		event.element.parent.parent.destroy()

	elseif event.element.name == "player_auth_verify_code_button" then
		local verify_code = event.element.parent.player_auth_verify_code_input.text
		local player_name = game.players[event.player_index].name
		clusterio_api.send_json("player_auth", {
			type = "set_verify_code",
			player = player_name,
			verify_code = verify_code,
		})
	end
end

auth.events[defines.events.on_gui_closed] = function(event)
	if
		event.element
		and event.element.valid
		and event.element.name == "player_auth_dialog"
	then
		event.element.destroy()
	end
end

return auth
