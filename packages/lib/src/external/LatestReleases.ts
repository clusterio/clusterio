import { Static, Type } from "@sinclair/typebox";
import { FullVersion, FullVersionSchema } from "../data/version";

const LATEST_RELEASES_URL = "https://factorio.com/api/latest-releases";

/**
 * The set of builds (e.g. alpha, demo, headless, expansion) and their version
 * for a single release channel.
 */
export const LatestReleaseBuildsSchema = Type.Record(Type.String(), FullVersionSchema);

/**
 * The latest released version of each build, keyed by release channel name
 * (e.g. "stable" and "experimental").
 */
export const LatestReleasesSchema = Type.Record(Type.String(), LatestReleaseBuildsSchema);

export type LatestReleases = Static<typeof LatestReleasesSchema>

/**
 * Fetch the latest stable and experimental factorio releases
 *
 * @returns The latest version of each build keyed by release channel
 * @throws Network errors and non-ok status responses
 */
export async function fetchLatestReleases(): Promise<LatestReleases> {
	let res;

	try {
		res = await fetch(LATEST_RELEASES_URL);
	} catch (err) {
		throw new Error(`Failed to fetch Factorio releases from ${LATEST_RELEASES_URL}: ${err}`);
	}

	if (!res.ok) {
		throw new Error(
			`Failed to fetch Factorio releases from ${LATEST_RELEASES_URL}: HTTP ${res.status} ${res.statusText}`
		);
	}

	return await res.json() as LatestReleases;
}

/**
 * Resolve a release channel to a concrete factorio version
 *
 * @param releases Releases data as returned by {@link fetchLatestReleases}
 * @param channel Release channel name, e.g. "stable" or "experimental"
 * @param build Build to read the version of, defaults to the headless build
 * @returns The version for the channel, or undefined if it cannot be resolved
 */
export function resolveReleaseChannel(
	releases: LatestReleases,
	channel: string,
	build = "headless",
): FullVersion | undefined {
	const builds = releases[channel];
	if (!builds) {
		return undefined;
	}
	return (builds[build] ?? Object.values(builds)[0]) as FullVersion | undefined;
}
