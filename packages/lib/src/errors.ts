/**
 * Errors thrown in Clusterio
 *
 * Each class sets its name on the prototype, like the built in errors, so
 * the stack and assertions show the class without adding an own property.
 * @module lib/errors
 */

/**
 * Thrown by commands when they fail
 */
export class CommandError extends Error {
	static { this.prototype.name = "CommandError"; }
	code = "CommandError";
}

/**
 * Thrown if the installation is broken, such as when multiple copies of lib is imported
 */
export class InstallationError extends Error {
	static { this.prototype.name = "InstallationError"; }
	code = "InstallationError";
}

/**
 * Base class for errors caused by the request, such as invalid input,
 * missing permissions or a missing resource. Corresponds to the HTTP 4xx
 * range.
 *
 * Link does not log these as unexpected when a request handler throws them.
 */
export class ClientError extends Error {
	static { this.prototype.name = "ClientError"; }
}

/**
 * Thrown when the request contains invalid data (HTTP 400)
 */
export class ValidationError extends ClientError {
	static { this.prototype.name = "ValidationError"; }
}

/**
 * Thrown when a config value cannot be used for its field
 */
export class InvalidValueError extends ValidationError {
	static { this.prototype.name = "InvalidValueError"; }
}

/**
 * Thrown when a config field does not exist
 */
export class InvalidFieldError extends ValidationError {
	static { this.prototype.name = "InvalidFieldError"; }
}

/**
 * Thrown when the request is not allowed (HTTP 403)
 */
export class ForbiddenError extends ClientError {
	static { this.prototype.name = "ForbiddenError"; }
}

/**
 * Thrown when a permission check fails
 */
export class PermissionError extends ForbiddenError {
	static { this.prototype.name = "PermissionError"; }
}

/**
 * Thrown when a config field is not accessible from the current location
 */
export class InvalidAccessError extends ForbiddenError {
	static { this.prototype.name = "InvalidAccessError"; }
}

/**
 * Thrown when a resource the request refers to does not exist (HTTP 404)
 */
export class NotFoundError extends ClientError {
	static { this.prototype.name = "NotFoundError"; }
}

/**
 * Thrown when an operation for a request timed out (HTTP 408)
 */
export class TimeoutError extends ClientError {
	static { this.prototype.name = "TimeoutError"; }
}

/**
 * Thrown when the request conflicts with the current state, such as an
 * instance that is running or a name that is taken (HTTP 409)
 */
export class ConflictError extends ClientError {
	static { this.prototype.name = "ConflictError"; }
}

/**
 * Base class for errors caused by the side handling the request.
 * Corresponds to the HTTP 5xx range.
 */
export class ServerError extends Error {
	static { this.prototype.name = "ServerError"; }
}

/**
 * Received in place of an error response whose class is not registered,
 * such as a TypeError thrown by a request handler (HTTP 500)
 */
export class InternalServerError extends ServerError {
	static { this.prototype.name = "InternalServerError"; }
}

/**
 * Thrown when the host or instance that should handle the request is not
 * connected, not running or shutting down (HTTP 503)
 */
export class UnavailableError extends ServerError {
	static { this.prototype.name = "UnavailableError"; }
}

/**
 * Signal for messages that fail validation
 */
export class InvalidMessage extends ValidationError {
	static { this.prototype.name = "InvalidMessage"; }
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
	static { this.prototype.name = "SessionLost"; }
	code = "SessionLost";
}

/**
 * Super class for all custom websocket errors
 */
export class WebSocketError extends Error {
	static { this.prototype.name = "WebSocketError"; }
	code = "WebSocketError";
}

/**
 * Thrown when WebSocket authentication failed
 */
export class AuthenticationFailed extends WebSocketError {
	static { this.prototype.name = "AuthenticationFailed"; }
	code = "AuthenticationFailed";
}

/**
 * Thrown when WebSocket protocol is violated
 */
export class ProtocolError extends WebSocketError {
	static { this.prototype.name = "ProtocolError"; }
	code = "ProtocolError";
}

/**
 * Thrown when WebSocket policy is violated
 */
export class PolicyViolation extends WebSocketError {
	static { this.prototype.name = "PolicyViolation"; }
	code = "PolicyViolation";
}

/**
 * Errror class for known errors occuring during startup
 */
export class StartupError extends Error {
	static { this.prototype.name = "StartupError"; }
	code = "StartupError";
}

/**
 * Errors outside of our control
 */
export class EnvironmentError extends Error {
	static { this.prototype.name = "EnvironmentError"; }
	code = "EnvironmentError";
}

/**
 * Errors caused by plugins
 */
export class PluginError extends Error {
	static { this.prototype.name = "PluginError"; }
	code = "PluginError";
	constructor(
		public pluginName: string,
		public original: Error
	) {
		super(`PluginError: ${original.message}`);
	}
}
