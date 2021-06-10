local save_crafts = require("modules/inventory_sync/save_crafts")
local restore_crafts = require("modules/inventory_sync/restore_crafts")

function add_commands()
    --[[
        Command to serialize crafting queue for transport.
        When serialized, the crafting queue is cleared and stored in global. The items received are cleared as well.
        Upon leaving, the value in global is cleared and sent with the inventory to the master.
        Upon joining a game the crafting queue is added to the end of the existing crafting queue.
    ]]
	commands.add_command("save-crafts", "Save crafting queue for transport to a different server", save_crafts)
    commands.add_command("csc", "Shorthand for /save-crafts", save_crafts)
    commands.add_command("restore-crafts", "Load crafting queue from global", restore_crafts)
    commands.add_command("crc", "Shorthand for /restore-crafts", restore_crafts)
end

return add_commands
