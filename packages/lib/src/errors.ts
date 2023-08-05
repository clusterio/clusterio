/**
 * Errors thrown in Clusterio
 * @module lib/errors
 */

/**
 * Thrown by commands when they fail
 */
export class CommandError extends Error { }

/**
 * Thrown from requests sent when an error occured handling it
 */
export class RequestError extends Error {
	constructor(
		message: string,
		public code?: string,
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
export class PermissionError extends RequestError { }

/**
 * Signal for messages that fail validation
 */
export class InvalidMessage extends Error {
	constructor(
		message: string,
		public errors: object = null,
	) {
		super(message);
	}
}

/**
 * Thrown from requests when the session it was sent on was lost
 */
export class SessionLost extends Error { }

/**
 * Thrown when WebSocket authentication failed
 */
export class AuthenticationFailed extends Error { }

/**
 * Errror class for known errors occuring during startup
 */
export class StartupError extends Error { }

/**
 * Errors outside of our control
 */
export class EnvironmentError extends Error { }

/**
 * Errors caused by plugins
 */
export class PluginError extends Error {
	constructor(
		public pluginName: string,
		public original: Error
	) {
		super(`PluginError: ${original.message}`);
	}
}
