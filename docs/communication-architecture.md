# Clusterio Communication Architecture

This document explains how Clusterio achieves bidirectional communication between Node.js (the Host) and Factorio (Lua), including the technical details of stdout parsing, RCON, and the "IPC" system.

## Table of Contents

- [Overview](#overview)
- [Communication Channels](#communication-channels)
- [Lua → Node.js: The "IPC" System](#lua--nodejs-the-ipc-system)
- [Node.js → Lua: RCON Commands](#nodejs--lua-rcon-commands)
- [Complete Round-Trip Example](#complete-round-trip-example)
- [Configuration](#configuration)
- [Performance & Concurrency](#performance--concurrency)
- [Best Practices](#best-practices)

## Overview

Clusterio uses an **asymmetric bidirectional communication** system:

| Direction | Protocol | Method | Format |
|-----------|----------|--------|--------|
| **Lua → Node.js** | stdout parsing | `print()` statements | `\f$ipc:channel?jDATA` |
| **Node.js → Lua** | RCON (TCP) | Remote commands | `/sc function("DATA")` |

This design works around Factorio's limitations:
- ✅ Factorio has no built-in IPC mechanism
- ✅ Factorio doesn't read from stdin in server mode
- ✅ RCON allows executing arbitrary Lua code
- ✅ stdout is already monitored for logging

## Communication Channels

```
┌─────────────────────────────────────────────────────────────┐
│                      Node.js (Host)                         │
│                                                             │
│  ┌──────────────────┐              ┌──────────────────┐   │
│  │  stdout Parser   │              │  RCON Client     │   │
│  │  (Event Emitter) │              │  (TCP Socket)    │   │
│  └────────▲─────────┘              └────────┬─────────┘   │
│           │                                 │              │
│           │ (1) Parse stdout                │ (2) Send     │
│           │     \f$ipc:...                  │     /sc ...  │
└───────────┼─────────────────────────────────┼──────────────┘
            │                                 │
            │ Pipe                            │ TCP
            │                                 │
┌───────────┴─────────────────────────────────▼──────────────┐
│                    Factorio Process                         │
│                                                             │
│  Lua Code:                                                  │
│  • clusterio_api.send_json() → print("\f$ipc:...") ────►(1)│
│  • my_callback(data) ◄──── RCON executes ◄──────────────(2)│
└─────────────────────────────────────────────────────────────┘
```

## Lua → Node.js: The "IPC" System

Despite the name "IPC", this is actually **stdout parsing with magic prefixes**.

### How It Works

#### 1. Lua Sends Data

From `packages/host/modules/clusterio/api.lua`:

```lua
function api.send_json(channel, data)
    -- Escape special characters in channel name
    channel = channel:gsub("([\x00-\x1f?\\])", function(match)
        return "\\x" .. string.format("%02x", match:byte())
    end)

    data = compat.table_to_json(data)

    -- Small data: Print directly to stdout
    if #data < 4000 then
        print("\f$ipc:" .. channel .. "?j" .. data)

    -- Large data: Write to file and print filename
    else
        local file_name = "clst_" .. file_no .. ".json"
        compat.write_file(file_name, data, false, 0)
        print("\f$ipc:" .. channel .. "?f" .. file_name)
    end
end
```

**Example output to stdout:**
```
\f$ipc:inventory_sync_acquire?j{"player_name":"Alice"}
```

**Breaking down the format:**
- `\f` = Form feed character (ASCII 12) - marker for special output
- `$ipc:` = Magic string identifying this as IPC
- `inventory_sync_acquire` = Channel name
- `?j` = Type indicator: "j" = JSON inline
- `{"player_name":"Alice"}` = The actual JSON data

For large data (>4KB):
```
\f$ipc:inventory_sync_upload?fclst_123.json
```
- `?f` = Type indicator: "f" = file
- `clst_123.json` = Filename in `script-output/` directory

#### 2. Node.js Spawns Factorio with Piped stdio

From `packages/host/src/server.ts`:

```typescript
this._server = child_process.spawn(
    this.binaryPath(),  // Path to factorio executable
    ["--start-server", save, "--rcon-port", ...],
    {
        detached: true,
        stdio: "pipe",  // <-- Critical: Creates pipes for stdout/stderr
    }
);
```

**What `stdio: "pipe"` does:**
1. Creates OS-level pipes (anonymous pipes on Unix, named pipes on Windows)
2. Connects Factorio's stdout file descriptor to the write end of the pipe
3. Exposes the read end as `this._server.stdout` (a Node.js Readable Stream)
4. Node.js reads from the pipe asynchronously in the event loop

#### 3. Node.js Attaches Stream Processors

From `packages/host/src/server.ts`:

```typescript
_attachStdio() {
    // Create a line splitter for stdout
    let stdout = new lib.LineSplitter({ readableObjectMode: true });
    stdout.on("data", line => { this._handleOutput(line, "stdout"); });
    this._server!.stdout.pipe(stdout);  // Pipe stdout through line splitter

    // Same for stderr
    let stderr = new lib.LineSplitter({ readableObjectMode: true });
    stderr.on("data", line => { this._handleOutput(line, "stderr"); });
    this._server!.stderr.pipe(stderr);
}
```

**Processing flow:**
```
Factorio stdout → OS Pipe → Node.js Readable Stream → LineSplitter → _handleOutput()
```

#### 4. Node.js Parses Each Line

From `packages/host/src/server.ts`:

```typescript
_handleOutput(rawLine: Buffer, source: "stdout" | "stderr") {
    // Check if it's an IPC message
    if (rawLine.subarray(0, 6).equals(Buffer.from("\f$ipc:"))) {
        this._handleIpc(rawLine).catch(err => this.emit("error", err));
        return;  // Don't process as normal output
    }

    // Not IPC, emit as raw output and parse as regular Factorio logs
    this.emit(source, rawLine);
    let line = rawLine.toString("utf-8");
    let parsed = parseOutput(line, source);
    this.emit("output", parsed, line);
}
```

#### 5. Node.js Handles IPC Messages

From `packages/host/src/server.ts`:

```typescript
async _handleIpc(line: Buffer) {
    // Find "?" separator between channel and payload
    let channelEnd = line.indexOf("?");

    // Extract channel name (after "\f$ipc:")
    let channel = line.subarray(6, channelEnd).toString("utf-8")
        .replace(/\\x([0-9a-f]{2})/g, (match, p1) =>
            String.fromCharCode(parseInt(p1, 16))
        );

    // Get type: "j" (JSON inline) or "f" (file)
    let type = line.subarray(channelEnd + 1, channelEnd + 2).toString("utf-8");

    let content;
    if (type === "j") {
        // Parse JSON directly from stdout
        content = JSON.parse(line.subarray(channelEnd + 2).toString("utf-8"));

    } else if (type === "f") {
        // Read JSON from file
        let fileName = line.subarray(channelEnd + 2).toString("utf-8");
        let filePath = this.writePath("script-output", fileName);
        content = JSON.parse(await fs.readFile(filePath, "utf-8"));
        await fs.unlink(filePath);  // Delete file after reading
    }

    // Emit event that plugins can listen to
    if (!this.emit(`ipc-${channel}`, content)) {
        this._logger.warn(`Warning: Unhandled ipc-${channel}`, { content });
    }
}
```

#### 6. Plugins Listen to Events

From `plugins/inventory_sync/instance.ts`:

```typescript
this.instance.server.on(
    "ipc-inventory_sync_acquire",  // Event name = "ipc-" + channel
    (request: IpcPlayerName) => this.handleAcquire(request)
);
```

### Why "IPC" is a Misnomer

Traditional IPC uses:
- Shared memory
- Named pipes
- Unix domain sockets
- Message queues

Clusterio's "IPC" is actually:
- ✅ **stdout parsing** with a magic prefix (`\f$ipc:`)
- ✅ A **clever workaround** for Factorio's lack of IPC
- ✅ **Fire-and-forget** (no acknowledgment)
- ✅ **Simple and portable** (works everywhere stdout works)

## Node.js → Lua: RCON Commands

Sending data FROM Node.js TO Factorio uses **RCON** (Remote Console), Factorio's built-in remote control protocol.

### How It Works

#### 1. RCON Connection Setup

When Factorio starts with `--rcon-port` and `--rcon-password`, it opens a TCP socket.

From `packages/host/src/server.ts`:

```typescript
async _startRcon() {
    let config = {
        host: "127.0.0.1",
        port: this.rconPort,           // Random port (49152-65535)
        password: this.rconPassword,   // Random generated password
        timeout: 200000,               // 200 seconds
        maxPending: this.maxConcurrentCommands,  // Default: 5
    };

    this._rconClient = new Rcon(config);  // Using 'rcon-client' npm package
    await this._rconClient.connect();
}
```

#### 2. Node.js Sends Commands via RCON

From `plugins/inventory_sync/instance.ts`:

```typescript
async handleAcquire(request: IpcPlayerName) {
    // Get data from controller
    let acquireResponse = await this.instance.sendTo("controller", ...);

    // Build response object
    let response = {
        player_name: request.player_name,
        status: acquireResponse.status,
        generation: acquireResponse.generation,
    };

    // Serialize to JSON and escape special characters
    let json = lib.escapeString(JSON.stringify(response));

    // Send via RCON - call Lua function with JSON as argument
    await this.sendRcon(
        `/sc inventory_sync.acquire_response("${json}")`,
        true
    );
}
```

**What gets sent over TCP:**
```lua
/sc inventory_sync.acquire_response("{\"player_name\":\"Alice\",\"status\":\"acquired\"}")
```

Breaking it down:
- `/sc` = Server Command (runs Lua code)
- `inventory_sync.acquire_response` = Global Lua function
- `"..."` = Escaped JSON string as argument

#### 3. Factorio Receives and Executes

Factorio's RCON server:
1. Receives the TCP message
2. Parses the `/sc` command
3. Executes the Lua code: `inventory_sync.acquire_response("...")`
4. Sends response back over TCP

From `plugins/inventory_sync/module/inventory_sync.lua`:

```lua
function inventory_sync.acquire_response(data)
    local script_data = get_script_data()
    local response = assert(compat.json_to_table(data))  -- Parse JSON

    if response.status == "acquired" and response.has_data then
        -- Player has data, start downloading it
        inventory_sync.initiate_inventory_download(player, ...)
    end
end
```

### Why Not Use stdin?

You might wonder: "Why not just pipe data INTO Factorio via stdin?"

**Problems with stdin:**
- ❌ Factorio **doesn't read from stdin** in server mode
- ❌ No Lua API to read from stdin
- ❌ Would be synchronous/blocking if it existed

**RCON advantages:**
- ✅ **Asynchronous**: Doesn't block Factorio game loop
- ✅ **Built-in**: Factorio already has RCON support
- ✅ **Powerful**: Can execute arbitrary Lua code
- ✅ **Reliable**: TCP protocol with acknowledgments
- ✅ **Response handling**: Can get return values from Lua

### Large Data Handling

For large data (like inventory downloads), data is sent in chunks:

From `plugins/inventory_sync/instance.ts`:

```typescript
async handleDownload(request: IpcPlayerName) {
    // Get player data from controller
    let response = await this.instance.sendTo("controller", ...);

    // Split into chunks (RCON has size limits)
    const chunkSize = this.instance.config.get("inventory_sync.rcon_chunk_size");
    const chunks = chunkify(chunkSize, JSON.stringify(response.playerData));

    // Send each chunk sequentially via RCON
    for (let i = 0; i < chunks.length; i++) {
        const chunk = lib.escapeString(chunks[i]);
        await this.sendRcon(
            `/sc inventory_sync.download_inventory('${playerName}','${chunk}',${i + 1},${chunks.length})`,
            true
        );
    }
}
```

**Why chunk?**
- RCON commands have size limits (~1-2 MB depending on settings)
- Large blueprints can be 100+ KB of JSON
- Chunking prevents command buffer overflows

### JSON Escaping

When passing JSON via RCON, special characters must be escaped:

```typescript
function escapeString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')   // Backslash: \ → \\
        .replace(/"/g, '\\"')     // Quote: " → \"
        .replace(/\n/g, '\\n')    // Newline: \n → \\n
        .replace(/\r/g, '\\r');   // Carriage return: \r → \\r
}
```

**Escaping overhead:** ~5-10% size increase

**Example:**
```json
// Original (50 bytes)
{"name":"platform","data":[1,2,3]}

// Escaped (52 bytes)
{\"name\":\"platform\",\"data\":[1,2,3]}
```

## Complete Round-Trip Example

Let's trace a complete interaction from the inventory_sync plugin:

### Step 1: Player Joins (Lua → Node.js)

```lua
-- inventory_sync.lua
script.on_event(defines.events.on_player_joined_game, function(event)
    local player = game.get_player(event.player_index)

    -- Send acquire request
    clusterio_api.send_json("inventory_sync_acquire", {
        player_name = player.name
    })
end)
```

**What happens:**
1. Lua calls `send_json()`
2. api.lua prints: `\f$ipc:inventory_sync_acquire?j{"player_name":"Alice"}`
3. Factorio writes to stdout
4. OS pipes bytes to Node.js
5. Node.js reads from `this._server.stdout`
6. LineSplitter emits line as Buffer
7. `_handleOutput()` detects `\f$ipc:` prefix
8. `_handleIpc()` parses channel and data
9. Emits event: `server.emit("ipc-inventory_sync_acquire", {player_name: "Alice"})`

### Step 2: Plugin Receives Event (Node.js processing)

```typescript
// instance.ts
this.instance.server.on("ipc-inventory_sync_acquire", async (request) => {
    // Ask controller for permission to sync this player
    let acquireResponse = await this.instance.sendTo(
        "controller",
        new AcquireRequest(this.instance.id, request.player_name)
    );

    // ... process response
});
```

### Step 3: Plugin Responds (Node.js → Lua)

```typescript
// instance.ts (continued)
async handleAcquire(request: IpcPlayerName) {
    // Build response
    let response = {
        player_name: "Alice",
        status: "acquired",
        generation: 5,
        has_data: true,
    };

    let json = lib.escapeString(JSON.stringify(response));

    // Send back to Factorio via RCON
    await this.sendRcon(
        `/sc inventory_sync.acquire_response("${json}")`,
        true
    );
}
```

**What happens:**
1. Node.js calls `sendRcon()`
2. Escapes JSON: `{\"player_name\":\"Alice\",...}`
3. Sends over TCP to Factorio's RCON server
4. Factorio receives command
5. Executes: `inventory_sync.acquire_response("...")`

### Step 4: Lua Receives Response (Lua execution)

```lua
-- inventory_sync.lua
function inventory_sync.acquire_response(data)
    local response = json_to_table(data)
    -- response = {
    --   player_name = "Alice",
    --   status = "acquired",
    --   generation = 5,
    --   has_data = true
    -- }

    if response.status == "acquired" and response.has_data then
        -- Start downloading inventory
        inventory_sync.initiate_inventory_download(...)
    end
end
```

### Step 5: Download Request (Lua → Node.js again)

```lua
-- inventory_sync.lua (continued)
function inventory_sync.initiate_inventory_download(player, ...)
    -- Request inventory data
    clusterio_api.send_json("inventory_sync_download", {
        player_name = player.name
    })
end
```

### Step 6: Streaming Data Back (Node.js → Lua, chunked)

```typescript
// instance.ts
async handleDownload(request: IpcPlayerName) {
    let response = await this.instance.sendTo("controller", ...);

    const chunks = chunkify(500_000, JSON.stringify(response.playerData));

    for (let i = 0; i < chunks.length; i++) {
        const chunk = lib.escapeString(chunks[i]);
        await this.sendRcon(
            `/sc inventory_sync.download_inventory('${request.player_name}','${chunk}',${i+1},${chunks.length})`,
            true
        );
    }
}
```

**Timeline visualization:**
```
0ms:    Player joins Factorio
1ms:    Lua sends IPC acquire → Node.js
2ms:    Node.js receives via stdout
3ms:    Node.js asks controller
50ms:   Controller responds
51ms:   Node.js sends RCON callback → Lua
52ms:   Lua requests download (IPC)
53ms:   Node.js receives download request
54ms:   Node.js sends chunk 1/50 (RCON)
55ms:   Node.js sends chunk 2/50 (RCON)
...     (up to 5 concurrent RCON commands)
200ms:  All chunks received
201ms:  Lua deserializes and spawns player
```

## Configuration

### RCON Concurrency

**Setting:** `factorio.max_concurrent_commands`
**Location:** Per-instance configuration
**Default:** 5

**How to configure:**

```bash
# Via CLI
npx clusterioctl instance config set <instance_id> factorio.max_concurrent_commands 10

# Via config file (instances/<id>/instance.json)
{
  "factorio.max_concurrent_commands": 10
}
```

**When to increase (10-20):**
- Large inventory transfers
- High-latency networks
- Powerful server hardware

**When to decrease (1-3):**
- Underpowered servers
- Debugging RCON issues
- Single-player testing

### Other RCON Settings

From `packages/host/src/server.ts`:

```typescript
{
    timeout: 200000,              // 200 seconds (not configurable)
    maxPending: 5,                // Configurable via max_concurrent_commands
}
```

**Formula for safe concurrent value (older Factorio versions):**
```
max_concurrent = 7000 / (3 × game_speed × maximum_segment_size)
```

Typical result: ~20 commands at 1x game speed

## Performance & Concurrency

### How RCON Concurrency Works

Even though code uses `await` in a loop:

```typescript
for (let i = 0; i < chunks.length; i++) {
    await this.sendRcon(chunk[i]);  // Looks sequential...
}
```

The underlying RCON client can have **up to 5 commands in-flight simultaneously**!

**Visual timeline:**
```
Time →

Chunk 1: [send]────[wait]────[response]
Chunk 2:      [send]────[wait]────[response]
Chunk 3:           [send]────[wait]────[response]
Chunk 4:                [send]────[wait]────[response]
Chunk 5:                     [send]────[wait]────[response]
Chunk 6:                          [send]────[wait]────[response]
         ^                              ^
         |                              |
    maxPending=5                   Chunk 6 waits
    commands active                until slot opens
```

**Effective throughput:**
- Sequential (1 at a time): 50 chunks × 20ms = 1000ms
- Concurrent (5 at a time): 50 chunks ÷ 5 = 10 batches × 20ms = 200ms

### Trade-offs

| Concurrency | Pros | Cons |
|-------------|------|------|
| 1 | Easy to debug, guaranteed order | Slow (1 command at a time) |
| 5 (default) | Good balance | Adequate for most use cases |
| 10-20 | Faster bulk operations | Higher memory, packet loss impact |
| >20 | Maximum throughput | Can make multiplayer unplayable |

## Best Practices

### DO ✅

1. **Always escape JSON for RCON:**
   ```typescript
   const escaped = json
       .replace(/\\/g, '\\\\')
       .replace(/"/g, '\\"')
       .replace(/\n/g, '\\n')
       .replace(/\r/g, '\\r');
   ```

2. **Use `send_json` for data OUT of Factorio:**
   - Handles large files automatically (>4KB → file)
   - No manual file management needed

3. **Check size after escaping:**
   ```typescript
   const escapedSize = escaped.length;
   if (escapedSize > 1_200_000) {
       throw new Error(`Command too large: ${escapedSize} bytes`);
   }
   ```

4. **Keep individual RCON commands < 1 MB** after escaping

5. **Use sequential `await` loops for ordered delivery:**
   ```typescript
   for (let chunk of chunks) {
       await sendRcon(chunk);  // Order guaranteed
   }
   ```

6. **Handle unknown IPC channels gracefully:**
   ```typescript
   if (!this.emit(`ipc-${channel}`, content)) {
       this._logger.warn(`Unhandled ipc-${channel}`);
   }
   ```

## Related Documentation

- [data-transfer-limits.md](data-transfer-limits.md) - Detailed limits and size constraints
- [factorio-saves.md](factorio-saves.md) - Save patching and module injection
- [writing-plugins.md](writing-plugins.md) - Plugin development guide
- [developing-for-clusterio.md](developing-for-clusterio.md) - Factorio mod integration

## Summary

Clusterio's communication system is an elegant workaround for Factorio's limitations:

| Feature | Implementation | Why It Works |
|---------|---------------|--------------|
| **Lua → Node.js** | stdout parsing with `\f$ipc:` prefix | Factorio already outputs to stdout |
| **Node.js → Lua** | RCON commands over TCP | Factorio has built-in RCON support |
| **Large data (OUT)** | Automatic file switching at 4KB | Prevents stdout stuttering |
| **Large data (IN)** | Chunking with sequential RCON | Stays under RCON size limits |
| **Concurrency** | Up to 5 concurrent RCON commands | Balances throughput and stability |
| **Ordering** | Sequential for RCON, best-effort for IPC | Predictable behavior |

Despite being called "IPC", it's actually a clever combination of:
- 🎯 **stdout parsing** (Lua → Node.js)
- 🎯 **RCON execution** (Node.js → Lua)
- 🎯 **File-based transport** (for large data)
- 🎯 **Async queuing** (for concurrency)

This design enables rich, bidirectional communication without requiring any changes to Factorio itself!
