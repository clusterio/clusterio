data:extend({
  {
    type = "item",
    name = "spawn-belt",
    icon = "__c-inv__/graphics/icons/spawn-belt.png",
    flags = {"goes-to-quickbar"},
    subgroup = "belt",
    order = "a[express-transport-belt]-d[spawn-belt]",
    place_result = "spawn-belt",
    stack_size = 50
  },
	{
    type = "item",
    name = "void-belt",
    icon = "__c-inv__/graphics/icons/void-belt.png",
    flags = {"goes-to-quickbar"},
    subgroup = "belt",
    order = "c[spawn-belt]-d[void-belt]",
    place_result = "void-belt",
    stack_size = 50
	}
})