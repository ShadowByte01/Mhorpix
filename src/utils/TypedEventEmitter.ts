import { EventEmitter } from "node:events";

/**
 * A strongly-typed wrapper around Node's EventEmitter.
 * Mirrors the pattern used internally by Shoukaku (github.com/Deivu/Shoukaku).
 *
 * TEvents must be a map of event name → tuple of argument types, e.g.:
 *   type LundEvents = {
 *     ready: [name: string];
 *     error: [error: Error];
 *   };
 */
export abstract class TypedEventEmitter<
	TEvents extends Record<string, unknown[]>,
> extends EventEmitter {
	public override on<K extends Extract<keyof TEvents, string>>(
		event: K,
		listener: (...args: TEvents[K]) => void,
	): this {
		return super.on(event, listener as (...args: unknown[]) => void);
	}

	public override once<K extends Extract<keyof TEvents, string>>(
		event: K,
		listener: (...args: TEvents[K]) => void,
	): this {
		return super.once(event, listener as (...args: unknown[]) => void);
	}

	public override off<K extends Extract<keyof TEvents, string>>(
		event: K,
		listener: (...args: TEvents[K]) => void,
	): this {
		return super.off(event, listener as (...args: unknown[]) => void);
	}

	public override emit<K extends Extract<keyof TEvents, string>>(
		event: K,
		...args: TEvents[K]
	): boolean {
		return super.emit(event, ...args);
	}
}
