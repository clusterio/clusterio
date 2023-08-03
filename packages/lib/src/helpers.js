/**
 * Collection of small utilites that are useful in multiple places.
 * @module lib/helpers
 */
"use strict";

/**
 * Return a string describing the type of the value passed
 *
 * Works the same as typeof, excpet that null and array types get their
 * own string.
 *
 * @param {*} value - value to return the type of.
 * @returns {string} basic type of the value passed.
 * @static
 */
function basicType(value) {
	if (value === null) { return "null"; }
	if (value instanceof Array) { return "array"; }
	return typeof value;
}


/**
 * Asynchronously wait for the given duration
 *
 * @param {number} duration - Time to wait for in milliseconds.
 * @static
 */
async function wait(duration) {
	await new Promise(resolve => { setTimeout(resolve, duration); });
}


/**
 * Resolve a promise with a timeout.
 *
 * @param {Promise} promise - Promise to wait for.
 * @param {number} time - Maximum time im milliseconds to wait for.
 * @param {*=} timeoutResult - Value to return if the operation timed out.
 * @static
 */
async function timeout(promise, time, timeoutResult) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise(resolve => {
				timer = setTimeout(() => resolve(timeoutResult), time);
			}),
		]);

	} finally {
		clearTimeout(timer);
	}
}


/**
 * Read stream to the end and return its content
 *
 * Reads the stream given asynchronously until the end is reached and
 * returns all the data which was read from the stream.
 *
 * @param {Readable} stream - byte stream to read to the end.
 * @returns {Promise<Buffer>} content of the stream.
 * @static
 */
async function readStream(stream) {
	let chunks = [];
	for await (let chunk of stream) {
		// Support using ^Z to end input on Windows
		if (process.platform === "win32" && stream.isTTY && chunk.toString() === "\x1a\r\n") {
			break;
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}


/**
 * Escapes text for inclusion in a RegExp
 *
 * Adds \ character in front of special meta characters in the passsed in
 * text so that it can be embedded into a RegExp and only match the text.
 *
 * See https://stackoverflow.com/a/9310752
 *
 * @param {string} text - Text to escape RegExp meta chars in.
 * @returns {string} escaped text.
 * @static
 */
function escapeRegExp(text) {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Format byte count for human readable display
 *
 * Shortens a large number of bytes using the kB/MB/GB/TB prefixes.
 * @param {number} bytes - Count of bytes to format.
 * @returns {string} formatted text.
 * @static
 */
function formatBytes(bytes) {
	if (bytes === 0) {
		return "0\u{A0}Bytes"; // No-break space
	}

	let units = ["\u{A0}Bytes", "\u{A0}kB", "\u{A0}MB", "\u{A0}GB", "\u{A0}TB"];
	let factor = 1000;
	let power = Math.min(Math.floor(Math.log(bytes) / Math.log(factor)), units.length);
	return (power > 0 ? (bytes / factor ** power).toFixed(2) : bytes) + units[power];
}

function parseSearchIdentifier(pos, input) {
	// character = ? all characters excluding space : " ?
	// identifier = 1*character
	let startPos = pos;
	while (pos < input.length && ![" ", '"', ":"].includes(input.charAt(pos))) {
		pos += 1;
	}
	return [pos, input.slice(startPos, pos)];
}

function parseSearchWord(pos, input) {
	// non quote character = ? all characters excluding " ?
	// word op = "-"
	// word = [ word op ], ( identifier | '"', *non quote character, '"' )
	let word = {
		type: "word",
	};
	if (input.charAt(pos) === "-") {
		word.exclude = true;
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
		word.value = input.slice(startPos, endPos);
	} else {
		([pos, word.value] = parseSearchIdentifier(pos, input));
	}
	return [pos, word];
}

function parseSearchTerm(pos, input, attributes, issues) {
	// attribute = identifier, ':', word
	// term = word | attribute
	let term;
	if (["-", '"'].includes(input.charAt(pos))) {
		([pos, term] = parseSearchWord(pos, input));
	} else {
		let identifier;
		([pos, identifier] = parseSearchIdentifier(pos, input));
		if (input.charAt(pos) === ":") {
			pos += 1;
			identifier = identifier.toLowerCase();
			if (!Object.prototype.hasOwnProperty.call(attributes, identifier)) {
				issues.push(`Unregonized attribute "${identifier}", use quotes to escape colons`);
			} else if (attributes[identifier] === "word") {
				let value;
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
 * @param {lib/helpers.ParsedTerm} word - Word to match.
 * @param {...string} texts - Text to match word in.
 * @returns {boolean} true if the word matches.
 */
function wordMatches(word, ...texts) {
	if (word.type !== "word") {
		throw Error("wordMatches: parameter is not a word");
	}
	let matches = false;
	for (let text of texts) {
		if (text.includes(word.value)) {
			matches = true;
			break;
		}
	}
	if (word.exclude) {
		matches = !matches;
	}
	return matches;
}

/**
 * @typedef {object} ParsedTerm
 * @property {string} type - Type of term, either attribute or word.
 * @property {string=} name - attribute only: Name of attribute.
 * @property {boolean=} exclude - word only: exclude results with this word.
 * @property {string | ParsedTerm} value -
 *     Parsed value of this term. Is a string if type is word, and a
 *     ParsedTerm if type is attribute.
 */

/**
 * @typedef {object} ParsedSearch
 * @property {Array<ParsedTerm>} terms -
 *     Parsed result of search terms.
 * @property {Array<string>} issues -
 *     Issues detected while parsing the seach string.
 */

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
 * @param {string} input - Search expression to parse.
 * @param {Object<string, string>} attributes -
 *     Recognized attributes and their format. Currently only word is
 *     supported.
 * @returns {ParsedSearch} parsed terms of the search.
 * @static
 */
function parseSearchString(input, attributes = {}) {
	// whitespace = 1*" "
	// search = [ term, *( [ whitespace ], term ) ]
	input = input.trim();
	let parsed = {
		terms: [],
		issues: [],
	};
	let pos = 0;
	while (pos < input.length) {
		let term;
		([pos, term] = parseSearchTerm(pos, input, attributes, parsed.issues));
		if (term) {
			parsed.terms.push(term);
		}
		while (pos < input.length && input.charAt(pos) === " ") {
			pos += 1;
		}
	}
	// istanbul ignore if (should not be possible)
	if (pos !== input.length) {
		throw new Error(`parse search ended at ${pos} which is not the end of the input (${input.length})`);
	}
	return parsed;
}


module.exports = {
	basicType,
	wait,
	timeout,
	readStream,
	escapeRegExp,
	formatBytes,
	wordMatches,
	parseSearchString,
};
