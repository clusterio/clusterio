const fs = require("fs-extra");
const path = require("path");

/**
 * Returns the newest file in a directory
 *
 * @param {string} directory - The directory to look for the newest file in.
 * @returns {string|null}
 *     Name of the file with the newest timestamp or null if the
 *     directory contains no files.
 */
async function getNewestFile(directory) {
	let newestTime = new Date(0);
	let newestFile = null;
	for (let entry of await fs.readdir(directory, { withFileTypes: true })) {
		if (entry.isFile()) {
			let stat = await fs.stat(path.join(directory, entry.name));
			if (stat.mtime > newestTime) {
				newestTime = stat.mtime;
				newestFile = entry.name;
			}
		}
	}

	return newestFile;
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
