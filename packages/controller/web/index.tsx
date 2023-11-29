declare function scriptError(err: any): void;
import("@clusterio/web_ui")
	.then(webUi => webUi.bootstrap())
	.catch(scriptError)
;
