local item_types = {
    -- Item categories
    "item",
    "ammo",
    "capsule",
    "gun",
    "item-with-entity-data",
    "item-with-label",
    "item-with-inventory",
    "blueprint-book",
    "item-with-tags",
    "selection-tool",
    "blueprint",
    "deconstruction-item",
    "copy-paste-tool",
    "upgrade-item",
    "module",
    "rail-planner",
    "tool",
    "armor",
    "mining-tool",
    "repair-tool",

    -- Fluids
    "fluid",
}

local function is_array(t)
    local count = 0
    for k in pairs(t) do
        if type(k) ~= "number" then
            return false
        end
        count = count + 1
    end

    for i = 1, count do
        if not t[i] then
            return false
        end
    end

    return count ~= 0
end

-- no game.table_to_json here :(
local function table_to_json(data)
    if type(data) == "number" then
		if data == math.huge then return "1e500" end -- Inf is not representable in JSON, but 1e500 will overflow to it.
		if data == -math.huge then return "-1e500" end
		if data ~= data then return "0" end -- NaN is not representable in JSON, treat as 0 instead.
        return string.format("%.17g", data)

    elseif type(data) == "string" then
        data = data:gsub('([\x00-\x1f\\"])', function(match)
            return "\\u00" .. string.format("%02x", match:byte())
        end)
        return '"' .. data .. '"'

    elseif data == nil then
        return "null"

    elseif data == true then
        return "true"
    elseif data == false then
        return "false"

    elseif type(data) == "table" then
        local r
        if is_array(data) then
            r = {"["}
            for i=1, #data do
                r[#r+1] = table_to_json(data[i])
                r[#r+1] = ","
            end

            -- overwrite last comma, empty table is an object
            r[#r] = "]"

        else
            r = {"{"}
            for k, v in pairs(data) do
                r[#r+1] = table_to_json(tostring(k))
                r[#r+1] = ":"
                r[#r+1] = table_to_json(v)
                r[#r+1] = ","
            end
            r[#r + (r[#r] == "," and 0 or 1)] = "}"
        end

        return table.concat(r)
    end
end

local function send_json(channel, data)
    data = table_to_json(data)
    print("\f$ipc:" .. channel .. "?j" .. data)
end

for _, group in ipairs(item_types) do
    for _, item in pairs(data.raw[group]) do
        send_json("item_export", item)
    end
end
