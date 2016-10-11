
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
	ctx = document.querySelector("#contentGraph").getContext('2d');
    PieChart = new Chart(ctx);
}

setInterval(function() {
	var xmlhttp = new XMLHttpRequest();
	xmlhttp.onreadystatechange = function() {
		if(xmlhttp.readyState == 4 && xmlhttp.status == 200) {
			data = JSON.parse(xmlhttp.responseText);
			drawcontents(data);
			// render our piechart with up to date information
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

// create chart of items in master storage
// setTimeout is used to put this processing in the back of the queue, after the HTML canvas is done
setTimeout(function(){
	drawcharts();
},10)