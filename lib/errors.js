/**
 * Errors thrown in Clusterio
 * @module
 */

class CommandError extends Error { }
class RequestError extends Error { }

// Signal for messages that fail validation
class InvalidMessage extends Error { }

// Errror class for known errors occuring during startup
class StartupError extends Error { }

module.exports = {
	CommandError,
	RequestError,
	InvalidMessage,
	StartupError,
}
