const averagedTimeSeries = require("averaged-timeseries")

const doleNN = require("./../../lib/dole_nn_base.js")

class neuralDole {
    constructor({
        items, gauge
    }){
        // Set some storage variables for the dole divider
        this.prometheusDoleFactorGauge = gauge
        this.items = items
        this.itemsLastTick = JSON.parse(JSON.stringify(items))
        this.dole = {}
        this.carry = {}
        this.lastRequest = {}
        this.doleinfo_last = {}
        this.doleinfo_new = {}

        setInterval(()=>{
            for(let name in this.items){
                // The items object have 2 functions tied to it - addItem and removeItem. A for loop will reveal those properties.
                if(typeof this.items[name] !== "number") continue

                let count = this.items[name]
                let magicData = doleNN.Tick(
                    count,
                    this.dole[name],
                    this.itemsLastTick[name],
                    this.doleinfo_last[name] || {numreq:0 , numslave:0},
                    this.doleinfo_new[name] || {numreq:0 , numslave:0}
                )
                this.dole[name] = magicData[0]
                // DONE handle magicData[1] for graphing for our users
                this.prometheusDoleFactorGauge.labels(name).set(magicData[1] || 0);
                this.doleinfo_last[name]=this.doleinfo_new[name]
                this.doleinfo_new[name]={numreq:0 , numslave:0}
            }
            this.itemsLastTick = JSON.parse(JSON.stringify(this.items))
        }, 1000)
    }
    divider({
        res,
        object,
        config,
        sentItemStatisticsBySlaveID,
        prometheusImportGauge
    }){
        let magicData = doleNN.Dose(
            object.count, // numReq
            this.items[object.name],
            this.itemsLastTick[object.name] || 0,
            this.dole[object.name],
            this.carry[object.name+" "+object.instanceID] || 0,
            this.lastRequest[object.name+"_"+object.instanceID+"_"+object.instanceName] || 0,
            this.doleinfo_last[object.name] || {numreq:0 , numslave:0}
        )
        this.lastRequest[object.name+"_"+object.instanceID+"_"+object.instanceName] = object.count
        //0.Number of items to give in that dose
        //1.New dole for item X
        //2.New carry for item X slave Y
        this.dole[object.name] = magicData[1]
        this.carry[object.name+" "+object.instanceID] = magicData[2]
        
        this.doleinfo_new[object.name].numreq=magicData[0] + (this.doleinfo_new[object.name].numreq || 0)
        this.doleinfo_new[object.name].numslave=1 + (this.doleinfo_new[object.name].numslave || 0)
        
        // Remove item from DB and send it
        if(this.items.removeItem({count: magicData[0], name: object.name})){
            if(config.logItemTransfers){
                console.log("removed: " + object.name + " " + magicData[0] + " . " + this.items[object.name] + " and sent to " + object.instanceID + " | " + object.instanceName);
            }
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
                value:magicData[0],
            });
            //console.log(sentItemStatistics.data)
            sentItemStatisticsBySlaveID[object.instanceID] = sentItemStatistics;
            prometheusImportGauge.labels(object.instanceID, object.name).inc(Number(magicData[0]) || 0);

            res.send({
                name: object.name,
                count: magicData[0],
            })
        } else {
            res.send({
                name: object.name,
                count: 0,
            })
        }        
    }
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

module.exports = {
    doleDivider,
    neuralDole
}
