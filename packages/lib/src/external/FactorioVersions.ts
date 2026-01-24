import { Static, Type } from "@sinclair/typebox";
import { FullVersionSchema, integerFullVersion, isFullVersion } from "../data";

const ARCHIVE_URL = "https://factorio.com/download/archive";

/**
 * Represents the parsed result of a factorio version
 */
export const ExternalFactorioVersionSchema = Type.Object({
	stable: Type.Boolean(),
	version: FullVersionSchema,
	headlessUrl: Type.String(),
});

export type ExternalFactorioVersion = Static<typeof ExternalFactorioVersionSchema>

/**
 * Fetch all factorio versions that support headless
 *
 * @returns A list of all factorio versions and their download URL
 * @throws Network errors and non-ok status responses
 */
export async function fetchFactorioVersions(): Promise<ExternalFactorioVersion[]> {
	let res;

	try {
		res = await fetch(ARCHIVE_URL);
	} catch (err) {
		throw new Error(`Failed to fetch Factorio versions from ${ARCHIVE_URL}: ${err}`);
	}

	if (!res.ok) {
		throw new Error(`Failed to fetch Factorio versions from ${ARCHIVE_URL}: HTTP ${res.status} ${res.statusText}`);
	}

	const html = await res.text();
	return parseFactorioVersions(html);
}

/**
 * Parse all versions from the factorio archive webpage
 *
 * @param html The HTML content of the archive page
 * @returns A list of all factorio versions and their download URL
 */
function parseFactorioVersions(html: string): ExternalFactorioVersion[] {
	const versions = new Map<string, ExternalFactorioVersion>();

	// Match <a class=" slot-button-inline version-button-stable " href="/download/archive/2.0.72">2.0.72</a>
	// eslint-disable-next-line max-len
	const anchorRegex = /<a[^>]*class="[^"]*version-button-(?<kind>stable|experimental)[^"]*"[^>]*href="[^"]*\/download\/archive\/(?<version>\d+\.\d+.\d+)"[^>]*>/g;

	let match: RegExpExecArray | null;
	const minimumMultiplayerVersion = integerFullVersion("0.12.35");
	while ((match = anchorRegex.exec(html)) !== null) {
		const kind = match.groups?.kind;
		const version = match.groups?.version;

		if (kind && version && isFullVersion(version) && integerFullVersion(version) >= minimumMultiplayerVersion) {
			versions.set(version, {
				version: version,
				stable: kind === "stable",
				headlessUrl: `www.factorio.com/get-download/${version}/headless/linux64`,
			});
		}
	}

	return [...versions.values()];
}
