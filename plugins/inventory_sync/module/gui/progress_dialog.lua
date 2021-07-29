-- Show inventory download progressbar
function open_dialog(player, progress, total)
    if player.gui.screen.inventory_sync_progress then
        player.gui.screen.inventory_sync_progress.destroy()
    end
    if progress == total then
        return -- Hide dialog on completed download
    end

    local frame = player.gui.screen.add {
        name = "inventory_sync_progress",
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
        caption = "Inventory sync",
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
		name = "inventory_sync_progress_close_button",
		type = "sprite-button",
		sprite = "utility/close_white",
		hovered_sprite = "utility/close_black",
		clicked_sprite = "utility/close_black",
		style = "frame_action_button",
	}

	local content = frame.add {
		name = "inventory_sync_progress_dialog_content",
		type = "frame",
		direction = "vertical",
		style = "inside_shallow_frame_with_padding",
	}
	content.style.width = 400

	local p1 = content.add {
		type = "label",
		caption = "Downloading inventory chunk"..progress.."/"..total,
	}
	p1.style.single_line = false
	p1.style.bottom_margin = 8

    local progressbar = content.add {
        type = "progressbar",
        value = progress / total,
    }
    progressbar.style.width = 376 -- inside_shallow_frame_with_padding has 12px padding on each side

    frame.force_auto_center()
    player.opened = frame
end

return open_dialog
