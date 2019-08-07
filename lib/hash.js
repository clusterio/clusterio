const crypto = require('crypto');
const fs = require('fs');

/**
 * Returns a promise that resolves to the SHA1 hash of the file given by path
 */
exports.hashFile = function(path) {
	return new Promise(function(resolve, reject) {
		let hasher = crypto.createHash('sha1')
		hasher.setEncoding('hex')
		hasher.on('finish', function() {
			resolve(hasher.read());
		});

		let stream = fs.createReadStream(path);
		stream.on('error', function(error) {
			// the docs doesn't say anything about what's passed on error
			reject(error);
		});
		stream.pipe(hasher);
	});
}
