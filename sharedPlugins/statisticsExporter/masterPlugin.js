const fs = require("fs-extra");
const path = require("path");

class masterPlugin {
	constructor({config, socketio, express, Prometheus}){
		const authenticate = require("./../../lib/authenticate")(config);
		
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
			// endpointHitCounter.labels(req.route.path).inc();
			if(typeof req.body == "object"
			&& req.body.instanceID
			&& typeof req.body.instanceID == "string"
			&& req.body.instanceID.length < 100
			&& req.body.data
			&& typeof req.body.data == "object"
			&& !Array.isArray(req.body.data)){
				try{
					Object.keys(req.body.data).forEach(statisticName => {
						Object.keys(req.body.data[statisticName]).forEach(direction => {
							let statHash = req.body.data[statisticName][direction];
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
				res.send("failure");
			}
		});
	}
}
module.exports = masterPlugin;
