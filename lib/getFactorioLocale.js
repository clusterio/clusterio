const fs = require("fs");
const ini = require("ini");

function getLocale(factorioDirectory, languageCode, callback){
	var localeFile = factorioDirectory + '/data/base/locale/' + languageCode + '/base.cfg';
	fs.readFile(localeFile, "utf8", (err, rawLocale) => {
		callback(err, rawLocale);
	});
}

function getLocaleAsObject(factorioDirectory, languageCode, callback){
	if(typeof factorioDirectory != "string" || typeof languageCode != "string" || typeof callback != "function"){
		throw "Error: wrong parameters provided";
	}
	getLocale(factorioDirectory, languageCode, (err, rawLocale) => {
		if(err){
			callback(err);
		} else {
			let processedLocale = ini.parse(rawLocale)
			callback(undefined, processedLocale);
		}
	});
}

module.exports = {
	asObject: getLocaleAsObject,
}


