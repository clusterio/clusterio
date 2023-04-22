# JSON Serialisable Classes

To serialise and deserialise data the Clusterio codebase uses a JSON serialisable data class pattern.
Instances of these classes can be serialised to JSON by passing them directly to `JSON.serialise` and deserialised by passing the serialised JSON representation to its static `fromJSON` method.
The data class also has a static `jsonSchema` property describing the serialised JSON representation for validation purposes.
See the following example code for a hypothetical `Data` class with a single property `member` defaulting to a value of `"foo"`.


```js
// Data.js
"use strictc";

/**
 * A Data class example
 * @alias module:Data
 */
class Data {
    /** @type {string} */
    member = "foo";

    constructor(member) {
        if (member !== undefined) { this.member = member; }
    }

    static jsonSchema = {
        type: "object",
        properties: {
            "member": { type: "string" },
        },
    };

    static fromJSON(json) {
        return new this(json.member);
    }

    // toJSON is called by JSON.stringify when serialising this class
    toJSON() {
        let json = {};
        // Omit property if it's set to the default value
        if (this.member !== "foo") { json["member"] = this.member; }
        return json;
    }
}

module.exports = Data;
```

Serialising an instance of `Data` for JSON is as simple as doing `serialised = JSON.stringify(data)` as the `toJSON` method is automatically called by `JSON.stringify` to create a suitable object.
Deserialising is done by calling the static `fromJSON` method with the serialised JSON data, like `data = Data.fromJSON(JSON.parse(serialised))`.

By structuring the classes like this they can be easily composed together.
For example a class holding a data property with an instance of the Data class from the previous example can be created as follows.

```js
// Composed.js
"use strict";
const Data = require("./Data");

/**
 * Composed data class example
 * @alias module:Data
 */
class Composed {
    /** @type {module:Data|undefined} */
    data;

    constructor(data) {
        if (data) { this.data = data; }
    }

    static jsonSchema = {
        type: "object",
        properties: {
            "data": Data.jsonSchema,
        },
    };

    static fromJSON(json) {
        let data;
        if (json["data"]) { data = Data.fromJSON(json["data"]); }
        return new this(data);
    }

    // toJSON is optional and not needed for this particular class
}

module.exports = Composed;
```

It's easy to create a new instance of Composed by calling `new Composed(new Data("spam"))` and serialising to and from JSON is the same as for Data.
Meaning `serialised = JSON.stringify(composed)` and `composed = Composed.fromJSON(JSON.parse(serialised))` does as expected.

## Interface description

Data classes are ES6 style class declarations with the following methods and fields:

### toJSON(): any (optional)

Method returning an object or primitive suitable for passing to JSON.stringify in order to create a JSON representation of the class instance.
The returned object may contain objects that have their own toJSON methods which JSON.stringify will then call recursively.

This method is optional if calling `JSON.stringify` on an instance without it would produce the desired serialised form, however this is rarely the case as often you'll have to provide it to convert the values fram Map/Set properites, omit default values or do similar actions.

Note that the primary use case for serialising data classes is to send them over the network, this method should therefore try to reduce the size of the resulting JSON by for example omitting properties who's values are the default value.

### static fromJSON(json: any): this

Method constructing an instance of this class from one that was previously serialised by passing an instance of it to `JSON.stringify`.

While not a requirement it is preferrable if the input is not mutated and that no references to any any structures in the input ends up in the returned object.
In other words calling fromJSON twice with the same input should produce two independent objects.

Note that directly passing the output of `toJSON` to `fromJSON` is not valid, as the output of `toJSON` may require further expansion calling `toJSON` on objects returned by it.
It has to go through `JSON.stringify` or an equivalent recursive expansion of `toJSON`.

### static jsonSchema

A [JSON schema](http://json-schema.org/) describing the format of the JSON resulting from passing an instance of this class to `JSON.stringify`.
This should be lenient towards adding additional properties that would be ignored by `fromJSON` as it makes it easier to extend these classes in the future without breaking compatibility.
