"use strict";
const zlib = require("zlib");


class MapReaderState {
	constructor(buf) {
		this.pos = 0;
		this.buf = buf;
		this.last_position = { x: 0, y: 0 };
	}
}

function readUInt8(state) {
	let value = state.buf.readUInt8(state.pos);
	state.pos += 1;
	return value;
}

function readBool(state) {
	let value = readUInt8(state) !== 0;
	return value;
}

function readInt16(state) {
	let value = state.buf.readInt16LE(state.pos);
	state.pos += 2;
	return value;
}

function readUInt16(state) {
	let value = state.buf.readUInt16LE(state.pos);
	state.pos += 2;
	return value;
}

function readInt32(state) {
	let value = state.buf.readInt32LE(state.pos);
	state.pos += 4;
	return value;
}

function readUInt32(state) {
	let value = state.buf.readUInt32LE(state.pos);
	state.pos += 4;
	return value;
}

function readUInt32so(state) {
	let value = readUInt8(state);
	if (value === 0xff) {
		return readUInt32(state);
	}

	return value;
}

function readFloat(state) {
	let value = state.buf.readFloatLE(state.pos);
	state.pos += 4;
	return value;
}

function readDouble(state) {
	let value = state.buf.readDoubleLE(state.pos);
	state.pos += 8;
	return value;
}

function readString(state) {
	let size = readUInt32so(state);
	let data = state.buf.slice(state.pos, state.pos + size).toString("utf-8");
	state.pos += size;
	return data;
}

function readOptional(state, readValue) {
	let load = readUInt8(state) !== 0;
	if (!load) {
		return null;
	}
	return readValue(state);
}

function readArray(state, readItem) {
	let size = readUInt32so(state);

	let array = [];
	for (let i = 0; i < size; i++) {
		let item = readItem(state);
		array.push(item);
	}

	return array;
}

function readDict(state, readKey, readValue) {
	let size = readUInt32so(state);

	let mapping = new Map();
	for (let i = 0; i < size; i++) {
		let key = readKey(state);
		let value = readValue(state);
		mapping.set(key, value);
	}

	return mapping;
}

function readVersion(state) {
	let major = readUInt16(state);
	let minor = readUInt16(state);
	let patch = readUInt16(state);
	let developer = readUInt16(state);
	return [major, minor, patch, developer];
}

function readFrequencySizeRichness(state) {
	return {
		frequency: readFloat(state),
		size: readFloat(state),
		richness: readFloat(state),
	};
}

function readAutoplaceSetting(state) {
	return {
		treat_missing_as_default: readBool(state),
		settings: Object.fromEntries(readDict(state, readString, readFrequencySizeRichness)),
	};
}

function readMapPosition(state) {
	let x, y;
	let x_diff = readInt16(state) / 256;
	if (x_diff === 0x7fff / 256) {
		x = readInt32(state) / 256;
		y = readInt32(state) / 256;
	} else {
		let y_diff = readInt16(state) / 256;
		x = state.last_position.x + x_diff;
		y = state.last_position.y + y_diff;
	}
	state.last_position.x = x;
	state.last_position.x = y;
	return { x, y };
}

function readBoundingBox(state) {
	return {
		left_top: readMapPosition(state),
		right_bottom: readMapPosition(state),
		orientation: {
			x: readInt16(state),
			y: readInt16(state),
		},
	};
}

function readCliffSettings(state) {
	return {
		name: readString(state),
		elevation_0: readFloat(state),
		elevation_interval: readFloat(state),
		richness: readFloat(state),
	};
}

function readMapGenSettings(state) {
	return {
		terrain_segmentation: readFloat(state),
		water: readFloat(state),
		autoplace_controls: Object.fromEntries(readDict(state, readString, readFrequencySizeRichness)),
		autoplace_settings: Object.fromEntries(readDict(state, readString, readAutoplaceSetting)),
		default_enable_all_autoplace_controls: readBool(state),
		seed: readUInt32(state),
		width: readUInt32(state),
		height: readUInt32(state),
		area_to_generate_at_start: readBoundingBox(state),
		starting_area: readFloat(state),
		peaceful_mode: readBool(state),
		starting_points: readArray(state, readMapPosition),
		property_expression_names: Object.fromEntries(readDict(state, readString, readString)),
		cliff_settings: readCliffSettings(state),
	};
}

