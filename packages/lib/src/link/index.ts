/**
 * Library for message based communication between nodes
 * @module lib/link
 * @author Hornwitser
 */
export * from "./link"
export * from "./connectors"

// migrate: Allow info for plugins from before link refactor to load.
export class Event {}
export class Request {}
