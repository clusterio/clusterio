
(function (){
	ensureSetting("Display offline slaves", "boolean", false);
	ensureSetting("Enable production graphs", "boolean", true);
}())

function ensureSetting(setting, type, defaultSetting) {
	let settings
	try {
		settings = JSON.parse(localStorage.settings);
	} catch (e) {
		
	}
	if(!settings) settings = {};
	if(typeof settings[setting] != type) {
		settings[setting] = defaultSetting;
		console.log("Fixed setting: " + setting + " | " + defaultSetting)
	}
	localStorage.settings = JSON.stringify(settings)
}

var g = {}
contents = {
	"iron-plate":100,
	"copper-plate":7312,
}
// nice functions
// hash a string to a hash
function djb2(str){
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
  }
  return hash;
}
// hash a string to a color
function hashColor(str) {
  var hash = djb2(str);
  var r = (hash & 0xFF0000) >> 16;
  var g = (hash & 0x00FF00) >> 8;
  var b = hash & 0x0000FF;
  return "#" + ("0" + r.toString(16)).substr(-2) + ("0" + g.toString(16)).substr(-2) + ("0" + b.toString(16)).substr(-2);
}
// exactly what you would expect it to, returns String
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// hide the HTML object passed as argument #1
function hideThis(object) {
	object.style.visibility = "hidden";
}

Date.prototype.yyyymmdd = function(time) { // http://stackoverflow.com/questions/3066586/get-string-in-yyyymmdd-format-from-js-date-object
	var mm = this.getMonth() + 1; // getMonth() is zero-based
	var dd = this.getDate();
	if(mm<10)mm = "0"+mm
	if(dd<10)dd = "0"+dd
	console.log(this.getFullYear())
	return this.getFullYear()+""+mm+""+dd+ ""; // padding
};
var date = new Date();

// image data
// key is the name of the item in the database, value is the name of the image on wiki.factorio.com/images/*
// this list has to include all entities that doesn't just follow the simple capitalize first letter convention
var imagedata = {
	["empty-barrel"]: "Barrel-empty",
	["transport-belt"]: "Basic-transport-belt",
	["underground-belt"]: "Basic-transport-belt-to-ground",
	["fast-underground-belt"]: "Fast-transport-belt-to-ground",
	["express-underground-belt"]: "Express-transport-belt-to-ground",
	["splitter"]: "Basic-splitter",
	["inserter"]: "Inserter-icon",
	["stack-inserter"]: "Stack_inserter",
	["stack-filter-inserter"]: "Stack_filter_inserter",
	["efficiency-module"]: "Effectivity-module",
	["efficiency-module_2"]: "Effectivity-module-2",
	["efficiency-module_3"]: "Effectivity-module-3",
	["low-density-structure"]: "Rocket-structure",
	["electric-mining-drill"]: "Basic-mining-drill",
	["burner-mining-drill"]: "Burner-mining-drill",
	["active-provider-chest"]: "Logistic-chest-active-provider",
	["passive-provider-chest"]: "Logistic-chest-passive-provider",
	["storage-chest"]: "Logistic-chest-storage",
	["requester-chest"]: "Logistic-chest-requester",
	["wall"]: "Stone-wall",
	["medium-electric-pole"]: "Medium-electric-pole",
	["lamp"]: "Small-lamp",
	["regular-magazine"]: "Basic-bullet-magazine",
	["piercing-rounds_magazine"]: "Piercing-bullet-magazine",
	["flamethrower-ammo"]: "Flame-thrower-ammo",
	["cannon-shells"]: "Cannon-shell",
	["explosive-cannon-shells"]: "Explosive-cannon-shell",
	["land-mine"]: "Land-mine-research",
	["cluster-grenade"]: "Cluster_grenade",
	["shotgun-shells"]: "Shotgun-shell",
	["piercing-shotgun-shells"]: "Piercing-shotgun-shell",
	["accumulator"]: "Basic-accumulator",
	["beacon"]: "Basic-beacon",
	["rail"]: "Straight-rail",
	["piercing-rounds-magazine"]: "Piercing-bullet-magazine",
	["grenade"]: "Basic-grenade",
	["raw-fish"]: "Fish",
	["water-barrel"]: "Barrel-empty",
	["smart-train-stop"]: "Train-stop",
	["put-combinator"]: "Decider-combinator",
}

// value:link pairs where you can add modded item icons that are missing
var imagelinks = {
	"fictional-modded-item": "/pictures/fictional-modded-item.png"
}
