import { Static, Type } from "@sinclair/typebox";
import { FullVersion, FullVersionSchema, integerFullVersion, isFullVersion } from "../data/version.js";

const ARCHIVE_URL = "https://factorio.com/download/archive/";

/**
 * Represents the parsed result of a factorio version
 */
export const ExternalFactorioVersionSchema = Type.Object({
	stable: Type.Boolean(),
	version: FullVersionSchema,
	/** @deprecated Linux x64 only, use {@link factorioHeadlessUrl} instead. */
	headlessUrl: Type.String(),
});

export type ExternalFactorioVersion = Static<typeof ExternalFactorioVersionSchema>;

/** Platforms Factorio may publish headless builds for, named as in Node's process.platform */
export type FactorioHeadlessPlatform = "linux" | "win32";

/** CPU architectures Factorio may publish headless builds for, named as in Node's process.arch */
export type FactorioHeadlessArch = "x64" | "arm64";

/** First Factorio version with an ARM64 Linux headless build */
export const minimumArm64HeadlessVersion = "2.1.18";

/**
 * Check if Factorio publishes a headless build of a version
 *
 * @param version - Factorio version to check.
 * @param platform - Platform of the build.
 * @param arch - CPU architecture of the build.
 * @returns true if the build can be downloaded.
 */
export function hasFactorioHeadless(
	version: FullVersion,
	platform: FactorioHeadlessPlatform,
	arch: FactorioHeadlessArch,
) {
	if (platform !== "linux") {
		return false;
	}
	return arch === "x64" || integerFullVersion(version) >= integerFullVersion(minimumArm64HeadlessVersion);
}

/**
 * Download URL of the headless build of a Factorio version
 *
 * @param version - Factorio version to download.
 * @param platform - Platform of the build.
 * @param arch - CPU architecture of the build.
 * @returns URL redirecting to the archive.
 * @throws Error if Factorio has no headless build for the platform and arch.
 */
export function factorioHeadlessUrl(
	version: FullVersion,
	platform: FactorioHeadlessPlatform,
	arch: FactorioHeadlessArch,
) {
	if (!hasFactorioHeadless(version, platform, arch)) {
		throw new Error(`Factorio ${version} has no headless build for ${platform} ${arch}`);
	}
	const build = arch === "arm64" ? "linux-arm64" : "linux64";
	return `https://www.factorio.com/get-download/${version}/headless/${build}`;
}

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
	// eslint-disable-next-line @stylistic/max-len
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
				headlessUrl: factorioHeadlessUrl(version, "linux", "x64"),
			});
		}
	}

	return [...versions.values()];
}
