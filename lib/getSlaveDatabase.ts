import * as fs from "fs"
import * as path from "path"

export function getSlaveDatabase(config: ClusterioConfig): Slaves {
    var slaves: Slaves = {};
    try{
		let x = fs.statSync(path.resolve(config.databaseDirectory, "/slaves.json"));
		console.log(`loading slaves from path.resolve(config.databaseDirectory, "slaves.json")`);
		slaves = JSON.parse(fs.readFileSync(path.resolve(config.databaseDirectory, "slaves.json"), "utf-8"));
	} catch (e){
		slaves = {};
    }
    return slaves
}
