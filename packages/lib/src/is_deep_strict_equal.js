/* eslint-disable node/global-require */
"use strict";
// eslint-disable-next-line node/no-process-env
if (process.env.APP_ENV === "browser") {
	// eslint-disable-next-line node/no-extraneous-require
	module.exports = require("fast-deep-equal/es6");
} else {
	module.exports = require("util").isDeepStrictEqual;
}
