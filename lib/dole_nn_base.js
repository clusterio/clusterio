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

//Returns: Array of 3 elements
//0.Number of items to give in that dose
//1.New dole for item X
//2.New carry for item X slave Y
function Dose(numreq,instore,store_last_tick,dole,carry,prev_req)
{
	var inputs=[numreq,instore,store_last_tick,dole,carry,prev_req];
	var internal=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
	var outputs=[0,0];
	//NN: Please don't touch :), code is generated
	
internal[1]=internal[8]*-1.643964648;
internal[1]=internal[1]+internal[3]*1.475263;
internal[1]=internal[1]+internal[10]*1.137161493;
internal[1]=internal[1]+1.0*0.581692636;
internal[1]=internal[1]+inputs[3]*-0.7429554462;
internal[1]=internal[1]+inputs[1]*-4.860008717;
internal[1]=internal[1]+inputs[0]*0.8682486415;
internal[1]=internal[1]+inputs[5]*-2.332767725;
internal[1]=sigmoid0(internal[1]);
internal[2]=internal[1]*0.8746165037;
internal[2]=sigmoid0(internal[2]);
internal[3]=inputs[0]*-5.502003193;
internal[3]=internal[3]+inputs[4]*0.2463098913;
internal[3]=internal[3]+inputs[5]*2.313313961;
internal[3]=internal[3]+1.0*-0.3230940998;
internal[3]=internal[3]+inputs[3]*-0.7781001329;
internal[3]=internal[3]+inputs[2]*7.295908451;
internal[3]=sigmoid0(internal[3]);
internal[6]=internal[1]*1.406680346;
internal[6]=internal[6]+inputs[3]*0.5068955421;
internal[6]=internal[6]+inputs[1]*-0.4729067087;
internal[6]=internal[6]+inputs[2]*0.8344552517;
internal[6]=internal[6]+inputs[0]*2.739265203;
internal[6]=sigmoid0(internal[6]);
internal[7]=inputs[0]*-0.9354650974;
internal[7]=internal[7]+inputs[5]*1.853131294;
internal[7]=internal[7]+inputs[2]*-0.5912416577;
internal[7]=internal[7]+inputs[1]*1.000927806;
internal[7]=sigmoid0(internal[7]);
internal[8]=1.0*-2.179960728;
internal[8]=internal[8]+inputs[1]*1.66548419;
internal[8]=internal[8]+inputs[0]*1.550180197;
internal[8]=sigmoid0(internal[8]);
internal[10]=inputs[2]*1.491255403;
internal[10]=internal[10]+1.0*1.035691857;
internal[10]=sigmoid0(internal[10]);
outputs[0]=inputs[2]*0.5093510151;
outputs[0]=outputs[0]+inputs[4]*0.9384511113;
outputs[0]=outputs[0]+outputs[1]*-3.595440626;
outputs[0]=sigmoid1(outputs[0]);
outputs[1]=inputs[2]*1.534054637;
outputs[1]=outputs[1]+internal[2]*-2.732098818;
outputs[1]=outputs[1]+outputs[2]*1.163635135;
outputs[1]=outputs[1]+internal[1]*-0.2005333602;
outputs[1]=outputs[1]+internal[6]*0.6757783294;
outputs[1]=sigmoid0(outputs[1]);
outputs[2]=1.0*-0.9311643243;
outputs[2]=outputs[2]+inputs[1]*-1.85346806;
outputs[2]=outputs[2]+inputs[2]*-1.232177019;
outputs[2]=outputs[2]+inputs[0]*1.937278271;
outputs[2]=outputs[2]+internal[7]*-0.728112638;
outputs[2]=sigmoid0(outputs[2]);

	if (outputs[0]<0) outputs[0]=0;
	outputs[0]=outputs[0]*numreq;
	var res1=Math.trunc(outputs[0]);
	if (res1>numreq) res1=numreq;
	if (res1>instore) res1=instore;
	if (res1<0) res1=0;
	carry=outputs[2]+outputs[0]-res1;
	return [res1,outputs[1],carry];
}

//TICK - Updates values for item X, should be called once for each item for each round of all slaves requesting that item
//Instore - number of items for item X in master gauge (currently)
//dole - Current dole for item X
//store_last_tick - Number of items for item X in master gauge at time of last tick (not this one)

//Returns: Array of 2 elements
//0.New dole for item X
//1.Guessed percentage average of items supplied in last 10 ticks
function Tick(instore,dole,store_last_tick)
{
	var inputs=[instore,dole,store_last_tick];
	var internal=[0,0,0,0,0];
	var outputs=[0,0];
	//NN: Please don't touch :), code is generated
	
outputs[0]=1.0*0.5381062031;
outputs[0]=sigmoid1(outputs[0]);
outputs[1]=1.0*-0.5653554201;
outputs[1]=outputs[1]+inputs[0]*0.65881145;
outputs[1]=outputs[1]+inputs[1]*0.6852278709;
outputs[1]=sigmoid0(outputs[1]);


	avg=outputs[1];
	if (avg>1) avg=1;
	if (avg<0) avg=0;
	return [outputs[0],avg];
}

module.exports = {Dose,Tick}