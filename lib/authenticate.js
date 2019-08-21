const jwt = require('jsonwebtoken');

let authSecret = null;
function setAuthSecret(secret) {
	authSecret = secret;
}

function middleware(req, res, next) {
	// This should not happen
	if (!authSecret) {
		return res.status(500).send({ auth: false, message: 'Secret not set', endpoint: req.route.path });
	}

	var token = req.headers['x-access-token'];
	if (!token) {
		return res.status(401).send({ auth: false, message: 'No token provided.', endpoint: req.route.path });
	}

	jwt.verify(token, authSecret, function(err, decoded) {
		if (err) {
			return res.status(401).send({ auth: false, message: 'Failed to authenticate token.', endpoint: req.route.path });
		}
		next();
	});
}

async function check(token) {
	return new Promise((resolve, reject) => {
		// This should not happen
		if (!authSecret) {
			resolve({ ok: false, msg: 'Secret not set' });
		}

		jwt.verify(token, authSecret, function(err, decoded) {
			if (err) {
				resolve({ok:false, msg:err})
			} else {
				resolve({ok:true, msg:"Successfully authenticated"});
			}
		});
	});
}

module.exports = {
	setAuthSecret,
	middleware,
	check,
};
