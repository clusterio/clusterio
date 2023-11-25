import { bootstrap } from "./host";
export { default as BaseInstancePlugin } from "./src/BaseInstancePlugin";

if (module === require.main) {
	bootstrap();
}
