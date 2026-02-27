import { Type, Static } from "@sinclair/typebox";

/**
 * Export manifest for a mod pack
 *
 * Tracks files stored on disk for data that extracted from Factorio using a
 * given mod pack.
 */
export default class ExportManifest {
	constructor(
		/**
		 * Mapping between known assets and their file names.
		 *
		 * Currently exported assets are:
		 * - settings: JSON of mod settings prototypes.
		 * - prototypes: JSON of all game prototypes except settings.
		 * - locale: JSON of flattened Map entries of en locale strings from the game.
		 * - spritesheet: Single PNG spritesheet containing all icon categories.
		 * - metadata: JSON array of [name, {x, y, size, category, path?}] entries
		 *   describing sprite coordinates and category membership. Categories:
		 *   item, recipe, signal, technology, planet, quality, entity, static.
		 */
		public assets: Record<string, string>,
		/** ISO 8601 timestamp of when the export was uploaded. */
		public exportedAt?: string,
	) { }

	static jsonSchema = Type.Object({
		"assets": Type.Record(Type.String(), Type.String()),
		"exportedAt": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof ExportManifest.jsonSchema>) {
		return new this(json.assets, json.exportedAt);
	}
}
