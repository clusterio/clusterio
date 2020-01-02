local api = {}


-- Table of events raised by clusterio
api.events = {
    -- Raised after the name and id of an instance has been updated
    -- This may occur even if the id and name didn't change.

    -- Event data:
    --   instance_id: The id of the instance.
    --   instance_name: the name of the instance.
    on_instance_updated = script.generate_event_name(),
}

-- Send a table as json to Clusterio
-- Send data to Clusterio over the given channel.  Clusterio plugins can
-- listen to channels and will receive an event with the data sent here.
-- See docs/writing-plugins.md for more information.

-- Note: Payloads greater than 4 MB will cause stuttering.

-- Note: This is not a binary safe way of sending data.  Strings embedded
-- into the tables sent must be valid UTF-8 text.

-- Parameters:
--   channel: string identifying which channel to send it on.
--   data: table that can be converted to json with game.table_to_json
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

