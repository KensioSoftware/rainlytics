/**
 * What the beacon costs a page, measured and held to a budget.
 *
 * Page weight is the first thing this project exists to protect. Every other
 * cost here is somebody's AWS bill, which they chose. This one is paid by
 * every reader of every measured site, on a connection nobody asked about.
 * So it gets a number and a check rather than an intention.
 *
 * The entry below is what a site actually writes. Bundling that rather than
 * the whole of `dist/beacon/index.js` is the honest measure, because a
 * bundler drops the exports a site never names and a page pays for what is
 * left. KensioSoftware/rainlytics#110 is where that stopped being a guess:
 * splitting the SQL out of the envelope took a beacon-shaped bundle from 464
 * bytes to 241, and neither number was visible from any one source file.
 *
 * Gzip rather than brotli, and gzip is the floor. CloudFront serves brotli to
 * anything that asks, so the bytes on the wire are this or fewer.
 *
 * Run by `pnpm check`, after `pnpm pack:check` has built `dist`.
 */

import { gzipSync } from "node:zlib";

import * as esbuild from "esbuild";

/** The most the beacon may weigh, gzipped, in bytes. */
const budget = 640;

/**
 * What a site writes to start the beacon.
 *
 * `report` is named as well as `startBeacon`, because a site that only wanted
 * route changes would pay less than one using the whole surface, and the
 * number worth holding is the larger one.
 */
const entry = `
import { startBeacon } from "./dist/beacon/index.js";

const beacon = startBeacon();
beacon.report({ event: "signup", page: location.pathname });
`;

const built = await esbuild.build({
  stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "page.js" },
  bundle: true,
  minify: true,
  format: "esm",
  // The `browserslist` floor in package.json, as the syntax that meets it.
  // `tsconfig.json` says why ES2021 rather than ES2022.
  target: "es2021",
  write: false,
});

const [output] = built.outputFiles;

if (output === undefined) {
  console.error("esbuild produced no output for the beacon entry point.");
  process.exit(1);
}

const minified = output.contents.byteLength;
const gzipped = gzipSync(output.contents, { level: 9 }).byteLength;

console.log(`Beacon bundle: ${String(minified)} bytes minified,`);
console.log(`               ${String(gzipped)} bytes gzipped,`);
console.log(`               ${String(budget)} bytes is the budget.`);

if (gzipped > budget) {
  console.error("");
  console.error(
    `The beacon is ${String(gzipped - budget)} bytes over budget, gzipped.`,
  );
  console.error("");
  console.error("Every page of every measured site downloads this. Either");
  console.error("take the weight back out, or raise the budget in");
  console.error("scripts/js/beacon-size.mjs and say in the pull request what");
  console.error("the page is getting for the bytes.");
  process.exit(1);
}
