/**
Module for grabbing factorio locale from a local factorio install
@module getFactorioLocale
*/

const fs = require("fs");
const ini = require("ini");

/**
Gets raw factorio locale from the .ini file.
Not available outside of module through exports.

@memberof getFactorioLocale
@inner
@param {string} factorioDirectory
@param {string} languageCode
@param {function} callback
*/
function getLocale(factorioDirectory, languageCode, callback){
	var localeFile = factorioDirectory + '/data/base/locale/' + languageCode + '/base.cfg';
	fs.readFile(localeFile, "utf8", (err, rawLocale) => {
		callback(err, rawLocale);
	});
}

/**
Gets factorios locale as an object, does not respect mods.

@param {string} factorioDirectory
@param {string} languageCode
@param {function} callback
*/
module.exports.asObject = function getLocaleAsObject(factorioDirectory, languageCode, callback){
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
