"use strict";
const path = require("path");
const webpack = require("webpack");
const { merge } = require("webpack-merge");

const common = require("@clusterio/web_ui/webpack.common");

module.exports = (env = {}) => merge(common(env), {
	context: __dirname,
	entry: "./web/index.__ext__x",
	output: {
		path: path.resolve(__dirname, "dist", "web"),
	},
	plugins: [
		new webpack.container.ModuleFederationPlugin({
			name: "__plugin_name__",
			library: { type: "window", name: "plugin___plugin_name__" },
			exposes: {
				"./": "./index.__ext__",
				"./package.json": "./package.json",
				"./web": "./web/index.__ext__x",
			},
			shared: {
				"@clusterio/lib": { import: false },
				"@clusterio/web_ui": { import: false },
//%if web
				"antd": { import: false },
				"react": { import: false },
				"react-dom": { import: false },
//%endif
			},
		}),
	],
});
