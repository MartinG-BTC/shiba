module.exports = {
    plugins: [
        "node",
        "promise",
    ],
    env: {
        es6: true,
        node: true,
    },
    extends: [
        "eslint:recommended",
        "plugin:node/recommended",
        "plugin:promise/recommended",
    ],
    rules: {
        "no-console": "off"
    },
}
