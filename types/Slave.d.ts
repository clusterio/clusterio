interface Slave {
    time?: string,
    rconPort?: string,
    rconPassword?: string,
    serverPort?: string,
    unique?: string, // this one isn't really optional, but I got tired of fighting with types and rewriting logic in master.ts
    publicIP?: string,
    mods?: Mod[],
    instanceName?: string,
    playerCount?: string | number,
    mac?: string,
    meta?: {
        [name:string]:any,
    },
}