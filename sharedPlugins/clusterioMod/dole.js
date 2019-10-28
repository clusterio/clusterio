const averagedTimeSeries = require("averaged-timeseries")

const doleNN = require("./dole_nn_base")

const Prometheus = require('prom-client');

class neuralDole {
    
    getRequestStats(itemname,samples)
    {
        var sum=0;
        samples=Math.min(samples,(this.stats[itemname] || []).length-1);
        if (samples<1) return 0.1;
        for (var i = 1; i <= samples; i++) {
            sum+=this.stats[itemname][i].req;
        }
        if (sum==0) return 0.1;
        return sum/samples;
    }
    
    constructor({
		items, gaugePrefix
    }){
        // Set some storage variables for the dole divider
        this.prometheusNNDoleGauge = new Prometheus.Gauge({
            name: gaugePrefix+'nn_dole_gauge',
            help: 'Current demand being supplied by Neural Network ; 1 means all demand covered, 0.5 means about half of each supply is covered, 0 means no items are given',
            labelNames: ["itemName"],
        });
		this.items = items
		this.itemsLastTick = new Map(items._items)
        this.dole = {}
        this.carry = {}
        this.lastRequest = {}
        this.stats=[]
		this.debt= {}

        setInterval(()=>{
			for (let [name, count] of this.items._items) {
                let magicData = doleNN.Tick(
                    count,
                    this.dole[name],
					this.itemsLastTick.get(name),
                    this.getRequestStats(name,5)
                )
                this.stats[name]=this.stats[name] || []
                this.stats[name].unshift({req:0,given:0});//stats[name][0] is the one we currently collect
                if (this.stats[name].length>10) this.stats[name].pop();//remove if too many samples in stats
                
                this.dole[name] = magicData[0]
                // DONE handle magicData[1] for graphing for our users
                this.prometheusNNDoleGauge.labels(name).set(magicData[1] || 0);
            }
			this.itemsLastTick = new Map(this.items._items)
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
			this.items.getItemCount(object.name),
			this.itemsLastTick.get(object.name) || 0,
            this.dole[object.name],
            this.carry[object.name+" "+object.instanceID] || 0,
            this.lastRequest[object.name+"_"+object.instanceID+"_"+object.instanceName] || 0,
            this.getRequestStats(object.name,5),
			this.debt[object.name+" "+object.instanceID] || 0
        )
        if ((this.stats[object.name] || []).length>0)
        {
            this.stats[object.name][0].req+=Number(object.count);
            this.stats[object.name][0].given+=Number(magicData[0]);
        }
        this.lastRequest[object.name+"_"+object.instanceID+"_"+object.instanceName] = object.count
        //0.Number of items to give in that dose
        //1.New dole for item X
        //2.New carry for item X slave Y
        this.dole[object.name] = magicData[1]
        this.carry[object.name+" "+object.instanceID] = magicData[2]
		this.debt[object.name+" "+object.instanceID] = magicData[3]

		// Remove item from DB and send it
		this.items.removeItem(object.name, magicData[0]);
		if(config.logItemTransfers){
			console.log("removed: " + object.name + " " + magicData[0] + " . " + this.items.getItemCount(object.name) + " and sent to " + object.instanceID + " | " + object.instanceName);
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
    }
}

_doleDivisionFactor = {}; //If the server regularly can't fulfill requests, this number grows until it can. Then it slowly shrinks back down.
function doleDivider({
	itemCount,
    object,
	items,
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
	if (itemCount > 40) {
		console.info(`Serving ${object.count}/${originalCount} ${object.name} from ${itemCount} ${object.name} with dole division factor ${(_doleDivisionFactor[object.name]||0)} (real=${((_doleDivisionFactor[object.name]||0)+doleDivisionRetardation)/doleDivisionRetardation}), item is ${itemCount > object.count?'stocked':'short'}.`);
	}

	// Update existing items if item name already exists
	if (itemCount > object.count) {
        //If successful, increase dole
        _doleDivisionFactor[object.name] = Math.max((_doleDivisionFactor[object.name]||0)||1, 1) - 1;
		if (config.logItemTransfers) {
			console.log("removed: " + object.name + " " + object.count + " . " + itemCount + " and sent to " + object.instanceID + " | " + object.instanceName);
		}
		items.removeItem(object.name, object.count)
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

        prometheusDoleFactorGauge.labels(object.name).set(_doleDivisionFactor[object.name] || 0);
        prometheusImportGauge.labels(object.instanceID, object.name).inc(object.count || 0);
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