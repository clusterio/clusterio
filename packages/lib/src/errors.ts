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
 * Thrown from requests sent when an error occured handling it
 */
export class RequestError extends Error {
	code: string;
	stack?: string;

	constructor(
		message: string,
		code = "RequestError",
		stack?: string,
	) {
		super(message);
		this.code = code;
		this.stack = stack;
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
	errors?: object | null;
	code = "InvalidMessage";
	constructor(
		message: string,
		errors?: object | null,
	) {
		super(message);
		this.errors = errors;
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
	pluginName: string;
	original: Error;
	code = "PluginError";
	constructor(
		pluginName: string,
		original: Error,
	) {
		super(`PluginError: ${original.message}`);
		this.pluginName = pluginName;
		this.original = original;
	}
}
