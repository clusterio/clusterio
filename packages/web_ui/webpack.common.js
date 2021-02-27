"use strict";
const webpack = require("webpack");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

module.exports = (env = {}) => ({
	mode: env.production ? "production" : "development",
	devtool: env.production ? "source-map" : "eval-source-map",
	performance: {
		maxAssetSize: 2**21,
		maxEntrypointSize: 2**21,
	},
	plugins: [
		new CleanWebpackPlugin(),

		// required for winston
		new webpack.ProvidePlugin({
			process: require.resolve("process/browser.js"),
			Buffer: [require.resolve("buffer/"), "Buffer"],
		}),

		new webpack.DefinePlugin({
			"process.env.APP_ENV": JSON.stringify("browser"),
		}),

		// Make sure ant-design icons use the ES variant
		new webpack.NormalModuleReplacementPlugin(
			/@ant-design\/icons\/[A-Z]/,
			resource => {
				resource.request = resource.request.replace(/@ant-design\/icons/, "$&/es/icons");
			}
		),
	],
	module: {
		rules: [
			{
				test: /node_modules.fs-extra/,
				use: require.resolve("null-loader"),
			},
			{
				test: /node_modules.jsonwebtoken/,
				use: require.resolve("null-loader"),
			},
			{
				test: /node_modules.winston.dist.winston.transports.(http|file)/,
				use: require.resolve("null-loader"),
			},
			// Colour library used by winston which doesn't work in browser.
			{
				test: /node_modules.colors/,
				use: require.resolve("null-loader"),
			},
			{
				test: /\.css$/,
				use: [
					require.resolve("style-loader"),
					{
						loader: require.resolve("css-loader"),
						options: {
							sourceMap: !env.production,
						},
					},
				],
			},
			{
				test: /\.js$/,
				resolve: {
					// XXX Required due to bug in babel-runtime
					// see: https://github.com/babel/babel/issues/12058
					fullySpecified: false,
				},
			},
			{
				test: /\.jsx$/,
				exclude: /node_modules/,
				use: {
					loader: require.resolve("babel-loader"),
					options: {
						presets: [require.resolve("@babel/preset-react")],
					},
				},
			},
			{
				test: /\.png$/,
				use: require.resolve("file-loader"),
			},
		],
	},
	resolve: {
		extensions: [".js", ".json", ".jsx"],
		fallback: {
			// Required for winston
			"util": require.resolve("util/"),
			"os": require.resolve("os-browserify/browser"),

			"events": require.resolve("events/"),
			"path": require.resolve("path-browserify"),
		},
	},
});
