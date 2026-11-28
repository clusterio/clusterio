// Matches util.isDeepStrictEqual for JSON values and for class instances,
// Maps and Sets of primitives. It differs on -0, Sets of objects, symbol keys,
// non-enumerable properties, sparse arrays and objects without a prototype.
export { default } from "fast-deep-equal/es6/index.js";
