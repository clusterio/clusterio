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
 * Base class for errors that are part of normal program flow.
 *
 * Errors of this class are passed back to the requester without being
 * logged as unexpected. Extend it for errors the caller is expected to
 * handle, such as permission checks and validation failures. Also thrown
 * from requests when the remote side responds with an error.
 */
export class ExpectedError extends Error {
	constructor(
		message: string,
		public code = "ExpectedError",
		public stack?: string,
	) {
		super(message);
	}
}

/**
 * @deprecated Use ExpectedError instead
 */
export const RequestError = ExpectedError;
/** @deprecated Use ExpectedError instead */
export type RequestError = ExpectedError;

/**
 * Thrown when a permission check fails.
 *
 * Is a subclass of ExpectedError to prevent logging stack traces when
 * requests fail due to permission denied.
 */
export class PermissionError extends ExpectedError {
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
