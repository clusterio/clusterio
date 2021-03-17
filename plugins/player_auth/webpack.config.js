"use strict";
const path = require("path");
const webpack = require("webpack");
const { merge } = require("webpack-merge");

const common = require("@clusterio/web_ui/webpack.common");

module.exports = (env = {}) => merge(common(env), {
	context: __dirname,
	entry: "./web/index.jsx",
	output: {
		publicPath: "auto",
		filename: "bundle.js",
		path: path.resolve(__dirname, "dist", "web"),
	},
	plugins: [
		new webpack.container.ModuleFederationPlugin({
			name: "player_auth",
			library: { type: "var", name: "plugin_player_auth" },
			filename: "remoteEntry.js",
			exposes: {
				"./info": "./info.js",
				"./package.json": "./package.json",
				"./web": "./web/index.jsx",
			},
			shared: {
				"@clusterio/lib/config": { import: false },
				"@clusterio/lib/link": { import: false },
				"@clusterio/lib/plugin": { import: false },
				"@clusterio/web_ui": { import: false },
				"antd": { import: false },
				"react": { import: false },
				"react-dom": { import: false },
			},
		}),
	],
});
