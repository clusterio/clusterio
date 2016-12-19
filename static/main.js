var g = {}
contents = {
	"iron-plate":100,
	"copper-plate":7312,
}
// nice functions
// hash a string to a hash
function djb2(str){
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
  }
  return hash;
}
// hash a string to a color
function hashColor(str) {
  var hash = djb2(str);
  var r = (hash & 0xFF0000) >> 16;
  var g = (hash & 0x00FF00) >> 8;
  var b = hash & 0x0000FF;
  return "#" + ("0" + r.toString(16)).substr(-2) + ("0" + g.toString(16)).substr(-2) + ("0" + b.toString(16)).substr(-2);
}
// exactly what you would expect it to, returns String
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// hide the HTML object passed as argument #1
function hideThis(object) {
	object.style.visibility = "hidden";
}
// function to sort arrays of objects after a keys value
function sortByKey(array, key) {
    return array.sort(function(a, b) {
        var x = Number(a[key]); var y = Number(b[key]);
        return ((x < y) ? 1 : ((x > y) ? -1 : 0));
    });
}
// function to draw data we recieve from ajax requests
function drawcontents(data) {
	var data = sortByKey(data, "count");
	result = "<table>";
	for(i = 0;i < data.length; i++) {
		var img = "";
		if(imagedata[data[i].name]){
			img = "https://wiki.factorio.com/images/" + imagedata[data[i].name] + ".png"
		} else {
			img = "https://wiki.factorio.com/images/" + capitalizeFirstLetter(data[i].name) + ".png";
		}
		result = result + "<tr><td><image src='" + img + "' onerror='hideThis(this);'></td><td>" + data[i].name + "</td><td>" + data[i].count + "</td></tr>";
	}
	result = result + "</table>"
	document.getElementById("contents").innerHTML = result;
}

// handle the navigation buttons
currentPage = ""
function display(page) {
	var pages = document.querySelector("#body").childNodes;
	for(i=0;i<pages.length;i++){
		if(pages[i].style){
			pages[i].style.display = "none";
		}
	}
	if(typeof page == "string" && document.querySelector("#" + page)) {
		document.querySelector("#" + page).style.display = "block";
		currentPage = page;
	}
}

// setTimeout is used to put this processing in the back of the queue, after the HTML canvas is done
window.onload = function () {
	display("storage")
	// dataPoints
	var dataPoints1 = [];
	var dataPoints2 = [];

	var chart = new CanvasJS.Chart("productionChart",{
		zoomEnabled: true,
		title: {
			text: "Production"
		},
		toolTip: {
			shared: true
		},
		legend: {
			verticalAlign: "top",
			horizontalAlign: "center",
			fontSize: 14,
			fontWeight: "bold",
			fontFamily: "calibri",
			fontColor: "dimGrey"
		},
		axisX: {
			title: "Shows items in network"
		},
		axisY:{
			prefix: '',
			includeZero: true
		}, 
		data: [{ 
			// dataSeries1
			type: "line",
			xValueType: "dateTime",
			showInLegend: true,
			name: "Company A",
			dataPoints: dataPoints1
		},
		{				
			// dataSeries2
			type: "line",
			xValueType: "dateTime",
			showInLegend: true,
			name: "Company B" ,
			dataPoints: dataPoints2
		}],
	  legend:{
		cursor:"pointer",
		itemclick : function(e) {
		  if (typeof(e.dataSeries.visible) === "undefined" || e.dataSeries.visible) {
			e.dataSeries.visible = false;
		  }
		  else {
			e.dataSeries.visible = true;
		  }
		  chart.render();
		}
	  }
	});



	var updateInterval = 10000;
	// initial value
	var yValue1 = 640; 
	var yValue2 = 604;

	var time = new Date;
	time.setHours(9);
	time.setMinutes(30);
	time.setSeconds(00);
	time.setMilliseconds(00);
	// starting at 9.30 am

	var updateChart = function (count) {
		count = count || 1;

		// count is number of times loop runs to generate random dataPoints. 

		for (var i = 0; i < count; i++) {
			
			// add interval duration to time				
			time.setTime(time.getTime()+ updateInterval);


			// generating random values
			var deltaY1 = .5 + Math.random() *(-.5-.5);
			var deltaY2 = .5 + Math.random() *(-.5-.5);

			// adding random value and rounding it to two digits. 
			yValue1 = Math.round((yValue1 + deltaY1)*100)/100;
			yValue2 = Math.round((yValue2 + deltaY2)*100)/100;
			
			// pushing the new values
			dataPoints1.push({
				x: time.getTime(),
				y: yValue1
			});
			dataPoints2.push({
				x: time.getTime(),
				y: yValue2
			});


		};

		// updating legend text with  updated with y Value 
		chart.options.data[0].legendText = " Company A  $" + yValue1;
		chart.options.data[1].legendText = " Company B  $" + yValue2; 

		chart.render();

	};

	// generates first set of dataPoints 
	updateChart(3000);	
	 
	// update chart after specified interval 
	setInterval(function(){updateChart()}, updateInterval);
}

