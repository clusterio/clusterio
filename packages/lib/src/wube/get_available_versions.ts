import phin from "phin";

type Version = {
	download_url: {
		linux64: string;
	};
	version: string;
}

/**
 * Get versions of Factorio available for download from the official website
 * @returns {Promise<Version[]>} List of versions available for download
 */
export async function getAvailableVersions(): Promise<Version[]> {
	let page = await phin({
		url: "https://www.factorio.com/download/archive",
		method: "GET",
		followRedirects: true,
	});

	// Reimplement with a regex to parse the relevant sections of the html
	let regex = /\/download\/archive\/\d+\.\d+\.\d+\b/g;
	let versions = [];
	let matches = page.body.toString().matchAll(regex);
	for (const match of matches) {
		const version = match[0].split("/")[3];
		versions.push({
			download_url: {
				// Supporting other platforms will require factorio account login
				linux64: `https://www.factorio.com/get-download/${version}/headless/linux64"`,
			},
			version: version,
		});
	}

	return versions;
};
