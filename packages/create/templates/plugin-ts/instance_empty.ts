import type { InstancePluginContext } from "@clusterio/host";

// This entrypoint is empty because an instance entrypoint must be defined for a module to be injected
// This requirement may change in the future to allow for standalone modules
export default async function loadInstancePlugin(context: InstancePluginContext) { }
