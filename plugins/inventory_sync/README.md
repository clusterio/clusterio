# Clusterio inventory sync plugin

Carry over player inventory between servers

As a player, it mostly just works. Most important to know is that factorio data transfer is slow, which means if you have "big" items (blueprints mostly) in your inventory it will take a long time to transfer when joining servers. For this reason it is recommended to keep blueprints in the blueprint library.

A note on crashing servers:

When a server crashes while you are online there won't be time to immediately upload the inventory. Instead, the inventory is uploaded as soon as the server restarts. This means if you have been playing on a different server from the one that crashed and gathered/consumed items but are offline at the time of the first server coming online again your inventory will reset to the autosave.

## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-inventory_sync
    npx clusteriocontroller plugin add @clusterio/plugin-inventory_sync

Substitute clusteriocontroller with clusteriohost or clusterioctl if this a dedicated host or ctl installation respectively.

## Method of operation

This plugin does event based synchronization of inventories.
The greatly simplified data flow is as follows:

1. Player joins server.
2. Scenario script asks controller for exclusive access to the player.
3. Controller grants exclusive access for the player to the instance.
4. Scenario script checks the access response and then acts according to the situation:

    1. If the player has no inventory on the controller then the current inventory becomes the synced inventory and the process is done.
    2. If the player inventory was previously uploaded and is the same as the one stored on the controller then the current inventory becomes the synced inventory and the process is done.
    3. If the player inventory was previously uploaded but is not the same then the player inventory is deleted and the player is turned into a spectator.
    4. Otherwise the player inventory is kept.

5. Scenario script asks for the player inventory from the controller, including its current recipe notification state.
6. Controller sends it to the scenario in a stream of chunks, with only the recipe notifications that differ from the current state.
7. Scenario displays and updates a progress bar as each chunk is received.
8. Once all chunks have loaded the player's synced inventory is recreated from the data and the player can start playing.

When the player leaves the inventory is uploaded if it's a synced inventory and the exclusive access the scenario script holds is released.
Should an error occur during this process the player is given the option to use a temporary inventory instead, which will be merged back into the synced inventory the next time the sync succeeds on that instance.

Instances can leave parts of the player out of the sync with the `inventory_sync.sync_*` options below.
A part which is not synced is left as it is when the player joins, and the instance's copy of it is not uploaded, so the stored copy from other instances stays as it was.
A player online when the options change keeps the old ones until they leave and join again, and a part that was turned on is downloaded when they join.
Turning off `inventory_sync.sync_inventories` leaves the items players have on the instance in place while the stored inventory still holds them too.

Communication between the server and instance goes over stdout or rcon, depending on the size of the data.
Communication between the instance and the controller goes over websockets.
Overall, we are able to achieve a latency between 3 and infinite ticks from server join, depending on the size of the inventory. The major limiter is rcon transfer speeds with larger inventories, especially if they contain blueprints.


## Controller Configuration

### inventory_sync.player_lock_timeout

Time in seconds before the exclusive access an instance holds on a player's inventory expires after the instance stops or its host disconnects.
Until it expires the player is told the inventory is in use on that instance when joining another one.
The timeout is cancelled if the instance comes back before it runs out.

Defaults to `60`.


## Instance Configuration

### inventory_sync.rcon_chunk_size

Size in characters of the chunks the serialized inventory is split into when sent to the game over RCON.
Smaller chunks take more commands to transfer an inventory but hold up the RCON command pipe for less time each.

Defaults to `1000`.

### inventory_sync.sync_controller

Sync whether the player is a character, god or spectator, their respawn timer, cheat mode, the god inventory and the inventory filters of a dead player.
Switching controller can destroy the character holding the inventory, so this only takes effect while `inventory_sync.sync_inventories` is also enabled.

Defaults to `true`.

### inventory_sync.sync_force

Sync the force the player is on.

Defaults to `true`.

### inventory_sync.sync_appearance

Sync the player colour, chat colour and tag.

Defaults to `true`.

### inventory_sync.sync_inventories

Sync the character inventories, the character bonuses and the crafting queue.
While the controller is not synced a player without a character keeps what they have on the instance and does not change the stored character.
A player who died on the instance uploads the character they will respawn with, and a player waiting to respawn when joining is respawned straight away if there is a synced character to give them.

Defaults to `true`.

### inventory_sync.sync_logistics

Sync the personal logistic requests.

Defaults to `true`.

### inventory_sync.sync_quick_bar

Sync the quick bar.

Defaults to `true`.

### inventory_sync.sync_settings

Sync the shortcut toggles, game view settings and flashlight.

Defaults to `true`.

### inventory_sync.sync_recipe_notifications

Sync which new recipe notifications have been seen.

Defaults to `true`.
