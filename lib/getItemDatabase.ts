import * as fs from "fs"
import * as path from "path"

export function getItemDatabase(config: ClusterioConfig): {[name:string]: number | Function} {
	var items: {[name: string]: number | Function} = {}
	try{
		let x = fs.statSync(path.resolve(config.databaseDirectory, "items.json"));
		console.log(`loading items from ${path.resolve(config.databaseDirectory, "items.json")}`);
		items = JSON.parse(fs.readFileSync(path.resolve(config.databaseDirectory, "items.json")).toString());
	} catch (e){
		items = {};
	}
	items.addItem = function addItem(object: item): boolean {
		if(object.name == "addItem" || object.name == "removeItem") {
			console.error("Fuck you, that would screw everything up if you named your item that.");
			return false;
		} else {
			if(this[object.name] && Number(this[object.name]) != NaN){
				this[object.name] = Number(this[object.name]) + Number(object.count);
			} else {
				this[object.name] = object.count;
			}
			return true;
		}
	},
	items.removeItem = function removeItem(object: item): boolean {
		if(object.name == "addItem" || object.name == "removeItem") {
			console.error("Fuck you, that would screw everything up if you named your item that.");
			return false;
		} else {
			if(this[object.name] && Number(this[object.name]) != NaN){
				this[object.name] = Number(this[object.name]) - Number(object.count);
			} else {
				this[object.name] = 0;
			}
			return true;
		}
	}
	return items
}