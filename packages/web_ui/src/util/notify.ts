import { notification } from "antd";
import { logger } from "@clusterio/lib";


export default function notify(
	message: string | Error,
	type: "success"|"info"|"warning"|"error" = "info",
	description?: string,
) {
	notification[type]({
		message: typeof message === "string" ? message : "ERROR: See console",
		description,
		placement: "bottomRight",
	});
	if (typeof message !== "string") {
		logger.error(message.stack);
	}
}

/**
 * Promise rejection handler notifying the user
 *
 * Shows the error occuring in a notification card.
 *
 * @param message -
 *     User facing message to give context to the error.  Should say which
 *     operation failed.
 * @returns function showing the error passed to it.
 */
export function notifyErrorHandler(message: string): (err:Error) => void {
	return function handler(err: Error) {
		logger.error(err.stack);
		notification.error({
			message,
			description: err.message,
			duration: 0,
			placement: "bottomRight",
		});
	};
}
