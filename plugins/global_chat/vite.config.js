import { defineConfig } from "vite";
import { clusterioPlugin } from "@clusterio/web_ui/vite.mjs";

export default defineConfig({
	plugins: [clusterioPlugin()],
});
