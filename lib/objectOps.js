/**
 * Helper functions related to objects
 * @module
 */
"use strict";

/**
 * Deep clones an object, is actually just JSON.parse(JSON.stringify()) but looks cleaner.
 * @param {object} obj to clone
 * @returns {object} The cloned object.
 *
 * @example
 * a = {"thingy":"with a value"};
 * b = a;
 * a == b; // true
 * c = objectOps.deepclone(a);
 * a == c; // false
 */
module.exports.deepclone = function(obj){
	return JSON.parse(JSON.stringify(obj));
};

/**
 * Checks if a string is valid JSON using try/catch. If passed an object it will always return true.
 * @param {string} string to verify
 * @returns {boolean} true if valid JSON.
 *
 * @example
 * objectOps.isJSON("99 bottles of beer"); // false
 * objectOps.isJSON("99"); // true
 * objectOps.isJSON({"thingy":"that is an object"}); // true
 * objectOps.isJSON(JSON.stringify({"thingy":"that is an object"})); // true
 */
module.exports.isJSON = function(string){
	let stringIsJson = false;
	let x;
	try {
		x = JSON.parse(string);
	} catch (e){
		return false;
	}
	if(typeof x == "object" || typeof string == "object"){
		stringIsJson = true;
	}
	return stringIsJson;
};
