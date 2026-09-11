"use strict";
const os = require("os");
const { execSync } = require("child_process");

const webpack = require("webpack");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const { WebpackManifestPlugin } = require("webpack-manifest-plugin");
const TerserPlugin = require("terser-webpack-plugin");

function getCommitHash() {
	try {
		return execSync("git rev-parse --short HEAD").toString().trim();
	} catch {
		return "unknown";
	}
}

module.exports = (env = {}, argv = {}) => ({
	mode: argv.mode ?? "development",
	devtool: argv.mode === "production" ? "source-map" : "eval-source-map",
	cache: { type: "filesystem" },
	performance: {
		maxAssetSize: 2**21,
		maxEntrypointSize: 2**21,
	},
	output: {
		publicPath: "auto",
		assetModuleFilename: "static/[hash][ext][query]",
		filename: "static/[name].[contenthash].js",
	},
	plugins: [
		new CleanWebpackPlugin(),
		new WebpackManifestPlugin({ publicPath: "" }),

		// required for winston
		new webpack.ProvidePlugin({
			process: require.resolve("process/browser.js"),
			Buffer: [require.resolve("buffer/"), "Buffer"],
		}),

		new webpack.DefinePlugin({
			"process.env.APP_ENV": JSON.stringify("browser"),
			"process.env.COMMIT_HASH": JSON.stringify(getCommitHash()),
			"process.env.BUILD_DATE": JSON.stringify(new Date().toISOString()),
			"process.env.BUILD_ENV": JSON.stringify(process.env.NODE_ENV ?? "dev"),
			"process.env.BUILD_OS": JSON.stringify(os.platform()),
		}),

		// Make sure ant-design icons use the ES variant
		new webpack.NormalModuleReplacementPlugin(
			/@ant-design\/icons\/[A-Z]/,
			resource => {
				resource.request = resource.request.replace("@ant-design\/icons", "$&/es/icons");
			}
		),
		// Strip node: prefix in request paths.
		new webpack.NormalModuleReplacementPlugin(/^node:/, resource => {
			resource.request = resource.request.replace(/^node:/, "");
		}),
	],
	module: {
		rules: [
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
							sourceMap: argv.mode !== "production",
						},
					},
				],
			},
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: {
					loader: require.resolve("swc-loader"),
					options: {
						sourceMaps: true,
						jsc: {
							parser: {
								syntax: "typescript",
								tsx: true,
							},
							target: "es2022",
							transform: {
								react: {
									runtime: "automatic",
								},
							},
						},
					},
				},
			},
			{
				test: /\.jsx?$/,
				exclude: /node_modules/,
				use: {
					loader: require.resolve("swc-loader"),
					options: {
						sourceMaps: true,
						jsc: {
							parser: {
								syntax: "ecmascript",
								jsx: true,
							},
							target: "es2022",
							transform: {
								react: {
									runtime: "automatic",
								},
							},
						},
					},
				},
			},
			{
				test: /\.png$/,
				type: "asset/resource",
			},
			{
				test: /\.svg$/,
				type: "asset/resource",
			},
			{
				test: /\.md$/,
				type: "asset/source",
			},
		],
	},
	resolve: {
		extensions: [".js", ".ts", ".json", ".jsx", ".tsx"],
		fallback: {
			"crypto": false,
			"fs": false,
			"fs/promises": false,

			// Required for winston
			"util": require.resolve("util/"),
			"os": require.resolve("os-browserify/browser"),
			"buffer": require.resolve("buffer/"),

			// Required for zlib
			"assert": require.resolve("assert/"),
			"stream": require.resolve("stream-browserify"),

			"events": require.resolve("events/"),
			"path": require.resolve("path-browserify"),
			"zlib": require.resolve("browserify-zlib"),
		},
	},
	optimization: {
		moduleIds: "deterministic",
		minimizer: [
			new TerserPlugin({
				minify: TerserPlugin.swcMinify,
				terserOptions: {
					compress: {
						keep_classnames: true,
					},
					mangle: {
						keep_classnames: true,
					},
				},
			}),
		],
	},
});
