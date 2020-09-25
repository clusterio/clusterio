import { notification } from "antd";

/**
 *
 * @param {string} message
 * @param {("info"|"error"|"success"|"warning"|"warn")} type
 */
export default function notify(message, type = "info", description) {
  notification[type]({
    message: typeof message === "string" ? message : "ERROR: See console",
    description,
    placement: "bottomRight",
  });
  if (typeof message !== "string") console.error(message)
}