function readPollution(state) {
	return {
		enabled: readOptional(state, readBool),
		diffusion_ratio: readOptional(state, readDouble),
		min_to_diffuse: readOptional(state, readDouble),
		ageing: readOptional(state, readDouble),
		expected_max_per_chunk: readOptional(state, readDouble),
		min_to_show_per_chunk: readOptional(state, readDouble),
		min_pollution_to_damage_trees: readOptional(state, readDouble),
		pollution_with_max_forest_damage: readOptional(state, readDouble),
		pollution_per_tree_damage: readOptional(state, readDouble),
		pollution_restored_per_tree_damage: readOptional(state, readDouble),
		max_pollution_to_restore_trees: readOptional(state, readDouble),
		enemy_attack_pollution_consumption_modifier: readOptional(state, readDouble),
	};
}

function readSteeringValue(state) {
	return {
		radius: readOptional(state, readDouble),
		separation_factor: readOptional(state, readDouble),
		separation_force: readOptional(state, readDouble),
		force_unit_fuzzy_goto_behavior: readOptional(state, readBool),
	};

}

function readSteering(state) {
	return {
		default: readSteeringValue(state),
		moving: readSteeringValue(state),
	};
}

function readEnemyEvolution(state) {
	return {
		enabled: readOptional(state, readBool),
		time_factor: readOptional(state, readDouble),
		destroy_factor: readOptional(state, readDouble),
		pollution_factor: readOptional(state, readDouble),
	};
}

function readEnemyExpansion(state) {
	return {
		enabled: readOptional(state, readBool),
		max_expansion_distance: readOptional(state, readUInt32),
		friendly_base_influence_radius: readOptional(state, readUInt32),
		enemy_building_influence_radius: readOptional(state, readUInt32),
		building_coefficient: readOptional(state, readDouble),
		other_base_coefficient: readOptional(state, readDouble),
		neighbouring_chunk_coefficient: readOptional(state, readDouble),
		neighbouring_base_chunk_coefficient: readOptional(state, readDouble),
		max_colliding_tiles_coefficient: readOptional(state, readDouble),
		settler_group_min_size: readOptional(state, readUInt32),
		settler_group_max_size: readOptional(state, readUInt32),
		min_expansion_cooldown: readOptional(state, readUInt32),
		max_expansion_cooldown: readOptional(state, readUInt32),
	};
}

function readUnitGroup(state) {
	return {
		min_group_gathering_time: readOptional(state, readUInt32),
		max_group_gathering_time: readOptional(state, readUInt32),
		max_wait_time_for_late_members: readOptional(state, readUInt32),
		max_group_radius: readOptional(state, readDouble),
		min_group_radius: readOptional(state, readDouble),
		max_member_speedup_when_behind: readOptional(state, readDouble),
		max_member_slowdown_when_ahead: readOptional(state, readDouble),
		max_group_slowdown_factor: readOptional(state, readDouble),
		max_group_member_fallback_factor: readOptional(state, readDouble),
		member_disown_distance: readOptional(state, readDouble),
		tick_tolerance_when_member_arrives: readOptional(state, readUInt32),
		max_gathering_unit_groups: readOptional(state, readUInt32),
		max_unit_group_size: readOptional(state, readUInt32),
	};
}

