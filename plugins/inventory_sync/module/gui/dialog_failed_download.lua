-- Show inventory download progressbar
function dialog_failed_download(player)
    if player.gui.screen.dialog_failed_download then
        player.gui.screen.dialog_failed_download.destroy()
    end

    local frame = player.gui.screen.add {
        name = "dialog_failed_download",
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
        caption = "Inventory sync download failed",
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

	local content = frame.add {
		name = "inventory_sync_failed_download_content",
		type = "frame",
		direction = "vertical",
		style = "inside_shallow_frame_with_padding",
	}
	content.style.width = 400

	local p1 = content.add {
		type = "label",
		caption = "The inventory download couldn't complete. You can choose to keep playing with an empty inventory until the connection is reestablished and the inventory download completes. At that point your temporary inventory will be put in a chest.",
	}
	p1.style.single_line = false
	p1.style.bottom_margin = 8

    local abort = content.add {
        name = "inventory_sync_failed_download_abort",
        type = "button",
        caption = "Continue with new inventory",
        tooltip = "Create a new empty temporary inventory. Items you pick up will be placed in a chest when the sync completes.",
    }

    frame.force_auto_center()
    player.opened = frame
end

return dialog_failed_download
