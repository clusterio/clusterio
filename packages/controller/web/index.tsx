/* eslint-disable arrow-body-style, no-console */
import("@clusterio/web_ui").then(webUi => {
	return webUi.bootstrap();
}).catch(console.error);
