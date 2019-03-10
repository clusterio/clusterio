type ClusterioConfig = {
    factorioDirectory: string,
    instanceDirectory: string,
    databaseDirectory: string,
    publicIP: string,
    masterIP: string,
    masterPort: number,
    sslPort: number,
    sslCert: string,
    sslPrivKey: string,
    masterAuthToken: string,
    masterAuthSecret: string,
    username: string,
    token: string,
    factorio_version: string,
    verify_user_identity: boolean,
    auto_pause: boolean,
    allow_commands: "admins-only" | "true" | "false",
    game_password: string,
    description: string,
    visibility: {
        public: boolean,
        lan: boolean
    },
    itemStats: {
        maxEntries: number,
        entriesPerSecond: number
    },
    logItemTransfers: boolean,
    disableFairItemDistribution: boolean,
    uploadModsToMaster: boolean,
    msBetweenCommands: 10,
    allowRemoteCommandExecution: boolean,
    enableCrossServerShout: boolean,
    mirrorAllChat: boolean,
    autosaveInterval: 600000,
    disablePrometheusPushgateway: boolean,
    disableImportsOfEverythingExceptElectricity: boolean
}