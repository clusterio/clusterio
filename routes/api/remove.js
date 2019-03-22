const averagedTimeSeries = require("averaged-timeseries")

const doleNN = require("./../../lib/dole_nn_base.js")

module.exports = {
    doleDivider
}

_doleDivisionFactor = {}; //If the server regularly can't fulfill requests, this number grows until it can. Then it slowly shrinks back down.

function doleDivider({
    item,
    object,
    db,
    sentItemStatisticsBySlaveID,
    config,
    prometheusDoleFactorGauge,
    prometheusImportGauge,
    req,res,
}){
	const doleDivisionRetardation = 10; //lower rates will equal more dramatic swings
    const maxDoleDivision = 250; //a higher cap will divide the store more ways, but will take longer to recover as supplies increase
    
    const originalCount = Number(object.count) || 0;
    object.count /= ((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation;
    object.count = Math.round(object.count);
    if(item.length > 40) console.info(`Serving ${object.count}/${originalCount} ${object.name} from ${item} ${object.name} with dole division factor ${(_doleDivisionFactor[object.name]||0)} (real=${((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation}), item is ${Number(item) > Number(object.count)?'stocked':'short'}.`);
    
    // Update existing items if item name already exists
    if(Number(item) > Number(object.count)) {
        //If successful, increase dole
        _doleDivisionFactor[object.name] = Math.max((_doleDivisionFactor[object.name]||0)||1, 1) - 1;
        if(config.logItemTransfers){
            console.log("removed: " + object.name + " " + object.count + " . " + item + " and sent to " + object.instanceID + " | " + object.instanceName);
        }
        if(db.items.removeItem({count: object.count, name: object.name})){
            let sentItemStatistics = sentItemStatisticsBySlaveID[object.instanceID];
            if(sentItemStatistics === undefined){
                sentItemStatistics = new averagedTimeSeries({
                    maxEntries: config.itemStats.maxEntries,
                    entriesPerSecond: config.itemStats.entriesPerSecond,
                    mergeMode: "add",
                }, console.log);
            }
            sentItemStatistics.add({
                key:object.name,
                value:object.count,
            });
            //console.log(sentItemStatistics.data)
            sentItemStatisticsBySlaveID[object.instanceID] = sentItemStatistics;
        }
        
        prometheusDoleFactorGauge.labels(object.name).set(_doleDivisionFactor[object.name] || 0);
        prometheusImportGauge.labels(object.instanceID, object.name).inc(Number(object.count) || 0);
        res.send({count: object.count, name: object.name});
    } else {
        // if we didn't have enough, attempt giving out a smaller amount next time
        _doleDivisionFactor[object.name] = Math.min(maxDoleDivision, Math.max((_doleDivisionFactor[object.name]||0)||1, 1) * 2);
        prometheusDoleFactorGauge.labels(object.name).set(_doleDivisionFactor[object.name] || 0);
        res.send({name:object.name, count:0});
        //console.log('failure out of ' + object.name + " | " + object.count + " from " + object.instanceID + " ("+object.instanceName+")");
    }
}