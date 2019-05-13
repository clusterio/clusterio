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
function Dose(numreq,instore,store_last_tick,dole,carry,prev_req,numreq_total_adj)
{
	numreq=Number(numreq);
	instore=Number(instore);
	var instore_adj=instore;
	if (instore_adj==0) instore_adj=0.1;
	
	var b=Math.trunc(prev_req/instore_adj*numreq);
	var inp1=[numreq,instore_adj,store_last_tick/numreq,dole,carry];//0..4
	var inp2=[prev_req/numreq,numreq/numreq_total_adj,store_last_tick/numreq_total_adj,prev_req/instore_adj,b,numreq_total_adj,store_last_tick];//5..11
	var inputs=inp1.concat(inp2);
	var internal=new Array(20).fill(0);
	var outputs=[0,0,0,0];
	//NN: Please don't touch :), code is generated
	
internal[2]=internal[6]*7.267292023;
internal[2]=internal[2]+inputs[6]*-0.5385144949;
internal[2]=internal[2]+inputs[4]*7.982471466;
internal[2]=internal[2]+inputs[7]*-4.120764256;
internal[2]=internal[2]+internal[8]*0.6542916298;
internal[2]=internal[2]+internal[10]*1.781727672;
internal[2]=internal[2]+internal[12]*-0.3893937171;
internal[2]=sigmoid0(internal[2]);
internal[6]=inputs[7]*-1.472857833;
internal[6]=internal[6]+inputs[2]*0.8619997501;
internal[6]=internal[6]+inputs[9]*1.951734781;
internal[6]=internal[6]+inputs[3]*-1.689901233;
internal[6]=internal[6]+internal[9]*3.475469828;
internal[6]=sigmoid0(internal[6]);
internal[8]=sigmoid0(internal[8]);
internal[9]=inputs[10]*-1.441205978;
internal[9]=internal[9]+inputs[1]*5.842033863;
internal[9]=internal[9]+inputs[9]*2.132386684;
internal[9]=internal[9]+inputs[5]*0.9830219746;
internal[9]=sigmoid0(internal[9]);
internal[10]=internal[14]*1.186838627;
internal[10]=internal[10]+inputs[4]*2.864197493;
internal[10]=internal[10]+inputs[2]*1.245233774;
internal[10]=internal[10]+inputs[7]*-3.596544981;
internal[10]=internal[10]+inputs[5]*0.2605635822;
internal[10]=internal[10]+inputs[6]*0.4522094429;
internal[10]=internal[10]+inputs[0]*-0.9868286252;
internal[10]=internal[10]+1.0*0.9270827174;
internal[10]=sigmoid0(internal[10]);
internal[12]=inputs[11]*-0.7495238185;
internal[12]=internal[12]+inputs[10]*-0.2499841005;
internal[12]=internal[12]+inputs[7]*-1.974439263;
internal[12]=internal[12]+1.0*1.85799706;
internal[12]=internal[12]+inputs[0]*0.413690418;
internal[12]=internal[12]+inputs[9]*1.894246459;
internal[12]=internal[12]+inputs[4]*-2.371104717;
internal[12]=sigmoid0(internal[12]);
internal[14]=inputs[9]*-1.812304616;
internal[14]=internal[14]+inputs[10]*-0.3029920459;
internal[14]=internal[14]+inputs[5]*-0.3064728975;
internal[14]=internal[14]+inputs[1]*0.5113605857;
internal[14]=internal[14]+inputs[6]*-0.3487350941;
internal[14]=internal[14]+inputs[0]*0.701588273;
internal[14]=internal[14]+1.0*0.693169713;
internal[14]=internal[14]+inputs[4]*-1.443944097;
internal[14]=internal[14]+inputs[2]*-2.836822033;
internal[14]=internal[14]+inputs[11]*-0.6553236842;
internal[14]=internal[14]+inputs[3]*-1.075786948;
internal[14]=internal[14]+inputs[8]*0.2613089979;
internal[14]=sigmoid0(internal[14]);
outputs[0]=inputs[1]*1.726672769;
outputs[0]=sigmoid0(outputs[0]);
outputs[1]=sigmoid0(outputs[1]);
outputs[2]=sigmoid0(outputs[2]);
outputs[3]=internal[2]*-2.092440128;
outputs[3]=sigmoid0(outputs[3]);

	var res1=Math.round(Number(outputs[0])*numreq)+Math.round(outputs[3]);
	
	if (res1>numreq) res1=numreq;
	if (res1>instore) res1=instore;
	if (res1<0) res1=0;
	res1=res1 || 0;//Safeguard against wrong values
	carry=sigmoid0(outputs[2]*carry+outputs[0]) || 0;
	return [res1,sigmoid0(outputs[1]),carry];
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
function Tick(instore,dole,store_last_tick,numreq_total_adj)
{
	var instore_adj=instore;
	if (instore_adj==0) instore_adj=0.1;
	var inputs=[instore,dole,store_last_tick/instore_adj,store_last_tick/numreq_total_adj];
	var internal=new Array(10).fill(0);
	var outputs=[0,0];
	//NN: Please don't touch :), code is generated
	
internal[2]=inputs[3]*-0.3051533401;
internal[2]=internal[2]+1.0*1.657034278;
internal[2]=sigmoid0(internal[2]);
internal[5]=inputs[1]*1.691301703;
internal[5]=internal[5]+inputs[0]*1.238131285;
internal[5]=sigmoid0(internal[5]);
outputs[0]=1.0*0.309109062;
outputs[0]=outputs[0]*inputs[0]*1.836197853;
outputs[0]=sigmoid1(outputs[0]);
outputs[1]=inputs[3]*1.100017905;
outputs[1]=outputs[1]+internal[5]*0.9273151159;
outputs[1]=outputs[1]+1.0*-2.498474121;
outputs[1]=outputs[1]+inputs[0]*1.087127209;
outputs[1]=outputs[1]+internal[2]*-0.896425426;
outputs[1]=sigmoid0(outputs[1]);

	avg=outputs[1];
	if (numreq_total_adj<0.11) avg=1;//When no item's are requested, result is 0.1 ; In that case there is no deficit, so return 1 = 100% demand fulfilled
	if (avg>1) avg=1;
	if (avg<0) avg=0;
	
	return [sigmoid0(outputs[0]),avg];
}

module.exports = {Dose,Tick}
