// string, object, function(object)
function post(url, data, callback) {
	console.log("POST " + url + JSON.stringify(data));
	var xhr = new XMLHttpRequest();
	xhr.open("POST", url, true);
	xhr.setRequestHeader("Content-type", "application/json");
	xhr.onreadystatechange = function () {
		if (xhr.readyState === 4 && xhr.status === 200) {
			var json = JSON.parse(xhr.responseText);
			callback(json);
		}
	};
	xhr.send(JSON.stringify(data));
}
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




/// code below here
// declaring globals
var chartsByID = {};
// update the online indicator dot
setInterval(function(){
	getJSON("/api/slaves", function(err, slaveData){
		let indicator = document.querySelector("#online-indicator");
		$(indicator).removeClass('fa-signal');
		$(indicator).removeClass('fa-dizzy');
		$(indicator).removeClass('fa-plug');
		if(err){
			// our request threw an error, most likely master is unavailable so we show yellow indicator
			indicator.style.color = "yellow";
			$(indicator).addClass('fa-plug');
			indicator.title = "Master server unavailable";
			// compare with Math.floor(x/100000) allows us to check if they are within 10s of each other
		} else if(Math.floor(slaveData[getParameterByName("instanceID")].time/100000) === Math.floor(Date.now()/100000)){
			indicator.style.color = "green";
			$(indicator).addClass('fa-signal');
			indicator.title = "Slave is online";
		} else {
			indicator.style.color = "red";
			$(indicator).addClass('fa-dizzy');
			indicator.title = "Slave is offline";
		}
	});
}, 1000);

function regexModDetails(modFileName) {
	let m;
	let results = [];
	const regex = /(.+)_(\d+\.\d+\.\d+)\.zip/gm;
	while ((m = regex.exec(modFileName)) !== null) {
		// This is necessary to avoid infinite loops with zero-width matches
		if (m.index === regex.lastIndex) {
			regex.lastIndex++;
		}

		// The result can be accessed through the `m`-variable.
		m.forEach((match, _) => {
			results.push(match);
		});
	}
	return results
}

populateSlaveInfo();
function populateSlaveInfo(){
	let instanceID = getParameterByName("instanceID");
	if(!instanceID){
		throw "We need instanceID! Also, *funny joke* but it doesn't work after I standardized on calling it instanceID";
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
		let slave = slaveData[instanceID];
		let HTML = '<div class="jumbotron mt-5"><div id="header">' +
			'<h1 class="display-4"><i id="online-indicator" class="mr-3 fas"></i> ' + slave.instanceName+"</h1>";
		HTML += '<div class="stats" id="node-stats">' +
			'<nav class="mt-3" aria-label="breadcrumb">\n' +
			'  <ol class="breadcrumb align-content-center"><li class="breadcrumb-item">Host: '+slave.mac+'</li>' +
			'<li class="breadcrumb-item">Unique: '+slave.unique+'</li>';
		if(slave.publicIP !== "localhost"){
			HTML += '<li class="breadcrumb-item">IP: '+slave.publicIP+':'+slave.serverPort+'</li>';
		} else {
			HTML += '<li class="breadcrumb-item">This server is not configured for incoming connections</li>';
		}
        if(slave.meta)
            for(let key in slave.meta){
                let t = slave.meta[key];
                if(typeof t == "string"){
                    HTML += "<li class=\"breadcrumb-item\">"+key+": "+t+"</li>";
                }
            }
		HTML += '<li class="breadcrumb-item">Last seen: <span id="lastSeenDate">'+moment(Number(slave.time)).fromNow()+"</span></li>";
		HTML += '<li class="breadcrumb-item">Online players: '+slave.playerCount+"</li></ol></nav>";

		HTML += "</div>"; // end of displayBody
		
		// list mods and other metadata
		HTML += '<h2 class="subtitle d-inline">Mods</h2><a id="fetch-mod-data" class="btn btn-primary float-right m-2">Fetch Mod Data</a>' +
			'<table id="modlist" class="table table-striped table-hover">' +
			'  <thead>\n' +
			'    <tr>\n' +
			'      <th scope="col">#</th>\n' +
			'      <th scope="col">Version</th>\n' +
			'      <th scope="col">Name</th>\n' +
			'      <th scope="col">Summary</th>\n' +
			'    </tr>\n' +
			'  </thead>' +
			'  <tbody>';
		for(let i = 0; i < slave.mods[0].modName.length; i++){
			let modRegexResults = regexModDetails(slave.mods[0].modName[i]);
			HTML += `<tr>
					<th scope="row">${i + 1}</th>
					<td>${modRegexResults[2]}</td>
					<td>${modRegexResults[1]}</td>
					<td></td>
				</tr>`
		}
		HTML += "</ul>";
		
		HTML += "</div>"; // end of left container
		
		// chart
		HTML += '<div id="' + slave.unique + '" class="productionGraph" style="width: calc(100% - 300px);"></div>';
		// terminal
		// HTML += '<div id="terminal"></div>';


		
		document.querySelector("#body > #details").innerHTML = HTML;
		
		// make production graph
		makeGraph(slave.unique, slave.unique)
		
		// makeTerminal();

        $('#fetch-mod-data').on("click", downloadSaveModData);
	});
}


function downloadSaveModData() {
    let modRows = $("#modlist tbody tr");
    for (let i = 0; i < modRows.length; i++) {
		let modName = modRows[i].children[2].innerText;
        $.getJSON( "/api/modmeta?modname=" + modName, function( data ) {
            modRows[i].children[2].innerHTML = data.title;
            modRows[i].children[3].innerHTML = data.summary
        });
    }
}

