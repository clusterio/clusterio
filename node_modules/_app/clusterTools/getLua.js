const fs = require("fs-extra");

module.exports = function getLua(filePath, COMPRESS_LUA = true){
	return new Promise((resolve, reject) => {
		fs.readFile(filePath, "utf8", (err, contents) => {
			if(err){
				reject(err);
			} else {
				// split content into lines
				contents = contents.split(/\r?\n/);

				// join those lines after making them safe again
				contents = contents.reduce((acc, val) => {
					val = val.replace(/\\/g ,'\\\\');
					// remove leading and trailing spaces
					val = val.trim();
					// escape single quotes
					val = val.replace(/'/g ,'\\\'');

					// remove single line comments
					let singleLineCommentPosition = val.indexOf("--");
					let multiLineCommentPosition = val.indexOf("--[[");

					if(multiLineCommentPosition === -1 && singleLineCommentPosition !== -1) {
						val = val.substr(0, singleLineCommentPosition);
					}

					return acc + val + '\\n';
				}, ""); // need the "" or it will not process the first row, potentially leaving a single line comment in that disables the whole code

				// console.log(contents);

				// this takes about 46 ms to minify train_stop_tracking.lua in my tests on an i3 6100u
				if(COMPRESS_LUA) contents = require("luamin").minify(contents);
				
				resolve(contents);
			}
		});
	});
}
