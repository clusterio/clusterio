# Save Patching and Hot Loading Guide

This guide explains how Clusterio's save patching system works, the differences between save-patched modules and regular Factorio mods, and how to develop plugins efficiently using the `external_plugins` directory and `--dev-plugin` flag.

## Table of Contents

- [Overview](#overview)
- [Save Patching vs Regular Mods](#save-patching-vs-regular-mods)
- [How Save Patching Works](#how-save-patching-works)
- [Plugin Development Setup](#plugin-development-setup)
- [Module Structure](#module-structure)
- [Development Workflow](#development-workflow)
- [Common Patterns](#common-patterns)

## Overview

Clusterio uses a **save patching** system to inject Lua code into Factorio saves at runtime. This is fundamentally different from regular Factorio mods and enables unique capabilities required for cluster coordination.

### Key Concepts

- **Save Patching**: Modifying the save file's ZIP structure to inject Lua modules and regenerate `control.lua`
- **Modules**: Lua code directories that get patched into saves (located in plugin's `module/` folder)
- **clusterio_lib**: A regular Factorio mod that provides the Clusterio API (for standalone mods)
- **Hot Loading**: Real-time recompilation during development using `--dev-plugin`
- **external_plugins**: Development directory for testing plugins with hot loading

## Save Patching vs Regular Mods

### When to Use Save-Patched Modules

Use save patching (create a `module/` directory in your plugin) when you need:

1. **Multi-instance coordination**: Managing state across multiple Factorio servers
2. **RCON callback interface**: Bidirectional conversations between Node.js and Lua
3. **Dynamic loading**: Injecting code without requiring game restart or mod portal
4. **Cross-server state management**: Syncing player data, research, etc. across instances
5. **Cluster-level orchestration**: Coordinating actions that span multiple servers
6. **Access to internal Clusterio events**: `on_server_startup`, `on_instance_updated`, etc.

**Examples**: inventory_sync, research_sync, player_auth

### When to Use clusterio_lib as a Regular Mod

Use clusterio_lib as a dependency (regular Factorio mod) when you:

1. **Only need single-instance features**: Your mod works on one server at a time
2. **Don't need RCON callbacks**: Simple fire-and-forget IPC messages are sufficient
3. **Want mod portal distribution**: Regular mods can be uploaded to the Factorio mod portal
4. **Need standard mod features**: Migrations, data stage, etc.
5. **Prefer standard Factorio workflows**: Easier for Factorio modders to understand

**Example use case**: A mod that sends statistics to Clusterio but doesn't need coordination

### Comparison Table

| Feature | Save-Patched Module | clusterio_lib Mod |
|---------|---------------------|-------------------|
| **Multi-instance coordination** | ✅ Full support | ❌ Limited |
| **RCON callbacks** | ✅ Yes | ❌ No |
| **Dynamic loading** | ✅ No restart needed | ❌ Requires restart |
| **Mod portal compatible** | ❌ No | ✅ Yes |
| **Development complexity** | Higher | Lower |
| **Requires save patching** | ✅ Yes | ❌ No |
| **Access to clusterio events** | ✅ Full access | ⚠️ Limited |
| **Hot reload during dev** | ✅ Via `--dev-plugin` | ❌ No |
| **Initialization** | Automatic | Manual (`clusterio_api.init()`) |

### Hybrid Approach

You can create **both** a save-patched module and a regular mod:
- Module handles cluster coordination
- Regular mod provides optional single-player features

## How Save Patching Works

### The Process

When an instance starts, Clusterio patches the save file through these steps:

1. **Load Save**: Opens the save ZIP file using JSZip
2. **Detect Scenario**: Identifies the base scenario (freeplay, etc.) by hashing `control.lua`
3. **Read Patch Info**: Loads `clusterio.json` if present (tracks what's already patched)
4. **Remove Old Modules**: Deletes previously patched files
5. **Load New Modules**: Reads modules from plugins and standalone module directories
6. **Reorder Dependencies**: Sorts modules to satisfy dependency requirements
7. **Inject Files**: Adds all module files into the save ZIP
8. **Generate Loader**: Creates new `control.lua` that loads all modules via event_handler
9. **Write clusterio.json**: Records patch metadata for next time
10. **Save and Swap**: Writes temporary file, then atomically replaces the original

### File Structure Inside a Patched Save

```
save.zip
├── control.lua                    # Generated loader
├── scenario.lua                   # Original control.lua (backed up)
├── clusterio.json                 # Patch metadata
├── modules/
│   ├── clusterio/                # Core Clusterio module
│   │   ├── impl.lua
│   │   ├── compat.lua
│   │   └── api.lua
│   ├── clusterio.lua             # Auto-generated loader
│   ├── inventory_sync/           # Plugin module
│   │   ├── inventory_sync.lua
│   │   └── gui/
│   │       └── dialog_failed_download.lua
│   └── inventory_sync.lua        # Auto-generated loader
└── locale/
    └── en/
        └── inventory_sync-messages.cfg  # Locale files auto-mapped
```

### Generated control.lua

Clusterio generates a `control.lua` that looks like this:

```lua
-- Auto generated scenario module loader created by Clusterio
-- Modifications to this file will be lost when loaded in Clusterio
clusterio_patch_number = 1

local event_handler = require("event_handler")

-- Scenario modules
event_handler.add_lib(require("scenario"))

-- Clusterio modules
event_handler.add_lib(require("modules/clusterio/impl"))
event_handler.add_lib(require("modules/clusterio/compat"))
event_handler.add_lib(require("modules/inventory_sync/inventory_sync"))
event_handler.add_lib(require("modules/inventory_sync/gui/dialog_failed_download"))
```

### clusterio.json Structure

```json
{
  "version": 1,
  "patch_number": 1,
  "scenario": {
    "name": "freeplay",
    "version": "2.0.0",
    "load": [],
    "require": ["scenario"]
  },
  "modules": [
    {
      "name": "clusterio",
      "version": "0.0.0",
      "load": ["impl.lua", "compat.lua"],
      "require": [],
      "dependencies": {},
      "files": [
        "modules/clusterio/impl.lua",
        "modules/clusterio/compat.lua",
        "modules/clusterio/api.lua",
        "modules/clusterio.lua"
      ]
    },
    {
      "name": "inventory_sync",
      "version": "2.0.0",
      "load": ["inventory_sync.lua", "gui/dialog_failed_download.lua"],
      "require": [],
      "dependencies": {
        "clusterio": "*"
      },
      "files": [
        "modules/inventory_sync/inventory_sync.lua",
        "modules/inventory_sync/gui/dialog_failed_download.lua",
        "modules/inventory_sync.lua"
      ]
    }
  ]
}
```

### Dependency Resolution

Modules are reordered to satisfy dependencies:

```javascript
// From patch.ts:262-304
function reorderDependencies(modules: SaveModule[]) {
    let present = new Map<string, string>();
    let hold = new Map<string, [SaveModule]>();

    // Iterate through modules, checking dependencies
    for (let module of modules) {
        for (let [dependency, requirement] of module.info.dependencies) {
            if (!present.has(dependency)) {
                // Unmet dependency, hold this module until dependency is loaded
                hold.get(dependency).push(module);
                modules.splice(index, 1);
            }
        }
        present.set(module.info.name, module.info.version);
    }
}
```

**Errors detected:**
- Missing dependencies
- Version mismatches (semver)
- Circular dependencies

## Plugin Development Setup

### Using the external_plugins Directory

The `external_plugins/` directory enables hot loading for plugins developed outside the main repository.

#### Setup Steps

1. **Place your plugin in external_plugins:**
```bash
# From clusterio repo root
cd external_plugins
git clone https://github.com/yourname/clusterio-plugin-yourplugin
# Or create a symlink
ln -s /path/to/your/plugin clusterio-plugin-yourplugin
```

2. **Install dependencies:**
```bash
# From clusterio repo root
pnpm install
```
This incorporates your plugin's dependencies into the shared pnpm workspace.

3. **Add plugin to development cluster:**
```bash
node packages/ctl plugin add ./external_plugins/clusterio-plugin-yourplugin
```

4. **Start controller with hot loading:**
```bash
node packages/controller run --dev --dev-plugin yourplugin
```

### Hot Loading with --dev-plugin

The `--dev-plugin` flag enables:

- **Automatic recompilation**: TypeScript/JSX changes rebuild immediately
- **Live web UI reload**: Web module updates without controller restart
- **Module Federation**: Dynamically loads plugin UI at runtime
- **Source maps**: Debug with original TypeScript sources

**Example:**
```bash
# Single plugin
node packages/controller run --dev --dev-plugin inventory_sync

# Multiple plugins
node packages/controller run --dev --dev-plugin inventory_sync --dev-plugin research_sync
```

**Important Notes:**
- `--dev-plugin` only works for plugins in `external_plugins/` or the main repo
- Web builds are deleted when using these flags (run `pnpm run -r --if-present prepare` before starting without flags)
- Node.js code still requires `pnpm watch` for auto-recompilation
- Lua module changes require instance restart to re-patch the save

### Complete Development Workflow

```bash
# 1. Setup
cd /path/to/clusterio
pnpm install

# 2. Create your plugin in external_plugins
cd external_plugins
mkdir -p clusterio-plugin-myplugin/module
cd clusterio-plugin-myplugin
npm init -y

# 3. Install dependencies again to link your plugin
cd ../..
pnpm install

# 4. Add plugin to cluster
node packages/ctl plugin add ./external_plugins/clusterio-plugin-myplugin

# 5. Start with hot loading in separate terminals
# Terminal 1: TypeScript watcher
pnpm watch

# Terminal 2: Controller with web dev mode
NODE_OPTIONS=--enable-source-maps node packages/controller run --dev --dev-plugin myplugin

# Terminal 3: Host
NODE_OPTIONS=--enable-source-maps node packages/host run
```

## Module Structure

### Directory Layout

```
your-plugin/
├── package.json
├── module/                       # Save-patched module (optional)
│   ├── module.json              # Module metadata
│   ├── control.lua              # Main Lua file
│   ├── globals.lua              # Global state (optional)
│   └── locale/                  # Translations
│       └── en/
│           └── messages.cfg
├── controller.ts                # Controller-side plugin
├── host.ts                      # Host-side plugin
├── instance.ts                  # Instance-side plugin (Node.js)
├── ctl.ts                       # CLI plugin
└── web/                         # Web UI components
    └── index.tsx
```

### module.json Format

```json
{
  "name": "your_plugin_name",
  "version": "1.0.0",
  "dependencies": {
    "clusterio": "*",
    "other_module": "^1.0.0"
  },
  "load": [
    "control.lua"
  ],
  "require": [
    "globals.lua"
  ]
}
```

**Fields:**
- `name`: Module name (should match plugin name)
- `version`: Semantic version (defaults to plugin version)
- `dependencies`: Other modules this depends on (semver ranges)
- `load`: Files to load with `event_handler.add_lib()` (event-based)
- `require`: Files to load with `require()` (procedural, runs immediately)

**Important:**
- `load` is for files that use event_handler pattern (most common)
- `require` is for files that define globals or run initialization code
- `.lua` extension is optional in these arrays
- Files are loaded in the order specified

### Difference: load vs require

**load** (via event_handler):
```lua
-- modules/your_plugin/control.lua
local your_plugin = {}

function your_plugin.on_init()
    -- Runs on_init event
end

function your_plugin.events[defines.events.on_player_created](event)
    -- Handle events
end

return your_plugin
```

**require** (immediate execution):
```lua
-- modules/your_plugin/globals.lua
-- Runs immediately when required
global.your_plugin = global.your_plugin or {}

-- Define utility functions
function global.your_plugin.helper()
    -- ...
end
```

### Module API Access

Inside your module, access Clusterio API:

```lua
local clusterio_api = require("modules/clusterio/api")

-- Get instance info
local instance_id = clusterio_api.get_instance_id()
local instance_name = clusterio_api.get_instance_name()

-- Send data to Node.js
clusterio_api.send_json("your_channel", {
    player_name = player.name,
    data = "example"
})

-- Listen for custom events
script.on_event(clusterio_api.events.on_server_startup, function(event)
    -- Runs when Clusterio connects to server
end)

script.on_event(clusterio_api.events.on_instance_updated, function(event)
    -- Runs when instance config changes
end)
```

### Handling IPC from Node.js

In your `instance.ts`:

```typescript
import BaseInstancePlugin from "@clusterio/host/dist/node/src/BaseInstancePlugin";

export class InstancePlugin extends BaseInstancePlugin {
    async init() {
        // Register IPC handler
        this.instance.server.on("ipc-your_channel", (data: any) => {
            this.handleYourData(data).catch(err => this.logger.error(err));
        });
    }

    async handleYourData(data: any) {
        // Process data from Lua
        this.logger.info(`Received from Lua: ${data.player_name}`);

        // Send response back via RCON
        const response = { status: "ok" };
        const json = lib.escapeString(JSON.stringify(response));
        await this.instance.sendRcon(
            `/sc your_plugin.handle_response('${json}')`,
            true
        );
    }
}
```

In your Lua module:

```lua
-- Function called by RCON
function your_plugin.handle_response(json_string)
    local response = game.json_to_table(json_string)
    if response.status == "ok" then
        game.print("Success!")
    end
end
```

## Development Workflow

### Iteration Cycle

1. **Edit TypeScript** (controller/host/instance/ctl):
   - Changes compile automatically if `pnpm watch` is running
   - Restart controller/host to see changes

2. **Edit Web UI** (web/):
   - Hot reloads automatically with `--dev --dev-plugin`
   - No restart needed

3. **Edit Lua Module** (module/):
   - Stop instance
   - Delete save or let it re-patch
   - Start instance (save gets re-patched)

### Testing Module Changes

```bash
# Method 1: Delete save and restart (clean slate)
rm instances/your-instance/saves/your-save.zip
node packages/ctl instance start your-instance

# Method 2: Keep save, increment patch number (preserves game state)
# Clusterio automatically detects module changes and re-patches
node packages/ctl instance stop your-instance
# Edit module files
node packages/ctl instance start your-instance
```

### Debugging Save Patching

Enable verbose logging:

```bash
node packages/host run --log-level verbose
```

Watch for these messages:
```
Loading module your_plugin from plugin
Module your_plugin version 1.0.0 loaded
Patching save with 3 modules
Save patched, patch number: 2
```

### Common Issues

**Module not loading:**
- Check `module/module.json` syntax
- Verify `load` array has correct file paths
- Ensure module name matches plugin name

**Dependency errors:**
- Check semver ranges in `dependencies`
- Make sure clusterio module is loaded first

**IPC not working:**
- Verify channel name matches between Lua and Node.js
- Check that `ipc-` prefix is used in event name
- Look for `\f$ipc:` in server stdout logs

**Save patching fails:**
- Check save isn't corrupted
- Verify Factorio version compatibility
- Look for "unknown scenario" errors (save needs recognized base scenario)

## Common Patterns

### Pattern 1: Request/Response via RCON Callbacks

**Lua initiates:**
```lua
function your_plugin.request_data(player)
    clusterio_api.send_json("your_request", {
        player_name = player.name
    })
end
```

**Node.js responds:**
```typescript
this.instance.server.on("ipc-your_request", async (data) => {
    const response = { result: "data" };
    const json = lib.escapeString(JSON.stringify(response));
    await this.instance.sendRcon(
        `/sc your_plugin.handle_response('${json}')`,
        true
    );
});
```

**Lua receives:**
```lua
function your_plugin.handle_response(json_string)
    local data = game.json_to_table(json_string)
    game.print(data.result)
end
```

### Pattern 2: Chunked Data Transfer

For large data (>4KB):

```typescript
const chunkSize = this.instance.config.get("your_plugin.chunk_size");
const chunks = chunkify(chunkSize, JSON.stringify(largeData));

for (let i = 0; i < chunks.length; i++) {
    const chunk = lib.escapeString(chunks[i]);
    await this.instance.sendRcon(
        `/sc your_plugin.receive_chunk('${chunk}',${i + 1},${chunks.length})`,
        true
    );
}
```

```lua
local chunks = {}
function your_plugin.receive_chunk(chunk, index, total)
    chunks[index] = chunk
    if index == total then
        local full_data = table.concat(chunks)
        local data = game.json_to_table(full_data)
        -- Process data
        chunks = {}
    end
end
```

### Pattern 3: Progress Reporting

```lua
local function long_operation()
    for i = 1, 100 do
        -- Do work
        if i % 10 == 0 then
            clusterio_api.send_json("progress_update", {
                percent = i
            })
        end
    end
end
```

```typescript
this.instance.server.on("ipc-progress_update", (data) => {
    this.logger.info(`Progress: ${data.percent}%`);
});
```

### Pattern 4: Cross-Instance Messaging

Send message through controller:

```typescript
// In instance plugin
await this.info.messages.yourCustomMessage.send(this.instance, {
    target_instance_id: targetId,
    data: "message"
});
```

```typescript
// Define message in info.ts
import { Type } from "@sinclair/typebox";

export const messages = {
    yourCustomMessage: new lib.Event({
        type: "your_plugin:your_message",
        links: ["instance-controller", "controller-instance"],
        eventProperties: {
            "target_instance_id": Type.Number(),
            "data": Type.String(),
        },
    }),
};
```

## Source Code References

- [packages/host/src/patch.ts](../packages/host/src/patch.ts) - Save patching implementation
- [packages/host/src/Instance.ts:930-946](../packages/host/src/Instance.ts#L930-L946) - Module loading
- [packages/host/modules/clusterio/](../packages/host/modules/clusterio/) - Core Clusterio module
- [plugins/inventory_sync/module/](../plugins/inventory_sync/module/) - Example complex module
- [docs/contributing.md:88-96](../docs/contributing.md#L88-L96) - --dev-plugin documentation
- [docs/writing-plugins.md](../docs/writing-plugins.md) - General plugin development

## Summary

**Use save patching when:**
- You need multi-instance coordination
- Your plugin requires RCON callbacks
- Dynamic loading is important

**Use clusterio_lib when:**
- Your mod is single-instance focused
- You want mod portal distribution
- You prefer standard Factorio workflows

**For development:**
- Use `external_plugins/` for hot loading
- Use `--dev-plugin` for web UI changes
- Use `pnpm watch` for TypeScript changes
- Restart instances to test module changes

The save patching system is powerful but adds complexity. Choose the right approach based on your plugin's coordination needs.
