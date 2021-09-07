# Clusterio inventory sync plugin

Carry over player inventory between servers

As a player, it mostly just works. Most important to know is that factorio data transfer is slow, which means if you have "big" items (blueprints mostly) in your inventory it will take a long time to transfer when joining servers. For this reason it is recommended to keep blueprints in the blueprint library.

A note on crashing servers:

When a server crashes while you are online there won't be time to immediately upload the inventory. Instead, the inventory is uploaded as soon as the server restarts. This means if you have been playing on a different server from the one that crashed and gathered/consumed items but are offline at the time of the first server coming online again your inventory will reset to the autosave.

## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-inventory_sync
    npx clusteriomaster plugin add @clusterio/plugin-inventory_sync

Substitute clusteriomaster with clusterioslave or clusterioctl if this a dedicated slave or ctl installation respectively.

## Method of operation

This plugin does event based synchronization of inventories.
The greatly simplified data flow is as follows:

1. Player joins server.
2. Scenario script asks master for exclusive access to the player.
3. Master grants exclusive access for the player to the instance.
4. Scenario script checks the access response and then acts according to the situation:

    1. If the player has no inventory on the master then the current inventory becomes the synced inventory and the process is done.
    2. If the player inventory was previously uploaded and is the same as the one stored on the master then the current inventory becomes the synced inventory and the process is done.
    3. If the player inventory was previously uploaded but is not the same then the player inventory is deleted and the player is turned into a spectator.
    4. Otherwise the player inventory is kept.

5. Scenario script asks for the player inventory from the master.
6. Master sends it to the scenario in a stream of chunks.
7. Scenario displays and updates a progress bar as each chunk is received.
8. Once all chunks have loaded the player's synced inventory is recreated from the data and the player can start playing.

When the player leaves the inventory is uploaded if it's a synced inventory and the exclusive access the scenario script holds is released.
Should an error occur during this process the player is given the option to use a temporary inventory instead, which will be merged back into the synced inventory the next time the sync succeeds on that instance.

Communication between the server and instance goes over stdout or rcon, depending on the size of the data.
Communication between the instance and the master server goes over websockets.
Overall, we are able to achieve a latency between 3 and infinite ticks from server join, depending on the size of the inventory. The major limiter is rcon transfer speeds with larger inventories, especially if they contain blueprints.
