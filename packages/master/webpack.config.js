"use strict";
const path = require("path");
const webpack = require("webpack");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

module.exports = (env = {}) => ({
	entry: "./web/index.jsx",
	mode: env.production ? "production" : "development",
	devtool: env.production ? "source-map" : "eval-source-map",
	devServer: {
		contentBase: "./static",
	},
	output: {
		filename: "bundle.js",
		path: path.resolve(__dirname, "static"),
	},
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
				test: /\.jsx$/,
				exclude: /node_modules/,
				use: {
					loader: "babel-loader",
					options: {
						presets: ["@babel/preset-react"],
					},
				},
			},
		],
	},
	resolve: {
		extensions: [".js", ".json", ".jsx"],
	},
	node: {
		"crypto": "empty",
	},
});
