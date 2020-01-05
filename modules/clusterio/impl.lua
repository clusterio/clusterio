local api = require('modules/clusterio/api')

local impl = {}


impl.events = {}
impl.events[defines.events.on_tick] = function()
    if global.clusterio_patch_number ~= clusterio_patch_number then
        global.clusterio_patch_number = clusterio_patch_number
        script.raise_event(api.events.on_server_startup, {})
    end
end

impl.events[api.events.on_server_startup] = function()
    if not global.clusterio then
        global.clusterio = {
            instance_id = nil,
            instance_name = nil,
        }
    end
end

-- Internal API
clusterio_private = {}
function clusterio_private.update_instance(new_id, new_name)
    global.clusterio.instance_id = new_id
    global.clusterio.instance_name = new_name
    script.raise_event(api.events.on_instance_updated, {
        instance_id = new_id,
        instance_name = new_name,
    })
end


function impl.add_remote_interface()
    remote.add_interface('clusterio_api', {
        -- Returns a table of events raised by clusterio
        get_events = function()
            return api.events
        end,

        -- Returns the instance id the game is run under
        -- This may change over time and/or be nil.
        get_instance_id = function()
            return global.clusterio.instance_id
        end,

        -- Returns the name of the instance the game runs under.
        -- This may change over time and/or be nil.
        get_instance_name = function()
            return global.clusterio.instance_name
        end,
    })
end


return impl
