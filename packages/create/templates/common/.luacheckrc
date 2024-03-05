--[[----------------------------------------------------------------------------
                            LICENSE
    .luacheckrc for Factorio Version 0.18.8, luacheck version 0.23.0
    This file is free and unencumbered software released into the public domain.

    Anyone is free to copy, modify, publish, use, compile, sell, or
    distribute this file, either in source code form or as a compiled
    binary, for any purpose, commercial or non-commercial, and by any
    means.

    In jurisdictions that recognize copyright laws, the author or authors
    of this file dedicate any and all copyright interest in the
    software to the public domain. We make this dedication for the benefit
    of the public at large and to the detriment of our heirs and
    successors. We intend this dedication to be an overt act of
    relinquishment in perpetuity of all present and future rights to this
    software under copyright law.

    THE FILE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
    OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
    ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.

    For more information, please refer to <http://unlicense.org/>
------------------------------------------------------------------------------]]
local LINE_LENGTH = false

local IGNORE = {'21./%w+_$', '21./^_%w+$', '213/[ijk]', '213/index', '213/key'}

-- These globals are not available to the factorio API
local NOT_GLOBALS = {'coroutine', 'io', 'socket', 'dofile', 'loadfile'}

local STD_CONTROL = 'lua52+factorio+factorio_control+stdlib+factorio_defines'
local STD_DATA = 'lua52+factorio+factorio_data+stdlib+stdlib_data+factorio_defines'

-- For Base and Core Mods
local STD_BASE_DATA = 'lua52+factorio+factorio_data+factorio_defines+factorio_base_data'
local STD_BASE_CONTROL = 'lua52+factorio+factorio_control+factorio_defines+factorio_base_control'

do -- Assume Factorio Control Stage as Default
    std = STD_CONTROL
    --cache = true
    not_globals = NOT_GLOBALS
    ignore = IGNORE
    quiet = 1 -- pass -q option
    max_cyclomatic_complexity = false
    codes = true
    max_line_length = LINE_LENGTH
    max_code_line_length = LINE_LENGTH
    max_string_line_length = LINE_LENGTH
    max_comment_line_length = LINE_LENGTH

    --List of files and directories to exclude
    exclude_files = {
        --Ignore special folders
        '**/.trash/',
        '**/.history/',
        '**/stdlib/vendor/',

        --Ignore development mods
        '**/combat-tester/',
        '**/test-maker/',
        '**/trailer/',

        --Ignore love Includes
        '**/love/includes/'
    }
end

do -- Set default prototype files
    files['**/data.lua'].std = STD_DATA
    files['**/data-updates.lua'].std = STD_DATA
    files['**/data-final-fixes.lua'].std = STD_DATA
    files['**/settings.lua'].std = STD_DATA
    files['**/settings-updates.lua'].std = STD_DATA
    files['**/settings-final-fixes.lua'].std = STD_DATA
    files['**/prototypes/'].std = STD_DATA
    files['**/settings/'].std = STD_DATA
end

do -- Base and Core mod files
    local base_scenarios = {
        std = STD_BASE_CONTROL .. '+factorio_base_scenarios+factorio_base_story',
        --ignore = {'212/event', '111', '112', '113', '211', '212', '213', '311', '411', '412', '421', '422', '423', '431', '432', '512'}
        ignore = {'...'}
    }
    files['**/base/scenarios/'] = base_scenarios
    files['**/base/tutorials/'] = base_scenarios
    files['**/base/campaigns/'] = base_scenarios
    files['**/wip-scenario/'] = base_scenarios

    files['**/base/migrations/'] = {std = STD_BASE_CONTROL}

    files['**/core/lualib/'] = {std = STD_BASE_CONTROL}
    files['**/core/lualib/util.lua'] = {globals = {'util', 'table'}, ignore = {'432/object'}}
    files['**/core/lualib/silo-script.lua'] = {globals = {'silo_script'}, ignore = {'4../player'}}
    files['**/core/lualib/production-score.lua'] = {globals = {'production_score', 'get_price_recursive'}, ignore = {'4../player'}}
    files['**/core/lualib/story*'] = {std = '+factorio_base_story', ignore = {'42./k', '42./filter'}}
    files['**/core/lualib/mod-gui.lua'] = {globals = {'mod_gui'}}
    files['**/core/lualib/camera.lua'] = {globals = {'camera'}}
    files['**/core/lualib/builder.lua'] = {globals = {'Builder', 'builder', 'action', 'down', 'right'}}

    files['**/core/lualib/bonus-gui-ordering/'] = {std = STD_BASE_DATA}
    files['**/core/lualib/dataloader.lua'] = {globals = {'data'}}
    files['**/core/lualib/circuit-connector-*'] = {std = STD_BASE_DATA..'+factorio_circuit_connector_generated'}
    files['**/core/lualib/bonus-gui-ordering.lua'] = {globals = {'bonus_gui_ordering'}}

    files['**/base/prototypes/'] = {std = STD_BASE_DATA}
    files['**/core/prototypes/'] = {std = STD_BASE_DATA}
    files['**/core/prototypes/noise-programs.lua'] = {ignore = {'212/x', '212/y', '212/tile', '212/map'}}
end

do -- Stdlib Files
    local stdlib_control = {
        std = 'lua52+factorio+factorio_control+stdlib+factorio_defines',
        max_line_length = LINE_LENGTH
    }

    local stdlib_data = {
        std = 'lua52+factorio+factorio_data+stdlib+factorio_defines',
        max_line_length = LINE_LENGTH
    }

    -- Assume control stage for stdlib
    files['**/stdlib/'] = stdlib_control

    -- Assume generic lua for stdlib utils
    files['**/stdlib/utils/**'].std = 'lua52+stdlib'

    -- STDLIB data stage files
    files['**/stdlib/data/'] = stdlib_data

    -- STDLIB Busted Spec
    files['**/spec/**'] = {
        globals = {'serpent', 'log', 'package.remove_stdlib'},
        std = 'lua52c+busted+factorio_defines+factorio_control+stdlib'
    }

    -- Love
    files['**/love/'].std = 'luajit+love+love_extra+stdlib+stdlib_data'
end

