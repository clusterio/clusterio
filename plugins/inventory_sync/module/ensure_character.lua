local function ensure_character(player)
    if player.character == nil then
        log("Character define:")
        log(player.controller_type)
        log(serpent.block(defines.controllers))
        player.set_controller {
            type = defines.controllers.god,
        }
        player.create_character()
    end
end

return ensure_character
