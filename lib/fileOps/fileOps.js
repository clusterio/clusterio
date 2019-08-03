const fs = require("fs");
const path = require("path");

// gets newest file in a directory
// dir is directory
// files is array of filenames
// callback(err, filename string);
var getNewestFile = function(dir, files, callback) {
	if (!callback) throw new Error("Missing callback");
	if (!files || (files && files.length === 0)) {
		callback(new Error("No files"));
		return;
	}
	// we are appending the file name to the directory, without the
	// "/" we would get paths like /folderfile.txt instead of /folder/file.txt
	if(dir[dir.length-1] != "/"){
		dir += "/";
	}
	var newest = { file: files[0] };
	var checked = 0;
	fs.stat(dir + newest.file, function(err, stats) {
		if(err) {
			callback(err);
		} else {
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
							callback(undefined,newest);
						}
					});
				})(dir + file);
			}
		}
	});
}

// get names of all directories in directory
var getDirectoriesSync = function(srcpath) {
	return fs.readdirSync(srcpath).filter(function (file) {
		return fs.statSync(path.join(srcpath, file)).isDirectory();
	});
}
// get names of all files in a directory
var getFileNamesSync = function(srcpath) {
	return fs.readdirSync(srcpath).filter(function (file) {
		return !fs.statSync(path.join(srcpath, file)).isDirectory();
	});
}
// does what it says on the tin
var deleteFolderRecursiveSync = function(path) {
	if (fs.existsSync(path)) {
		fs.readdirSync(path).forEach(function (file, index) {
			var curPath = path + "/" + file;
			if (fs.lstatSync(curPath).isDirectory()) { // recurse
				deleteFolderRecursiveSync(curPath);
			} else { // delete file
				fs.unlinkSync(curPath);
			}
		});
		fs.rmdirSync(path);
		return true;
	} else {
		return false;
	}
};
var deleteFolderRecursive = function(path){
	return new Promise((resolve, reject) => {
		fs.readdir(path, (err, files) => {
			if(err){
				reject(err);
			} else {
				let thingsToDelete = files.length;
				files.forEach(file => {
					let curPath = path + "/" + file;
					fs.stat(curPath, (err, stat) => {
						if(!err){
							if(stat.isDirectory()){
								// recurse
								deleteFolderRecursive(curPath).then(() => {
									whenFilesDeleted();
								}).catch(e => console.log(e));
							} else {
								fs.unlink(curPath, () => {
									// console.log("Deleted "+curPath);
									whenFilesDeleted();
								});
							}
						} else {
							resolve(false);
						}
					});
				});
				whenFilesDeleted();
				function whenFilesDeleted(){
					if(!thingsToDelete--){// var-- instead of --var because we are calling the function once too much and need the delay
						fs.rmdir(path, () => {
							resolve();
							// console.log("Deleted "+path);
						});
					}
				}
			}
		});
	});
}

module.exports = {
	getNewestFile,
	getDirectoriesSync,
	deleteFolderRecursiveSync,
	deleteFolderRecursive,
	getFileNamesSync,
}
