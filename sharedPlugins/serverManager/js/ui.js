let masterPlugin;

module.exports = {
	injectThis: function(x){masterPlugin = x; return this},
	ui: {
		slaveListing: [
			{
				name:"ServerMangerButton",
				getHtml: ({slave}) => {
					let html = "";
					if(masterPlugin.serverSockets[slave.unique]){
						let socket = masterPlugin.serverSockets[slave.unique];
						return `<a style="margin: 5px;" href='/serverManager?instanceID=${slave.unique}'>Server manager</a>`
					}
				},
			}
		],
	}
}
