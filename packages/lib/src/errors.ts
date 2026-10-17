/**
 * Errors thrown in Clusterio
 * @module lib/errors
 */

/**
 * Thrown by commands when they fail
 */
export class CommandError extends Error {
	code = "CommandError";
}

/**
 * Thrown if the installation is broken, such as when multiple copies of lib is imported
 */
export class InstallationError extends Error {
	code = "InstallationError";
}

/**
 * Base class for errors caused by the request, such as invalid input,
 * missing permissions or a missing resource. Corresponds to the HTTP 4xx
 * range.
 *
 * Link does not log these as unexpected when a request handler throws them.
 */
export class ClientError extends Error { }

/**
 * Thrown when the request contains invalid data (HTTP 400)
 */
export class ValidationError extends ClientError { }

/**
 * Thrown when a config value cannot be used for its field
 */
export class InvalidValueError extends ValidationError { }

/**
 * Thrown when a config field does not exist
 */
export class InvalidFieldError extends ValidationError { }

/**
 * Thrown when the request is not allowed (HTTP 403)
 */
export class ForbiddenError extends ClientError { }

/**
 * Thrown when a permission check fails
 */
export class PermissionDeniedError extends ForbiddenError { }

/**
 * Thrown when a config field is not accessible from the current location
 */
export class InvalidAccessError extends ForbiddenError { }

/**
 * Thrown when a resource the request refers to does not exist (HTTP 404)
 */
export class NotFoundError extends ClientError { }

/**
 * Thrown when an operation for a request timed out (HTTP 408)
 */
export class TimeoutError extends ClientError { }

/**
 * Thrown when the request conflicts with the current state, such as an
 * instance that is running or a host that is not connected (HTTP 409)
 */
export class ConflictError extends ClientError { }

/**
 * Base class for errors caused by the side handling the request.
 * Corresponds to the HTTP 5xx range.
 */
export class ServerError extends Error { }

/**
 * Received in place of an error response whose class is not registered,
 * such as a TypeError thrown by a request handler (HTTP 500)
 */
export class InternalServerError extends ServerError { }

/**
 * Signal for messages that fail validation
 */
export class InvalidMessage extends ValidationError {
	code = "InvalidMessage";
	constructor(
		message: string,
		public errors?: object | null,
	) {
		super(message);
		// Include the errors in the stack so generic handlers logging it show what failed
		if (errors) {
			this.stack += `\n${JSON.stringify(errors, null, "\t")}`;
		}
	}
}

/**
 * Thrown from requests when the session it was sent on was lost
 */
export class SessionLost extends Error {
	code = "SessionLost";
}

/**
 * Super class for all custom websocket errors
 */
export class WebSocketError extends Error {
	code = "WebSocketError";
}

/**
 * Thrown when WebSocket authentication failed
 */
export class AuthenticationFailed extends WebSocketError {
	code = "AuthenticationFailed";
}

/**
 * Thrown when WebSocket protocol is violated
 */
export class ProtocolError extends WebSocketError {
	code = "ProtocolError";
}

/**
 * Thrown when WebSocket policy is violated
 */
export class PolicyViolation extends WebSocketError {
	code = "PolicyViolation";
}

/**
 * Errror class for known errors occuring during startup
 */
export class StartupError extends Error {
	code = "StartupError";
}

/**
 * Errors outside of our control
 */
export class EnvironmentError extends Error {
	code = "EnvironmentError";
}

/**
 * Errors caused by plugins
 */
export class PluginError extends Error {
	code = "PluginError";
	constructor(
		public pluginName: string,
		public original: Error
	) {
		super(`PluginError: ${original.message}`);
	}
}
