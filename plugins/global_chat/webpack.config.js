"use strict";
const path = require("path");
const webpack = require("webpack");
const { merge } = require("webpack-merge");

const common = require("@clusterio/master/webpack.common");

module.exports = (env = {}) => merge(common(env), {
	entry: "./web/index.jsx",
	output: {
		filename: "bundle.js",
		path: path.resolve(__dirname, "static"),
	},
	plugins: [
		new webpack.container.ModuleFederationPlugin({
			name: "global_chat",
			library: { type: "var", name: "plugin_global_chat" },
			filename: "remoteEntry.js",
			exposes: {
				"./info": "./info.js",
			},
			shared: {
				"@clusterio/lib": { import: false },
				"ajv": { import: false },
			},
		}),
	],
});
