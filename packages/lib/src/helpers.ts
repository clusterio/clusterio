/**
 * Collection of small utilites that are useful in multiple places.
 * @module lib/helpers
 */

/**
 * Return a string describing the type of the value passed
 *
 * Works the same as typeof, excpet that null and array types get their
 * own string.
 *
 * @param value - value to return the type of.
 * @returns basic type of the value passed.
 */
export function basicType(value: unknown) {
	if (value === null) { return "null"; }
	if (value instanceof Array) { return "array"; }
	return typeof value;
}


/**
 * Asynchronously wait for the given duration
 *
 * @param durationMs - Time to wait for in milliseconds.
 */
export async function wait(durationMs: number) {
	await new Promise(resolve => { setTimeout(resolve, durationMs); });
}


/**
 * Resolve a promise with a timeout.
 *
 * @param {Promise} promise - Promise to wait for.
 * @param {number} limitMs - Maximum time im milliseconds to wait for.
 * @param {*=} timeoutResult - Value to return if the operation timed out.
 */
export async function timeout<T>(promise: Promise<T>, limitMs: number, timeoutResult: T) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>(resolve => {
				timer = setTimeout(() => resolve(timeoutResult), limitMs);
			}),
		]);

	} finally {
		clearTimeout(timer);
	}
}

/**
 * Helper to serialise and merge waiting calls to an async callback.
 *
 * Provides a convenient interface to serialise the calls made to an async
 * callback such that no overlapping invocations of the callback is made.
 * If the callback is already running when another invocation is requested
 * the request will be queued until the callback returns and then an the
 * callback called again.
 *
 * If multiple calls are made while the callback is running then these will
 * be merged into one call of the callback.
 */
export class AsyncSerialMergingCallback {
	private _currentlyRunning = false;
	private _currentlyWaiting: (() => void)[] = [];

	/**
	 * @param callback - Async function to serialise access to
	 */
	constructor(
		public callback: () => Promise<void>,
	) { }

	/**
	 * Invoke the assosiated callback.
	 *
	 * If the callback is currently running then this will wait until the
	 * existing invocation finishes and then invoke it again. If called
	 * multiple times while an invocation is running the calls will be
	 * merged into one call.
	 */
	async invoke() {
		if (this._currentlyRunning) {
			const waitForCompletion = () => new Promise<void>(resolve => {
				this._currentlyWaiting.push(resolve);
			});
			await waitForCompletion();
			if (this._currentlyRunning) {
				await waitForCompletion();
				return;
			}
		}

		this._currentlyRunning = true;
		try {
			await this.callback();
		} finally {
			this._currentlyRunning = false;
			for (const waiter of this._currentlyWaiting) {
				waiter();
			}
			this._currentlyWaiting.length = 0;
		}
	}
}

/**
 * Helper to serialise calls to an async callback.
 *
 * Provides a convenient interface to serialise the calls made to an async
 * callback such that no overlapping invocations of the callback is made,
 * and successive calls are served on a first in first out basis.  If the
 * callback is already running when another invocation is requested the
 * request will be queued until the callback returns and then the callback
 * called again.
 */
export class AsyncSerialCallback<
	Callback extends (...args: Parameters<Callback>) => Promise<Awaited<ReturnType<Callback>>>,
> {
	private _currentlyRunning = false;
	private _currentlyWaiting: (() => void)[] = [];

	/**
	 * @param callback - Async function to serialise access to
	 */
	constructor(
		public callback: Callback,
	) { }

	/**
	 * Invoke the assosiated callback.
	 *
	 * If the callback is currently running then this will wait until the
	 * existing invocation finishes and then invoke it again. If called
	 * multiple times while an invocation is running the calls will be
	 * merged into one call.
	 */
	async invoke(...args: Parameters<Callback>) {
		if (this._currentlyRunning) {
			await new Promise<void>(resolve => {
				this._currentlyWaiting.push(resolve);
			});
		}

		this._currentlyRunning = true;
		try {
			return await this.callback(...args);
		} finally {
			this._currentlyRunning = false;
			this._currentlyWaiting.shift()?.();
		}
	}
}


