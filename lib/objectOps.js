var copyChildren = function(d){
	var copied = clone(d);
	copy = [];
	if(copied.children){
		copied.children.forEach(function(h){
			copy.push(h);
		});
	}
	if(copied._children){
		copied._children.forEach(function(h){
			copy.push(h);
		});
	}
}

var clone = function(obj) {
	if (null == obj || "object" != typeof obj) return obj;
	var copy = obj.constructor();
	for (var attr in obj) {
		if (obj.hasOwnProperty(attr) && attr != "parent"){
			if(attr == "children" && obj[attr] != null){
				copy[attr] = obj[attr].map(function (d) {
					var subCopy = clone(d);
					return subCopy;
				});
			}
			else if(attr == "_children" && obj[attr] != null){
				copy[attr] = obj[attr].map(function(d) {
					var subCopy = clone(d);
					return subCopy;
				});
			}
			else{
				copy[attr] = obj[attr];
			}
		}
	}
	return copy;
}

var deepclone = function(obj){
	return JSON.parse(JSON.stringify(obj));
}

module.exports = {
	clone:clone,
	deepclone:deepclone,
};