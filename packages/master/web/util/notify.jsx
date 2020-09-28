import { notification } from "antd";

export default function notify(message, type = "info", description = undefined) {
	notification[type]({
		message: typeof message === "string" ? message : "ERROR: See console",
		description,
		placement: "bottomRight",
	});
	if (typeof message !== "string") console.error(message);
}