var piedata = {};
var piedataOld = {};
// get cluster inventory from master
setInterval(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			data = JSON.parse(xmlhttp.responseText);
			if(currentPage = "storage"){
				drawcontents(data);
			}
			// render our piechart with up to date information
			// items-in-network-chart
			if(piedata) {
				piedataOld = piedata;
			}
			piedata = [];
			for(i=0;i<data.length;i++) {
				piedata[piedata.length] = {
					value: Number(data[i].count),
					color: hashColor(data[i].name),
					label: data[i].name,
				}
			}
		}
	}
	xmlhttp.open("GET", "inventory", true);
	xmlhttp.send();
}, 500)
// get all slaves recently connected to master
Date.prototype.yyyymmdd = function(time) { // http://stackoverflow.com/questions/3066586/get-string-in-yyyymmdd-format-from-js-date-object
	var mm = this.getMonth() + 1; // getMonth() is zero-based
	var dd = this.getDate();
	if(mm<10)mm = "0"+mm
	if(dd<10)dd = "0"+dd
	console.log(this.getFullYear())
	return this.getFullYear()+""+mm+""+dd+ ""; // padding
};
var date = new Date();

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

// image data
// key is the name of the item in the database, value is the name of the image on wiki.factorio.com/images/*
// this list has to include all entities that doesn't just follow the simple capitalize first letter convention
var imagedata = {
	["empty-barrel"]: "Barrel-empty",
	["transport-belt"]: "Basic-transport-belt",
	["underground-belt"]: "Basic-transport-belt-to-ground",
	["fast-underground-belt"]: "Fast-transport-belt-to-ground",
	["express-underground-belt"]: "Express-transport-belt-to-ground",
	["splitter"]: "Basic-splitter",
	["inserter"]: "Inserter-icon",
	["stack-inserter"]: "Stack_inserter",
	["stack-filter-inserter"]: "Stack_filter_inserter",
	["efficiency-module"]: "Effectivity-module",
	["efficiency-module_2"]: "Effectivity-module-2",
	["efficiency-module_3"]: "Effectivity-module-3",
	["low-density-structure"]: "Rocket-structure",
	["electric-mining-drill"]: "Basic-mining-drill",
	["burner-mining-drill"]: "Burner-mining-drill",
	["active-provider-chest"]: "Logistic-chest-active-provider",
	["passive-provider-chest"]: "Logistic-chest-passive-provider",
	["storage-chest"]: "Logistic-chest-storage",
	["requester-chest"]: "Logistic-chest-requester",
	["wall"]: "Stone-wall",
	["medium-electric-pole"]: "Medium-electric-pole",
	["lamp"]: "Small-lamp",
	["regular-magazine"]: "Basic-bullet-magazine",
	["piercing-rounds_magazine"]: "Piercing-bullet-magazine",
	["flamethrower-ammo"]: "Flame-thrower-ammo",
	["cannon-shells"]: "Cannon-shell",
	["explosive-cannon-shells"]: "Explosive-cannon-shell",
	["land-mine"]: "Land-mine-research",
	["cluster-grenade"]: "Cluster_grenade",
	["shotgun-shells"]: "Shotgun-shell",
	["piercing-shotgun-shells"]: "Piercing-shotgun-shell",
	["accumulator"]: "Basic-accumulator",
	["beacon"]: "Basic-beacon",
}
