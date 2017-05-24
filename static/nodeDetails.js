// string, object, function(object)
function post(url, data, callback) {
	console.log("POST " + url + JSON.stringify(data))
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
function getJSON(url, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'json';
    xhr.onload = function() {
      var status = xhr.status;
      if (status == 200) {
        callback(null, xhr.response);
      } else {
        callback(status);
      }
    };
    xhr.send();
};
// function to sort arrays of objects after a keys value
function sortByKey(array, key) {
    return array.sort(function(a, b) {
        var x = Number(a[key]); var y = Number(b[key]);
        return ((x < y) ? 1 : ((x > y) ? -1 : 0));
    });
}
function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

function populateSlaveInfo(){
	let slaveID = getParameterByName("slaveID");
	if(!slaveID){
		throw "We need slaveID! GIVE US SLAVEID! ALL HAIL OUR NEW OVERLORDS!"
	}
	getJSON("/api/slaves", function(err, slaveData){
		/*
		{"-1530507550":{
			"time":"1495475926375",
			"rconPort":"8714",
			"rconPassword":"hidden",
			"serverPort":"14345",
			"unique":"-1530507550",
			"publicIP":"localhost",
			"mods":[
				{
					"modName":"clusterio_1.0.0.zip",
					"hash":"341feb6c60918c83f7f3a6a14a4a308aef18dda6"
				},{
					"modName":"clusterio_1.0.1.zip",
					"hash":"aee7a4b67ece19bddf236312fe408a5d4b67248d"
				},{
					"modName":"clusterio_1.1.0.zip",
					"hash":"18e2f7e402d716e3dd1c1458b7fab2d0bb29eccf"
				}],
			"playerCount":"0",
			"instanceName":"t",
			"mac":"44-85-00-D2-7E-D6"}
		}
		*/
		let slave = slaveData[slaveID];
		let HTML = "<div id='header'><div id='onlineIndicator'></div><h1>Name: " + slave.instanceName+"</h1>"
		HTML += "<div class='subbar'><h6>Host: "+slave.mac+" </h6><h6>Unique: "+slave.unique+" </h6>"
		if(slave.publicIP != "localhost"){
			HTML += "<h6>IP: "+slave.publicIP+":"+slave.serverPort+"</h6>";
		} else {
			HTML += "<h6>This server is not configured for incoming connections</h6>"
		}
		HTML += "</div></div>" // end of header
		// left container
		HTML += "<div id='leftHeroContainer'>"
		HTML += "<div id='displayBody'><p>Last seen: <span id='lastSeenDate'>"+moment(Number(slave.time)).fromNow()+"</span></p>"
		HTML += "<p>Online players: "+slave.playerCount+"</p>"
		HTML += "</div>" // end of displayBody
		
		// list mods and other metadata
		HTML += "<h2>Mods</h2><ul id='modlist'>"
		for(let i = 0; i < slave.mods.length; i++){
			HTML += "<li>"+slave.mods[i].modName+"</li>"
		}
		HTML += "</ul>"
		
		HTML += "</div>" // end of left container
		
		// chart
		HTML += '<div id="' + slave.unique + '" class="productionGraph" style="width: calc(100% - 300px);"></div>'
		
		document.querySelector("#hero").innerHTML = HTML;
		makeGraph(slave.unique, slave.unique)
		
	});
}

populateSlaveInfo();

// ID of slave, ID of canvasjs div without #
function makeGraph(slaveID, selector) {
	post("api/getStats", {slaveID: slaveID}, function(data){
		//console.log("Building chart " + slaveID + " with this data:")
		//console.log(data)
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
			//console.log(chartData)
			drawChart(selector, chartData)
		}
		// callback(data);
	})
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
	chartData = sortByKey(chartData, "x");
	let xyz = {};
	xyz.name = nameKey;
	xyz.type = "line";
	if(nameKey == "copper-wire"||nameKey == "iron-plate"||nameKey == "copper-plate"||nameKey == "electronic-circuit"||nameKey == "steel-plate"||nameKey == "advanced-circuit"||nameKey == "crude-oil"||nameKey == "petroleum-gas"){
		xyz.showInLegend = true;
	}
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