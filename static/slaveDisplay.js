
// get all slaves recently connected to master
// ask master for slaves
setInterval(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			var slaveData = JSON.parse(xmlhttp.responseText);
			var HTML = "<p>Current connections:</p>"
			for(i=0;i<Object.keys(slaveData).length;i++){
				var key = Object.keys(slaveData)[i]
				// Date.getYear.getmonth.getDay
				if(Date.now() - slaveData[key].time < 12000) {
					// Display ISO 6801 compliant date to please Zarthus
					// maybe include an option to use y-ymd-ymd-y for Trangar compatibility as well
					var seenDate = date.yyyymmdd(slaveData[key].time)
					if(g.trangarTime == true){
						var seenDate = (seenDate+"")[0]+"-"+(seenDate+"")[1]+(seenDate+"")[4]+(seenDate+"")[6]+"-"+(seenDate+"")[2]+(seenDate+"")[5]+(seenDate+"")[7]+"-"+(seenDate+"")[3]
					}
					HTML += "<div class='slaveBox'><h2>ID: " + slaveData[key].unique + "</h2><p>Last seen: "+seenDate+"</p><p>Port: "+slaveData[key].serverPort+"</p><p>Host: "+slaveData[key].mac+"</p></div>"
				}
			}
			document.querySelector("#slaves > #display").innerHTML = HTML
		}
	}
	xmlhttp.open("GET", "slaves", true);
	xmlhttp.send();
}, 500)

function makeGraph(slaveID, selector, callback) {
	post("http://localhost:8080/getStats", {slaveID: slaveID}, function(data){
		console.log("makeGraphed!")
		callback(data);
	})
}

// production info
// string, object, function(object)
function post(url, data, callback) {
	console.log("POST " + url + JSON.stringify(data))
	var xhr = new XMLHttpRequest();
	xhr.open("POST", url, true);
	xhr.setRequestHeader("Content-type", "application/json");
	xhr.onreadystatechange = function () {
		console.log(xhr.readyState + "WOW")
		if (xhr.readyState == 4 && xhr.status == 200) {
			var json = JSON.parse(xhr.responseText);
			callback(json);
		}
	}
	xhr.send(JSON.stringify(data));
}
// execute functions to make a graph, this is the entrypoint (during testing at least)
// ID of slave, blank string, function with JSON data as fist argument
makeGraph("-496927236", "", function(data){
	console.log("Building chart with this data:")
	console.log(data)
	// find keys
	let itemNames = [];
	for(let key in data[data.length - 1].data) {
		itemNames[itemNames.length] = key
	}
	let chartData = [];
	for(let o = 0; o < itemNames.length; o++) {
		if(itemNames[o] != "water"){
			chartData[chartData.length] = generateLineChartArray(data, itemNames[o]);
		}
	}
	
	
	console.log(chartData)
	drawChart("chartContainer", chartData)
})

function generateLineChartArray(data, nameKey) {
	let chartData = [];
	for(let i = 0; i < data.length; i++) {
		// only show recent data
		if(data[i].timestamp > Date.now() - (24*60*60*1000)){
			let y = data[i].data[nameKey]
			if(!data[i].data[nameKey]) {
				y = 0
			}
			chartData[chartData.length] = {
				/*x: new Date(data[i].timestamp),*/
				x: new Date(data[i].timestamp),//new Date(2012, 00, i),
				y: Number(y)
			}
			// console.log(i + " | " + y)
		}
	}
	let xyz = {};
	xyz.type = "spline";
	xyz.dataPoints = chartData;
	return xyz;
}

function drawChart(selector, chartData) {
	// selector is ID of element, ex "chartContainer"
	var chart = new CanvasJS.Chart(selector, {
		title:{
			text: "Production graph"
		},
		axisY:{
			includeZero: true
		},
		data: chartData/*[{
			type: "line",
			dataPoints: chartData
		}]*/
	});
	// console.log(chart)
	chart.render();
}