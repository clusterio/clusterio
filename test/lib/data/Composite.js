"use strict";
const assert = require("assert").strict;
const { Type } = require("@sinclair/typebox");

const lib = require("@clusterio/lib");
const { jsonPrimitive, jsonArray } = lib;

describe("lib/data/composites", function() {
	describe("function jsonPrimitive", function() {
		it("should create a boolean primitive", function() {
			const booleanPrimitive = jsonPrimitive("boolean");

			assert.deepEqual(booleanPrimitive.jsonSchema, Type.Boolean());
			assert.equal(booleanPrimitive.fromJSON(true), true);
		});

		it("should create a number primitive", function() {
			const numberPrimitive = jsonPrimitive("number");

			assert.deepEqual(numberPrimitive.jsonSchema, Type.Number());
			assert.equal(numberPrimitive.fromJSON(-10), -10);
		});

		it("should create a string primitive", function() {
			const numberPrimitive = jsonPrimitive("string");

			assert.deepEqual(numberPrimitive.jsonSchema, Type.String());
			assert.equal(numberPrimitive.fromJSON("value"), "value");
		});

		it("should throw an error", function() {
			assert.throws(
				() => jsonPrimitive("not a primitive"),
				new Error(
					"Unexpected jsonPrimitive type (not a primitive) expect " +
					"\one of \"boolean\"|\"number\"|\"string\""
				),
			);
		});
	});

	describe("function jsonArray", function() {
		class TestValue {

			constructor(value) {
				this.value = value;
			}

			static jsonSchema = Type.Object({
				"value": Type.Number(),
			});

			static fromJSON(json) {
				return new this(json.value);
			}

		}

		it("should create a TestValue[]", function() {
			const valueArray = jsonArray(TestValue);
			assert.deepEqual(valueArray.jsonSchema, Type.Array(TestValue.jsonSchema));
			assert.deepEqual(
				valueArray.fromJSON([{value: 3}, {value: 2}, {value: 1}]),
				[new TestValue(3), new TestValue(2), new TestValue(1)],
			);
		});

		it("should fail to create", function() {
			assert.throws(
				() => jsonArray(undefined),
				new TypeError("Cannot read properties of undefined (reading 'jsonSchema')"),
			);
		});
	});
});
