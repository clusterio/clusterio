import { createServer } from "../../packages/web_ui/node_modules/vite/dist/node/index.js";
import { clusterioApp } from "../../packages/web_ui/vite.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.resolve("packages/web_ui/package.json"));
const server = await createServer({
	configFile: false,
	root: process.cwd(),
	resolve: { alias: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-router", "react-router/dom", "react-router-dom", "antd", "@sinclair/typebox"].map(name => ({ find: new RegExp(`^${name}$`), replacement: require.resolve(name) })) },
	plugins: [clusterioApp({ entry: "temp/plugin-layout/main.tsx" }), {
		name: "fixture-html", configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (req.url?.startsWith("/plugins")) {
					res.setHeader("Content-Type", "text/html");
					res.end(await server.transformIndexHtml(req.url, await fs.readFile("temp/plugin-layout/index.html", "utf8")));
				} else { next(); }
			});
		},
	}],
	server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
server.printUrls();
