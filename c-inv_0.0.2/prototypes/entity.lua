require ("transport-belt-stuff")

data:extend({
  {
    type = "transport-belt",
    name = "spawn-belt",
    icon = "__c-inv__/graphics/icons/spawn-belt.png",
    flags = {"placeable-neutral", "player-creation"},
    minable = {hardness = 0.2, mining_time = 0.3, result = "spawn-belt"},
    max_health = 50,
    corpse = "small-remnants",
    collision_box = {{-0.4, -0.4}, {0.4, 0.4}},
    selection_box = {{-0.5, -0.5}, {0.5, 0.5}},
    working_sound =
    {
      sound =
      {
        filename = "__base__/sound/express-transport-belt.ogg",
        volume = 0.4
      },
      max_sounds_per_type = 3
    },
    animation_speed_coefficient = 32,
    animations =
    {
      filename = "__c-inv__/graphics/entity/spawn-belt/spawn-belt.png",
      priority = "extra-high",
      width = 40,
      height = 40,
      frame_count = 32,
      direction_count = 12
    },
    fast_replaceable_group = "transport-belt",
    speed = 0.15375,
    -- specified in transport-belt-stuff.lua
    belt_horizontal = spawn_belt_horizontal,
    belt_vertical = spawn_belt_vertical,
    ending_top = spawn_belt_ending_top,
    ending_bottom = spawn_belt_ending_bottom,
    ending_side = spawn_belt_ending_side,
    starting_top = spawn_belt_starting_top,
    starting_bottom = spawn_belt_starting_bottom,
    starting_side = spawn_belt_starting_side,
    ending_patch = ending_patch_prototype,
    ending_patch = ending_patch_prototype,
    connector_frame_sprites = transport_belt_connector_frame_sprites,
    circuit_connector_sprites = transport_belt_circuit_connector_sprites,
    circuit_wire_connection_point = transport_belt_circuit_wire_connection_point,
    circuit_wire_max_distance = transport_belt_circuit_wire_max_distance
  },
  {
    type = "transport-belt",
    name = "void-belt",
    icon = "__c-inv__/graphics/icons/void-belt.png",
    flags = {"placeable-neutral", "player-creation"},
    minable = {hardness = 0.2, mining_time = 0.3, result = "void-belt"},
    max_health = 50,
    corpse = "small-remnants",
    collision_box = {{-0.4, -0.4}, {0.4, 0.4}},
    selection_box = {{-0.5, -0.5}, {0.5, 0.5}},
    working_sound =
    {
      sound =
      {
        filename = "__base__/sound/express-transport-belt.ogg",
        volume = 0.4
      },
      max_sounds_per_type = 3
    },
    animation_speed_coefficient = 32,
    animations =
    {
      filename = "__c-inv__/graphics/entity/void-belt/void-belt.png",
      priority = "extra-high",
      width = 40,
      height = 40,
      frame_count = 32,
      direction_count = 12
    },
    fast_replaceable_group = "transport-belt",
    speed = 0.15375,
    -- specified in transport-belt-stuff.lua
    belt_horizontal = spawn_belt_horizontal,
    belt_vertical = spawn_belt_vertical,
    ending_top = spawn_belt_ending_top,
    ending_bottom = spawn_belt_ending_bottom,
    ending_side = spawn_belt_ending_side,
    starting_top = spawn_belt_starting_top,
    starting_bottom = spawn_belt_starting_bottom,
    starting_side = spawn_belt_starting_side,
    ending_patch = ending_patch_prototype,
    ending_patch = ending_patch_prototype,
    connector_frame_sprites = transport_belt_connector_frame_sprites,
    circuit_connector_sprites = transport_belt_circuit_connector_sprites,
    circuit_wire_connection_point = transport_belt_circuit_wire_connection_point,
    circuit_wire_max_distance = transport_belt_circuit_wire_max_distance
  },
})