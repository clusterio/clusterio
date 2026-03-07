import { InstallationError } from "./errors";
declare global {
	// eslint-disable-next-line vars-on-top
	var _clusterioLibImportedFrom: string;
}

export function checkSingletonImport(location: string) {
	if (!global._clusterioLibImportedFrom) {
		global._clusterioLibImportedFrom = location;
	} else {
		throw new InstallationError(`Attempt to import duplicate copy of @clusterio/lib

Importing more than one copy of @clusterio/lib into the same runtime
will break Clusterio. This typically happens when the package
manager has installed two different versions of @clusterio/lib
and assigned different ones to different components of Clusterio.

Previously imported @clusterio/lib was located at ${_clusterioLibImportedFrom}
This copy of @clusterio/lib is located at ${location}`);
	}
}
