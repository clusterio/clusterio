local function ensure_character(player)
    if player.character == nil then
        player.set_controller {
            type = defines.controllers.god,
        }
        player.create_character()
    end
end

return ensure_character
