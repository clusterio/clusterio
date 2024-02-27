# Templates

Create has the ability to create new plugins from templates to avoid needing to manually copy lots of boiler plate. This folder contains all those templates for both Javascript and Typescript plugins. These templates have custom preprocessor instructions that can be used to alter a template based on developer input, this syntax is described below.

- [The Basics](#the-basics)
- [Insert Instruction](#insert-instruction) (`__variable__`)
- [Conditional Instruction](#conditional-instruction) (`//%if` `//%endif`)
- [Available Variables](#available-variables)

## The Basics

All files can contain preprocessor instructions whether json, js, lua, or anything else. All instructions use the same syntax although it has been designed to work well with js and ts files.

Except for the insert instruction, all preprocessors use a `//%` prefix and must be on their own line. These lines are never included in the output. Parsing is stopped when `//` is encountered to allow for comments on preprocessors. Eg. `//%if foo // this is a comment`.

Empty instructions, aka just comments, can be inserted into templates using `//%//` and are not included in the output file.

`templates/plugin-js` contains all the files which will be used by a javascript only plugin.
`templates/plugin-ts` contains all the files which will be used by a plugin that supports typescript.
`templates/common` contains files used by both types of plugins, this is mostly lua code or root files like `package.json`

Files are not copied via wildcards and instead are explicitly listed within `template.js` so any new templates will need to be added there.

## Insert Instruction

There are a number of template variables available to be inserted into templates. All variables are raw string values, that is they are inserted directly into the output file without any modifications. To signify a place to insert a variable you need only surround its identifier with double underscores, examples below.

Example Variables:

```sh
my_number=1
my_string=foo
my_property=bar: "baz"
```

Example Template:

```ts
const __my_string__: number = __my_number__;
console.log(__my_string__);

console.log({
    foo: "Hello, __my_string__!",
    __my_property__,
    my_property: __my_string__,
});
```

Example Output:

```ts
const foo: number = 1;
console.log(foo);

console.log({
    foo: "Hello, foo!",
    bar: "baz",
    my_property: foo,
});
```

## Conditional Instruction

Conditionals allow for code to be included/omitted based on the value of template variables. Currently only boolean logic in [disjunctive normal form](https://en.wikipedia.org/wiki/Disjunctive_normal_form) is supported and any variables that are not booleans are evaluated with the [Boolean constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean).

Variables used in condition statements do not require double underscores. Their values can be inverted using `!`. Arithmetic and comparison operations are not supported. Parentheses are also not supported, conditions must be in DNF.

Conversion to DNF:
`A & (B | !C)` -> `A & B | A & !C` evaluated as `(A and B) or (A and not C)`

Example Variables:

```sh
my_string=foo
say_hello=true
say_done=true
verbose=false
```

Example Template:

```ts
//%if verbose
console.log("Starting...");
//%endif
//%if say_hello & my_string
console.log("Hello, __my_string__!");
//%endif
//%if say_done | verbose
console.log("Done.");
//%endif
```

Example Output:

```ts
console.log("Hello, foo!");
console.log("Done.");
```

## Available Variables

| Identifier | Example | Description |
| - | - | - |
| typescript | `true` / `false` | `true` if typescript templates are included |
| controller | `true` / `false` | `true` if controller templates are included |
| host | `true` / `false` | `true` if host templates are included |
| instance | `true` / `false` | `true` if instance templates are included |
| module | `true` / `false` | `true` if module templates are included |
| ctl | `true` / `false` | `true` if control templates are included |
| web | `true` / `false` | `true` if web templates are included |
| plugin_name | `my_plugin` | name of the plugin |
| prepare | `tsc --build` | commands to run for the prepare script |
| ext | `ts` / `js` | file extension of source files |
