local function welcome_new_player(player_name)
    local player = game.get_player(player_name)
    if player == nil then return end
    player.print("Welcome to the server!")
    player.print("Your inventory will be automatically synchronized between servers in this cluster.")
    player.print("To improve sync performance, please avoid storing blueprints in your inventory.")
end

return welcome_new_player
