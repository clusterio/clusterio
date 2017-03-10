
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
makeGraph("2000814241", "", function(data){
	console.log("Building chart with this data:")
	console.log(data)
	let chartData = [];
	for(let i = 0; i < data.length; i++){
		chartData[chartData.length] = {
			/*x: new Date(data[i].timestamp),*/
			x: new Date(2012, 00, i),
			y: data[i].data["light-oil"]
		}
	}
	console.log(chartData)
	drawChart("chartContainer", chartData)
})

function drawChart(selector, data) {
	// selector is ID of element, ex "chartContainer"
	var chart = new CanvasJS.Chart(selector, {
		title:{
			text: "Production with CanvasJS"
		},
		axisX: {
			interval:1,
		},
		axisY:{
			includeZero: true
		},
		data: [{
			type: "line",
			dataPoints: data
		}]
		/*[{
			type: "line",
			dataPoints: [
			{ x: new Date(2012, 00, 1), y: 450 },
			{ x: new Date(2012, 01, 1), y: 414},
			{ x: new Date(2012, 02, 1), y: 520, indexLabel: "highest",markerColor: "red", markerType: "triangle"},
			{ x: new Date(2012, 03, 1), y: 460 },
			{ x: new Date(2012, 04, 1), y: 450 },
			{ x: new Date(2012, 05, 1), y: 500 },
			{ x: new Date(2012, 06, 1), y: 480 },
			{ x: new Date(2012, 07, 1), y: 480 },
			{ x: new Date(2012, 08, 1), y: 410 , indexLabel: "lowest",markerColor: "DarkSlateGrey", markerType: "cross"},
			{ x: new Date(2012, 09, 1), y: 500 },
			{ x: new Date(2012, 10, 1), y: 480 },
			{ x: new Date(2012, 11, 1), y: 510 }
			]
		}]*/
	});
	chart.render();
}