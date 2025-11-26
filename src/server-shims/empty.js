// Lightweight shim used at build-time to avoid bundling test/dev-only
// dependencies that break Turbopack. This file exports both CommonJS
// and ESM shapes so it can satisfy a variety of import styles.

exports.__esModule = true;
exports.default = {};
module.exports = exports.default;

// also provide named exports defensively
Object.assign(exports, {});
