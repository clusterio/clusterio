# Clusterio player sync plugin

Carry over player inventories and settings between servers

As a player, it mostly just works. Most important to know is that factorio data transfer is slow, which means if you have "big" items (blueprints mostly) in your inventory it will take a long time to transfer when joining servers. For this reason it is recommended to keep blueprints in the blueprint library.

A note on crashing servers:

When a server crashes while you are online there won't be time to immediately upload the inventory. Instead, the inventory is uploaded as soon as the server restarts. This means if you have been playing on a different server from the one that crashed and gathered/consumed items but are offline at the time of the first server coming online again your inventory will reset to the autosave.

## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-player_sync
    npx clusteriocontroller plugin add @clusterio/plugin-player_sync

Substitute clusteriocontroller with clusteriohost or clusterioctl if this a dedicated host or ctl installation respectively.

## Upgrading from inventory_sync

This plugin was called inventory_sync before 2.0.0-alpha.28.
Remove the old package and install the new one in its place:

    npm uninstall @clusterio/plugin-inventory_sync
    npm install @clusterio/plugin-player_sync
    npx clusteriocontroller plugin remove inventory_sync
    npx clusteriocontroller plugin add @clusterio/plugin-player_sync

The `inventory_sync.*` config fields and the `inventory_sync.inventory.view` permission are renamed on load.
The controller moves `inventories.json` in the database directory to `player_sync.json`, and saves keep their player data the next time they are started with the new module.

## Fixing broken inventories

The controller stores one entry per player in `player_sync.json` and keeps a lock on the player while an instance has them online.
When sync goes wrong for a player, the Player sync page in the web interface lists every stored entry with its generation, size and the instance holding the lock.
Click an entry to see a summary of its inventories, export it as JSON, import an edited JSON file in its place, delete it, or release the lock.

The same operations are available from clusterioctl:

    npx clusterioctl player-sync list
    npx clusterioctl player-sync show <player>
    npx clusterioctl player-sync export <player> [file]
    npx clusterioctl player-sync import <player> <file>
    npx clusterioctl player-sync delete <player>
    npx clusterioctl player-sync release <player>

Importing and deleting both start a new epoch for the player.
An instance holding a copy from an earlier epoch throws it away the next time the player joins, even if it is newer than what the controller has, and an upload from an earlier epoch is discarded.
After an import the instance downloads the new data.
After a delete the next join turns whatever the player has on that instance into the new synced inventory.
Deleted players stay in `player_sync.json` as an entry with `deleted: true` so their epoch survives a controller restart.
Hosts running a version of this plugin from before epochs keep comparing generations only, so they can still overwrite an import with a copy they failed to upload.
Update the plugin on every host to get the full guarantee.
Both are refused while an instance holds the lock on the player, because the instance uploads its own copy when the player leaves and that would undo the change.
Have the player leave first, or release the lock if the instance is stuck holding it.

Viewing and exporting need the `player_sync.inventory.view` permission. Importing, deleting and releasing need `player_sync.inventory.modify`, which is not granted by default.

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

Instances can leave parts of the player out of the sync with the `player_sync.sync_*` options below.
A part which is not synced is left as it is when the player joins, and the instance's copy of it is not uploaded, so the stored copy from other instances stays as it was.
A player online when the options change keeps the old ones until they leave and join again, and a part that was turned on is downloaded when they join.
Turning off `player_sync.sync_inventories` leaves the items players have on the instance in place while the stored inventory still holds them too.
Items follow the player to whatever controller they end up with, a character, god or ghost, and what does not fit is put into a corpse below them.

Communication between the server and instance goes over stdout or rcon, depending on the size of the data.
Communication between the instance and the controller goes over websockets.
Overall, we are able to achieve a latency between 3 and infinite ticks from server join, depending on the size of the inventory. The major limiter is rcon transfer speeds with larger inventories, especially if they contain blueprints.


## Controller Configuration

### player_sync.player_lock_timeout

Time in seconds before the exclusive access an instance holds on a player's inventory expires after the instance stops or its host disconnects.
Until it expires the player is told the inventory is in use on that instance when joining another one.
The timeout is cancelled if the instance comes back before it runs out.

Defaults to `60`.


## Instance Configuration

### player_sync.rcon_chunk_size

Size in characters of the chunks the serialized inventory is split into when sent to the game over RCON.
Smaller chunks take more commands to transfer an inventory but hold up the RCON command pipe for less time each.

Defaults to `1000`.

### player_sync.sync_controller

Sync whether the player is a character, god or spectator, their respawn timer and cheat mode.

Defaults to `true`.

### player_sync.sync_force

Sync the force the player is on.

Defaults to `true`.

### player_sync.sync_appearance

Sync the player color, chat color and tag.

Defaults to `true`.

### player_sync.sync_inventories

Sync the items the player holds, the character bonuses and the crafting queue.
This covers the character inventories, the god inventory and the items a dead player will respawn with.
A spectator holds no items, so the synced items are put into a corpse when the player is a spectator on the instance.
A player without a character gets the ingredients of the crafting queue as items instead.
With this off and the controller synced, the items the player has on the instance move to the synced controller the same way.

Defaults to `true`.

### player_sync.sync_logistics

Sync the personal logistic requests.

Defaults to `true`.

### player_sync.sync_quick_bar

Sync the quick bar.

Defaults to `true`.

### player_sync.sync_settings

Sync the shortcut toggles, game view settings and flashlight.

Defaults to `true`.

### player_sync.sync_recipe_notifications

Sync which new recipe notifications have been seen.

Defaults to `true`.
