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


return api