function readPathFinder(state) {
	return {
		fwd2bwd_ratio: readOptional(state, readInt32),
		goal_pressure_ratio: readOptional(state, readDouble),
		use_path_cache: readOptional(state, readBool),
		max_steps_worked_per_tick: readOptional(state, readDouble),
		max_work_done_per_tick: readOptional(state, readUInt32),
		short_cache_size: readOptional(state, readUInt32),
		long_cache_size: readOptional(state, readUInt32),
		short_cache_min_cacheable_distance: readOptional(state, readDouble),
		short_cache_min_algo_steps_to_cache: readOptional(state, readUInt32),
		long_cache_min_cacheable_distance: readOptional(state, readDouble),
		cache_max_connect_to_cache_steps_multiplier: readOptional(state, readUInt32),
		cache_accept_path_start_distance_ratio: readOptional(state, readDouble),
		cache_accept_path_end_distance_ratio: readOptional(state, readDouble),
		negative_cache_accept_path_start_distance_ratio: readOptional(state, readDouble),
		negative_cache_accept_path_end_distance_ratio: readOptional(state, readDouble),
		cache_path_start_distance_rating_multiplier: readOptional(state, readDouble),
		cache_path_end_distance_rating_multiplier: readOptional(state, readDouble),
		stale_enemy_with_same_destination_collision_penalty: readOptional(state, readDouble),
		ignore_moving_enemy_collision_distance: readOptional(state, readDouble),
		enemy_with_different_destination_collision_penalty: readOptional(state, readDouble),
		general_entity_collision_penalty: readOptional(state, readDouble),
		general_entity_subsequent_collision_penalty: readOptional(state, readDouble),
		extended_collision_penalty: readOptional(state, readDouble),
		max_clients_to_accept_any_new_request: readOptional(state, readUInt32),
		max_clients_to_accept_short_new_request: readOptional(state, readUInt32),
		direct_distance_to_consider_short_request: readOptional(state, readUInt32),
		short_request_max_steps: readOptional(state, readUInt32),
		short_request_ratio: readOptional(state, readDouble),
		min_steps_to_check_path_find_termination: readOptional(state, readUInt32),
		start_to_goal_cost_multiplier_to_terminate_path_find: readOptional(state, readDouble),
		overload_levels: readOptional(state, (p) => readArray(p, readUInt32)),
		overload_multipliers: readOptional(state, (p) => readArray(p, readDouble)),
		negative_path_cache_delay_interval: readOptional(state, readUInt32),
	};
}

function readDifficultySettings(state) {
	return {
		recipe_difficulty: readUInt8(state),
		technology_difficulty: readUInt8(state),
		technology_price_multiplier: readDouble(state),
		research_queue_setting: ["always", "after-victory", "never"][readUInt8(state)],
	};
}

function readMapSettings(state) {
	return {
		pollution: readPollution(state),
		steering: readSteering(state),
		enemy_evolution: readEnemyEvolution(state),
		enemy_expansion: readEnemyExpansion(state),
		unit_group: readUnitGroup(state),
		path_finder: readPathFinder(state),
		max_failed_behavior_count: readUInt32(state),
		difficulty_settings: readDifficultySettings(state),
	};
}

/**
 * @typedef {object} module:lib/factorio.MapExchangeResult
 * @property {array} version -
 *     Version of Factorio the string was created with.
 * @property {object} map_gen_settings -
 *     Decoded map generator settings in the format the --map-gen-settings
 *     command line option to Factorio expect.
 * @property {object} map_settings -
 *     Decoded map settings in the format the --map-settings command line option
 *     to Factorio expects.
 * @property {number} checksum - checksum for the exchange string.
 */

/**
 * Parse a Map Exchange String
 *
 * Reads and decodes the data in the given map exchange string and returns
 * data structures that can be fed into the Factorio server when creating a
 * save to set the map gen settings and the map settings for the save.
 *
 * @param {string} exchangeString - Max Exchange String to parse.
 * @returns {module:lib/factorio.MapExchangeResult} Parsed result.
 * @memberof module:lib/factorio
 */
function readMapExchangeString(exchangeString) {
	exchangeString = exchangeString.replace(/[ \t\n\r]+/g, "");
	if (!/>>>[0-9a-zA-Z\/+]+={0,3}<<</.test(exchangeString)) {
		throw new Error("Not a map exchange string");
	}

	let buf = Buffer.from(exchangeString.slice(3, -3), "base64");
	try {
		// eslint-disable-next-line node/no-sync
		buf = zlib.inflateSync(buf);
	} catch (err) {
		if (err.code.startsWith("Z_")) {
			throw new Error("Malformed map exchange string: zlib inflate failed");
		}
	}

	let state = new MapReaderState(buf);
	let data;

	try {
		data = {
			version: readVersion(state),
			unknown: readUInt8(state),
			map_gen_settings: readMapGenSettings(state),
			map_settings: readMapSettings(state),
			checksum: readUInt32(state),
		};
	} catch (err) {
		if (err.code === "ERR_OUT_OF_RANGE") {
			throw new Error("Malformed map exchange string: reached end before finishing parsing");
		}
		throw err;
	}

	if (state.pos !== buf.length) {
		throw new Error("Malformed map exchange string: data after end");
	}

	return data;
}

module.exports = {
	readMapExchangeString,
};
