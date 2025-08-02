
"use strict";

if (process.env.APP_ENV === "browser") {

	module.exports = require("fast-deep-equal/es6");
} else {
	module.exports = require("util").isDeepStrictEqual;
}
