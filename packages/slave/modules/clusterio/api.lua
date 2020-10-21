-- Important: Keep this API in sync with mod/api.lua
local api = {}


api.events = {
    on_instance_updated = script.generate_event_name(),
    on_server_startup = script.generate_event_name(),
}

function api.get_instance_name()
    return global.clusterio.instance_name
end

function api.get_instance_id()
    return global.clusterio.instance_id
end

function api.send_json(channel, data)

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
        global.clusterio_file_no = (global.clusterio_file_no or 0) + 1
        local file_name = "clst_" .. global.clusterio_file_no .. ".json"
        game.write_file(file_name, data, false, 0)
        print("\f$ipc:" .. channel .. "?f" .. file_name)
    end
end


return api