var slaveLogin = {};
function makeTerminal(){
	myTerminal = new Terminal();
	document.querySelector("#terminal").appendChild(myTerminal.html);
	// use jQuery to allow the user to drag the window around
	$("#terminal").draggable({
		handle:".titleBar",
	});
	myTerminal.print('Welcome to Clusterio rcon!');
	myTerminal.input('', handleTerminalInput);
	if(localStorage.terminalMinimized && localStorage.terminalMinimized === "true"){
		minimizeTerminal(true);
	}
	function print(string){
		myTerminal.print(string);
	}
	
	function handleTerminalInput(inputString) {
		// show clearly that it was a command that was typed, not terminal output
		let lastLine = document.querySelector("#terminal div > p:nth-child(1) > div:last-child");
		lastLine.innerHTML = "> " + lastLine.innerHTML;
		
		argv = inputString.split(' ');
		if(argv[0][0] === '/'){
			if(slaveLogin && slaveLogin.name && slaveLogin.pass){
				print('Running: '+inputString);
			} else {
				print('Not identified to communicate with any slave! Run "help" for more information.');
			}
		} else if(argv[0] === 'help'){
			if(argv[1] === 'login'){
				print('To send commands to a slave, you are required to identify yourself. You can do this with the login command. The name will be the name of the slave as displayed on master. The password is the rcon password of the slave, as per /instances/[name]/config.json');
			} else if(argv[1] === "/c"){
				print('To run a command, start with /. You can for example do /c game.print("hello world!")');
			} else if(argv[1] === "issues"){
				print("Issues are reported to clusterio on github or espernet IRC.");
				print(" - http://github.com/clusterio/factorioClusterio/issues");
				print(" - EsperNet #factorio Danielv123");
			} else {
				print('To identify yourself to a slave, use "login [name] [password]"');
				print(' - /c [command] - Run command');
				print(' - login [name] [passs] - Connect to remote slave');
				print(' - issues - Report an issue');
			}
		} else if(argv[0] === 'issues'){
			print("Issues are reported to clusterio on github or espernet IRC.");
			print(" - http://github.com/clusterio/factorioClusterio/issues");
			print(" - EsperNet #factorio Danielv123");
		} else {
			print('Invalid command!');
		}
		
		// keep handling input (unless something is seriously wrong)
		myTerminal.input('',handleTerminalInput);
	}
}
function minimizeTerminal(instant){
	localStorage.terminalMinimized = true;
	$('#terminal').draggable('disable');
	if(!instant){
		$('#terminal')[0].style.transition = 'left 0.2s linear, top 0.2s linear';
	}
	document.querySelector('.Terminal').style.height = 0;
	let ter = $('#terminal')[0];
	// if the window just spawned in and we are doing the first minimize,  our position won't be set yet. We also don't want to save this blank position.
	if(ter.style.left && ter.style.top){
		localStorage.oldTerminalPosition = JSON.stringify({x:ter.style.left, y:ter.style.top});
	}
	ter.style.left = (window.innerWidth - ter.offsetWidth)+'px';
	ter.style.top = (window.innerHeight - 25)+'px';
	
	// if we did it instant we still want to set this property for after.
	if(instant){
		setTimeout(() => $('#terminal')[0].style.transition = 'left 0.2s linear, top 0.2s linear',200);
	}
}
function maximizeTerminal(instant){
	localStorage.terminalMinimized = false;
	document.querySelector('.Terminal').style.height = '400px';
	let ter = $('#terminal')[0];
	
	// recover our old saved position
	let oldTerminalPosition = JSON.parse(localStorage.oldTerminalPosition);
	ter.style.left = oldTerminalPosition.x;
	ter.style.top = oldTerminalPosition.y;
	
	// remove our animation once its finished
	// since instant is a true/false value, Number will convert it to 1 or 0. Since 0 is falsy, || will turn it into 200.
	setTimeout(() => $('#terminal')[0].style.transition = 'none', (Number(instant) || 200));
	$('#terminal').draggable('enable');
}

// ID of slave, ID of canvasjs div without #
function makeGraph(instanceID, selector) {
	let chartIgnoreList = [
		"water",
		"steam"
	];
	post("api/getStats", {instanceID: instanceID}, function(data){
		//console.log("Building chart " + instanceID + " with this data:")
		//console.log(data)
		if(data.length > 0) {
			// find keys
			let itemNames = [];
			for(let key in data[data.length - 1].data) {
				itemNames[itemNames.length] = key
			}
			let chartData = [];
			for(let o = 0; o < itemNames.length; o++) {
				if(!chartIgnoreList.includes(itemNames[o])){
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
			let y = data[i].data[nameKey];
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
	if(nameKey === "copper-wire"||nameKey === "iron-plate"||nameKey === "copper-plate"||nameKey === "electronic-circuit"||nameKey === "steel-plate"||nameKey === "advanced-circuit"||nameKey === "crude-oil"||nameKey === "petroleum-gas"){
		xyz.showInLegend = true;
	}
	xyz.dataPoints = chartData;
	return xyz;
}

function drawChart(selector, chartData, title) {
	// selector is ID of element, ex "chartContainer" or "-123199123"
	console.log(chartData);
	chartsByID[selector] = new CanvasJS.Chart(selector, {
		title:{
			text: title || "Production graph"
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
	return chart;
}
