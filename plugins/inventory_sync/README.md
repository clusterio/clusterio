# Clusterio inventory sync plugin

Carry over player inventory between servers

## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-inventory_sync
    npx clusteriomaster plugin add @clusterio/plugin-inventory_sync

Substitute clusteriomaster with clusterioslave or clusterioctl if this a dedicate slave or ctl installation respectively.

## Method of operation

This plugin does even based synchronization of inventories. The data flow is as follows:

1. Player joins server, gets put in spectator mode

2. Lua script asks instance for inventory

3. Instance asks master for inventory

4. Master does not find inventory, and responds to instance with undefined

5. Instance sets player to survival

6. Player keeps playing, and eventually leaves. Inventory is serialized and sent to instance through stdout/file

7. Instance sends inventory to master

8. Player joins a different server. Lua sends a request to instance, puts player into spectator mode

9. Instance sends request to master

10. Master responds with json data

11. Instance calls command in scenario script using rcon

12. Once the entire command is transfered, the scenario script clears the old inventory, applies the new inventory from the scenario script and sets the player to survival mode.

Communication between the server and instance goes over stdout or rcon, depending on the size of the data. 
Communication between the instance and the master server goes over websockets.
Overall, we are able to achieve a latency between 3 and infinite ticks from server join, depending on the size of the inventory. The major limiter is rcon transfer speeds with larger inventories, especially if they contain blueprints.
