import { defineConfig } from "vite";
import { clusterioApp } from "@clusterio/web_ui/vite.mjs";

export default defineConfig({
	plugins: [clusterioApp({ entry: "web/index.tsx" })],
});
