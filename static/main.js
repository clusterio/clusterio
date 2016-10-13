
contents = {
	"iron-plate":100,
	"copper-plate":7312,
}
// nice functions
function djb2(str){
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
  }
  return hash;
}

function hashColor(str) {
  var hash = djb2(str);
  var r = (hash & 0xFF0000) >> 16;
  var g = (hash & 0x00FF00) >> 8;
  var b = hash & 0x0000FF;
  return "#" + ("0" + r.toString(16)).substr(-2) + ("0" + g.toString(16)).substr(-2) + ("0" + b.toString(16)).substr(-2);
}

// function to draw data we recieve from ajax requests
function drawcontents(data) {
	keys = Object.keys(data);
	result = "<table>";
	for(i = 0;i < data.length; i++) {
		result = result + "<tr><td>" + data[i].name + "</td><td>" + data[i].count + "</td></tr>";
	}
	result = result + "</table>"
	document.getElementById("contents").innerHTML = result;
}

// handle the navigation buttons
function display(page) {
	var pages = document.querySelector("#body").childNodes;
	for(i=0;i<pages.length;i++){
		if(pages[i].style){
			pages[i].style.display = "none";
		}
	}
	if(typeof page == "string" && document.querySelector("#" + page)) {
		document.querySelector("#" + page).style.display = "block";
	}
}

// Function to redraw charts in case they bug out
function drawcharts() {
	// create chart of items in master storage
	ctx = document.querySelector("#contentGraph").getContext('2d');
    PieChart = new Chart(ctx);
	
	// production chart
	// https://codepen.io/statuswoe/pen/hyldD
	var count = 20;
	var data = {
		labels : ["1","2","3","4","5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"],
		datasets : [
			{
				fillColor : "rgba(220,220,220,0.5)",
				strokeColor : "rgba(220,220,220,1)",
				pointColor : "rgba(220,220,220,1)",
				pointStrokeColor : "#fff",
				title:"one",
				data : [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
			},
			{
				fillColor : "rgba(151,187,205,0.5)",
				strokeColor : "rgba(151,187,205,1)",
				pointColor : "rgba(151,187,205,1)",
				pointStrokeColor : "#fff",
				title:"two",
				data : [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
			}
		]
	}
	// this is ugly, don't judge me
	var updateData = function(oldData){
		//console.log(piedata)
		var labels = oldData["labels"];
		var dataSetA = oldData["datasets"][0]["data"];
		var dataSetB = oldData["datasets"][1]["data"];
		
		labels.shift();
		count++;
		labels.push(count.toString());
		// this is where we generate new data
		var newDataA =  piedata[0].value - piedataOld[0].value;
		var newDataB = piedata[1].value - piedataOld[1].value;
		dataSetA.push(newDataA);
		dataSetB.push(newDataB);
		dataSetA.shift();
		dataSetB.shift();
	};
	
	// Not sure why the scaleOverride isn't working...
	var optionsNoAnimation = {
		animation : false,
		//Boolean - If we want to override with a hard coded scale
		scaleOverride : true,
		//** Required if scaleOverride is true **
		//Number - The number of steps in a hard coded scale
		scaleSteps : 20,
		//Number - The value jump in the hard coded scale
		scaleStepWidth : 10,
		//Number - The scale starting value
		scaleStartValue : 0
	}
	
	//Get the context of the canvas element we want to select
	var ctx = document.getElementById("productionChart").getContext("2d");
	var optionsNoAnimation = {animation : false}
	productionChart = new Chart(ctx);
	productionChart.Line(data, optionsNoAnimation);	
	
	setInterval(function(){
		updateData(data);
		productionChart.Line(data, optionsNoAnimation);
	},1000);
}

// setTimeout is used to put this processing in the back of the queue, after the HTML canvas is done
setTimeout(function(){
	drawcharts();
},10)

var piedata = false;
setInterval(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			data = JSON.parse(xmlhttp.responseText);
			drawcontents(data);
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
			PieChart.Pie(piedata, {
				animation: false,
				legend: {
					display: true,
					labels: {
						fontColor: 'rgb(255, 99, 132)'
					}
				},
				hover: {
					mode: "label",
				}
			});
		}
	}
	xmlhttp.open("GET", "inventory", true);
	xmlhttp.send();
}, 500)

