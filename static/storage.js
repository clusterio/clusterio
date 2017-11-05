// function to draw data we recieve from ajax requests
_lastData = [];
function drawcontents(data) {
	data = data || _lastData; //Cache data so we can drawcontents without waiting for the server, for the search box.
	_lastData = data;
	
	const search = new RegExp(document.querySelector("#search").value, 'i');
	data = data.filter(function(item) {
		return search.test(item.name);
	})
	
	sortByKey(data, "count");
	
	const table = document.querySelector("#contents tbody"); //tables have tbody inserted automatically
	const rows = table.children;
	
	//update existing rows or create new ones
	data.forEach(function(item, i) {
		let row = rows[i];
		if(!row) {
			row = document.createElement('tr');
			row.innerHTML = "<td><img width=32 height=32></td><td class=name></td><td class=count></td>";
			table.appendChild(row);
		}
		
		const img = row.querySelector('img');
		const imgName = getImageFromName(item.name);
		if(img.getAttribute('src') !== imgName) {
			img.setAttribute('src',imgName);
		}
		
		const name = row.querySelector('.name');
		if(name.textContent !== item.name) {
			name.textContent = item.name;
			row.onclick = ()=>{
				makeItemGraphs(item.name);
			}
		}
		
		const count = row.querySelector('.count');
		if(count.textContent !== ''+item.count) {
			count.textContent = item.count;
		}
	});
	
	//remove excess rows, for example, after filtering
	while (data.length < rows.length) {
		table.removeChild(rows[data.length]);
	}
}

// get cluster inventory from master
function updateInventory() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			let data = JSON.parse(xmlhttp.responseText);
			drawcontents(data);
		}
	}
	xmlhttp.open("GET", "api/inventory", true);
	xmlhttp.send();
}
if(JSON.parse(localStorage.settings)["Periodically update storage screen"]) {
	setInterval(updateInventory, 500);
} else {
	updateInventory();
}

// function to sort arrays of objects after a keys value
function sortByKey(array, key) {
    array.sort(function(a, b) {
        return b[key] - a[key];
    });
}

document.querySelector("#search").addEventListener('input', function() { 
	drawcontents();
});

// Make graph of cluster IO items
/*getJSON("/api/getStats", function(err, data){
	
}*/
function getItemStatData(item, callback){
	var xhr = new XMLHttpRequest();
	var url = "/api/getStats";
	xhr.open("POST", url, true);
	xhr.setRequestHeader("Content-type", "application/json");
	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4 && xhr.status === 200) {
			var json = JSON.parse(xhr.responseText);
			console.log(json.email + ", " + json.password);
			callback(json);
		}
	};
	var requestData = JSON.stringify({
		"statistic": "place",
		"itemName": "shit",
	});
	xhr.send(data);
}

function makeItemGraphs(itemName){
	getJSON("/api/slaves", function(err, slaves){
		if(err) throw err;
		if(typeof slaves == "string"){
			slaves = JSON.parse(slaves);
		}
		let slaveIDs = Object.keys(slaves);
		let HTML = ""
		// Draw in/out chart for unregistered slaves as well
		slaveIDs.unshift("unknown");
		slaveIDs.forEach(function(slaveID){
			if(slaveID == "unknown" || Date.now() - slaves[slaveID].time < 120000 || JSON.parse(localStorage.settings)["Display offline slaves"]){
				HTML += '<div id="contentGraph'+slaveID+'" class="storageGraph" style="width: 100%;"></div>';
				["place", "remove"].forEach(statistic => {
					console.log("Making chart for "+slaveID+"'s "+statistic+" statistic");
					
					setTimeout(function(){
						let xmlhttp = new XMLHttpRequest();   // new HttpRequest instance 
						xmlhttp.open("POST", "/api/getStats");
						xmlhttp.setRequestHeader("Content-Type", "application/json");
						xmlhttp.onreadystatechange = function(){
							console.log(xmlhttp.status);
							if(xmlhttp.readyState === XMLHttpRequest.DONE && xmlhttp.status === 200) {
								// console.log(xmlhttp.responseText);
								if(isJSON(xmlhttp.responseText) && JSON.parse(xmlhttp.responseText).statusForDebugging === undefined){
									let slaveDisplayName = "unknown";
									try {
										slaveDisplayName = slaves[slaveID].instanceName;
									} catch(e) {}
									let whatGraphIsIt = "Items sent to cluster from";
									if(statistic == "remove") whatGraphIsIt = "Items taken from cluster by";
									
									let chartData = JSON.parse(xmlhttp.response).data;
									switch(statistic){
										case "place":
											chartData.name = "Items exported:";
										break;
										case "remove":
											chartData.name = "Items imported:";
										break;
									}
									drawChartWhenCalledTwice(chartData, whatGraphIsIt + " " + slaveDisplayName);
									//drawChart(statistic+"contentGraph"+slaveID, [JSON.parse(xmlhttp.response).data], `${whatGraphIsIt} ${slaveDisplayName} (${slaveID}) ${itemName}`);
									// console.log(JSON.parse(xmlhttp.response).data);
								}
							}
						}
						xmlhttp.send(JSON.stringify({statistic:statistic, itemName:itemName, slaveID:slaveID}));
					},1);
				});
				let chartLines = [];
				function drawChartWhenCalledTwice(data, slaveDisplayName){
					chartLines.push(data);
					if(chartLines.length >= 2){
						drawChart("contentGraph"+slaveID, chartLines, `${slaveDisplayName} (${slaveID}) ${itemName}`);
					}
				}
			}
		});
		document.querySelector("#graphDisplay > #storageGraphContainer").innerHTML = HTML;
	});
}
let chartsByID = {};
function drawChart(selector, chartData, title) {
	// selector is ID of element, ex "chartContainer" or "-123199123"
	console.log(chartData)
	chartsByID[selector] = new CanvasJS.Chart(selector, {
		title:{
			text: title || "Production graph"
		},
		toolTip:{
			shared: true,
			// content: "{name}: {y}",
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
	return chart;
}