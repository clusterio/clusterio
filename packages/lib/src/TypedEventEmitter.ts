import EventEmitter from "events";

/**
 * Type checked version of EventEmitter
 *
 * @example
 * ```ts
 * interface Events {
 *     "foo": (a: number, b: number) => void,
 *     "bar": (spam: string) => void,
 * }
 *
 * class Emitter extends TypedEventEmitter<keyof Events, Events> {}
 *
 * const e = new Emitter();
 * e.emit("foo", 1, 2) // type checked arguments
 * ```
 */
export default abstract class TypedEventEmitter<
	Keys extends string,
	Events extends Record<Keys, (...args: [...any]) => void>,
> extends EventEmitter {
	declare ["on"]: <E extends Keys>(event: E, listener: Events[E]) => this;
	declare ["off"]: <E extends Keys>(event: E, listener: Events[E]) => this;
	declare ["once"]: <E extends Keys>(event: E, listener: Events[E]) => this;
	declare ["emit"]: <E extends Keys>(event: E, ...args: Parameters<Events[E]>) => boolean;
}
