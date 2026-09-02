// Build step: takes the readable source (index.source.html) and produces the
// deployable, obfuscated+minified index.html. Run this after every edit to
// index.source.html, then deliver/deploy the regenerated index.html — never
// hand-edit index.html directly, it will just get overwritten next build.
//
// Usage: node build-obfuscate.js <path-to-final-package-dir>

const fs = require("fs");
const path = require("path");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { minify } = require("html-minifier-terser");

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error("Usage: node build-obfuscate.js <path-to-final-package-dir>");
  process.exit(1);
}

const srcPath = path.join(pkgDir, "index.source.html");
const outPath = path.join(pkgDir, "index.html");

const html = fs.readFileSync(srcPath, "utf8");

// A light, honest deterrent — NOT real security (nothing running in a
// browser can be truly hidden from a determined technical user; DevTools can
// still be reached other ways, e.g. the browser menu, or by disabling JS
// first). This just stops the casual "right-click > View Source" / F12
// crowd, and is worth exactly that much.
const DETERRENT_SNIPPET = `
document.addEventListener('contextmenu', function (e) {
  var t = e.target;
  var editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (!editable) e.preventDefault(); // still allow right-click paste into form fields
});
document.addEventListener('keydown', function (e) {
  var k = e.key;
  var blocked =
    k === 'F12' ||
    (e.ctrlKey && e.shiftKey && (k === 'I' || k === 'i' || k === 'J' || k === 'j' || k === 'C' || k === 'c')) ||
    (e.metaKey && e.altKey && (k === 'I' || k === 'i' || k === 'J' || k === 'j' || k === 'C' || k === 'c')) ||
    (e.ctrlKey && (k === 'U' || k === 'u')) ||
    (e.metaKey && (k === 'U' || k === 'u'));
  if (blocked) e.preventDefault();
});
`;

// Pull out the single inline <script>...</script> block.
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error("Could not find an inline <script> block in " + srcPath);
  process.exit(1);
}
const originalJs = scriptMatch[1];
const combinedJs = DETERRENT_SNIPPET + "\n" + originalJs;

console.log("Obfuscating inline JS (" + combinedJs.length + " chars)...");
const obfuscationResult = JavaScriptObfuscator.obfuscate(combinedJs, {
  compact: true,
  controlFlowFlattening: false, // keep off: this app is form/event-handler heavy and CFF materially slows interaction handlers for little extra deterrence
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false, // keep false: several inline onclick="fn(...)" HTML attributes call these functions by name — renaming globals would break them
  selfDefending: false, // keep off: self-defending code breaks if any minifier ever touches it afterward, and gains little here
  disableConsoleOutput: false,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: false // keep false: several objects use string keys later accessed dynamically (e.g. by decision/status text) — safest not to touch key names
});
const obfuscatedJs = obfuscationResult.getObfuscatedCode();

const htmlWithObfuscatedJs = html.replace(
  /<script>[\s\S]*?<\/script>/,
  "<script>" + obfuscatedJs + "</script>"
);

console.log("Minifying HTML/CSS (JS left as-is — already obfuscated above)...");
minify(htmlWithObfuscatedJs, {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: false, // already obfuscated/compacted above — re-minifying here risks re-breaking string-array bootstrapping
  removeEmptyAttributes: false,
  removeRedundantAttributes: false,
  collapseBooleanAttributes: false,
  caseSensitive: true
}).then(function (finalHtml) {
  fs.writeFileSync(outPath, finalHtml, "utf8");
  const srcSize = Buffer.byteLength(html, "utf8");
  const outSize = Buffer.byteLength(finalHtml, "utf8");
  console.log("Wrote " + outPath);
  console.log("Source: " + srcSize + " bytes -> Build: " + outSize + " bytes");
}).catch(function (err) {
  console.error("Minification failed:", err);
  process.exit(1);
});
