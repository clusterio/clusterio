"use strict";
if (module === require.main) {
	process.stdout.write(JSON.stringify(process.argv.slice(2)));
}
