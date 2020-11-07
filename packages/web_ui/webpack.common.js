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
		new webpack.DefinePlugin({
			"process.env.APP_ENV": JSON.stringify("browser"),
		}),

		// Make sure ant-design icons use the ES variant
		new webpack.NormalModuleReplacementPlugin(
			/@ant-design\/icons\/[A-Z]/,
			function(resource) {
				resource.request = resource.request.replace(/@ant-design\/icons/, "$&/es/icons");
			}
		),
	],
	module: {
		rules: [
			{
				test: /node_modules.fs-extra/,
				use: "null-loader",
			},
			{
				test: /node_modules.jsonwebtoken/,
				use: "null-loader",
			},
			{
				test: /\.css$/,
				use: [
					"style-loader",
					{
						loader: "css-loader",
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
					loader: "babel-loader",
					options: {
						presets: ["@babel/preset-react"],
					},
				},
			},
			{
				test: /\.png$/,
				use: "file-loader",
			},
		],
	},
	resolve: {
		extensions: [".js", ".json", ".jsx"],
		fallback: {
			"events": require.resolve("events/"),
			"path": require.resolve("path-browserify"),
		},
	},
});