/**
 * Read stream to the end and return its content
 *
 * Reads the stream given asynchronously until the end is reached and
 * returns all the data which was read from the stream.
 *
 * @param stream - byte stream to read to the end.
 * @returns content of the stream.
 */
export async function readStream(stream: NodeJS.ReadableStream & { isTTY?: boolean }) {
	let chunks: Buffer[] = [];
	for await (let chunk of stream) {
		// Support using ^Z to end input on Windows
		if (process.platform === "win32" && stream.isTTY && chunk.toString() === "\x1a\r\n") {
			break;
		}
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

/**
 * Split the given string on the first instance of separator
 *
 * Splits `string` on the first instance of `separator` and returns an
 * array consisting of the string up to the separator and the string
 * after the separator.  Returns an array with the string and an empty
 * string if the separator is not present.
 *
 * @param separator - Separator to split string by.
 * @param string - String to split
 * @returns string split on separator.
 */
export function splitOn(separator: string, string: string) {
	let index = string.indexOf(separator);
	if (index === -1) {
		return [string, ""];
	}
	return [string.slice(0, index), string.slice(index + separator.length)];
}

/**
 * Escapes text for inclusion in a RegExp
 *
 * Adds \ character in front of special meta characters in the passsed in
 * text so that it can be embedded into a RegExp and only match the text.
 *
 * See https://stackoverflow.com/a/9310752
 *
 * @param text - Text to escape RegExp meta chars in.
 * @returns escaped text.
 */
export function escapeRegExp(text: string) {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Format byte count for human readable display
 *
 * Shortens a large number of bytes using the kB/MB/GB/TB prefixes.
 * @param bytes - Count of bytes to format.
 * @param prefixes - Whethere to use SI powers (1000) or the binary powers (1024).
 * @returns formatted text.
 */
export function formatBytes(bytes: number, prefixes: "si" | "binary" = "si") {
	if (bytes === 0) {
		return "0\u{A0}Bytes"; // No-break space
	}

	let base, units;
	if (prefixes === "si") {
		base = 1000;
		units = ["\u{A0}Bytes", "\u{A0}kB", "\u{A0}MB", "\u{A0}GB", "\u{A0}TB"];
	} else {
		base = 1024;
		units = ["\u{A0}Bytes", "\u{A0}kiB", "\u{A0}MiB", "\u{A0}GiB", "\u{A0}TiB"];
	}
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length);
	const significant = bytes / base ** exponent;
	const fractionDigits = Number(significant < 99.95) + Number(significant < 9.995);
	return significant.toFixed(fractionDigits) + units[exponent];
}

function skipWhitespace(pos: number, input: string) {
	// whitespace = 1*" "
	while (pos < input.length && input.charAt(pos) === " ") {
		pos += 1;
	}
	return pos;
}

function parseSearchIdentifier(pos: number, input: string): [number, string] {
	// character = ? all characters excluding space : " ?
	// identifier = 1*character
	let startPos = pos;
	while (pos < input.length && ![" ", '"', ":"].includes(input.charAt(pos))) {
		pos += 1;
	}
	return [pos, input.slice(startPos, pos)];
}

function parseSearchWord(pos: number, input: string): [number, ParsedWord] {
	// non quote character = ? all characters excluding " ?
	// word op = "-"
	// word = [ word op ], ( identifier | '"', *non quote character, '"' )
	let exclude = false;
	let value: string;
	if (input.charAt(pos) === "-") {
		exclude = true;
		pos += 1;
	}
	if (input.charAt(pos) === '"') {
		pos += 1;
		let startPos = pos;
		let endPos = pos;
		while (pos < input.length && input.charAt(pos) !== '"') {
			pos += 1;
			endPos += 1;
		}
		if (input.charAt(pos) === '"') {
			pos += 1;
		}
		value = input.slice(startPos, endPos);
	} else {
		([pos, value] = parseSearchIdentifier(pos, input));
	}
	let word: ParsedWord = {
		type: "word",
		value,
	};
	if (exclude) {
		word.exclude = true;
	}
	return [pos, word];
}

function parseSearchTerm(
	pos: number,
	input: string,
	attributes: Record<string, string>,
	issues: Array<string>
): [number, ParsedTerm | undefined] {
	// attribute = identifier, ':', word
	// term = word | attribute
	let term: ParsedTerm | undefined;
	if (["-", '"'].includes(input.charAt(pos))) {
		([pos, term] = parseSearchWord(pos, input));
	} else {
		let identifier: string;
		([pos, identifier] = parseSearchIdentifier(pos, input));
		if (input.charAt(pos) === ":") {
			pos += 1;
			identifier = identifier.toLowerCase();
			if (!Object.prototype.hasOwnProperty.call(attributes, identifier)) {
				issues.push(`Unregonized attribute "${identifier}", use quotes to escape colons`);
			} else if (attributes[identifier] === "word") {
				let value: ParsedWord;
				([pos, value] = parseSearchWord(pos, input));
				term = { type: "attribute", name: identifier, value };
			} else {
				throw new Error(`Bad attribute format ${attributes[identifier]} for ${identifier}`);
			}
		} else {
			term = { type: "word", value: identifier };
		}
	}
	return [pos, term];
}

/**
 * Match a parsed word term with the given texts.
 *
 * Returns true if the passed word term in the search matches at least one
 * of the passed text snippets. If the word mode is exclude then returns
 * true if none of the passed text snippets match.
 *
 * @param word - Word to match.
 * @param texts - Text to match word in.
 * @returns true if the word matches.
 */
export function wordMatches(word: ParsedTerm, ...texts: string[]) {
	if (word.type !== "word") {
		throw Error("wordMatches: parameter is not a word");
	}
	let matches = false;
	for (let text of texts) {
		if (text.includes(word.value as string)) {
			matches = true;
			break;
		}
	}
	if (word.exclude) {
		matches = !matches;
	}
	return matches;
}

export interface ParsedAttribute {
	/** Type of term, either attribute or word. */
	type: "attribute"
	/** Name of attribute. */
	name: string;
	/** Parsed value of this attribute. */
	value: ParsedWord;
}

export interface ParsedWord {
	/** Type of term, either attribute or word. */
	type: "word";
	/** Exclude results with this word. */
	exclude?: boolean;
	/** Parsed text of this word. */
	value: string;
}

export type ParsedTerm = ParsedAttribute | ParsedWord;

/**
 * Result from {@link parseSearchString}.
 */
export interface ParsedSearch {
	/** Parsed result of search terms. */
	terms: Array<ParsedTerm>;
	/** Issues detected while parsing the seach string. */
	issues: Array<string>;
};

/**
 * Parse a search string with optional attributes
 *
 * Parses the given input as a search expression consisting of space
 * delimited words and attributes:word pairs.  For aattributes to be
 * recognized they need to be passed as name: "word" in the attributes
 * parameter.
 *
 * Words in the search expression can optionally be prefixed by a - to
 * search for results that does not contain that word. E.g. -author contains
 * all results not matching author.
 *
 * If parsing fails an string describing the problem will be added to the
 * issues array returned and parsing will resume at some arbitrary point.
 * The issues should be shown to the end user so that they can correct their
 * search.
 *
 * @param input - Search expression to parse.
 * @param attributes -
 *     Recognized attributes and their format. Currently only word is
 *     supported.
 * @returns parsed terms of the search.
 */
export function parseSearchString(
	input: string,
	attributes: Record<string, string> = {}
): ParsedSearch {
	// search = [ term, *( [ whitespace ], term ) ]
	input = input.trim();
	let parsed = {
		terms: [] as ParsedTerm[],
		issues: [] as string[],
	};
	let pos = 0;
	while (pos < input.length) {
		let term: ParsedTerm | undefined;
		([pos, term] = parseSearchTerm(pos, input, attributes, parsed.issues));
		if (term) {
			parsed.terms.push(term);
		}
		pos = skipWhitespace(pos, input);
	}
	// istanbul ignore if (should not be possible)
	if (pos !== input.length) {
		throw new Error(`parse search ended at ${pos} which is not the end of the input (${input.length})`);
	}
	return parsed;
}

function isDigit(pos: number, input: string) {
	const code = input.charCodeAt(pos);
	return "0".charCodeAt(0) <= code && code <= "9".charCodeAt(0);
}

function parseNumber(pos: number, input: string): [number, number] {
	// number = 1*('0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9')
	let startPos = pos;
	let endPos = pos;
	while (pos < input.length && isDigit(pos, input)) {
		pos += 1;
		endPos += 1;
	}
	return [pos, Number.parseInt(input.slice(startPos, endPos), 10)];
}

function parseRange(pos: number, input: string, min: number, max: number): [number, Set<number>] {
	// range = number, [ whitespace ], [ '-', [ whitespace ], number ]
	const range = new Set<number>();
	if (!isDigit(pos, input)) {
		throw new Error(`Expected digit but got '${input[pos]}' at pos ${pos} while parsing "${input}"`);
	}
	let start: number;
	([pos, start] = parseNumber(pos, input));
	pos = skipWhitespace(pos, input);
	if (pos < input.length && input[pos] === "-") {
		pos += 1; // Skip dash
		pos = skipWhitespace(pos, input);
		if (pos === input.length) {
			throw new Error(`Expected digit but got end of input while parsing "${input}"`);
		}
		if (!isDigit(pos, input)) {
			throw new Error(`Expected digit but got '${input[pos]}' at pos ${pos} while parsing "${input}"`);
		}
		let end: number;
		([pos, end] = parseNumber(pos, input));

		if (start > end) {
			([start, end] = [end, start]);
		}
		if (start < min) {
			throw new Error(`start of range ${start}-${end} is below the minimum value ${min}`);
		}
		if (end > max) {
			throw new Error(`end of range ${start}-${end} is above the maximum value ${max}`);
		}
		for (let i = start; i <= end; i++) {
			range.add(i);
		}
	} else { // Single value range
		if (start < min) {
			throw new Error(`value ${start} is below the minimum value ${min}`);
		}
		if (start > max) {
			throw new Error(`value ${start} is above the maximum value ${max}`);
		}
		range.add(start);
	}
	return [pos, range];
}

/**
 * Parse a comma separated range expression
 *
 * Parses the given input as a series of comma sepparated number ranges
 * where each range can consist of either a whole number or a whole number
 * of where the range starts, a dash and then a whole number of where the
 * range ends inclusively.
 *
 * @param input - Range expression to parse
 * @param min - Minimum accepted input value.
 * @param max - Maximum accepted input value.
 * @returns Set of all numbers in the parsed range.
 */
export function parseRanges(
	input: string,
	min: number,
	max: number,
) {
	// ranges = [ range, *( [ whitespace ],  [ ',', [ whitespace ] ], range ) ]
	input = input.trim();
	const parsed = new Set<number>();
	let pos = 0;
	while (pos < input.length) {
		let range: Set<number>;
		([pos, range] = parseRange(pos, input, min, max));
		for (const i of range) {
			parsed.add(i);
		}
		pos = skipWhitespace(pos, input);
		if (pos < input.length && input[pos] === ",") {
			pos += 1;
			pos = skipWhitespace(pos, input);
		}
	}
	return parsed;
}
