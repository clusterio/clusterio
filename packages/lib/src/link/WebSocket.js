"use strict";
// eslint-disable-next-line node/no-process-env
module.exports = process.env.APP_ENV === "browser" ? window.WebSocket : require("ws");
