"use strict";
const path = require("path");
const webpack = require("webpack");
const { merge } = require("webpack-merge");

const common = require("@clusterio/web_ui/webpack.common");

module.exports = (env = {}, argv = {}) => merge(common(env, argv), {
	context: __dirname,
	entry: "./web/index.tsx",
	devServer: {
		contentBase: "./dist/web",
	},
	output: {
		path: path.resolve(__dirname, "dist", "web"),
	},
	plugins: [
		new webpack.container.ModuleFederationPlugin({
			name: "controller",
			shared: {
				"@clusterio/lib": { singleton: true },
				"@clusterio/web_ui": { singleton: true },
				"antd": { singleton: true },
				"react": { singleton: true },
				"react-dom": { singleton: true },
				"react-router": { singleton: true },
				"react-router-dom": { singleton: true },
			},
		}),
	],
});
