module.exports = function(x){
	if(x === false || x === true || x === null) return true; // === false is valid JSON, so is true and null
	var isNotJson = false
	try{
		z = JSON.parse(x);
	} catch (e) {
		isNotJson = true;
	}
	
	return !isNotJson;
}