var mkdirp = require("mkdirp");

var directories = [
	"database/linvodb",
	"sharedMods",
	"instances",
];

directories.forEach(path => {
	mkdirp("database/linvodb", function(err){
		if(err){
			console.error("Unable to mkdirp "+path);
			console.error(err);
		} else {
			console.log("mkdirp "+path);
		}
	});
})
