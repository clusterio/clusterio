var http = require('http');
var https = require('https');
var fs = require('fs-extra');


function makeDirectory(path){
	return new Promise((resolve, reject) => {
		fs.mkdirp(path, function(err){
			if(err){
				console.error("Unable to mkdirp "+path);
				console.error(err);
				resolve(false);
			} else {
				console.log("mkdirp "+path);
				resolve(true);
			}
		});
	});
}
function download(url, file, callback){
	return new Promise((resolve, reject) => {
		let pathArray = file.split("/");
		pathArray.pop(); // remove filename from the end
		if(pathArray.length >= 1){
			// this might be an invalid path!
			fs.stat(pathArray.join("/"), (err, stat) => {
				if(err){
					makeDirectory(pathArray.join("/")).then(()=>{
						doDownload(url, file, callback);
					});
				} else {
					doDownload(url, file, callback);
				}
			});
		} else {
			doDownload(url, file, callback);
		}
		function doDownload(url, file, callback){
			var writeStream = fs.createWriteStream(file);
			let protocol = http;
			if(url.split(":")[0] == "https") protocol = https;
			var request = protocol.get(url, function(response) {
				response.pipe(writeStream);
				response.on("end", () => {
					if(callback && typeof callback == "function") callback(file);
					console.log("Downloaded "+file+" from "+url);
					resolve();
				});
			});
		}
	});
}

var directories = [
	"sharedMods",
	"instances",
];
let downloadList = [
	{
		url: "https://code.jquery.com/jquery.js",
		file: "static/external/jquery.js",
	},
	{
		url: "https://code.jquery.com/ui/1.12.1/jquery-ui.js",
		file: "static/external/jquery-ui.js",
	},
	{
		url: "https://momentjs.com/downloads/moment.min.js",
		file: "static/external/moment.min.js",
	},
	{
		url: "https://craig.global.ssl.fastly.net/js/mousetrap/mousetrap.min.js",
		file: "static/external/mousetrap.min.js",
	},
	{
		url: "https://fonts.googleapis.com/css?family=Roboto",
		file: "static/external/css/Roboto.css",
	},
]

// initiate folder creations and downloads
function processMkdirRecursive(callback){
	let item = directories.shift();
	makeDirectory(item).then(()=>{
		if(directories.length == 0){
			if(callback) callback();
		} else {
			processMkdirRecursive(callback);
		}
	});
}
function processDownloadRecursive(callback){
	let item = downloadList.shift();
	download(item.url, item.file, item.callback).then(()=>{
		if(downloadList.length == 0){
			if(callback) callback();
		} else {
			processDownloadRecursive(callback);
		}
	});
}

if (module === require.main) {
	processMkdirRecursive(processDownloadRecursive);
}
