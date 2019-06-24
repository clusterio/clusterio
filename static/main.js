
(function (){
	ensureSetting("Display offline slaves", "boolean", false);
	ensureSetting("Enable production graphs", "boolean", true);
	ensureSetting("Periodically update storage screen", "boolean", true);
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

// debug tools

debugTools = {
	addItem: function(name, count){
		console.log(`Attempting to add ${count} ${name}`)
		postJSON("api/place", {
			instanceName: "unknown",
			instanceID: "unknown",
			unique: "unknown",
			name: name,
			count: count,
		}, function(data){
			console.log(data);
		});
	},
	removeItem: function(name, count){
		console.log(`Attempting to remove ${count} ${name}`)
		postJSON("api/remove", {
			instanceName: "unknown",
			instanceID: "unknown",
			unique: "unknown",
			name: name,
			count: count,
		}, function(data){
			console.log(data);
		});
	}
}

let cachedInstanceNames = {};
async function getInstanceName(instanceID){
	let instance = cachedInstanceNames[instanceID];
	if(!instance){
		let slaves = await getJSON("/api/slaves");
		try {
			for(id in slaves){
				cachedInstanceNames[id] = slaves[id].instanceName;
			}
		} catch(e){
			console.log("Error while looking for instance name!");
			console.log(e);
		}
		return cachedInstanceNames[instanceID] || instanceID;
	} else {
		return cachedInstanceNames[instanceID];
	}
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

// get queryString parameters
function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

// callback(err, json)
function getJSON(url, callback) {
	return new Promise((resolve, reject) => {
		var xhr = new XMLHttpRequest();
		xhr.open('GET', url, true);
		xhr.responseType = 'json';
		xhr.onload = function() {
			var status = xhr.status;
			if (status == 200) {
				if(callback) callback(null, xhr.response);
				resolve(xhr.response);
			} else {
				if(callback) callback(status);
				reject(status);
			}
		};
		// triggers if connection is refused
		xhr.onerror = function(e){
			if(callback) callback(e);
			reject(e);
		};
		xhr.send();
	});
};
// callback(err, json)
function postJSON(url, data, callback) {
	return new Promise((resolve, reject) => {
		var xhr = new XMLHttpRequest();
		xhr.open('POST', url, true);
		xhr.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
		xhr.responseType = 'json';
		xhr.onload = function() {
			var status = xhr.status;
			if (status == 200) {
				if(callback) callback(null, xhr.response);
				resolve(xhr.response);
			} else {
				if(callback) callback(status);
				reject(status);
			}
		};
		// triggers if connection is refused
		xhr.onerror = function(e){
			if(callback) callback(e);
			reject(e);
		};
		xhr.send(JSON.stringify(data));
	});
};
// return Boolean
function isJSON(string){
	let stringIsJson = false;
	let x
	try {
		x = JSON.parse(string);
	} catch (e){
		return false;
	}
	if(typeof x == "object" || typeof string == "object"){
		stringIsJson = true;
	}
	return stringIsJson;
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
function replaceAll(target, search, replacement) {
		return target.split(search).join(replacement);
};

function getImageFromName(name){
	if(imagelinks[name]){
		return imagelinks[name];
	} else if(imagedata[name]) {
		return "https://wiki.factorio.com/images/" + imagedata[name] + ".png";
	} else if(factorioLocale["entity-name"] && factorioLocale["entity-name"][name]){
		return "https://wiki.factorio.com/images/" + capitalizeFirstLetter(replaceAll(factorioLocale["entity-name"][name], ' ', '_').toLowerCase()) + ".png";
	} else if(factorioLocale["item-name"] && factorioLocale["item-name"][name]){
		return "https://wiki.factorio.com/images/" + capitalizeFirstLetter(replaceAll(factorioLocale["item-name"][name], ' ', '_').toLowerCase()) + ".png";
	} else if(factorioLocale["fluid-name"] && factorioLocale["fluid-name"][name]){
		return "https://wiki.factorio.com/images/" + capitalizeFirstLetter(replaceAll(factorioLocale["fluid-name"][name], ' ', '_').toLowerCase()) + ".png";
	} else if(factorioLocale["equipment-name"] && factorioLocale["equipment-name"][name]){
		return "https://wiki.factorio.com/images/" + capitalizeFirstLetter(replaceAll(factorioLocale["equipment-name"][name], ' ', '_').toLowerCase()) + ".png";
	} else return "/pictures/unknown-item.png";
}
window.factorioLocale = {};
$.getJSON("/api/getFactorioLocale", (locale) => {
	window.factorioLocale = locale;
});
// image data
// key is the name of the item in the database, value is the name of the image on wiki.factorio.com/images/*
// this list has to include all entities that doesn't just follow the simple capitalize first letter convention
/* Notice from bilka: All icon images hosted on this Wiki have been renamed to use their in-game names, with underscores. If your external tool references these icons, please correct your links. */
var imagedata = {
	"put-combinator": "Decider_combinator",
	"smart-train-stop": "Train_stop",
	"raw-fish": "Fish",
	"solar-panel-equipment": "Portable_solar_panel",
	"diesel-locomotive": "Locomotive", // pre 0.15 loco name
	"small-lamp": "Lamp",
	"tree-02": "Green_tree",
	"tree-02-red": "Green_tree",
	"tree-03": "Green_tree",
	"tree-04": "Green_tree",
	"tree-05": "Green_tree",
	"tree-07": "Green_tree",
	"tree-09": "Green_tree",
	"tree-09-brown": "Green_tree",
	"tree-09-red": "Green_tree",
	"dead-tree-desert": "Dead_tree_desert",
	"sand-rock-big": "Rock_big",
	// "biter-spawner" missing, but can't find png for it on wiki
	// "spitter-spawner"
	
}

// value:link pairs where you can add modded item icons that are missing
var imagelinks = {
	"crude-oil-barrel": "/pictures/Crude_oil_barrel.png",
	"heavy-oil-barrel": "/pictures/Heavy_oil_barrel.png",
	"light-oil-barrel": "/pictures/Light_oil_barrel.png",
	"petroleum-gas-barrel": "/pictures/Petroleum_gas_barrel.png",
	"sulfuric-acid-barrel": "/pictures/Sulfuric_acid_barrel.png",
	"water-barrel": "/pictures/Water_barrel.png",
	"lubricant-barrel": "/pictures/Lubricant_barrel.png",
	"power-armor-mk2": "/pictures/Power_armor_MK2.png",
	"fictional-modded-item": "/pictures/fictional-modded-item.png",
	"raw-fish": "/pictures/Fish.png",
	"rail": "/pictures/rail.png",
	"effectivity-module-1": "/pictures/green_module_1.png",
	"effectivity-module-2": "/pictures/green_module_2.png",
	"effectivity-module-3": "/pictures/green_module_3.png",
	"piercing-shotgun-shell": "/pictures/piercing_shotgun_shells.png",
	"energy-shield-mk2-equipment": "/pictures/Energy_shield_MK2.png",
	"battery-mk2-equipment": "/pictures/Battery_MK2.png",
	"personal-roboport-mk2-equipment": "/pictures/Personal_roboport_MK2.png",
}
var populateImageLinks = async () => (await getJSON("/api/getPictures")).forEach(img => imagelinks[img.name] = img.path)

populateImageLinks()
