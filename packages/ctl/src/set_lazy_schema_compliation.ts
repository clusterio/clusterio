// This needs to be a separate file due to ECMAScript Modules evaluating code in
// imported modules before any code in the file that imports it.
(global as any).lazySchemaCompilation = true;
