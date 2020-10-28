"use strict";
const path = require("path");
const webpack = require("webpack");
const { merge } = require("webpack-merge");

const common = require("@clusterio/web_ui/webpack.common");

module.exports = (env = {}) => merge(common(env), {
	entry: "./web/index.jsx",
	devServer: {
		contentBase: "./static",
	},
	output: {
		filename: "bundle.js",
		path: path.resolve(__dirname, "static"),
	},
	plugins: [
		new webpack.container.ModuleFederationPlugin({
			name: "master",
			shared: {
				"@clusterio/lib": { singleton: true },
				"@clusterio/web_ui": { singleton: true },
				"ajv": {},
				"antd": { singleton: true },
				"react": { singleton: true },
				"react-dom": { singleton: true },
			},
		}),
	],
});
