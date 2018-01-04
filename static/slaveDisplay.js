
// ask master for slaves and render them nicely on a page with production graphs
setTimeout(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			var slaveData = JSON.parse(xmlhttp.responseText);
			var HTML = "<p>Current connections:</p>"
			for(i=0;i<Object.keys(slaveData).length;i++){
				var key = Object.keys(slaveData)[i]
				// Only show slaves connected last 2 minutes (depending on setting now)
				if(JSON.parse(localStorage.settings)["Display offline slaves"]) var displayOffline = true;
				if(Date.now() - slaveData[key].time < 120000 || displayOffline) {
					let seenDate = moment(Number(slaveData[key].time)).format('DD.MM.YY, hh:mm:ss')
					HTML += "<div class='slaveBox'>";
					HTML += '<div id="' + slaveData[key].unique + '" class="productionGraph" style="width: calc(100% - 200px);"></div>';
					HTML += "<a href='nodeDetails?instanceID="+slaveData[key].unique+"'><h2>" + slaveData[key].instanceName + "</h2></a><p>ID: " + slaveData[key].unique + "</p><p>Last seen: "+seenDate+"</p><p>Online players: "+slaveData[key].playerCount+"</p><p>IP: "+slaveData[key].publicIP +":"+ slaveData[key].serverPort+"</p>"
					HTML += "<p>Host: "+slaveData[key].mac+"</p>";
					
					// detect  if remoteMap mod is installed, if it is we want to show the link for it
					let hasRemoteMap = false;
					slaveData[key].mods.forEach(mod => {
						console.log(mod.modName);
						if(mod.modName.includes("remoteMap")){
							hasRemoteMap = true; // we are still doing the logic on the outside, in case there are multiple instances of remoteMap installed....
						}
					});
					if(hasRemoteMap){
						HTML += "<a href='/remoteMap?instanceID="+slaveData[key].unique+"'>Remote map</a>"
					}
					
					HTML += "<br><p>Graph tools:</p>";
					HTML += "<button style='width:100px;' onclick='hideAllDatasets(\"" + slaveData[key].unique + "\")\'>Hide all</button>";
					HTML += "<button style='width:100px;' onclick='showAllDatasets(\"" + slaveData[key].unique + "\")\'>Show all</button>";
					HTML += "</div>";
				}
			}
			document.querySelector("#slaves > #display").innerHTML = HTML
			
			if(JSON.parse(localStorage.settings)["Enable production graphs"]) {
				let graphs = document.querySelectorAll(".productionGraph");
				for(let i = 0; i < graphs.length; i++) {
					// execute functions to make graphs
					// ID of slave, ID of canvasjs div without #
					makeGraph(graphs[i].id, graphs[i].id)
				}
			}
		}
	}
	xmlhttp.open("GET", "api/slaves", true);
	xmlhttp.send();
}, 0)

let chartIgnoreList = [
	"water",
	"steam"
]

// ID of slave, ID of canvasjs div without #
function makeGraph(instanceID, selector) {
	post("api/getTimelineStats", {instanceID: instanceID}, function(pointsInTime) {
		//console.log("Building chart " + instanceID + " with this data:")
		
		//Find all keys at all points in time.
		let itemNames = {};
		pointsInTime.forEach(function(point) {
			for(let key in point.data) {
				itemNames[key] = true;
			}
		});
		itemNames = Object.keys(itemNames);
		
		//Generate a chart list for each item.
		const displayNames = itemNames.filter(function(name) { 
			return !chartIgnoreList.includes(name);
		});
		const chartData = displayNames.map(function(name) {
			return generateLineChartArray(pointsInTime, name)
		});
		
		chartData.length && drawChart(selector, chartData)
	})
}

// production info
// string, object, function(object)
function post(url, data, callback) {
	console.log("POST " + url, data);
	var xhr = new XMLHttpRequest();
	xhr.open("POST", url, true);
	xhr.setRequestHeader("Content-type", "application/json");
	xhr.onreadystatechange = function () {
		if (xhr.readyState == 4 && xhr.status == 200) {
			var json = JSON.parse(xhr.responseText);
			callback(json);
		}
	}
	xhr.send(JSON.stringify(data));
}

function generateLineChartArray(data, nameKey) {
	const legendKeys = ["copper-cable", "iron-plate", "copper-plate", "electronic-circuit", "steel-plate", "advanced-circuit", "crude-oil", "petroleum-gas"];
	let chartData = [];
	for(let i = 0; i < data.length; i++) {
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
	chartData = sortByKey(chartData, "x");
	let xyz = {};
	xyz.name = nameKey;
	xyz.type = "line";
	
	if(legendKeys.indexOf(nameKey) >= 0){
		xyz.showInLegend = true;
	}
	xyz.dataPoints = chartData;
	return xyz;
}

var chartsByID = {};
function drawChart(selector, chartData) {
	// selector is ID of element, ex "chartContainer" or "-123199123"
	// console.log(chartData)
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

function hideAllDatasets(chartID) {
	if(chartsByID[chartID]) {
		let chart = chartsByID[chartID];
		for(let i = 0; i < chart.options.data.length; i++) {
			chart.options.data[i].visible = false;
		}
		chart.render();
	} else {
		return false;
	}
}
function showAllDatasets(chartID) {
	if(chartsByID[chartID]) {
		let chart = chartsByID[chartID];
		for(let i = 0; i < chart.options.data.length; i++) {
			chart.options.data[i].visible = true;
		}
		chart.render();
	} else {
		return false;
	}
}

// function to sort arrays of objects after a keys value
function sortByKey(array, key) {
    return array.sort(function(a, b) {
        var x = Number(a[key]); var y = Number(b[key]);
        return ((x < y) ? 1 : ((x > y) ? -1 : 0));
    });
}