do -- Factorio STDs--
    stds.factorio = {
        --Set the read only variables
        read_globals = {
            -- @log@: Gives writing access to Factorio's logger instance.
            "log",
            -- @serpent@: Lua serializer and pretty printer. (https://github.com/pkulchenko/serpent).
            "serpent",
            -- @table_size@: Returns the number of elements inside an LUA table.
            "table_size",
            -- @lldebugger@: Provided by lua local debugger vscode extension.
            lldebugger = {
                fields = {'requestBreak'},
                other_fields = true,
                read_only = false,
            },
            -- @__DebugAdapter@: Provided by Factorio Mod Debug vscode extension.
            __DebugAdapter = {
                fields = {'print', 'stepIgnoreAll', 'stepIgnore', 'breakpoint'},
                other_fields = true,
                read_only = false
            },
            util = {
                fields = {
                    "by_pixel", "distance", "findfirstentity", "positiontostr", "formattime", "moveposition", "oppositedirection",
                    "ismoduleavailable", "multiplystripes", "format_number", "increment", "color", "conditional_return",
                    "add_shift", "merge", "premul_color", "encode", "decode", "insert_safe",
                    table = {
                        fields = {
                            "compare", "deepcopy"
                        },
                    },
                },
            },
            table = {
                fields = {
                    "compare", "deepcopy"
                },
            },
        },
    }

    stds.factorio_control = {
        read_globals = {

            -- @commands@:
            commands = {
                fields = {
                    "add_command", "commands", "game_commands", "remove_command"
                },
            },

            -- @settings@:
            settings = {
                fields = {
                    "get_player_settings",
                    startup = {other_fields = true},
                    global = {other_fields = true},
                    player = {other_fields = true},
                    get = {read_only = false}, -- stdlib added
                    get_startup = {read_only = false} -- stdlib added
                },
            },

            -- @script@: Provides an interface for registering event handlers.
            -- (http://lua-api.factorio.com/latest/LuaBootstrap.html)
            script = {
                fields = {
                    "on_event", "on_nth_tick", "on_configuration_changed", "on_init", "on_load", "generate_event_name",
                    "raise_event", "get_event_handler", "mod_name", "get_event_order",
                    "is_game_in_debug_mode", "object_name", "set_event_filter", "get_event_filter", "register_metatable",
                    active_mods = {read_only = true, other_fields = true},
                },
                other_fields = false,
            },

            -- @remote@: Allows inter-mod communication by providing a repository of interfaces that is shared by all mods.
            -- (http://lua-api.factorio.com/latest/LuaRemote.html)
            remote = {
                fields = {
                    interfaces = {read_only = false, other_fields = true},
                    "add_interface", "remove_interface", "call"
                },
                read_only = true,
                other_fields = false,
            },

            rcon = {
                fields = {'print'}
            },

            rendering = {
                other_fields = false,
                read_only = true,
                fields = {
                    'draw_animation',
                    'draw_line',
                    'draw_text',
                    'draw_circle',
                    'draw_rectangle',
                    'draw_arc',
                    'draw_polygon',
                    'draw_sprite',
                    'draw_light',
                    'destroy',
                    'is_font_valid',
                    'is_valid',
                    'get_all_ids',
                    'clear',
                    'get_type',
                    'get_surface',
                    'get_time_to_live',
                    'set_time_to_live',
                    'get_forces',
                    'set_forces',
                    'get_players',
                    'set_players',
                    'get_color',
                    'set_color',
                    'get_width',
                    'set_width',
                    'get_from',
                    'set_from',
                    'get_to',
                    'set_to',
                    'get_gap_amount',
                    'set_gap_amount',
                    'get_gap_length',
                    'set_gap_length',
                    'get_target',
                    'set_target',
                    'get_orientation',
                    'set_orientation',
                    'get_scale',
                    'set_scale',
                    'get_text',
                    'set_text',
                    'get_font',
                    'set_font',
                    'get_alignment',
                    'set_alignment',
                    'get_scale_with_zoom',
                    'set_scale_with_zoom',
                    'get_filled',
                    'set_filled',
                    'get_radius',
                    'set_radius',
                    'get_left_top',
                    'set_left_top',
                    'get_right_bottom',
                    'set_right_bottom',
                    'get_max_radius',
                    'set_max_radius',
                    'get_min_radius',
                    'set_min_radius',
                    'get_start_angle',
                    'set_start_angle',
                    'get_angle',
                    'set_angle',
                    'get_vertices',
                    'set_vertices',
                    'get_sprite',
                    'set_sprite',
                    'get_x_scale',
                    'set_x_scale',
                    'get_y_scale',
                    'set_y_scale',
                    'get_render_layer',
                    'set_render_layer',
                    'get_orientation_target',
                    'set_orientation_target',
                    'get_oriented_offset',
                    'set_oriented_offset',
                    'get_intensity',
                    'set_intensity',
                    'get_minimum_darkness',
                    'set_minimum_darkness'
                }
            },

            -- @game@: Main object through which most of the API is accessed.
            -- It is, however, not available inside handlers registered with @script.on_load@.
            -- (http://lua-api.factorio.com/latest/LuaGameScript.html)
            game ={
                other_fields = false,
                read_only = false,
                fields = {
                    'auto_save',
                    'ban_player',
                    'check_consistency',
                    'check_prototype_translations',
                    'count_pipe_groups',
                    'create_force',
                    'create_profiler',
                    'create_random_generator',
                    'create_surface',
                    'decode_string',
                    'delete_surface',
                    'direction_to_string',
                    'disable_replay',
                    'disable_tips_and_tricks',
                    'disable_tutorial_triggers',
                    'encode_string',
                    'evaluate_expression',
                    'force_crc',
                    'get_active_entities_count',
                    'get_entity_by_tag',
                    'get_filtered_achievement_prototypes',
                    'get_filtered_decorative_prototypes',
                    'get_filtered_entity_prototypes',
                    'get_filtered_equipment_prototypes',
                    'get_filtered_fluid_prototypes',
                    'get_filtered_item_prototypes',
                    'get_filtered_mod_setting_prototypes',
                    'get_filtered_recipe_prototypes',
                    'get_filtered_technology_prototypes',
                    'get_filtered_tile_prototypes',
                    'get_map_exchange_string',
                    'get_player',
                    'get_surface',
                    'get_train_stops',
                    'help',
                    'is_demo',
                    'is_multiplayer',
                    'is_valid_sound_path',
                    'is_valid_sprite_path',
                    'json_to_table',
                    'kick_player',
                    'log_recipe_locale',
                    'merge_forces',
                    'mute_player',
                    'parse_map_exchange_string',
                    'play_sound',
                    'print',
                    'print_stack_size',
                    'purge_player',
                    'regenerate_entity',
                    'reload_mods',
                    'reload_script',
                    'remove_offline_players',
                    'remove_path',
                    'reset_time_played',
                    'save_atlas',
                    'server_save',
                    'set_game_state',
                    'set_wait_for_screenshots_to_finish',
                    'show_message_dialog',
                    'table_to_json',
                    'take_screenshot',
                    'take_technology_screenshot',
                    'unban_player',
                    'unmute_player',
                    'write_file',

                    achievement_prototypes = {read_only = true, other_fields = true},
                    active_mods = {read_only = true, other_fields = true},
                    ammo_category_prototypes = {read_only = true, other_fields = true},
                    autoplace_control_prototypes = {read_only = true, other_fields = true},
                    backer_names = {read_only = true, other_fields = true},
                    connected_players = {read_only = true, other_fields = true},
                    custom_input_prototypes = {read_only = true, other_fields = true},
                    damage_prototypes = {read_only = true, other_fields = true},
                    decorative_prototypes = {read_only = true, other_fields = true},
                    default_map_gen_settings = {read_only = true, other_fields = true},
                    difficulty = {read_only = true, other_fields = true},
                    difficulty_settings = {read_only = true, other_fields = true},
                    entity_prototypes = {read_only = true, other_fields = true},
                    equipment_category_prototypes = {read_only = true, other_fields = true},
                    equipment_grid_prototypes = {read_only = true, other_fields = true},
                    equipment_prototypes = {read_only = true, other_fields = true},
                    finished = {read_only = true, other_fields = true},
                    fluid_prototypes = {read_only = true, other_fields = true},
                    forces = {read_only = true, other_fields = true},
                    fuel_category_prototypes = {read_only = true, other_fields = true},
                    item_group_prototypes = {read_only = true, other_fields = true},
                    item_prototypes = {read_only = true, other_fields = true},
                    item_subgroup_prototypes = {read_only = true, other_fields = true},
                    map_settings = {read_only = true, other_fields = true},
                    mod_setting_prototypes = {read_only = true, other_fields = true},
                    module_category_prototypes = {read_only = true, other_fields = true},
                    named_noise_expressions = {read_only = true, other_fields = true},
                    noise_layer_prototypes = {read_only = true, other_fields = true},
                    object_name = {read_only = true, other_fields = true},
                    particle_prototypes = {read_only = true, other_fields = true},
                    permissions = {read_only = true, other_fields = true},
                    player = {read_only = true, other_fields = true},
                    players = {read_only = true, other_fields = true},
                    pollution_statistics = {read_only = true, other_fields = true},
                    recipe_category_prototypes = {read_only = true, other_fields = true},
                    recipe_prototypes = {read_only = true, other_fields = true},
                    resource_category_prototypes = {read_only = true, other_fields = true},
                    shortcut_prototypes = {read_only = true, other_fields = true},
                    styles = {read_only = true, other_fields = true},
                    surfaces = {read_only = true, other_fields = true},
                    technology_prototypes = {read_only = true, other_fields = true},
                    tick = {read_only = true, other_fields = true},
                    ticks_played = {read_only = true, other_fields = true},
                    tile_prototypes = {read_only = true, other_fields = true},
                    trivial_smoke_prototypes = {read_only = true, other_fields = true},
                    virtual_signal_prototypes = {read_only = true, other_fields = true},

                    autosave_enabled = {read_only = false, other_fields = false},
                    draw_resource_selection = {read_only = false, other_fields = false},
                    enemy_has_vision_on_land_mines = {read_only = false, other_fields = false},
                    speed = {read_only = false, other_fields = false},
                    tick_paused = {read_only = false, other_fields = false},
                    ticks_to_run = {read_only = false, other_fields = false}
                },
            },
        },

        globals = {
            -- @global@: The global dictionary, useful for storing data persistent across a save-load cycle.
            -- Writing access is given to the mod-id field (for mod-wise saved data).
            -- (http://lua-api.factorio.com/latest/Global.html)
            "global",

            -- @MOD@: Keep it organized, use this variable for anything that "NEEDS" to be global for some reason.
            "MOD"
        },
    }

    stds.factorio_data = {

        read_globals = {
            data = {
                fields = {
                    raw = {
                        other_fields = true,
                        read_only = false
                    },
                    "extend", "is_demo"
                },
            },

            settings = {
                fields = {
                    "startup", "global", "player", "get", "get_startup"
                },
            },

            mods = {
                other_fields = true
            },

            -- Popular mods that think they need globals!
            angelsmods = {
                other_fields = true
            },

            -- Popular mods that think they need globals!
            bobmods = {
                other_fields = true
            },


        }
    }
end

do -- Factorio Base/Core STDs--
    stds.factorio_base_control = {
        read_globals = {"silo_script", "mod_gui", "camera"}
    }

    stds.factorio_base_scenarios = {
        globals = {
            "check_automate_science_packs_advice", "check_research_hints", "check_supplies", "manage_attacks", "all_dead",
            "on_win", "difficulty_number", "init_attack_data", "handle_attacks", "count_items_in_container", "progress", "scanned",
            "check_light", "check_machine_gun", "level", "story_table",

            "tightspot_prices", "tightspot_make_offer", "tightspot_init", "tightspot_get_required_balance",
            "tightspot_init_level", "tightspot_init_spending_frame", "tightspot_init_progress_frame", "tightspot_update_progress", "tightspot_update_spending",
            "tightspot_get_missing_to_win", "tightspot_sell_back", "tightspot_start_level", "tightspot_show_level_description", "tightspot_update_speed_label",
            "map_ignore", "tightspot_check_level", "land_price",

            "transport_belt_madness_init", "transport_belt_madness_init_level", "transport_belt_madness_create_chests", "transport_belt_madness_fill_chests",
            "transport_belt_madness_start_level", "map_ignore", "map_clear", "map_load", "map_save", "transport_belt_madness_show_level_description",
            "transport_belt_madness_check_level", "transport_belt_madness_next_level", "transport_belt_madness_clear_level", "transport_belt_madness_contains_next_level",

            "restricted", "check_built_items", "result", "disable_combat_technologies", "apply_character_modifiers", "apply_combat_modifiers", "apply_balance",
            "load_config", "starting_area_constant", "create_next_surface", "end_round", "prepare_next_round", "silo_died","choose_joining_gui",
            "destroy_joining_guis", "create_random_join_gui", "create_auto_assign_gui", "create_pick_join_gui", "create_config_gui", "make_config_table", "default",
            "make_team_gui", "make_team_gui_config", "add_team_button_press", "trash_team_button_press", "remove_team_from_team_table", "add_team_to_team_table",
            "set_teams_from_gui", "on_team_button_press", "make_color_dropdown", "create_balance_option", "create_disable_frame", "disable_frame", "parse_disabled_items",
            "set_balance_settings", "config_confirm", "parse_config_from_gui", "get_color", "roll_starting_area", "delete_roll_surfaces", "auto_assign",
            "destroy_config_for_all", "prepare_map", "set_evolution_factor", "update_players_on_team_count", "random_join", "init_player_gui",
            "destroy_player_gui", "objective_button_press", "admin_button_press", "admin_frame_button_press", "diplomacy_button_press", "update_diplomacy_frame",
            "diplomacy_frame_button_press", "team_changed_diplomacy", "diplomacy_check_press", "get_stance", "give_inventory", "setup_teams", "disable_items_for_all",
            "set_random_team", "set_diplomacy", "create_spawn_positions", "set_spawn_position", "set_team_together_spawns", "chart_starting_area_for_force_spawns",
            "check_starting_area_chunks_are_generated", "check_player_color", "check_round_start", "clear_starting_area_enemies", "check_no_rush_end", "check_no_rush_players",
            "finish_setup", "chart_area_for_force", "setup_start_area_copy", "update_copy_progress", "update_progress_bar", "copy_paste_starting_area_tiles",
            "copy_paste_starting_area_entities", "create_silo_for_force", "setup_research", "on_chunk_generated", "get_distance_to_nearest_spawn",
            "create_wall_for_force", "fpn", "give_items", "create_item_frame", "create_technologies_frame", "create_cheat_frame", "create_day_frame",
            "time_modifier", "points_per_second_start", "points_per_second_level_subtract", "levels", "update_info", "get_time_left", "update_time_left",
            "on_joined", "make_frame", "update_frame", "update_table", "calculate_task_item_multiplayer", "setup_config", "select_from_probability_table",
            "select_inventory", "select_equipment", "select_challange_type", "save_round_statistics", "start_challenge", "create_teams", "set_areas",
            "decide_player_team", "set_teams", "refresh_leaderboard", "set_player", "generate_technology_list", "generate_research_task","setup_unlocks",
            "check_technology_progress", "generate_production_task", "generate_shopping_list_task", "set_gui_flow_table", "create_visibility_button",
            "check_item_lists", "update_task_gui", "check_end_of_round", "end_round_gui_update", "try_to_check_victory", "update_gui", "check_start_round",
            "check_start_set_areas", "check_start_setting_entities", "check_set_areas", "check_clear_areas", "check_chests", "check_chests_shopping_list",
            "check_chests_production", "check_input_chests", "fill_input_chests", "check_victory", "shopping_task_finished", "calculate_force_points",
            "update_research_task_table", "update_production_task_table", "update_shopping_list_task_table", "create_joined_game_gui", "pre_ending_round",
            "player_ending_prompt", "update_end_timer", "update_begin_timer", "team_finished", "save_points_list", "give_force_players_points",
            "update_winners_list", "set_spectator", "set_character", "give_starting_inventory", "give_equipment", "shuffle_table", "format_time",
            "spairs", "fill_leaderboard", "create_grid", "simple_entities", "save_map_data", "clear_map", "create_tiles", "recreate_entities",
            "map_sets", "give_points", "init_forces", "init_globals", "init_unit_settings", "check_next_wave", "next_wave", "calculate_wave_power",
            "wave_end", "make_next_spawn_tick", "check_spawn_units", "get_wave_units", "spawn_units", "randomize_ore", "set_command", "command_straglers",
            "unit_config", "make_next_wave_tick", "time_to_next_wave", "time_to_wave_end", "rocket_died", "unit_died", "get_bounty_price", "setup_waypoints",
            "insert_items", "give_starting_equipment", "give_spawn_equipment", "next_round_button_visible", "gui_init", "create_wave_frame", "create_money_frame",
            "create_upgrade_gui", "update_upgrade_listing", "upgrade_research", "get_upgrades", "get_money", "update_connected_players", "update_round_number",
            "set_research", "set_recipes", "check_deconstruction", "check_blueprint_placement", "loop_entities", "experiment_items",
            "setup", "story_gui_click", "clear_surface", "add_run_trains_button", "puzzle_condition", "basic_signals",
            "loop_trains", "Y_offset", "ghosts_1", "ghosts_2", "required_path", "through_wall_path", "count", "check_built_real_rail",
            "current_ghosts_count", "other", "rails", "set_rails", "straight_section", "late_entities", "entities", "stop",
            "get_spawn_coordinate",

            --tutorials
            "intermission", "create_entities_on_tick", "on_player_created", "required_count", "non_player_entities", "clear_rails",
            "chest", "damage", "furnace", "init_prototypes", "build_infi_table", "junk", "update_player_tags", "time_left", "team_production",
            "create_task_frame", "create_visibilty_buttons", "update_leaderboard", "in_in_area"
        }
    }

    stds.factorio_base_data = {
        globals = {
            --Style
            "make_cursor_box", "make_full_cursor_box",
            "default_container_padding", "default_orange_color", "default_light_orange_color", "warning_red_color",
            "achievement_green_color", "achievement_tan_color", "orangebuttongraphcialset", "bluebuttongraphcialset",
            "bonus_gui_ordering", "trivial_smoke", "technology_slot_base_width", "technology_slot_base_height", "default_frame_font_vertical_compensation",

            --Belts
            "transport_belt_connector_frame_sprites", "transport_belt_circuit_wire_connection_point", "transport_belt_circuit_wire_max_distance",
            "transport_belt_circuit_connector_sprites", "ending_patch_prototype", "basic_belt_horizontal", "basic_belt_vertical",
            "basic_belt_ending_top", "basic_belt_ending_bottom", "basic_belt_ending_side", "basic_belt_starting_top", "basic_belt_starting_bottom",
            "basic_belt_starting_side", "fast_belt_horizontal", "fast_belt_vertical", "fast_belt_ending_top", "fast_belt_ending_bottom",
            "fast_belt_ending_side", "fast_belt_starting_top", "fast_belt_starting_bottom", "fast_belt_starting_side", "express_belt_horizontal",
            "express_belt_vertical", "express_belt_ending_top", "express_belt_ending_bottom", "express_belt_ending_side", "express_belt_starting_top",
            "express_belt_starting_bottom", "express_belt_starting_side",

            --Circuit Connectors
            "circuit_connector_definitions", "default_circuit_wire_max_distance", "inserter_circuit_wire_max_distance",
            "universal_connector_template", "belt_connector_template", "belt_frame_connector_template", "inserter_connector_template",

            --Inserter Circuit Connectors
            "inserter_circuit_wire_max_distance", "inserter_default_stack_control_input_signal",

            --Sounds/beams
            "make_heavy_gunshot_sounds", "make_light_gunshot_sounds", "make_laser_sounds",

            --Gun/Laser
            "gun_turret_extension", "gun_turret_extension_shadow", "gun_turret_extension_mask", "gun_turret_attack",
            "laser_turret_extension", "laser_turret_extension_shadow", "laser_turret_extension_mask",

            --Pipes
            "pipecoverspictures", "pipepictures", "assembler2pipepictures", "assembler3pipepictures", "make_heat_pipe_pictures",

            --Combinators
            "generate_arithmetic_combinator", "generate_decider_combinator", "generate_constant_combinator",

            --Rail
            "destroyed_rail_pictures", "rail_pictures", "rail_pictures_internal", "standard_train_wheels", "drive_over_tie",
            "rolling_stock_back_light", "rolling_stock_stand_by_light",

            --Enemies
            "make_enemy_autoplace", "make_enemy_spawner_autoplace", "make_enemy_worm_autoplace",
            "make_spitter_attack_animation", "make_spitter_run_animation", "make_spitter_dying_animation",
            "make_spitter_attack_parameters", "make_spitter_roars", "make_spitter_dying_sounds",
            "make_spawner_idle_animation", "make_spawner_die_animation",
            "make_biter_run_animation", "make_biter_attack_animation", "make_biter_die_animation",
            "make_biter_roars", "make_biter_dying_sounds", "make_biter_calls",
            "make_worm_roars", "make_worm_dying_sounds", "make_worm_folded_animation", "make_worm_preparing_animation",
            "make_worm_prepared_animation", "make_worm_attack_animation", "make_worm_die_animation",

            --Other
            "tile_variations_template", "make_water_autoplace_settings",
            "make_unit_melee_ammo_type",  "make_trivial_smoke", "make_4way_animation_from_spritesheet", "flying_robot_sounds",
            "productivitymodulelimitation", "crash_trigger", "capsule_smoke", "make_beam", "playeranimations",
            "make_blood_tint", "make_shadow_tint",

            --tiles
            "water_transition_template", "make_water_transition_template", "water_autoplace_settings", "water_tile_type_names",
            "patch_for_inner_corner_of_transition_between_transition",
        }
    }

    stds.factorio_base_story = {
        globals = {
            "story_init_helpers", "story_update_table", "story_init", "story_update", "story_on_tick", "story_add_update",
            "story_remove_update", "story_jump_to", "story_elapsed", "story_elapsed_check", "story_show_message_dialog",
            "set_goal", "player_set_goal", "on_player_joined", "flash_goal", "set_info", "player_set_info", "export_entities",
            "list", "recreate_entities", "entity_to_connect", "limit_camera", "find_gui_recursive", "enable_entity_export",
            "add_button", "on_gui_click", "set_continue_button_style", "add_message_log", "story_add_message_log",
            "player_add_message_log", "message_log_frame", "message_log_scrollpane", "message_log_close_button",
            "message_log_table", "toggle_message_log_button", "toggle_objective_button", "message_log_init",
            "add_gui_recursive", "add_toggle_message_log_button", "add_toggle_objective_button", "mod_gui",
            "flash_message_log_button", "flash_message_log_on_tick", "story_gui_click", "story_points_by_name", "story_branches",
            "player", "surface", "deconstruct_on_tick", "recreate_entities_on_tick", "flying_congrats", "story_table"
        }
    }

    stds.factorio_circuit_connector_generated = {
        globals = {
            'default_circuit_wire_max_distance', 'circuit_connector_definitions', 'universal_connector_template',
            'belt_connector_template', 'belt_frame_connector_template', 'inserter_connector_template', 'inserter_connector_template',
            'inserter_circuit_wire_max_distance', 'inserter_default_stack_control_input_signal', 'transport_belt_connector_frame_sprites',
            'transport_belt_circuit_wire_max_distance',
        }
    }
end

do -- STDLIB STDs--
    stds.stdlib = {
        read_globals = {},
        globals = {
            'STDLIB',
            'prequire',
            'rawtostring',
            'traceback',
            'data_traceback',
            'inspect',
            'serpent',
            'inline_if',
            'install',
            'log',
            'concat',
            'GAME',
            'AREA',
            'POSITION',
            'TILE',
            'SURFACE',
            'CHUNK',
            'COLOR',
            'ENTITY',
            'INVENTORY',
            'RESOURCE',
            'CONFIG',
            'LOGGER',
            'QUEUE',
            'EVENT',
            'GUI',
            'PLAYER',
            'FORCE',
            'MATH',
            'STRING',
            'TABLE'
        }
    }

    stds.stdlib_control = {}

    stds.stdlib_data = {
        globals = {
            'DATA',
            'RECIPE',
            'ITEM',
            'FLUID',
            'ENTITY',
            'TECHNOLOGY',
            'CATEGORY'
        }
    }
end

do -- Love STDs
    stds.love_extra = {
        read_globals = {
            love = {
                fields = {
                    arg = {
                        fields = {
                            'parseGameArguments',
                            'parseOption',
                            'getLow',
                            'optionIndices',
                            'options'
                        }
                    }
                }
            },
            'coroutine',
            'io',
            'socket',
            'dofile',
            'loadfile'
        },
        globals = {
            love = {
                fields = {
                    'handlers'
                }
            }
        }
    }
end

do -- Factorio Defines STDs--
    stds.factorio_defines = {
        read_globals = {
            defines = {
                fields = {
                    alert_type = {
                        fields = {
                            'entity_destroyed',
                            'entity_under_attack',
                            'not_enough_construction_robots',
                            'no_material_for_construction',
                            'not_enough_repair_packs',
                            'turret_fire',
                            'custom',
                            'no_storage',
                            'train_out_of_fuel',
                            'fluid_mixing'
                        }
                    },
                    behavior_result = {
                        fields = {
                            'in_progress',
                            'fail',
                            'success',
                            'deleted'
                        }
                    },
                    build_check_type = {
                        fields = {
                            'script',
                            'manual',
                            'ghost_place',
                            'ghost_revive'
                        }
                    },
                    chain_signal_state = {
                        fields = {
                            'all_open',
                            'partially_open',
                            'none_open'
                        }
                    },
                    chunk_generated_status = {
                        fields = {
                            'nothing',
                            'custom_tiles',
                            'basic_tiles',
                            'corrected_tiles',
                            'tiles',
                            'entities'
                        }
                    },
                    circuit_condition_index = {
                        fields = {
                            'inserter_circuit',
                            'inserter_logistic',
                            'lamp',
                            'arithmetic_combinator',
                            'decider_combinator',
                            'constant_combinator',
                            'offshore_pump',
                            'pump'
                        }
                    },
                    circuit_connector_id = {
                        fields = {
                            'accumulator',
                            'constant_combinator',
                            'container',
                            'programmable_speaker',
                            'rail_signal',
                            'rail_chain_signal',
                            'roboport',
                            'storage_tank',
                            'wall',
                            'electric_pole',
                            'inserter',
                            'lamp',
                            'combinator_input',
                            'combinator_output',
                            'offshore_pump',
                            'pump'
                        }
                    },
                    command = {
                        fields = {
                            'attack',
                            'go_to_location',
                            'compound',
                            'group',
                            'attack_area',
                            'wander',
                            'flee',
                            'stop',
                            'build_base'
                        }
                    },
                    compound_command = {
                        fields = {
                            'logical_and',
                            'logical_or',
                            'return_last'
                        }
                    },
                    control_behavior = {
                        fields = {
                            inserter = {
                                fields = {
                                    circuit_mode_of_operation = {
                                        fields = {
                                            'enable_disable',
                                            'set_filters',
                                            'read_hand_contents',
                                            'set_stack_size'
                                        }
                                    },
                                    hand_read_mode = {
                                        fields = {
                                            'hold',
                                            'pulse'
                                        }
                                    }
                                }
                            },
                            lamp = {
                                fields = {
                                    circuit_mode_of_operation = {
                                        fields = {
                                            'use_colors'
                                        }
                                    }
                                }
                            },
                            logistic_container = {
                                fields = {
                                    circuit_mode_of_operation = {
                                        fields = {
                                            'send_contents',
                                            'set_requests'
                                        }
                                    }
                                }
                            },
                            mining_drill = {
                                fields = {
                                    resource_read_mode = {
                                        fields = {
                                            'this_miner',
                                            'entire_patch'
                                        }
                                    }
                                }
                            },
                            roboport = {
                                fields = {
                                    circuit_mode_of_operation = {
                                        fields = {
                                            'read_logistics',
                                            'read_robot_stats'
                                        }
                                    }
                                }
                            },
                            train_stop = {
                                fields = {
                                    circuit_mode_of_operation = {
                                        fields = {
                                            'enable_disable',
                                            'send_to_train',
                                            'read_from_train',
                                            'read_stopped_train'
                                        }
                                    }
                                }
                            },
                            transport_belt = {
                                fields = {
                                    content_read_mode = {
                                        fields = {
                                            'pulse',
                                            'hold'
                                        }
                                    }
                                }
                            },
                            type = {
                                fields = {
                                    'container',
                                    'generic_on_off',
                                    'inserter',
                                    'lamp',
                                    'logistic_container',
                                    'roboport',
                                    'storage_tank',
                                    'train_stop',
                                    'decider_combinator',
                                    'arithmetic_combinator',
                                    'constant_combinator',
                                    'transport_belt',
                                    'accumulator',
                                    'rail_signal',
                                    'rail_chain_signal',
                                    'wall',
                                    'mining_drill',
                                    'programmable_speaker'
                                }
                            }
                        }
                    },
                    controllers = {
                        fields = {
                            'ghost',
                            'character',
                            'god',
                            'editor',
                            'cutscene',
                            'spectator'
                        }
                    },
                    deconstruction_item = {
                        fields = {
                            entity_filter_mode = {
                                fields = {
                                    'whitelist',
                                    'blacklist'
                                }
                            },
                            tile_filter_mode = {
                                fields = {
                                    'whitelist',
                                    'blacklist'
                                }
                            },
                            tile_selection_mode = {
                                fields = {
                                    'normal',
                                    'always',
                                    'never',
                                    'only'
                                }
                            }
                        }
                    },
                    difficulty = {
                        fields = {
                            'easy',
                            'normal',
                            'hard'
                        }
                    },
                    difficulty_settings = {
                        fields = {
                            recipe_difficulty = {
                                fields = {
                                    'normal',
                                    'expensive'
                                }
                            },
                            technology_difficulty = {
                                fields = {
                                    'normal',
                                    'expensive'
                                }
                            }
                        }
                    },
                    direction = {
                        fields = {
                            'north',
                            'northeast',
                            'east',
                            'southeast',
                            'south',
                            'southwest',
                            'west',
                            'northwest'
                        }
                    },
                    distraction = {
                        fields = {
                            'by_enemy',
                            'by_anything',
                            'by_damage'
                        }
                    },
                    entity_status = {
                        fields = {
                            'working',
                            'no_power',
                            'no_fuel',
                            'no_recipe',
                            'no_input_fluid',
                            'no_research_in_progress',
                            'no_minable_resources',
                            'low_input_fluid',
                            'low_power',
                            'disabled_by_control_behavior',
                            'disabled_by_script',
                            'fluid_ingredient_shortage',
                            'fluid_production_overload',
                            'item_ingredient_shortage',
                            'item_production_overload',
                            'marked_for_deconstruction',
                            'missing_required_fluid',
                            'missing_science_packs',
                            'waiting_for_source_items',
                            'waiting_for_space_in_destination',
                            'waiting_to_launch_rocket'
                        }
                    },
                    events = {
                        fields = {
                            'on_tick',
                            'on_gui_click',
                            'on_gui_confirmed',
                            'on_gui_text_changed',
                            'on_gui_checked_state_changed',
                            'on_entity_died',
                            'on_post_entity_died',
                            'on_entity_damaged',
                            'on_picked_up_item',
                            'on_built_entity',
                            'on_sector_scanned',
                            'on_player_mined_item',
                            'on_put_item',
                            'on_rocket_launched',
                            'on_pre_player_mined_item',
                            'on_chunk_generated',
                            'on_player_crafted_item',
                            'on_robot_built_entity',
                            'on_robot_pre_mined',
                            'on_robot_mined',
                            'on_research_started',
                            'on_research_finished',
                            'on_player_rotated_entity',
                            'on_player_set_quickbar_slot',
                            'on_marked_for_deconstruction',
                            'on_cancelled_deconstruction',
                            'on_trigger_created_entity',
                            'on_trigger_fired_artillery',
                            'on_train_changed_state',
                            'on_player_created',
                            'on_resource_depleted',
                            'on_player_driving_changed_state',
                            'on_force_created',
                            'on_forces_merging',
                            'on_player_cursor_stack_changed',
                            'on_pre_entity_settings_pasted',
                            'on_entity_settings_pasted',
                            'on_player_main_inventory_changed',
                            'on_player_armor_inventory_changed',
                            'on_player_ammo_inventory_changed',
                            'on_player_gun_inventory_changed',
                            'on_player_placed_equipment',
                            'on_player_removed_equipment',
                            'on_pre_player_died',
                            'on_player_died',
                            'on_player_respawned',
                            'on_player_joined_game',
                            'on_player_left_game',
                            'on_player_built_tile',
                            'on_player_mined_tile',
                            'on_robot_built_tile',
                            'on_robot_mined_tile',
                            'on_player_selected_area',
                            'on_player_alt_selected_area',
                            'on_player_changed_surface',
                            'on_selected_entity_changed',
                            'on_market_item_purchased',
                            'on_player_dropped_item',
                            'on_biter_base_built',
                            'on_player_changed_force',
                            'on_entity_renamed',
                            'on_gui_selection_state_changed',
                            'on_runtime_mod_setting_changed',
                            'on_difficulty_settings_changed',
                            'on_surface_created',
                            'on_surface_deleted',
                            'on_pre_surface_deleted',
                            'on_player_mined_entity',
                            'on_robot_mined_entity',
                            'on_train_created',
                            'on_gui_elem_changed',
                            'on_player_setup_blueprint',
                            'on_player_deconstructed_area',
                            'on_player_configured_blueprint',
                            'on_console_chat',
                            'on_console_command',
                            'on_player_removed',
                            'on_pre_player_removed',
                            'on_player_used_capsule',
                            'script_raised_built',
                            'script_raised_destroy',
                            'script_raised_revive',
                            'on_player_promoted',
                            'on_player_demoted',
                            'on_combat_robot_expired',
                            'on_player_changed_position',
                            'on_mod_item_opened',
                            'on_gui_opened',
                            'on_gui_closed',
                            'on_gui_value_changed',
                            'on_player_muted',
                            'on_player_unmuted',
                            'on_player_cheat_mode_enabled',
                            'on_player_cheat_mode_disabled',
                            'on_character_corpse_expired',
                            'on_pre_ghost_deconstructed',
                            'on_player_pipette',
                            'on_player_display_resolution_changed',
                            'on_player_display_scale_changed',
                            'on_pre_player_crafted_item',
                            'on_player_cancelled_crafting',
                            'on_chunk_charted',
                            'on_technology_effects_reset',
                            'on_land_mine_armed',
                            'on_forces_merged',
                            'on_player_trash_inventory_changed',
                            'on_pre_player_left_game',
                            'on_pre_surface_cleared',
                            'on_surface_cleared',
                            'on_chunk_deleted',
                            'on_pre_chunk_deleted',
                            'on_train_schedule_changed',
                            'on_player_banned',
                            'on_player_kicked',
                            'on_player_unbanned',
                            'on_rocket_launch_ordered',
                            'on_script_path_request_finished',
                            'on_ai_command_completed',
                            'on_marked_for_upgrade',
                            'on_cancelled_upgrade',
                            'on_player_toggled_map_editor',
                            'on_entity_cloned',
                            'on_area_cloned',
                            'on_brush_cloned',
                            'on_game_created_from_scenario',
                            'on_surface_imported',
                            'on_surface_renamed',
                            'on_player_toggled_alt_mode',
                            'on_player_repaired_entity',
                            'on_player_fast_transferred',
                            'on_pre_robot_exploded_cliff',
                            'on_robot_exploded_cliff',
                            'on_entity_spawned',
                            'on_cutscene_waypoint_reached',
                            'on_unit_group_created',
                            'on_unit_added_to_group',
                            'on_unit_removed_from_group',
                            'on_unit_group_finished_gathering',
                            'on_build_base_arrived',
                            'on_chart_tag_added',
                            'on_chart_tag_modified',
                            'on_chart_tag_removed',
                            'on_lua_shortcut',
                            'on_gui_location_changed',
                            'on_gui_selected_tab_changed',
                            'on_gui_switch_state_changed',
                            'on_force_cease_fire_changed',
                            'on_force_friends_changed',
                            'on_string_translated',
                            'on_script_trigger_effect'
                        }
                    },
                    flow_precision_index = {
                        fields = {
                            'one_second',
                            'one_minute',
                            'ten_minutes',
                            'one_hour',
                            'ten_hours',
                            'fifty_hours',
                            'two_hundred_fifty_hours',
                            'one_thousand_hours'
                        }
                    },
                    group_state = {
                        fields = {
                            'gathering',
                            'moving',
                            'attacking_distraction',
                            'attacking_target',
                            'finished',
                            'pathfinding',
                            'wander_in_group'
                        }
                    },
                    gui_type = {
                        fields = {
                            'entity',
                            'research',
                            'controller',
                            'production',
                            'item',
                            'bonus',
                            'trains',
                            'achievement',
                            'blueprint_library',
                            'equipment',
                            'logistic',
                            'other_player',
                            'kills',
                            'permissions',
                            'tutorials',
                            'custom',
                            'server_management',
                            'player_management',
                            'tile'
                        }
                    },
                    input_action = {
                        fields = {
                            'activate_copy',
                            'activate_cut',
                            'activate_paste',
                            'add_permission_group',
                            'add_train_station',
                            'admin_action',
                            'alt_select_area',
                            'alt_select_blueprint_entities',
                            'alternative_copy',
                            'begin_mining',
                            'begin_mining_terrain',
                            'build_item',
                            'build_rail',
                            'build_terrain',
                            'cancel_craft',
                            'cancel_deconstruct',
                            'cancel_new_blueprint',
                            'cancel_research',
                            'cancel_upgrade',
                            'change_active_item_group_for_crafting',
                            'change_active_item_group_for_filters',
                            'change_active_quick_bar',
                            'change_arithmetic_combinator_parameters',
                            'change_blueprint_book_record_label',
                            'change_decider_combinator_parameters',
                            'change_item_label',
                            'change_multiplayer_config',
                            'change_picking_state',
                            'change_programmable_speaker_alert_parameters',
                            'change_programmable_speaker_circuit_parameters',
                            'change_programmable_speaker_parameters',
                            'change_riding_state',
                            'change_shooting_state',
                            'change_single_blueprint_record_label',
                            'change_train_stop_station',
                            'change_train_wait_condition',
                            'change_train_wait_condition_data',
                            'clean_cursor_stack',
                            'clear_selected_blueprint',
                            'clear_selected_deconstruction_item',
                            'clear_selected_upgrade_item',
                            'connect_rolling_stock',
                            'copy',
                            'copy_entity_settings',
                            'craft',
                            'create_blueprint_like',
                            'cursor_split',
                            'cursor_transfer',
                            'custom_input',
                            'cycle_blueprint_book_backwards',
                            'cycle_blueprint_book_forwards',
                            'deconstruct',
                            'delete_blueprint_library',
                            'delete_blueprint_record',
                            'delete_custom_tag',
                            'delete_permission_group',
                            'destroy_opened_item',
                            'disconnect_rolling_stock',
                            'drag_train_schedule',
                            'drag_train_wait_condition',
                            'drop_blueprint_record',
                            'drop_item',
                            'drop_to_blueprint_book',
                            'edit_custom_tag',
                            'edit_permission_group',
                            'export_blueprint',
                            'fast_entity_split',
                            'fast_entity_transfer',
                            'go_to_train_station',
                            'grab_blueprint_record',
                            'gui_checked_state_changed',
                            'gui_click',
                            'gui_confirmed',
                            'gui_elem_changed',
                            'gui_location_changed',
                            'gui_selected_tab_changed',
                            'gui_selection_state_changed',
                            'gui_switch_state_changed',
                            'gui_text_changed',
                            'gui_value_changed',
                            'import_blueprint',
                            'import_blueprint_string',
                            'import_permissions_string',
                            'inventory_split',
                            'inventory_transfer',
                            'launch_rocket',
                            'lua_shortcut',
                            'map_editor_action',
                            'market_offer',
                            'mod_settings_changed',
                            'open_achievements_gui',
                            'open_blueprint_library_gui',
                            'open_blueprint_record',
                            'open_bonus_gui',
                            'open_character_gui',
                            'open_equipment',
                            'open_gui',
                            'open_item',
                            'open_kills_gui',
                            'open_logistic_gui',
                            'open_mod_item',
                            'open_production_gui',
                            'open_technology_gui',
                            'open_train_gui',
                            'open_train_station_gui',
                            'open_trains_gui',
                            'open_tutorials_gui',
                            'paste_entity_settings',
                            'place_equipment',
                            'quick_bar_pick_slot',
                            'quick_bar_set_selected_page',
                            'quick_bar_set_slot',
                            'remove_cables',
                            'remove_train_station',
                            'reset_assembling_machine',
                            'rotate_entity',
                            'select_area',
                            'select_blueprint_entities',
                            'select_entity_slot',
                            'select_item',
                            'select_mapper_slot',
                            'select_next_valid_gun',
                            'select_tile_slot',
                            'set_auto_launch_rocket',
                            'set_autosort_inventory',
                            'set_behavior_mode',
                            'set_car_weapons_control',
                            'set_circuit_condition',
                            'set_circuit_mode_of_operation',
                            'set_deconstruction_item_tile_selection_mode',
                            'set_deconstruction_item_trees_and_rocks_only',
                            'set_entity_color',
                            'set_entity_energy_property',
                            'set_filter',
                            'set_heat_interface_mode',
                            'set_heat_interface_temperature',
                            'set_infinity_container_filter_item',
                            'set_infinity_container_remove_unfiltered_items',
                            'set_infinity_pipe_filter',
                            'set_inserter_max_stack_size',
                            'set_inventory_bar',
                            'set_logistic_filter_item',
                            'set_logistic_filter_signal',
                            'set_logistic_trash_filter_item',
                            'set_request_from_buffers',
                            'set_research_finished_stops_game',
                            'set_signal',
                            'set_single_blueprint_record_icon',
                            'set_splitter_priority',
                            'set_train_stopped',
                            'setup_assembling_machine',
                            'setup_blueprint',
                            'setup_single_blueprint_record',
                            'smart_pipette',
                            'stack_split',
                            'stack_transfer',
                            'start_repair',
                            'start_research',
                            'start_walking',
                            'stop_building_by_moving',
                            'switch_connect_to_logistic_network',
                            'switch_constant_combinator_state',
                            'switch_inserter_filter_mode_state',
                            'switch_power_switch_state',
                            'switch_to_rename_stop_gui',
                            'take_equipment',
                            'toggle_deconstruction_item_entity_filter_mode',
                            'toggle_deconstruction_item_tile_filter_mode',
                            'toggle_driving',
                            'toggle_enable_vehicle_logistics_while_moving',
                            'toggle_equipment_movement_bonus',
                            'toggle_map_editor',
                            'toggle_personal_roboport',
                            'toggle_show_entity_info',
                            'translate_string',
                            'undo',
                            'upgrade',
                            'upgrade_opened_blueprint',
                            'use_artillery_remote',
                            'use_item',
                            'wire_dragging',
                            'write_to_console'
                        }
                    },
                    inventory = {
                        fields = {
                            'fuel',
                            'burnt_result',
                            'chest',
                            'furnace_source',
                            'furnace_result',
                            'furnace_modules',
                            'character_main',
                            'character_guns',
                            'character_ammo',
                            'character_armor',
                            'character_vehicle',
                            'character_trash',
                            'god_main',
                            'editor_main',
                            'editor_guns',
                            'editor_ammo',
                            'editor_armor',
                            'roboport_robot',
                            'roboport_material',
                            'robot_cargo',
                            'robot_repair',
                            'assembling_machine_input',
                            'assembling_machine_output',
                            'assembling_machine_modules',
                            'lab_input',
                            'lab_modules',
                            'mining_drill_modules',
                            'item_main',
                            'rocket_silo_rocket',
                            'rocket_silo_result',
                            'rocket',
                            'car_trunk',
                            'car_ammo',
                            'cargo_wagon',
                            'turret_ammo',
                            'beacon_modules',
                            'character_corpse',
                            'artillery_turret_ammo',
                            'artillery_wagon_ammo'
                        }
                    },
                    logistic_member_index = {
                        fields = {
                            'logistic_container',
                            'vehicle_storage',
                            'character_requester',
                            'character_storage',
                            'character_provider',
                            'generic_on_off_behavior'
                        }
                    },
                    logistic_mode = {
                        fields = {
                            'active_provider',
                            'storage',
                            'requester',
                            'passive_provider',
                            'buffer'
                        }
                    },
                    mouse_button_type = {
                        fields = {
                            'left',
                            'right',
                            'middle'
                        }
                    },
                    rail_connection_direction = {
                        fields = {
                            'left',
                            'straight',
                            'right'
                        }
                    },
                    rail_direction = {
                        fields = {
                            'front',
                            'back'
                        }
                    },
                    render_mode = {
                        fields = {
                            'game',
                            'chart',
                            'chart_zoomed_in'
                        }
                    },
                    rich_text_setting = {
                        fields = {
                            'enabled',
                            'disabled',
                            'highlight'
                        }
                    },
                    riding = {
                        fields = {
                            acceleration = {
                                fields = {
                                    'nothing',
                                    'accelerating',
                                    'braking',
                                    'reversing'
                                }
                            },
                            direction = {
                                fields = {
                                    'left',
                                    'straight',
                                    'right'
                                }
                            }
                        }
                    },
                    shooting = {
                        fields = {
                            'not_shooting',
                            'shooting_enemies',
                            'shooting_selected'
                        }
                    },
                    signal_state = {
                        fields = {
                            'open',
                            'closed',
                            'reserved',
                            'reserved_by_circuit_network'
                        }
                    },
                    train_state = {
                        fields = {
                            'on_the_path',
                            'path_lost',
                            'no_schedule',
                            'no_path',
                            'arrive_signal',
                            'wait_signal',
                            'arrive_station',
                            'wait_station',
                            'manual_control_stop',
                            'manual_control'
                        }
                    },
                    transport_line = {
                        fields = {
                            'left_line',
                            'right_line',
                            'left_underground_line',
                            'right_underground_line',
                            'secondary_left_line',
                            'secondary_right_line',
                            'left_split_line',
                            'right_split_line',
                            'secondary_left_split_line',
                            'secondary_right_split_line'
                        }
                    },
                    wire_connection_id = {
                        fields = {
                            'electric_pole',
                            'power_switch_left',
                            'power_switch_right'
                        }
                    },
                    wire_type = {
                        fields = {
                            'red',
                            'green',
                            'copper'
                        }
                    },
                    -- Defines additional modules
                    color = {
                        other_fields = true
                    },
                    anticolor = {
                        other_fields = true
                    },
                    lightcolor = {
                        other_fields = true
                    },
                    time = {
                        fields = {
                            'second',
                            'minute',
                            'hour',
                            'day',
                            'week',
                            'month',
                            'year'
                        }
                    }
                }
            }
        }
    }
end

--[[ Options
    "ignore", "std", "globals", "unused_args", "self", "compat", "global", "unused", "redefined",
    "unused_secondaries", "allow_defined", "allow_defined_top", "module",
    "read_globals", "new_globals", "new_read_globals", "enable", "only", "not_globals",
    "max_line_length", "max_code_line_length", "max_string_line_length", "max_comment_line_length",
    "max_cyclomatic_complexity"
--]]

--[[ Warnings list
    -- 011 A syntax error.
    -- 021 An invalid inline option.
    -- 022 An unpaired inline push directive.
    -- 023 An unpaired inline pop directive.
    -- 111 Setting an undefined global variable.
    -- 112 Mutating an undefined global variable.
    -- 113 Accessing an undefined global variable.
    -- 121 Setting a read-only global variable.
    -- 122 Setting a read-only field of a global variable.
    -- 131 Unused implicitly defined global variable.
    -- 142 Setting an undefined field of a global variable.
    -- 143 Accessing an undefined field of a global variable.
    -- 211 Unused local variable.
    -- 212 Unused argument.
    -- 213 Unused loop variable.
    -- 221 Local variable is accessed but never set.
    -- 231 Local variable is set but never accessed.
    -- 232 An argument is set but never accessed.
    -- 233 Loop variable is set but never accessed.
    -- 241 Local variable is mutated but never accessed.
    -- 311 Value assigned to a local variable is unused.
    -- 312 Value of an argument is unused.
    -- 313 Value of a loop variable is unused.
    -- 314 Value of a field in a table literal is unused.
    -- 321 Accessing uninitialized local variable.
    -- 331 Value assigned to a local variable is mutated but never accessed.
    -- 341 Mutating uninitialized local variable.
    -- 411 Redefining a local variable.
    -- 412 Redefining an argument.
    -- 413 Redefining a loop variable.
    -- 421 Shadowing a local variable.
    -- 422 Shadowing an argument.
    -- 423 Shadowing a loop variable.
    -- 431 Shadowing an upvalue.
    -- 432 Shadowing an upvalue argument.
    -- 433 Shadowing an upvalue loop variable.
    -- 511 Unreachable code.
    -- 512 Loop can be executed at most once.
    -- 521 Unused label.
    -- 531 Left-hand side of an assignment is too short.
    -- 532 Left-hand side of an assignment is too long.
    -- 541 An empty do end block.
    -- 542 An empty if branch.
    -- 551 An empty statement.
    -- 611 A line consists of nothing but whitespace.
    -- 612 A line contains trailing whitespace.
    -- 613 Trailing whitespace in a string.
    -- 614 Trailing whitespace in a comment.
    -- 621 Inconsistent indentation (SPACE followed by TAB).
    -- 631 Line is too long.
--]]
