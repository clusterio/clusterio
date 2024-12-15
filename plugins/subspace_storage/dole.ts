import * as doleNN from "./dole_nn_base";

import * as lib from "@clusterio/lib";
const { Gauge } = lib;


const prometheusNNDoleGauge = new Gauge(
	"clusterio_subspace_storage_nn_dole_gauge",
	"Current demand being supplied by Neural Network ; 1 means all demand covered, "+
	"0.5 means about half of each supply is covered, 0 means no items are given",
	{ labels: ["resource", "quality"] }
);
const prometheusDoleFactorGauge = new Gauge(
	"clusterio_subspace_storage_dole_factor_gauge",
	"The current dole division factor for this resource",
	{ labels: ["resource", "quality"] }
);

export class NeuralDole {
	getRequestStats(itemname: string, quality: string, samples: number): number {
		let sum = 0;
		samples = Math.min(samples, (this.stats[itemname+quality] || []).length - 1);
		if (samples < 1) {
			return 0.1;
		}
		for (let i = 1; i <= samples; i++) {
			sum += this.stats[itemname+quality][i].req;
		}
		if (sum === 0) {
			return 0.1;
		}
		return sum / samples;
	}

	items: lib.ItemDatabase;
	itemsLastTick: Map<string, number>;
	dole: any = {};
	carry: any = {};
	lastRequest: any = {};
	stats: any = {};
	debt: any = {};
	constructor({ items }: { items: lib.ItemDatabase }) {
		// Set some storage variables for the dole divider
		this.items = items;
		this.itemsLastTick = new Map();
		for (let [name, qualities] of items.getEntries()) {
			for (let [quality, count] of Object.entries(qualities)) {
				this.itemsLastTick.set(name+quality, count);
			}
		}
	}

	doMagic() {
		for (let [name, qualities] of this.items.getEntries()) {
			for (let [quality, count] of Object.entries(qualities)) {
				let magicData = doleNN.tick(
					count,
					this.dole[name+quality],
					this.itemsLastTick.get(name+quality) || 0,
					this.getRequestStats(name, quality, 5)
				);
				this.stats[name+quality] = this.stats[name+quality] || [];
				this.stats[name+quality].unshift({ req: 0, given: 0 }); // stats[name][0] is the one we are collecting
				if (this.stats[name+quality].length>10) {
					this.stats[name+quality].pop(); // remove if too many samples in stats
				}

				this.dole[name+quality] = magicData[0];
				// DONE handle magicData[1] for graphing for our users
				prometheusNNDoleGauge.labels(name+quality).set(magicData[1] || 0);
			}
		}
		this.itemsLastTick = new Map();
		for (let [name, qualities] of this.items.getEntries()) {
			for (let [quality, count] of Object.entries(qualities)) {
				this.itemsLastTick.set(name+quality, count);
			}
		}
	}

	divider(object: { name:string, quality:string, count:number, instanceId:number, instanceName:string }): number {
		let magicData = doleNN.dose(
			object.count, // numReq
			this.items.getItemCount(object.name, object.quality) || 0,
			this.itemsLastTick.get(object.name+object.quality) || 0,
			this.dole[object.name+object.quality],
			this.carry[`${object.name} ${object.quality} ${object.instanceId}`] || 0,
			this.lastRequest[`${object.name}_${object.quality}_${object.instanceId}_${object.instanceName}`] || 0,
			this.getRequestStats(object.name, object.quality, 5),
			this.debt[`${object.name} ${object.quality} ${object.instanceId}`] || 0
		);
		if ((this.stats[object.name+object.quality] || []).length > 0) {
			this.stats[object.name+object.quality][0].req += Number(object.count);
			this.stats[object.name+object.quality][0].given += Number(magicData[0]);
		}
		this.lastRequest[`${object.name}_${object.quality}_${object.instanceId}_${object.instanceName}`] = object.count;
		// 0. Number of items to give in that dose
		// 1. New dole for item X
		// 2. New carry for item X instance Y
		this.dole[object.name+object.quality] = magicData[1];
		this.carry[`${object.name} ${object.quality} ${object.instanceId}`] = magicData[2];
		this.debt[`${object.name} ${object.quality} ${object.instanceId}`] = magicData[3];

		// Remove item from DB and send it
		this.items.removeItem(object.name, magicData[0], object.quality);

		return magicData[0];
	}
}

// If the server regularly can't fulfill requests, this number grows until
// it can. Then it slowly shrinks back down.
let _doleDivisionFactor: { [key:string]: number } = {};
export function doleDivider(
	{
		object,
		items,
		logItemTransfers,
		logger,
	} :{
		object: { name:string, quality:string, count:number, instanceId:number, instanceName:string },
		items: lib.ItemDatabase,
		logItemTransfers: boolean,
		logger: lib.Logger,
	},
) {
	let itemCount = items.getItemCount(object.name, object.quality);
	// lower rates will equal more dramatic swings
	const doleDivisionRetardation = 10;
	// a higher cap will divide the store more ways, but will take longer to
	// recover as supplies increase
	const maxDoleDivision = 250;

	const originalCount = Number(object.count) || 0;
	const doleFactor = _doleDivisionFactor[object.name+object.quality] || 0;
	object.count /= (doleFactor + doleDivisionRetardation) / doleDivisionRetardation;
	object.count = Math.round(object.count);
	if (logItemTransfers) {
		logger.verbose(
			`Serving ${object.count}/${originalCount} ${object.name} from ${itemCount} ${object.name} `+
			`with dole division factor ${doleFactor} `+
			`(real=${doleFactor + doleDivisionRetardation}), `+
			`item is ${itemCount > object.count?"stocked":"short"}.`
		);
	}

	// Update existing items if item name already exists
	if (itemCount > object.count) {
		// If successful, increase dole
		const key = object.name + object.quality;
		_doleDivisionFactor[key] = Math.max(_doleDivisionFactor[key] || 1, 1) - 1;
		items.removeItem(object.name, object.count, object.quality);

		prometheusDoleFactorGauge
			.labels(object.name, object.quality)
			.set(_doleDivisionFactor[key] || 0);
		return object.count;
	}

	// if we didn't have enough, attempt giving out a smaller amount next time
	const key = object.name + object.quality;
	_doleDivisionFactor[key] = Math.min(maxDoleDivision, Math.max(_doleDivisionFactor[key] || 1, 1) * 2);
	prometheusDoleFactorGauge
		.labels(object.name, object.quality)
		.set(_doleDivisionFactor[key] || 0);
	return 0;
	// console.log(`failure out of ${object.name}/${object.count} from ${object.instanceID} (${object.instanceName})`);
}
