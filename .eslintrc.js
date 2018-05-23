module.exports = {
	"env": {
		"browser": true,
		"commonjs": true,
		"es6": true,
		"node": true
	},
	"extends": "eslint:recommended",
	"parserOptions": {
		"ecmaVersion": 2017,
		"sourceType": "module"
	},
	"rules": {
		"indent": [
			1,
			"tab"
		],
		"linebreak-style": [
			"error",
			"windows"
		],
		"quotes": [
			0,
			"double"
		],
		"semi": [
			1,
			"always"
		],
		"no-console": [
			0
		]
	}
};
