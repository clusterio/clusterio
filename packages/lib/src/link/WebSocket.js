"use strict";

module.exports = process.env.APP_ENV === "browser" ? window.WebSocket : require("ws");
