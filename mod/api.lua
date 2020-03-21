-- Important: Keep this API in sync with modules/clusterio/api.lua
local api = {}


local initialized = false
function api.init()
    if initialized then
        return
    end
    initialized = true

    if remote.interfaces.clusterio_api then
        api.events = remote.call("clusterio_api", "get_events")
    else
        local null_event = script.generate_event_name()
        api.events = {
            on_instance_updated = null_event,
            on_server_startup = null_event,
        }
    end
end

local function call_api(fn, ...)
    if remote.interfaces.clusterio_api and remote.interfaces.clusterio_api[fn] then
        return remote.call("clusterio_api", fn, ...)
    else
        return nil
    end
end

function api.get_instance_name()
    return call_api("get_instance_name")
end

function api.get_instance_id()
    return call_api("get_instance_id")
end


function api.send_json(channel, data)
    if not remote.interfaces.clusterio_api then
        return
    end

    -- Escape bad characters.  The question mark is used for separating the
    -- channel name from the payload.
    channel = channel:gsub("([\x00-\x1f?\\])", function(match)
        return "\\x" .. string.format("%02x", match:byte())
    end)

    data = game.table_to_json(data)

    -- If there's more than about 4kB of data users running with the Windows
    -- console open will start to experience stuttering, otherwise we could
    -- output about 1 MB of data at a time through stdout.
    if #data < 4000 then
        print("\f$ipc:" .. channel .. "?j" .. data)
    else
        local file_no = remote.call("clusterio_api", "get_file_no")
        local file_name = "clst_" .. file_no .. ".json"
        game.write_file(file_name, data, false, 0)
        print("\f$ipc:" .. channel .. "?f" .. file_name)
    end
end


return api
