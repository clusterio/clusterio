import { bootstrap } from "./host";
export { default as BaseHostPlugin } from "./src/BaseHostPlugin";
export { default as BaseInstancePlugin } from "./src/BaseInstancePlugin";

if (module === require.main) {
	bootstrap();
}
