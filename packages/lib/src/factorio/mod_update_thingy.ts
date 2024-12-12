import { ModInfo } from "../data";


// the example comments are from the mod maraxsis

interface modRelease {
	download_url: string, // /download/maraxsis/670de301df21001f6147fd1c -- append to mods.factorio.com to download file, auth required
	file_name: string, // maraxsis_1.8.0.zip -- the file name of the downloaded file ^^
	info_json: { factorio_version: string } // 2.0 -- seems to just hold what factorio version it supports, due to it being nested, it could other info, not sure
	released_at: string, // 2024-10-15T03:35:29.892000Z -- some kind of time stamp, i'm sure that can be imported/converted to a useable format if it useful to have
	sha1: string,  // e227ee560d93485c7f215c9451eaa9cc38d81c98 -- it's a hash, not much to say
	version: string // 1.8.0 -- just a normal version string
}

interface modDetails {
	category: string, // content -- what mod catogory is this apart of, i think a mod can only be apart of 1 category
	download_count: number, // 3653 -- how many downloads does the mod have as a number
	name: string, // maraxsis -- the name of the mod
	owner: string, // notnotmelon -- the name of the author of the mod
	releases: Array<modRelease>, // an array of all releases and version of the mod, the type is declared above
	score: number, // 1054.8333333333333 -- not sure, seems some kind of float or double, based on name, it's prob used for sorting purposes
	summary: string, // the mod description
	thumbnail: string, // append path to assets-mods.factorio.com to get full url to thumbnail file
	title: string // the full title of the mod, shown on the mod page
}


async function getLatestVersion(mod: ModInfo) {
	const modStuff: modDetails = await (await fetch("https://mods.factorio.com/api/mods/" + mod.name)).json() as modDetails
	const latestVersion = modStuff.releases[modStuff.releases.length].version
}
