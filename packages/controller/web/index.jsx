import("@clusterio/web_ui").then(webUi => {
	return webUi.bootstrap();
}).catch(console.error);
