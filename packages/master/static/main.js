
(function (){
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

function getItemIconClass(name) {
	if (factorioItemMetadata.has(name)) {
		return `item-${name}`;
	} else {
		return "item-unknown-item";
	}
}
window.factorioLocale = new Map();
$.getJSON(`${root}export/locale.json`, (locale) => {
	window.factorioLocale = new Map(locale);
});
window.factorioItemMetadata = new Map();
$.getJSON(`${root}export/item-metadata.json`, (itemMetadata) => {
	window.factorioItemMetadata = new Map(itemMetadata);
	console.log(factorioItemMetadata.get("electronic-circuit"));
	let style = document.createElement("style");
	style.type = "text/css";
	document.head.appendChild(style);

	for (let [name, meta] of itemMetadata) {
		style.sheet.insertRule([
			`.item-${name} {`,
			` background-image: url("${root}export/item-spritesheet.png");`,
			" background-repeat: no-repeat;",
			` background-position: -${meta.x}px -${meta.y}px;`,
			` height: ${meta.size}px;`,
			` width: ${meta.size}px;`,
			"}\n",
		].join(""));
	}
});
