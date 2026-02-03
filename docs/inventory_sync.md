# Inventory Sync Plugin - Event Flow Documentation

This document provides a comprehensive view of the inventory_sync plugin's data flow when players join servers, disconnect, and move between servers in a Clusterio cluster.

## Table of Contents
1. [Overview](#overview)
2. [Player Joins Server](#1-player-joins-server)
3. [Player Disconnects](#2-player-disconnects-from-server)
4. [Player Joins Another Server](#3-player-joins-another-server)
5. [Timeout & Error Handling](#4-timeout--error-handling)
6. [Data Structures](#5-data-structures-at-each-level)
7. [Message Sequence Diagrams](#6-message-sequence-diagrams)
8. [Component Responsibilities](#7-key-responsibilities-by-component)
9. [Configuration](#8-configuration)

## Overview

The inventory_sync plugin synchronizes player inventories, stats, and state across multiple Factorio servers in a Clusterio cluster. It uses a distributed locking mechanism to ensure only one server has write access to a player at a time.

**Key Components:**
- **Lua Module** (save-patched): Captures player events, serializes/deserializes state
- **Instance Plugin**: Bridges Lua ↔ Controller communication, handles chunking
- **Controller Plugin**: Manages locks, stores persistent player data

**Communication Flow:**
```
Lua Module (Factorio) ←IPC→ Instance Plugin ←WebSocket→ Controller Plugin ←File→ Database
```

---

## 1. Player Joins Server

### Phase 1: Player Creation & Join Event

**Lua Event Handlers:**
```lua
-- plugins/inventory_sync/module/inventory_sync.lua:161-163
on_player_created = function(event)
    create_player(game.get_player(event.player_index), false)
end

-- Line 327-341
on_player_joined_game = function(event)
    local player = game.get_player(event.player_index)
    if not script_data.players[player.name] then
        create_player(player, false)
    end
    inventory_sync.acquire(player)
    script_data.active_uploads[player.name] = nil
end
```

**Player Record Initialized:**
```lua
script_data.players[player.name] = {
    dirty = false,        -- No unsaved changes yet
    sync = false,         -- Not synced from controller yet
    generation = 0,       -- Player data version number
}
```

### Phase 2: Acquire Request (Lua → Instance)

**Lua calls:**
```lua
-- inventory_sync.lua:170
clusterio_api.send_json("inventory_sync_acquire", { player_name = player.name })
```

**IPC Message:**
- Event: `inventory_sync_acquire`
- Data: `{ player_name: string }`

**Instance Handler:**
```typescript
// plugins/inventory_sync/instance.ts:95-127
async handleAcquire(request: IpcPlayerName) {
    let acquireResponse = await this.instance.sendTo(
        "controller",
        new AcquireRequest(this.instance.id, request.player_name)
    );
}
```

### Phase 3: Acquire Request (Instance → Controller)

**Message Sent:**
```typescript
// messages.ts:48-70
class AcquireRequest {
    constructor(
        public instanceId: number,
        public playerName: string
    )
}
```

**Controller Handler:**
```typescript
// plugins/inventory_sync/controller.ts:97-114
async handleAcquireRequest(request: AcquireRequest) {
    let { instanceId, playerName } = request;

    // Attempt to acquire lock
    if (!this.acquire(instanceId, playerName)) {
        // Player already acquired by another instance
        return {
            status: "busy",
            message: instance.config.get("instance.name"),
        };
    }

    // Lock acquired successfully
    let playerData = this.playerDatastore.get(playerName);
    return new AcquireResponse(
        "acquired",
        playerData ? playerData.generation : 0,
        Boolean(playerData),
    );
}
```

**Acquire Logic:**
```typescript
// controller.ts:82-95
acquire(instanceId: number, playerName: string): boolean {
    let acquisitionRecord = this.acquiredPlayers.get(playerName);
    if (
        !acquisitionRecord ||                               // Not acquired
        acquisitionRecord.instanceId === instanceId ||      // Already acquired by THIS instance
        !this.controller.instances.has(acquisitionRecord.instanceId) || // Original instance gone
        acquisitionRecord.expiresMs && acquisitionRecord.expiresMs < Date.now() // Lock expired
    ) {
        this.acquiredPlayers.set(playerName, { instanceId });
        return true;
    }
    return false;
}
```

**Controller State Updated:**
```typescript
this.acquiredPlayers.set(playerName, {
    instanceId: number,
    expiresMs?: number  // Set when instance stops
})
```

**Response:**
```typescript
class AcquireResponse {
    constructor(
        public status: string,          // "acquired", "error", or "busy"
        public generation?: number,     // Generation of stored data
        public hasData?: boolean,       // Whether controller has saved inventory
        public message?: string         // Error/busy message
    )
}
```

### Phase 4: Acquire Response (Instance → Lua)

**Instance sends RCON command:**
```typescript
// instance.ts:125-126
let json = lib.escapeString(JSON.stringify(response));
await this.sendRcon(
    `/sc inventory_sync.acquire_response("${json}")`,
    true
);
```

**Lua Handler:**
```lua
-- inventory_sync.lua:188-204
function inventory_sync.acquire_response(data)
    local response = compat.json_to_table(data)

    -- Check if player still waiting
    if not script_data.players_waiting_for_acquire[response.player_name] then
        -- Player disconnected while waiting - release lock
        clusterio_api.send_json("inventory_sync_release", {
            player_name = response.player_name
        })
        return
    end
    script_data.players_waiting_for_acquire[response.player_name] = nil

    local player = game.get_player(response.player_name)

    -- Defer sync if player in cutscene
    if is_in_cutscene(player) then
        response.player = player
        script_data.players_in_cutscene_to_sync[response.player_name] = response
    else
        inventory_sync.sync_player(response)
    end
end
```

### Phase 5: Sync Decision

**Lua decides whether to download:**
```lua
-- inventory_sync.lua:216-309
function inventory_sync.sync_player(acquire_response)
    local player = game.get_player(acquire_response.player_name)
    local player_record = script_data.players[acquire_response.player_name]

    if acquire_response.status == "acquired" and acquire_response.has_data then
        if acquire_response.generation > player_record.generation then
            -- Controller has newer data - download it
            inventory_sync.initiate_inventory_download(
                player,
                player_record,
                acquire_response.generation
            )
            return
        end
    end

    -- No data exists on controller (first join) OR local is newer
    player_record.sync = true
    player_record.dirty = true
end
```

### Phase 6: Download Initiation (if needed)

**Lua prepares for download:**
```lua
-- inventory_sync.lua:422-456
function inventory_sync.initiate_inventory_download(player, player_record, generation)
    player.print("Initiating inventory download...")

    -- Store download state
    local record = {
        started = game.ticks_played,
        last_active = game.ticks_played,
        generation = generation,
        data = ""  -- Will accumulate JSON chunks
    }
    script_data.active_downloads[player.name] = record

    -- If synced player, become spectator during download
    if player_record.sync then
        record.surface = player.surface
        record.position = player.position
        if player.driving then
            record.vehicle = player.vehicle
        end
        player.set_controller({ type = defines.controllers.spectator })

        -- Destroy character temporarily
        local character = player.character
        if character then
            character.destroy()
        end

        player_record.dirty = false  -- Don't persist spectator state
    end

    -- Show progress dialog
    progress_dialog.display(player, 0, 1)

    -- Request download
    clusterio_api.send_json("inventory_sync_download", {
        player_name = player.name
    })
end
```

### Phase 7: Download Request (Instance → Controller)

**Instance Handler:**
```typescript
// instance.ts:172-197
async handleDownload(request: IpcPlayerName) {
    const playerName = request.player_name;
    this.logger.verbose(`Downloading ${playerName}`);

    let response: DownloadResponse = await this.instance.sendTo(
        "controller",
        new DownloadRequest(this.instance.id, playerName)
    );

    if (!response.playerData) {
        // No data on controller
        await this.sendRcon(
            `/sc inventory_sync.download_inventory('${playerName}',nil,0,0)`,
            true
        );
        return;
    }

    // Send data in chunks
    const chunkSize = this.instance.config.get("inventory_sync.rcon_chunk_size");
    const chunks = chunkify(chunkSize, JSON.stringify(response.playerData));

    for (let i = 0; i < chunks.length; i++) {
        const chunk = lib.escapeString(chunks[i]);
        await this.sendRcon(
            `/sc inventory_sync.download_inventory('${playerName}','${chunk}',${i + 1},${chunks.length})`,
            true
        );
    }
}
```

**Controller Handler:**
```typescript
// controller.ts:163-176
async handleDownloadRequest(request: DownloadRequest) {
    let { instanceId, playerName } = request;

    // Validate acquisition
    let acquisitionRecord = this.acquiredPlayers.get(playerName);
    if (!acquisitionRecord || acquisitionRecord.instanceId !== instanceId) {
        this.logger.warn(`${instanceName} downloaded ${playerName} without proper acquisition`);
    }

    this.logger.verbose(`Sending player data for ${playerName} to ${instanceName}`);
    return new DownloadResponse(
        this.playerDatastore.get(playerName) || null
    );
}
```

### Phase 8: Inventory Assembly (Instance → Lua)

**Chunked RCON commands:**
```
/sc inventory_sync.download_inventory('PlayerName','chunk1',1,10)
/sc inventory_sync.download_inventory('PlayerName','chunk2',2,10)
...
/sc inventory_sync.download_inventory('PlayerName','chunk10',10,10)
```

**Lua Handler:**
```lua
-- download_inventory.lua:7-75
function download_inventory(player_name, data, number, total)
    local player = game.get_player(player_name)
    local record = script_data.active_downloads[player_name]

    if total == 0 then
        -- No data on controller
        ensure_character(player)
        restore_position(record, player)
        script_data.active_downloads[player_name] = nil
        player_record.dirty = player.connected
        player_record.sync = true
        player_record.generation = record.generation
        return
    end

    -- Accumulate chunk
    record.data = record.data .. data

    if number ~= total then
        -- More chunks incoming - update progress
        progress_dialog.display(player, number, total)
        record.last_active = game.ticks_played
        return
    end

    -- Download complete - move to finished_downloads
    progress_dialog.remove(player)
    script_data.active_downloads[player_name] = nil
    script_data.finished_downloads[player_name] = record

    if player.connected then
        inventory_sync.finish_download(player, record)
    end
end
```

### Phase 9: Deserialization & Restoration

**Lua finishes download:**
```lua
-- inventory_sync.lua:311-324
function inventory_sync.finish_download(player, finished_record)
    -- Deserialize player data
    local status, result = pcall(
        inventory_sync.deserialize_player,
        player,
        finished_record
    )

    if not status then
        log("ERROR: Deserializing player " .. player.name .. " failed: " .. result)
        player.print("ERROR: Deserializing player data failed: " .. result)
    end

    -- Clean up
    script_data.finished_downloads[player.name] = nil

    -- Update player record
    local player_record = script_data.players[player.name]
    player_record.dirty = true
    player_record.sync = true
    player_record.generation = finished_record.generation
end
```

**Deserialization Process:**
```lua
-- inventory_sync.lua:82-141 & serialize.lua:406-484
function inventory_sync.deserialize_player(player, finished_record)
    -- Parse JSON
    local serialized_player = compat.json_to_table(finished_record.data)

    -- Handle stashed corpse (if player had items during download)
    local stashed_corpse = nil
    if player_record.dirty and player.character then
        player.character.die()
        stashed_corpse = surface.find_entity(corpse_name, position)
    end

    -- Deserialize player state
    serialize.deserialize_player(player, serialized_player)

    -- Restore position/vehicle
    restore_position(player, finished_record)

    -- Merge stashed items back
    if stashed_corpse then
        transfer_inventory(stashed_corpse, player.character.get_main_inventory())
    end
end
```

**What Gets Restored:**
- Controller type (character/god/spectator/ghost)
- Player properties: color, chat_color, tag, force, cheat_mode, flashlight
- Character stats: speed modifiers, bonuses, health
- Inventories: main, armor, guns, ammo, spidertron_trunk
- Personal logistic slots (logistics requests)
- Hotbar configuration
- Crafting queue and in-progress recipes
- Position and vehicle

**Final State:**
```lua
script_data.players[player.name] = {
    dirty = true,
    sync = true,
    generation = <controller_generation>
}
```

---

## 2. Player Disconnects from Server

### Phase 1: Disconnect Event

**Lua Event Handler:**
```lua
-- inventory_sync.lua:361-396
on_pre_player_left_game = function(event)
    local player = game.get_player(event.player_index)
    local player_record = script_data.players[player.name]

    -- If download active, just release the lock
    if script_data.active_downloads[player.name] then
        clusterio_api.send_json("inventory_sync_release", {
            player_name = player.name
        })
        return
    end

    -- Skip if not dirty or not synced
    if not player_record.dirty or not player_record.sync then
        return
    end

    -- Serialize player for upload
    player_record.generation = player_record.generation + 1
    local serialized = inventory_sync.serialize_player(player, player_record)

    -- Queue upload with retry
    script_data.active_uploads[player.name] = {
        serialized = serialized,
        last_attempt = game.ticks_played,
        timeout = math.random(600, 1200)  -- 10-20 seconds
    }

    -- Send upload
    clusterio_api.send_json("inventory_sync_upload", serialized)
end
```

**Serialization:**
```lua
-- serialize.lua:1-405
function serialize_player(player, player_record)
    return {
        generation = player_record.generation,
        controller = serialize_controller(player),
        name = player.name,
        color = {player.color.r, player.color.g, player.color.b, player.color.a},
        chat_color = {player.chat_color.r, player.chat_color.g, player.chat_color.b, player.chat_color.a},
        tag = player.tag,
        force = player.force.name,
        cheat_mode = player.cheat_mode,
        flashlight = player.is_flashlight_enabled(),
        character = serialize_character(player.character),
        inventories = serialize_inventories(player),
        hotbar = serialize_hotbar(player),
        personal_logistic_slots = serialize_logistic_slots(player),
        crafting_queue = serialize_crafting_queue(player),
    }
end
```

### Phase 2: Upload Request (Lua → Instance)

**IPC Message:**
- Event: `inventory_sync_upload`
- Data: Full `IpcPlayerData` object

**Instance Handler:**
```typescript
// instance.ts:148-170
async handleUpload(player_data: IpcPlayerData) {
    // Skip if disconnected
    if (!this.host.connector.connected || this.disconnecting) {
        return;
    }

    try {
        await this.instance.sendTo(
            "controller",
            new UploadRequest(this.instance.id, player_data.name, player_data),
        );
    } catch (err: any) {
        if (!(err instanceof lib.SessionLost)) {
            this.logger.error(`Error uploading inventory for ${player_data.name}:\n${err.stack}`);
        }
        return;
    }

    // Confirm upload to Lua
    await this.sendRcon(
        `/sc inventory_sync.confirm_upload("${player_data.name}", ${player_data.generation})`,
        true
    );
}
```

### Phase 3: Upload to Controller (Instance → Controller)

**Message:**
```typescript
// messages.ts:92-105
class UploadRequest {
    constructor(
        public instanceId: number,
        public playerName: string,
        public playerData: IpcPlayerData
    )
}
```

**Controller Handler:**
```typescript
// controller.ts:128-161
async handleUploadRequest(request: UploadRequest) {
    let { instanceId, playerName, playerData } = request;
    let store = true;

    // Validate acquisition
    let acquisitionRecord = this.acquiredPlayers.get(playerName);
    if (!acquisitionRecord) {
        this.logger.warn(`${instanceName} uploaded ${playerName} without an acquisition`);
        // Allow anyway (might be from crashed instance)
    } else if (acquisitionRecord.instanceId !== instanceId) {
        this.logger.warn(`${instanceName} uploaded ${playerName} while another instance has it`);
        store = false;
    } else {
        // Release lock on successful upload
        this.acquiredPlayers.delete(playerName);
    }

    // Check generation (only store if newer)
    let oldPlayerData = this.playerDatastore.get(playerName);
    if (store && oldPlayerData && oldPlayerData.generation >= playerData.generation) {
        this.logger.warn(
            `${instanceName} uploaded generation ${playerData.generation} ` +
            `while stored generation is ${oldPlayerData.generation}`
        );
        store = false;
    }

    // Store if valid
    if (store) {
        this.logger.verbose(`Received player data for ${playerName} from ${instanceName}`);
        this.playerDatastore.set(playerName, playerData);
        this.playerDatastoreDirty = true;  // Mark for persistence
    }
}
```

**Controller State Updated:**
```typescript
// Lock released
this.acquiredPlayers.delete(playerName)

// Data stored
this.playerDatastore.set(playerName, playerData)
this.playerDatastoreDirty = true
```

### Phase 4: Upload Confirmation (Instance → Lua)

**RCON Command:**
```
/sc inventory_sync.confirm_upload("PlayerName", generation)
```

**Lua Handler:**
```lua
-- inventory_sync.lua:399-420
function inventory_sync.confirm_upload(player_name, generation)
    local player = game.get_player(player_name)

    -- Must be disconnected and generation must match
    if not player or player.connected then
        return
    end

    local player_record = script_data.players[player.name]
    if not player_record or player_record.generation ~= generation then
        return
    end

    log("Confirmed upload of " .. player_name)

    -- Clear upload state
    script_data.active_uploads[player_name] = nil
    player_record.dirty = false
end
```

### Phase 5: Data Persistence

**Controller saves periodically:**
```typescript
// controller.ts:178-183
async onSaveData() {
    if (this.playerDatastoreDirty) {
        this.playerDatastoreDirty = false;
        await saveDatabase(this.controller.config, this.playerDatastore, this.logger);
    }
}
```

**File:**
- Location: `{controller.database_directory}/inventories.json`
- Format: JSON array of `[playerName, playerData]` pairs

---

## 3. Player Joins Another Server

This is a combination of disconnect (Section 2) + join (Section 1):

**Complete Flow:**

1. **Player leaves Server A** → Upload to controller (Section 2)
   - Serializes current state with `generation++`
   - Sends `inventory_sync_upload`
   - Controller stores data and releases lock

2. **Player joins Server B** → Acquire on new instance (Section 1)
   - Sends `inventory_sync_acquire`
   - Controller grants lock to Server B (replaces Server A's lock)
   - Returns `generation` and `hasData=true`

3. **Download newer data** (Section 1, Phase 6-9)
   - Server B checks: `controller_generation > local_generation`
   - Initiates download if controller has newer data
   - Receives chunks via RCON
   - Deserializes and restores player state

4. **Player synced on Server B**
   - `player_record.sync = true`
   - `player_record.dirty = true`
   - `player_record.generation = <controller_generation>`

**Key Point:** The acquire operation automatically transfers the lock from Server A to Server B. If Server A still held the lock, it's implicitly released when Server B acquires it (assuming Server A is stopped or lock timeout expired).

---

## 4. Timeout & Error Handling

### Lock Timeout on Instance Stop

**Controller Handler:**
```typescript
// controller.ts:54-80
async onInstanceStatusChanged(instance: InstanceInfo) {
    let instanceId = instance.id;

    // Instance deleted/unassigned - remove all locks
    if (["unassigned", "deleted"].includes(instance.status)) {
        for (let [playerName, acquisitionRecord] of this.acquiredPlayers) {
            if (acquisitionRecord.instanceId === instanceId) {
                this.acquiredPlayers.delete(playerName);
            }
        }
    }

    // Instance stopped/unknown - set expiration timeout
    if (["unknown", "stopped"].includes(instance.status)) {
        let timeoutMs = this.controller.config.get("inventory_sync.player_lock_timeout") * 1000;
        for (let acquisitionRecord of this.acquiredPlayers.values()) {
            if (acquisitionRecord.instanceId === instanceId && !acquisitionRecord.expiresMs) {
                acquisitionRecord.expiresMs = Date.now() + timeoutMs;
            }
        }
    }

    // Instance running again - clear timeout
    if (instance.status === "running") {
        for (let acquisitionRecord of this.acquiredPlayers.values()) {
            if (acquisitionRecord.instanceId === instanceId && acquisitionRecord.expiresMs) {
                delete acquisitionRecord.expiresMs;
            }
        }
    }
}
```

**Timeout Behavior:**
- Instance stops → Locks get `expiresMs` timestamp
- After timeout (default 60s) → Other instances can acquire
- Instance restarts → Timeout cleared, keeps existing locks

### Queued Release on Reconnect

**Instance Handler:**
```typescript
// instance.ts:75-93
onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") {
    if (event === "connect") {
        this.disconnecting = false;

        // Release queued players
        (async () => {
            for (let player_name of this.playersToRelease) {
                if (!this.host.connector.connected || this.disconnecting) {
                    return;
                }
                this.playersToRelease.delete(player_name);
                await this.instance.sendTo(
                    "controller",
                    new ReleaseRequest(this.instance.id, player_name)
                );
            }
        })().catch(err =>
            this.logger.error(`Error releasing queued players:\n${err.stack}`)
        );
    }
}
```

### Download Timeout

**Lua Timeout Check:**
```lua
-- inventory_sync.lua:458-480
function inventory_sync.check_active_downloads()
    -- Timeout if no chunks received for 10 seconds (600 ticks)
    for player_name, record in pairs(script_data.active_downloads) do
        if record.last_active <= game.ticks_played - 600 then
            script_data.active_downloads[player_name] = nil
            local player = game.get_player(player_name)
            if player then
                dialog_failed_download.create(player, {
                    player_name = player_name,
                    status = "error",
                    message = "Inventory download failed",
                })
            end
        end
    end
end
```

**Runs every tick** via `on_tick` event handler.

### Upload Retry with Exponential Backoff

**Lua Retry Logic:**
```lua
-- inventory_sync.lua:482-498
function inventory_sync.check_active_uploads()
    for player_name, record in pairs(script_data.active_uploads) do
        if record.last_attempt + record.timeout < game.ticks_played then
            -- Retry with exponential backoff
            record.last_attempt = game.ticks_played
            record.timeout = math.random(record.timeout, record.timeout * 2)

            clusterio_api.send_json("inventory_sync_upload", record.serialized)
        end
    end
end
```

**Retry Schedule:**
- Initial: 10-20 seconds (600-1200 ticks)
- After 1st retry: 10-40 seconds
- After 2nd retry: 10-80 seconds
- Continues doubling until upload succeeds

---

## 5. Data Structures at Each Level

### Lua Module (Factorio)

```lua
script_data = {
    -- Player state tracking
    players = {
        [playerName] = {
            dirty = boolean,           -- Has unsaved changes
            sync = boolean,            -- Has been synced from controller
            generation = number,       -- Data version
        }
    },

    -- Acquisition wait queue
    players_waiting_for_acquire = {
        [playerName] = {
            start_tick = number        -- For timeout tracking
        }
    },

    -- Deferred sync (waiting for cutscene to end)
    players_in_cutscene_to_sync = {
        [playerName] = AcquireResponse  -- Stored response
    },

    -- Active downloads
    active_downloads = {
        [playerName] = {
            started = number,          -- Tick started
            last_active = number,      -- Last chunk received
            generation = number,       -- Target generation
            data = string,             -- Accumulated JSON chunks
            surface = LuaSurface,
            position = {x, y},
            vehicle = LuaEntity,       -- Optional
            restart = boolean,         -- Optional
        }
    },

    -- Completed downloads (waiting for deserialization)
    finished_downloads = {
        [playerName] = {
            started = number,
            last_active = number,
            generation = number,
            data = string,             -- Complete JSON
            surface = LuaSurface,
            position = {x, y},
            vehicle = LuaEntity,       -- Optional
        }
    },

    -- Queued uploads (with retry)
    active_uploads = {
        [playerName] = {
            serialized = IpcPlayerData,
            last_attempt = number,     -- Tick of last attempt
            timeout = number,          -- Ticks until retry
        }
    }
}
```

### Instance Plugin (Node.js)

```typescript
// In-memory state
playersToRelease: Set<string>           // Players waiting for controller reconnect
disconnecting: boolean                  // Graceful disconnect flag
```

### Controller Plugin (Node.js)

```typescript
// In-memory state
acquiredPlayers: Map<string, {
    instanceId: number,
    expiresMs?: number          // Timeout after instance stops
}>

playerDatastore: Map<string, IpcPlayerData>

playerDatastoreDirty: boolean           // Needs persistence

// IpcPlayerData structure
interface IpcPlayerData {
    generation: number,
    controller: string,                 // "character", "god", "spectator", "ghost"
    name: string,
    color: number[],                    // [r, g, b, a]
    chat_color: number[],
    tag: string,
    force: string,
    cheat_mode: boolean,
    flashlight: boolean,
    ticks_to_respawn?: number,
    character?: {
        position: {x: number, y: number},
        health: number,
        character_running_speed_modifier: number,
        character_mining_speed_modifier: number,
        character_crafting_speed_modifier: number,
        character_build_distance_bonus: number,
        character_reach_distance_bonus: number,
        character_item_drop_distance_bonus: number,
        character_item_pickup_distance_bonus: number,
        character_loot_pickup_distance_bonus: number,
        character_resource_reach_distance_bonus: number,
        character_inventory_slots_bonus: number,
        inventories: {...},
    },
    inventories?: {...},
    hotbar?: {...},
    personal_logistic_slots?: {...},
    crafting_queue?: {...}
}
```

### Persistent Storage (File)

**Location:** `{controller.database_directory}/inventories.json`

**Format:**
```json
[
    ["PlayerName1", { /* IpcPlayerData */ }],
    ["PlayerName2", { /* IpcPlayerData */ }],
    ...
]
```

**Loaded:** On controller startup
**Saved:** When `playerDatastoreDirty = true` during `onSaveData()`

---

## 6. Message Sequence Diagrams

### Player Joins with Existing Data

```
┌──────┐          ┌──────────┐          ┌────────────┐          ┌────────────┐
│ Lua  │          │ Instance │          │ Controller │          │ Database   │
└──┬───┘          └────┬─────┘          └─────┬──────┘          └──────┬─────┘
   │                   │                      │                        │
   │ on_player_joined  │                      │                        │
   ├─acquire(IPC)─────>│                      │                        │
   │                   ├─AcquireRequest──────>│                        │
   │                   │                      ├─acquire lock           │
   │                   │                      │  (set acquiredPlayers) │
   │                   │<─AcquireResponse─────┤                        │
   │<─acquire_response─┤  (generation, has_data)                       │
   │  (RCON)           │                      │                        │
   │                   │                      │                        │
   │ check cutscene    │                      │                        │
   │ set spectator     │                      │                        │
   │                   │                      │                        │
   ├─download(IPC)────>│                      │                        │
   │                   ├─DownloadRequest─────>│                        │
   │                   │                      ├─lookup player          │
   │                   │                      │                        │
   │                   │<─DownloadResponse────┤<─read from datastore───┤
   │                   │  (playerData)        │                        │
   │                   │                      │                        │
   │<─download_inv─────┤  (RCON, chunk 1)     │                        │
   │<─download_inv─────┤  (RCON, chunk 2)     │                        │
   │<─download_inv─────┤  ...                 │                        │
   │<─download_inv─────┤  (RCON, chunk N)     │                        │
   │                   │                      │                        │
   │ deserialize       │                      │                        │
   │ restore position  │                      │                        │
   │ player synced     │                      │                        │
   │ dirty = true      │                      │                        │
   │                   │                      │                        │
```

### Player Leaves Server

```
┌──────┐          ┌──────────┐          ┌────────────┐          ┌────────────┐
│ Lua  │          │ Instance │          │ Controller │          │ Database   │
└──┬───┘          └────┬─────┘          └─────┬──────┘          └──────┬─────┘
   │                   │                      │                        │
   │ on_pre_player_left                       │                        │
   │ serialize         │                      │                        │
   │ generation++      │                      │                        │
   │                   │                      │                        │
   ├─upload(IPC)──────>│                      │                        │
   │                   ├─UploadRequest───────>│                        │
   │                   │  (playerData)        ├─validate generation    │
   │                   │                      ├─store data             │
   │                   │                      │  (mark dirty)          │
   │                   │<─UploadResponse──────┤                        │
   │                   │                      ├─release lock           │
   │<─confirm_upload───┤  (RCON)              │  (delete from acquired)│
   │  (clear dirty)    │                      │                        │
   │                   │                      │                        │
   │                   │                      │ on_save_data           │
   │                   │                      ├─saveDatabase()────────>│
   │                   │                      │                        ├─write JSON
   │                   │                      │                        │
```

### Player Moves Between Servers

```
┌─────────┐   ┌─────────┐   ┌──────────┐   ┌────────────┐   ┌────────────┐
│Server A │   │Server B │   │Instance B│   │ Controller │   │ Database   │
└────┬────┘   └────┬────┘   └────┬─────┘   └─────┬──────┘   └──────┬─────┘
     │             │              │               │                  │
     │ player left │              │               │                  │
     ├─upload──────┼─────────────>│               │                  │
     │             │              ├─UploadRequest>│                  │
     │             │              │               ├─release lock A   │
     │             │              │               ├─store data───────>│
     │             │              │               │                  │
     │             │ player joined│               │                  │
     │             ├─acquire─────>│               │                  │
     │             │              ├─AcquireReq───>│                  │
     │             │              │               ├─acquire lock B   │
     │             │              │<─AcquireResp──┤  (replaces A)    │
     │             │<─response────┤  (new gen)    │                  │
     │             │              │               │                  │
     │             ├─download────>│               │                  │
     │             │              ├─DownloadReq──>│                  │
     │             │              │               ├─read data────────>│
     │             │              │<─PlayerData───┤                  │
     │             │<─chunks──────┤  (RCON)       │                  │
     │             │              │               │                  │
     │             │ deserialize  │               │                  │
     │             │ synced       │               │                  │
     │             │              │               │                  │
```

---

## 7. Key Responsibilities by Component

### Lua Module (Factorio)
- **Events:** Monitors player lifecycle (`on_player_created`, `on_player_joined_game`, `on_pre_player_left_game`)
- **Serialization:** Converts player state to JSON (`serialize_player()`)
- **Deserialization:** Restores player state from JSON (`deserialize_player()`)
- **Chunking:** Accumulates RCON chunks during download
- **Retry Logic:** Exponential backoff for failed uploads
- **UI:** Progress dialogs, error messages
- **State Management:** Cutscene detection, spectator mode during downloads

### Instance Plugin (Node.js)
- **IPC Bridge:** Connects Lua ↔ Controller via Link Protocol
- **Chunking:** Splits large inventories for RCON transmission (default 1000 bytes)
- **Connection Handling:** Queues releases when controller disconnected
- **RCON:** Sends commands to Lua module
- **Logging:** Debug/verbose logging for troubleshooting

### Controller Plugin (Node.js)
- **Locking:** Distributed lock implementation (one writer per player)
- **Storage:** Persistent player data store (`playerDatastore`)
- **Validation:** Generation checks, acquisition validation
- **Timeout Management:** Lock expiration when instances stop
- **Persistence:** Saves to `inventories.json` on dirty flag

---

## 8. Configuration

### Instance-Level Settings

**`inventory_sync.rcon_chunk_size`**
- Type: `number`
- Default: `1000` bytes
- Description: Size of chunks when downloading inventory data via RCON
- Impact: Smaller = more commands, more overhead; Larger = fewer commands, but risk hitting RCON limits

### Controller-Level Settings

**`inventory_sync.player_lock_timeout`**
- Type: `number`
- Default: `60` seconds
- Description: How long to hold player locks after instance stops before allowing another instance to acquire
- Impact:
  - Too short: Duplicate player acquisition during brief disconnects
  - Too long: Players stuck waiting when instance crashes

---

## Summary

The inventory_sync plugin orchestrates a complex dance between Lua, Node.js instances, and the controller to ensure:

1. **Consistency:** Only one server has write access to a player at a time (distributed lock)
2. **Persistence:** Player data survives server restarts and transfers
3. **Performance:** Chunking allows large inventories to transfer via RCON
4. **Resilience:** Retries, timeouts, and queue mechanisms handle network issues
5. **User Experience:** Seamless transitions between servers with progress feedback

The key insight is the **three-tier architecture**:
- **Lua:** Observes events, serializes state
- **Instance:** Bridges communication, handles chunking
- **Controller:** Manages locks, provides persistent storage

This separation of concerns enables reliable inventory synchronization across a distributed cluster of Factorio servers.
