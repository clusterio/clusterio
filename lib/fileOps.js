var fs = require("fs");
var path = require("path");

// gets newest file in a directory
// dir is directory
// files is array of filenames
// callback(filename string);
var getNewestFile = function(dir, files, callback) {
	if (!callback) return;
	if (!files || (files && files.length === 0)) {
		callback();
	}
	var newest = { file: files[0] };
	var checked = 0;
	fs.stat(dir + newest.file, function(err, stats) {
		newest.mtime = stats.mtime;
		for (var i = 0; i < files.length; i++) {
			var file = files[i];
			(function(file) {
				fs.stat(file, function(err, stats) {
					++checked;
					if (stats.mtime.getTime() > newest.mtime.getTime()) {
						newest = { file : file, mtime : stats.mtime };
					}
					if (checked == files.length) {
						callback(newest);
					}
				});
			})(dir + file);
		}
	});
}
 
// get all directories in folder
var getDirectories = function(srcpath) {
	return fs.readdirSync(srcpath).filter(function (file) {
		return fs.statSync(path.join(srcpath, file)).isDirectory();
	});
}
var getFileNamesSync = function(srcpath) {
	return fs.readdirSync(srcpath).filter(function (file) {
		return !fs.statSync(path.join(srcpath, file)).isDirectory();
	});
}
// does what it says on the tin
var deleteFolderRecursive = function(path) {
	if (fs.existsSync(path)) {
		fs.readdirSync(path).forEach(function (file, index) {
			var curPath = path + "/" + file;
			if (fs.lstatSync(curPath).isDirectory()) { // recurse
				deleteFolderRecursive(curPath);
			} else { // delete file
				fs.unlinkSync(curPath);
			}
		});
		fs.rmdirSync(path);
	}
};

module.exports = {
	getNewestFile:getNewestFile,
	getDirectories:getDirectories,
	deleteFolderRecursive:deleteFolderRecursive,
	getFileNamesSync:getFileNamesSync,
}