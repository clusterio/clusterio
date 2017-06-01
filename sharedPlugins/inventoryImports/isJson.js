module.exports = function(x){
	var isNotJson = false
	try{
		z = JSON.parse(x);
	} catch (e) {
		isNotJson = true;
	}
	return !isNotJson;
}