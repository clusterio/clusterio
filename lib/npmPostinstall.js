var mkdirp = require("mkdirp");
var http = require('http');
var fs = require('fs');

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
});

function download(url, file, callback){
	var writeStream = fs.createWriteStream(file);
	var request = http.get(url, function(response) {
	  response.pipe(writeStream);
	  response.on("end", () => {
			if(callback && typeof callback == "function") callback(file);
			console.log("Downloaded "+file+" from "+url);
	  });
	});
}

let downloadList = [
	{
		url: "http://fbpviewer.trakos.pl/images/spritesheet.json",
		file: "static/pictures/spritesheet.js",
		callback: function(file){
			fs.writeFileSync("static/pictures/spritesheet.js", "export default\n"+fs.readFileSync("static/pictures/spritesheet.js"));
		},
	},
	{
		url: "http://fbpviewer.trakos.pl/images/spritesheet.png",
		file: "static/pictures/spritesheet.png",
	},
]
downloadList.forEach(item => {
	download(item.url, item.file, item.callback);
});

// generate SSL certificates if they are missing
if(!fs.existsSync("database/certificates") || !fs.existsSync("database/certificates/cert.crt") || !fs.existsSync("database/certificates/cert.key")){
	var generateSSLcert = require("./generateSSLcert.js");
	
	generateSSLcert({
		certificatePath: "database/certificates",
		doLogging: true,
	});
}