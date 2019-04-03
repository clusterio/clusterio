//Sigmoids...

function sigmoid0(x)
{
	return x/(1+Math.abs(x));
}
function sigmoid1(x)
{
	if (x>=0.0) {
		return 1.0
	} else {
		return 0.0
	}
}
function sigmoid2(x)
{
	if (x>=0.0){
		return x
	} else {
		return 0.0
	}
}
function sigmoid3(x)
{
	return x;
}

//DOSE - Doses items for item X slave Y
//Numreq - number of items that are requested for item X for slave Y
//Instore - number of items for item X in master gauge (currently)
//store_last_tick - Number of items for item X in master gauge at time of last tick
//dole - Current dole for item X
//carry - carry for item X slave Y
//prev_req - Numreq for previous request for item X slave Y
//* doleinfo_last - Object with 2 values for last "tick period": numreq - total number or requests for item, numslave - number of slaves requesting that item

//Returns: Array of 3 elements
//0.Number of items to give in that dose
//1.New dole for item X
//2.New carry for item X slave Y
function Dose(numreq,instore,store_last_tick,dole,carry,prev_req,doleinfo_last)
{
	var instore_adj=instore;
	if (instore_adj==0) instore_adj=0.1;
	var numreq_total_adj=doleinfo_last.numreq;
	if (numreq_total_adj==0) numreq_total_adj=0.1;
	
	var a=(doleinfo_last.numslave)*numreq;
	if (a>0) {a=(doleinfo_last.numreq)/a;} else {a=1000;}
	var b=Math.trunc(prev_req/instore_adj*numreq);
	var inputs=[numreq,instore_adj,store_last_tick/numreq,dole,carry,prev_req/numreq,doleinfo_last.numslave,numreq/numreq_total_adj,a,store_last_tick/numreq_total_adj,prev_req/instore,b];
	var internal=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
	var outputs=[0,0,0];
	//NN: Please don't touch :), code is generated
	
internal[11]=inputs[1]*2.584747791;
internal[11]=internal[11]+inputs[4]*0.9939581156;
internal[11]=internal[11]+inputs[5]*-0.5315227509;
internal[11]=internal[11]+inputs[3]*0.2037106603;
internal[11]=internal[11]+inputs[2]*1.38696003;
internal[11]=internal[11]+inputs[6]*-0.5434055328;
internal[11]=internal[11]+inputs[8]*-0.4344435036;
internal[11]=internal[11]+1.0*-1.461762667;
internal[11]=sigmoid0(internal[11]);
outputs[0]=inputs[0]*0.4289886355;
outputs[0]=outputs[0]+internal[11]*1.96782124;
outputs[0]=outputs[0]+inputs[3]*-2.196558237;
outputs[0]=sigmoid3(outputs[0]);
outputs[1]=outputs[0]*3.200549364;
outputs[1]=outputs[1]+inputs[7]*-0.3701510429;
outputs[1]=sigmoid0(outputs[1]);
outputs[2]=sigmoid0(outputs[2]);

	if (outputs[0]<0) outputs[0]=0;
	outputs[0]=outputs[0]*numreq;
	var res1=Math.trunc(outputs[0]);
	if (res1>numreq) res1=numreq;
	if (res1>instore) res1=instore;
	if (res1<0) res1=0;
	carry=outputs[2];
	return [res1,outputs[1],carry];
}

//TICK - Updates values for item X, should be called once for each item for each round of all slaves requesting that item
//Instore - number of items for item X in master gauge (currently)
//dole - Current dole for item X
//store_last_tick - Number of items for item X in master gauge at time of last tick (not this one)
//* doleinfo_last - Object with 2 values for last "tick period": numreq - total number or requests for item, numslave - number of slaves requesting that item
//* doleinfo_new - Object with 2 values for new "tick period": numreq - total number or requests for item, numslave - number of slaves requesting that item


//Returns: Array of 2 elements
//0.New dole for item X
//1.Guessed percentage average of items supplied in last 10 ticks
function Tick(instore,dole,store_last_tick,doleinfo_last,doleinfo_new)
{
	var instore_adj=instore;
	if (instore_adj==0) instore_adj=0.1;
	var numreq_total_adj=doleinfo_last.numreq;
	if (numreq_total_adj==0) numreq_total_adj=0.1;
	var a=doleinfo_new.numreq;
	if (a>0) {a=doleinfo_last.numreq/doleinfo_new.numreq;} else {a=1000;}
	var aa=doleinfo_last.numslave*instore;
	if (aa>0) {doleinfo_last.numreq/aa;} else {aa=1000;}
	var inputs=[instore,dole,store_last_tick/instore_adj,a,doleinfo_last.numslave,doleinfo_new.numslave,aa,store_last_tick/numreq_total_adj];
	var internal=[0,0,0,0,0];
	var outputs=[0,0];
	//NN: Please don't touch :), code is generated
	
outputs[0]=sigmoid0(outputs[0]);
outputs[1]=inputs[7]*4.376355648;
outputs[1]=sigmoid0(outputs[1]);


	avg=outputs[1];
	if (avg>1) avg=1;
	if (avg<0) avg=0;
	
	return [outputs[0],avg];
}

module.exports = {Dose,Tick}
