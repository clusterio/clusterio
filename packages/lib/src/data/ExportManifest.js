"use strict";

/**
 * Export manifest for a mod pack
 *
 * Tracks files stored on disk for data that extracted from Factorio using a
 * given mod pack.
 * @alias module:lib.ExportManifest
 */
class ExportManifest {

	/**
	 * Mapping between known assets and their file names.
	 *
	 * Currently exported assets are
	 * - settings: JSON of mod settings prototypes.
	 * - prototypes: JSON of all game prototypes except settings.
	 * - item-spritesheet: PNG containing icons from the game.
	 * - item-metadata: JSON of Map entries describing icons in item-spritesheet
	 * - locale: JSON of flattened Map entries of en locale strings from the game.
	 * @type {Object<string, string>}
	 */
	assets = {};

	constructor(assets) {
		if (assets) { this.assets = assets; }
	}

	static jsonSchema = {
		type: "object",
		additionalProperties: false,
		required: ["assets"],
		properties: {
			"assets": {
				type: "object",
				additionalProperties: { type: "string" },
			},
		},
	};

	static fromJSON(json) {
		return new this(json.assets);
	}
}

module.exports = ExportManifest;
