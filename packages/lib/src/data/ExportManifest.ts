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
		 *
		 * Spritesheets — each `{category}-spritesheet` has a matching `{category}-metadata`
		 * containing a JSON array of [name, {x, y, size}] entries describing sprite coordinates:
		 * - item-spritesheet / item-metadata: items, fluids, ammo, armor, modules, tools, etc.
		 * - recipe-spritesheet / recipe-metadata: recipe prototypes with explicit icons.
		 * - signal-spritesheet / signal-metadata: virtual-signal prototypes.
		 * - technology-spritesheet / technology-metadata: technology prototypes.
		 * - planet-spritesheet / planet-metadata: planet and space-location prototypes.
		 * - quality-spritesheet / quality-metadata: quality prototypes.
		 * - entity-spritesheet / entity-metadata: all entity prototype types with icons.
		 * - static-spritesheet / static-metadata: non-prototype UI icons (tooltips, alerts,
		 *   and individual loose graphics from core/).
		 *
		 * Keys for static-metadata use the pattern `{prefix}-{basename}` for directory scans
		 * (e.g. `tooltip-category-electricity`, `alert-no-fuel`) or a short name for
		 * individual files (e.g. `add`, `cancel`, `clock`, `rename`).
		 */
		public assets: Record<string, string>,
		/** Name of the mod pack used for this export. */
		public modPackName?: string,
		/** Name of the instance that triggered this export. */
		public instanceName?: string,
		/** ISO 8601 timestamp of when the export was uploaded. */
		public exportedAt?: string,
	) { }

	static jsonSchema = Type.Object({
		"assets": Type.Record(Type.String(), Type.String()),
		"modPackName": Type.Optional(Type.String()),
		"instanceName": Type.Optional(Type.String()),
		"exportedAt": Type.Optional(Type.String()),
	});

	static fromJSON(json: Static<typeof ExportManifest.jsonSchema>) {
		return new this(json.assets, json.modPackName, json.instanceName, json.exportedAt);
	}
}
