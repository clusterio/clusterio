function hashCode(string){
	if(typeof string !== "string") throw "ERROR: Not a string";
	var hash = 0;
	if (string.length == 0) return hash;
	for (let i = 0; i < string.length; i++) {
		char = string.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash;
}
module.exports = {
	hashCode: hashCode,
}