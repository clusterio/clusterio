"use strict";
const assert = require("assert").strict;
const zlib = require("zlib");

const libFactorio = require("@clusterio/lib/factorio");


let defaultString = `
>>>eNpjZGBkUGQAgwZ7EOZgSc5PzIHxQJgrOb+gILVIN78oFVmYM
7moNCVVNz8TVXFqXmpupW5SYjGKYo7Movw8dBNYi0vy81BFSopSU
4uRRbhLixLzMktz0fUyMF5imubZ0CLHAML/6xkU/v8HYSDrAdAvI
MzA2ABRCRSDAdbknMy0NAYGBUcgdgJJMzIyVousc39YNcWeEaJGz
wHK+AAVOZAEE/GEMfwccEqpwBgmSOYYg8FnJAbE0hKgFVBVHA4IB
kSyBSTJyNj7duuC78cu2DH+Wfnxkm9Sgj2joavIuw9G6+yAkuwgf
zLBiVkzQWAnzCsMMDMf2EOlbtoznj0DAm/sGVlBOkRAhIMFkDjgz
czAKMAHZC3oARIKMgwwp9nBjBFxYEwDg28wnzyGMS7bo/sDGBA2I
MPlQMQJEAG2EO4yRgjTod+B0UEeJiuJUALUb8SA7IYUhA9Pwqw9j
GQ/mkMwIwLZH2giKg5YooELZGEKnHjBDHcNMDwvsMN4DvMdGJlBD
JCqL0AxCA8kAzMKQgs4gIObmQEBgGmjrO/lHgDxa6G4<<<
`;

let testString = `
>>>eNp1UzFs00AUvZ8mbRIEypCBSlCCyFAhOQqBKULxlQUxMCCxgnCc
S2rh2On5LAgMZOjAgISEurQLXSmCBTGwRWKhEkgIJraiMgBiaGmFOiC
FO5/PsUz6pfv+9/6/99+/kwEBOo2k6c83NhrZtOkaNkIDXa286fZ6hG
ouJaJIwTmT+i2iuZYdQ3GeOKTb15qGJ4oxQsMglbWo60iGYcSQ8Zjrh
GUhwighHpcRSBHIEZ8ajuV35dmBwIPK1DRxmMX6ADnqmre1Rb/D86UF
hNYX1lZncZpZNkGpmQ41PE87J6RFTe4YjND4hPDq943NwfIcEmv0AJV
GI7F4tMXViYVgECgCjoWWPm66DqOurXmEMcvp1A3/br1pGV5Oq1ZqVW
Hzk0ralCz5xDH79a5vM6tnW4Rma5XgQPVk8kTXtTzmU5Jg1g6tm0hfr
ZwPLGPaVrstL6p0SYwEAPeLLy9/vbeigxysgsPgIESGTYVcCYMnL/Bh
qbRKoQsq2NFBdt+LBbIp4y3CqiweBzK5LJIAu4vbD18f7Dfg77PdT1e
bt3S4/q2w5J39IbQfFW+TitzaqrA3ahSkOLf0MPVFhw/vhf3SYUqcOC
PczkoKQfXaNILCMb5df8Rd6QRS0hqKpoihHdgfNcm2Cj7ryTnKGC4K8
jnh3gmXQRElVwYyxI8x4FMqOzsu4edrKK6hNZ5wU7V9G+ufEFL+7yHi
cySQMp7wDHnRsBW571ORGn6fH2fUDj/FwV0iUbXPMbmTP7akkt8ChiL
/BPceEs3j1M3iz71/ObT9tA==<<<`;

// Simple linear congruential random number generator
class Random {
	constructor(seed) {
		this.prev = seed;
	}

	next() {
		let curr = (1103515245 * this.prev + 12345) & 0x7fffffff;
		this.prev = curr;
		return curr >> 16;
	}
}

describe("lib/factorio/exchange_string", function() {
	describe("readMapExchangeString", function() {
		it("should parse a valid string", function() {
			let result = libFactorio.readMapExchangeString(defaultString);
			assert.equal(result.map_gen_settings.seed, 1234567890);

			result = libFactorio.readMapExchangeString(testString);
			assert.equal(result.checksum, 4092204126);
		});

		it("should handle malformed strings", function() {
			assert.throws(
				() => libFactorio.readMapExchangeString("<<blah>>"),
				new Error("Not a map exchange string")
			);

			assert.throws(
				() => libFactorio.readMapExchangeString(defaultString.slice(0, 100)),
				new Error("Not a map exchange string")
			);

			assert.throws(
				() => libFactorio.readMapExchangeString(`>>>${Buffer.from("abk430ia404ah3b4").toString("base64")}<<<`),
				new Error("Malformed map exchange string: zlib inflate failed")
			);

			for (let i = 0; i < 100; i++) {
				let gen = new Random(i);
				let size = gen.next() % 200 + 100;
				let data = Buffer.alloc(size);
				for (let j = 0; j < size; j++) {
					data[j] = gen.next() % 256;
				}
				// eslint-disable-next-line node/no-sync
				data = zlib.deflateSync(data);
				assert.throws(
					() => libFactorio.readMapExchangeString(`>>>${data.toString("base64")}<<<`),
					new Error("Malformed map exchange string: reached end before finishing parsing")
				);
			}

			let pastEnd = Buffer.from(defaultString.replace(/><\n/g, ""), "base64");
			// eslint-disable-next-line node/no-sync
			pastEnd = zlib.deflateSync(Buffer.concat([zlib.inflateSync(pastEnd), Buffer.from("junk")]));
			assert.throws(
				() => libFactorio.readMapExchangeString(`>>>${pastEnd.toString("base64")}<<<`),
				new Error("Malformed map exchange string: data after end")
			);
		});
	});
});
