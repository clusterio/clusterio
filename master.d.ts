type MasterPluginInstance = {
    config: object,
    pluginConfig: object,
    path: string,
    socketio: any,
    express: any,
    Prometheus: any,
    onExit?: Function,
}
type pluginConfig = {
    name: string,
}
interface MasterPlugin {
    main: MasterPluginInstance,
    pluginConfig: pluginConfig,
}
