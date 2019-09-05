const fs = require("fs-extra");
const path = require("path");

class masterPlugin {
	constructor({config, socketio, express, Prometheus}){
		const authenticate = require("lib/authenticate");
		
		this.config = config;
		this.io = socketio;
		const app = express;
		
		const prometheusStatisticsGauge = new Prometheus.Gauge({
			name: 'clusterio_statistics_gauge',
			help: 'Items produced/built/killed by a force',
			labelNames: ["instanceID", "force", "statistic", "direction", "itemName"],
		});
		
		/** --- TODO: Replace this with a simpler Prometheus exporter. Requires changes to the mod as well.
		POST endpoint to log production graph statistics. Should contain an instanceID (also reffered to as "unique")
		and of course the timeSeries data organized by category.

		@memberof clusterioMaster
		@instance
		@alias api/logStats
		@param {object} JSON {instanceID: "string", force: "string" data: {"item_production_statistics": {"input":{"iron-plate":150}, "output":{}}, ...}}
		@returns {string} failure
		*/
		app.post("/api/logStats", authenticate.middleware, function(req,res) {
			let data = req.body.forceData;
			if(typeof req.body.forceData == "string") {
				data = JSON.parse(req.body.forceData);
			}
			// endpointHitCounter.labels(req.route.path).inc();
			if(typeof req.body == "object"
			&& req.body.instanceID
			&& typeof req.body.instanceID == "string"
			&& req.body.instanceID.length < 100
			&& data
			&& typeof data == "object"
			&& !Array.isArray(data)){
				try{
					Object.keys(data).forEach(statisticName => {
						Object.keys(data[statisticName]).forEach(direction => {
							let statHash = data[statisticName][direction];
							Object.keys(statHash).forEach(item => {
								let value = Number(statHash[item]);
								if(value) prometheusStatisticsGauge.labels(req.body.instanceID, req.body.force, statisticName, direction, item).set(value);
							});
						});
					});
					res.send({ok:true, msg:`Statistics successfully reported at ${Date.now()}`});
				}catch(e){
					res.send({ok:false, msg:"Statistics reporter crashed, see sharedPlugins/statisticsExporter/masterPlugin.js"});
					console.log(e)
				};
			} else {
				console.log(`/api/logStats: Invalid request. instanceID: ${req.body.instanceID}, dataIsArray: `
					+ `${Array.isArray(data)}, ${typeof req.body.instanceID}, ${typeof data}`);
				res.send({
					ok:false,
					msg:"Invalid request parameters"
				});
			}
		});
	}
}
module.exports = masterPlugin;
