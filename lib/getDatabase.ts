import { getItemDatabase } from "./getItemDatabase";
import { getSlaveDatabase } from "./getSlaveDatabase";

export type db = {
    items: {[name:string]: any},
    slaves: Slaves,
}

export function getDatabase(config: ClusterioConfig) {
    let db: db = {
        items: getItemDatabase(config),
        slaves: getSlaveDatabase(config),
    };
    return db
}
