"use strict";
module.exports = {
	"plugins": [
		"@typescript-eslint",
		"node",
	],
	"root": true,
	"env": {
		"node": true,
		"commonjs": true,
		"es2022": true,
	},

	"overrides": [
		{
			"files": ["{packages,plugins}/**/*.ts?(x)"],
			"parser": "@typescript-eslint/parser",
			"extends": [
				"plugin:@typescript-eslint/recommended",
			],
			"rules": {
				"@typescript-eslint/no-explicit-any": "off",
				"@typescript-eslint/no-useless-constructor": "error",
				"@typescript-eslint/no-unused-vars": "off",
				"@typescript-eslint/triple-slash-reference": "off",
				"@typescript-eslint/no-shadow": ["error", { "allow": ["Event", "Request", "yargs"] }],
				"prefer-const": "off",
				"no-shadow": "off",
			},
		},
		{
			"files": ["test/**/*.js", "plugins/*/test/**/*.js"],
			"env": {
				"mocha": "true",
			},
			"parserOptions": { sourceType: "commonjs" },
			"rules": {
				"prefer-arrow-callback": "off",
				"no-invalid-this": "off",
				"valid-jsdoc": "off",
				"node/no-unpublished-import": "off",
				"node/no-unpublished-require": "off",
			},
		},
		{
			"files": [
				"packages/web_ui/src/**/*.ts?(x)",
				"packages/lib/browser.ts",
				"packages/create/templates/*/web/**/*.{t,j}s?(x)",
				"{packages,plugins}/*/web/**/*.ts?(x)",
			],
			"env": {
				"browser": true,
			},
			"parserOptions": {
				"sourceType": "module",
				"ecmaFeatures": {
					"jsx": true,
				},
			},
			"rules": {
				"node/callback-return": "off",
				"node/exports-style": "off",
				"node/file-extension-in-import": "off",
				"node/global-require": "off",
				"node/handle-callback-err": "off",
				"node/no-callback-literal": "off",
				"node/no-deprecated-api": "off",
				"node/no-exports-assign": "off",
				"node/no-extraneous-import": "off",
				"node/no-extraneous-require": "off",
				"node/no-missing-import": "off",
				"node/no-missing-require": "off",
				"node/no-mixed-requires": "off",
				"node/no-new-require": "off",
				"node/no-path-concat": "off",
				"node/no-process-env": "off",
				"node/no-process-exit": "off",
				"node/no-restricted-require": "off",
				"node/no-sync": "off",
				"node/no-unpublished-bin": "off",
				"node/no-unpublished-import": "off",
				"node/no-unpublished-require": "off",
				"node/no-unsupported-features/es-builtins": "off",
				"node/no-unsupported-features/es-syntax": "off",
				"node/no-unsupported-features/node-builtins": "off",
				"node/prefer-global/buffer": "off",
				"node/prefer-global/console": "off",
				"node/prefer-global/process": "off",
				"node/prefer-global/text-decoder": "off",
				"node/prefer-global/text-encoder": "off",
				"node/prefer-global/url-search-params": "off",
				"node/prefer-global/url": "off",
				"node/prefer-promises/dns": "off",
				"node/prefer-promises/fs": "off",
				"node/process-exit-as-throw": "off",
				"node/shebang": "off",
			},
		},
		{
			"files": [
				"packages/create/templates/**/*.{t,j}s?(x)",
			],
			"rules": {
				"node/no-missing-require": "off",
				"node/no-missing-import": "off",
				"spaced-comment": "off",
				"comma-spacing": "off",
				"max-len": "off",
				"indent": "off",
			},
		},
	],

	"rules": {
		"accessor-pairs": "error",
		"array-bracket-newline": "off",
		"array-bracket-spacing": ["error", "never"],
		"array-callback-return": "error",
		"array-element-newline": "off",
		"arrow-body-style": "error",
		"arrow-parens": "off",
		"arrow-spacing": ["error", { "after": true, "before": true }],
		"block-scoped-var": "error",
		"block-spacing": "error",
		"brace-style": ["error", "1tbs", { "allowSingleLine": true }],
		"camelcase": "off",
		"capitalized-comments": "off",
		"class-methods-use-this": "off",
		"comma-dangle": [
			"error",
			{
				"arrays": "always-multiline",
				"objects": "always-multiline",
				"imports": "always-multiline",
				"exports": "always-multiline",
				"functions": "only-multiline",
			},
		],
		"comma-spacing": "error",
		"comma-style": ["error", "last"],
		"complexity": "error",
		"computed-property-spacing": ["error", "never"],
		"consistent-return": "error",
		"consistent-this": "error",
		"curly": "error",
		"default-case": "error",
		"default-case-last": "error",
		"default-param-last": "off",
		"dot-location": ["error", "property"],
		"dot-notation": ["error", { "allowPattern": "^[a-z]+(_[a-z]+)*$" }],
		"eol-last": "error",
		"eqeqeq": "error",
		"func-call-spacing": "error",
		"func-name-matching": "error",
		"func-names": "off",
		"func-style": ["error", "declaration", {
			// Allow arrow functions as it better expresses referencing this
			// of the containing scope, which is unweilding in plain functions.
			"allowArrowFunctions": true,
		}],
		"function-call-argument-newline": "off",
		"function-paren-newline": "off",
		"generator-star-spacing": ["error", { "before": false, "after": true }],
		"grouped-accessor-pairs": "error",
		"guard-for-in": "error",
		"id-blacklist": "error",
		"id-length": "off",
		"id-match": "error",
		"implicit-arrow-linebreak": "error",
		"indent": ["error", "tab", { "SwitchCase": 1 }],
		"indent-legacy": "off",
		"init-declarations": "off",
		"jsx-quotes": "error",
		"key-spacing": "error",
		"keyword-spacing": "error",
		"line-comment-position": "off",
		"linebreak-style": ["error", "unix"],
		"lines-around-comment": "off",
		"lines-around-directive": "off",
		"lines-between-class-members": ["error", "always", { "exceptAfterSingleLine": true }],
		"max-classes-per-file": "off",
		"max-depth": "error",
		"max-len": ["error", { "code": 120 }],
		"max-lines": "off",
		"max-lines-per-function": "off",
		"max-nested-callbacks": "error",
		"max-params": "off",
		"max-statements": "off",
		"max-statements-per-line": "off",
		"multiline-comment-style": ["error", "separate-lines"],
		"multiline-ternary": "off",
		"new-cap": ["error", {
			"capIsNewExceptions": ["StringEnum", "StringKey"],
			"capIsNewExceptionPattern": "^Type\\.",
		}],
		"new-parens": "error",
		"newline-after-var": "off",
		"newline-before-return": "off",
		"newline-per-chained-call": "off",
		"no-alert": "error",
		"no-array-constructor": "error",
		"no-await-in-loop": "off",
		"no-bitwise": "off",
		"no-buffer-constructor": "error",
		"no-caller": "error",
		"no-catch-shadow": "off",
		"no-confusing-arrow": "error",
		"no-console": "error",
		"no-constant-condition": ["error", { "checkLoops": false }],
		"no-constructor-return": "error",
		"no-continue": "off",
		"no-div-regex": "error",
		"no-duplicate-imports": "error",
		"no-else-return": "error",
		"no-empty-function": "off",
		"no-eq-null": "error",
		"no-eval": "error",
		"no-extend-native": "error",
		"no-extra-bind": "error",
		"no-extra-label": "error",
		"no-extra-parens": "off",
		"no-floating-decimal": "error",
		"no-implicit-coercion": "error",
		"no-implicit-globals": "error",
		"no-implied-eval": "error",
		"no-inline-comments": "off",
		"no-invalid-this": "error",
		"no-iterator": "error",
		"no-label-var": "error",
		"no-lone-blocks": "error",
		"no-lonely-if": "error",
		"no-loop-func": "error",
		"no-magic-numbers": "off",
		"no-mixed-operators": [
			"error",
			{
				"groups": [
					["&", "|", "^", "~", "<<", ">>", ">>>"],
					["==", "!=", "===", "!==", ">", ">=", "<", "<="],
					["in", "instanceof"],
				],
			},
		],
		"no-multi-assign": "error",
		"no-multi-spaces": "error",
		"no-multi-str": "error",
		"no-multiple-empty-lines": "error",
		"no-native-reassign": "error",
		"no-negated-condition": "off",
		"no-negated-in-lhs": "error",
		"no-nested-ternary": "error",
		"no-new": "error",
		"no-new-func": "error",
		"no-new-object": "error",
		"no-new-wrappers": "error",
		"no-octal-escape": "error",
		"no-param-reassign": "off",
		"no-plusplus": ["error", { "allowForLoopAfterthoughts": true }],
		"no-proto": "error",
		"no-restricted-exports": "error",
		"no-restricted-globals": "error",
		"no-restricted-imports": "error",
		"no-restricted-properties": "error",
		"no-restricted-syntax": "error",
		"no-return-assign": "error",
		"no-return-await": "off",
		"no-script-url": "error",
		"no-self-compare": "error",
		"no-sequences": "error",
		"no-shadow": ["error", { "allow": ["Event", "Request", "yargs"] }],
		"no-spaced-func": "error",
		"no-tabs": ["error", { "allowIndentationTabs": true }],
		"no-template-curly-in-string": "error",
		"no-ternary": "off",
		"no-throw-literal": "error",
		"no-trailing-spaces": "error",
		"no-undef-init": "error",
		"no-undefined": "off",
		"no-unmodified-loop-condition": "error",
		"no-unneeded-ternary": "error",
		"no-unused-expressions": "error",
		"no-use-before-define": "off",
		"no-useless-backreference": "error",
		"no-useless-call": "error",
		"no-useless-computed-key": "error",
		"no-useless-concat": "error",
		"no-useless-constructor": "off",
		"no-useless-rename": "error",
		"no-useless-return": "error",
		"no-var": "error",
		"no-void": ["error", { "allowAsStatement": true }],
		"no-warning-comments": "off",
		"no-whitespace-before-property": "error",
		"nonblock-statement-body-position": "error",
		"object-curly-newline": "error",
		"object-curly-spacing": "off",
		"object-shorthand": "off",
		"one-var": "off",
		"one-var-declaration-per-line": "error",
		"operator-assignment": "off",
		"operator-linebreak": ["error", "after", {
			"overrides": {
				"?": "before",
				":": "before",
				"||": "before",
				"&&": "before",
				"??": "before",
			},
		}],
		"padded-blocks": "off",
		"padding-line-between-statements": "error",
		"prefer-arrow-callback": "error",
		"prefer-const": "off",
		"prefer-destructuring": "off",
		"prefer-exponentiation-operator": "error",
		"prefer-named-capture-group": "off",
		"prefer-numeric-literals": "error",
		"prefer-object-spread": "error",
		"prefer-promise-reject-errors": "error",
		"prefer-reflect": "off",
		"prefer-regex-literals": "error",
		"prefer-rest-params": "error",
		"prefer-spread": "error",
		"prefer-template": "error",
		"quote-props": "off",
		"quotes": ["error", "double", { "avoidEscape": true }],
		"radix": ["error", "always"],
		"require-atomic-updates": "off", // XXX Not sure why this triggers on process.title = ...
		"require-await": "off",
		"require-jsdoc": "off",
		"require-unicode-regexp": "off",
		"rest-spread-spacing": ["error", "never"],
		"semi": "error",
		"semi-spacing": "error",
		"semi-style": "off",
		"sort-imports": "off",
		"sort-keys": "off",
		"sort-vars": "off",
		"space-before-blocks": "error",
		"space-before-function-paren": "off",
		"space-in-parens": ["error", "never"],
		"space-infix-ops": "off",
		"space-unary-ops": "error",
		"spaced-comment": ["error", "always", {
			"line": {
				"markers": ["/"],
			},
		}],
		"strict": "error",
		"switch-colon-spacing": "error",
		"symbol-description": "error",
		"template-curly-spacing": ["error", "never"],
		"template-tag-spacing": "error",
		"unicode-bom": ["error", "never"],
		"valid-jsdoc": ["error", {
			"requireReturn": false,
			"requireReturnType": false,
			"requireParamType": false,
		}],
		"vars-on-top": "error",
		"wrap-iife": "error",
		"wrap-regex": "off",
		"yield-star-spacing": "error",
		"yoda": ["error", "never", { "exceptRange": true }],

		"node/callback-return": "off",
		"node/exports-style": "off",
		"node/file-extension-in-import": "off",
		"node/global-require": "off",
		// Node.js callback passing style of (err, value) is not used in this project
		"node/handle-callback-err": "off",
		"node/no-callback-literal": "off",
		"node/no-deprecated-api": "error",
		"node/no-exports-assign": "error",
		"node/no-extraneous-import": "off",
		"node/no-extraneous-require": "off",
		"node/no-missing-import": ["error", {
			"tryExtensions": [".js", ".ts"],
		}],
		"node/no-missing-require": "error",
		"node/no-mixed-requires": "error",
		"node/no-new-require": "error",
		"node/no-path-concat": "error",
		"node/no-process-env": "error",
		"node/no-process-exit": "error",
		"node/no-restricted-require": "off",
		"node/no-sync": "error",
		"node/no-unpublished-bin": "error",
		"node/no-unpublished-import": "error",
		"node/no-unpublished-require": [
			"error",
			{ "allowModules": ["webpack", "webpack-merge", "webpack-dev-middleware"] },
		],
		"node/no-unsupported-features/es-builtins": "off",
		"node/no-unsupported-features/es-syntax": "off",
		"node/no-unsupported-features/node-builtins": "off",
		"node/prefer-global/buffer": "error",
		"node/prefer-global/console": "error",
		"node/prefer-global/process": "error",
		"node/prefer-global/text-decoder": "error",
		"node/prefer-global/text-encoder": "error",
		"node/prefer-global/url-search-params": "error",
		"node/prefer-global/url": "error",
		"node/prefer-promises/dns": "off",
		"node/prefer-promises/fs": "off",
		"node/process-exit-as-throw": "error",
		"node/shebang": ["error", {
			"convertPath": {
				"*.ts": ["^(.+)\\.ts$", "dist/node/$1.js"],
			},
		}],
	},
};
