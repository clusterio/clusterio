local settings = {
	["bool-setting"] = true,
	["int-setting"] = 123,
	["double-setting"] = 1234.5,
	["string-setting"] = "string",
	["color-setting"] = { r = 1, g = 0, b = 1, a = 1 },
}

local possible_values = { "missing", "bool", "int", "double", "string", "color" }

for name, default_value in pairs(settings) do
	for _, value in ipairs(possible_values) do
		data:extend({
			{
				type = name,
				name = name .. "-with-" .. value .. "-value",
				setting_type = "startup",
				default_value = default_value,
			}
		})
	end
end
