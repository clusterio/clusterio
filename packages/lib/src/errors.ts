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
 * Thrown from requests sent when an error occured handling it
 */
export class RequestError extends Error {
	constructor(
		message: string,
		public code = "RequestError",
		public stack?: string,
	) {
		super(message);
	}
}

/**
 * Thrown when a permission check fails.
 *
 * Is a subclass of RequestError to prevent logging stack traces when
 * requests fail due to permission denied.
 *
 */
export class PermissionError extends RequestError {
	constructor(
		message: string,
		code = "PermissionError",
		stack?: string,
	) {
		super(message, code, stack);
	}

}

/**
 * Signal for messages that fail validation
 */
export class InvalidMessage extends Error {
	code = "InvalidMessage";
	constructor(
		message: string,
		public errors?: object | null,
	) {
		super(message);
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
export class ProtocolViolation extends WebSocketError {
	code = "ProtocolViolation";
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
