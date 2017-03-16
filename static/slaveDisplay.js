
// get all slaves recently connected to master
// ask master for slaves
setTimeout(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			var slaveData = JSON.parse(xmlhttp.responseText);
			var HTML = "<p>Current connections:</p>"
			for(i=0;i<Object.keys(slaveData).length;i++){
				var key = Object.keys(slaveData)[i]
				// Only show slaves connected last 2 minutes
				if(Date.now() - slaveData[key].time < 120000) {
					// Display ISO 6801 compliant date to please Zarthus
					// maybe include an option to use y-ymd-ymd-y for Trangar compatibility as well
					var seenDate = date.yyyymmdd(slaveData[key].time)
					if(g.trangarTime == true){
						var seenDate = (seenDate+"")[0]+"-"+(seenDate+"")[1]+(seenDate+"")[4]+(seenDate+"")[6]+"-"+(seenDate+"")[2]+(seenDate+"")[5]+(seenDate+"")[7]+"-"+(seenDate+"")[3];
					}
					HTML += "<div class='slaveBox'>";
					HTML += '<div id="' + slaveData[key].unique + '" class="productionGraph" style="width: calc(100% - 200px);"></div>';
					HTML += "<h2>ID: " + slaveData[key].unique + "</h2><p>Last seen: "+seenDate+"</p><p>Port: "+slaveData[key].serverPort+"</p><p>Host: "+slaveData[key].mac+"</p>";
					
					HTML += "</div>";
				}
			}
			document.querySelector("#slaves > #display").innerHTML = HTML
			let graphs = document.querySelectorAll(".productionGraph");
			for(let i = 0; i < graphs.length; i++) {
				// execute functions to make graphs
				// ID of slave, ID of canvasjs div without #
				makeGraph(graphs[i].id, graphs[i].id)
			}
		}
	}
	xmlhttp.open("GET", "api/slaves", true);
	xmlhttp.send();
}, 0)


// ID of slave, ID of canvasjs div without #
function makeGraph(slaveID, selector) {
	post("api/getStats", {slaveID: slaveID}, function(data){
		console.log("Building chart " + slaveID + " with this data:")
		console.log(data)
		if(data.length > 0) {
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
			drawChart(selector, chartData)
		}
		// callback(data);
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

function generateLineChartArray(data, nameKey) {
	let chartData = [];
	for(let i = 0; i < data.length; i++) {
		// only show recent data
		if(data[i].timestamp > Date.now() - (24*60*60*1000)){
			let y = data[i].data[nameKey]
			if(!data[i].data[nameKey]) {
				y = 0;
			} else if(y < 0) {
				y = 0;
			}
			chartData[chartData.length] = {
				x: new Date(data[i].timestamp),
				y: Number(y)
			}
		}
	}
	let xyz = {};
	xyz.name = nameKey;
	xyz.type = "line";
	xyz.showInLegend = true;
	xyz.dataPoints = chartData;
	return xyz;
}

var chartsByID = {};
function drawChart(selector, chartData) {
	// selector is ID of element, ex "chartContainer" or "-123199123"
	console.log(chartData)
	chartsByID[selector] = new CanvasJS.Chart(selector, {
		title:{
			text: "Production graph"
		},
		toolTip:{   
			content: "{name}: {y}"	  
		},
		zoomEnabled: true,
		axisY:{
			includeZero: true,
		},
		legend: {
			cursor: "pointer",
			itemclick: function (e) {
				//console.log("legend click: " + e.dataPointIndex);
				//console.log(e);
				if (typeof (e.dataSeries.visible) === "undefined" || e.dataSeries.visible) {
					e.dataSeries.visible = false;
				} else {
					e.dataSeries.visible = true;
				}
				e.chart.render();
			}
		},
		data: chartData
	});
	chart = chartsByID[selector];
	// console.log(chart)
	chart.render();
}