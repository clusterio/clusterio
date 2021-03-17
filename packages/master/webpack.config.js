"use strict";
const path = require("path");
const webpack = require("webpack");
const { merge } = require("webpack-merge");

const common = require("@clusterio/web_ui/webpack.common");

module.exports = (env = {}) => merge(common(env), {
	context: __dirname,
	entry: "./web/index.jsx",
	devServer: {
		contentBase: "./dist/web",
	},
	output: {
		publicPath: "auto",
		filename: "bundle.js",
		path: path.resolve(__dirname, "dist", "web"),
	},
	plugins: [
		new webpack.container.ModuleFederationPlugin({
			name: "master",
			shared: {
				"@clusterio/lib/config": { singleton: true },
				"@clusterio/lib/errors": { singleton: true },
				"@clusterio/lib/helpers": { singleton: true },
				"@clusterio/lib/link": { singleton: true },
				"@clusterio/lib/logging": { singleton: true },
				"@clusterio/lib/plugin": { singleton: true },
				"@clusterio/lib/schema": { singleton: true },
				"@clusterio/lib/users": { singleton: true },
				"@clusterio/web_ui": { singleton: true },
				"antd": { singleton: true },
				"react": { singleton: true },
				"react-dom": { singleton: true },
			},
		}),
	],
});
