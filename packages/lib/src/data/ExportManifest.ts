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
		 * Currently exported assets are
		 * - settings: JSON of mod settings prototypes.
		 * - prototypes: JSON of all game prototypes except settings.
		 * - item-spritesheet: PNG containing icons from the game.
		 * - item-metadata: JSON of Map entries describing icons in item-spritesheet
		 * - locale: JSON of flattened Map entries of en locale strings from the game.
		 */
		public assets: Record<string, string>
	) { }

	static jsonSchema = Type.Object({
		"assets": Type.Record(Type.String(), Type.String()),
	});

	static fromJSON(json: Static<typeof ExportManifest.jsonSchema>) {
		return new this(json.assets);
	}
}
