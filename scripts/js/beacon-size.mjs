/**
 * What the beacon costs a page, measured and held to a budget.
 *
 * Page weight is the first thing this project exists to protect. Every other
 * cost here is somebody's AWS bill, which they chose. This one is paid by
 * every reader of every measured site, on a connection nobody asked about.
 * So it gets a number and a check rather than an intention.
 *
 * Each entry below is what a site actually writes. Bundling that rather than
 * the modules themselves is the honest measure, because a bundler drops the
 * exports a site never names and a page pays for what is left.
 * KensioSoftware/rainlytics#110 is where that stopped being a guess:
 * splitting the SQL out of the envelope took a beacon-shaped bundle from 464
 * bytes to 241, and neither number was visible from any one source file.
 *
 * The entries are separate because the imports are. Vitals and errors sit
 * behind subpaths of their own so that a site wanting route changes alone
 * pays for route changes alone, and a budget each is what keeps that true.
 *
 * Gzip rather than brotli, and gzip is the floor. CloudFront serves brotli to
 * anything that asks, so the bytes on the wire are this or fewer.
 *
 * Run by `pnpm check`, after `pnpm pack:check` has built `dist`.
 */

import { gzipSync } from "node:zlib";

import * as esbuild from "esbuild";

const start = 'import { startBeacon } from "./dist/beacon/index.js";';
const vitals = 'import { reportVitals } from "./dist/beacon/vitals.js";';
const errors = 'import { reportErrors } from "./dist/beacon/errors.js";';

/**
 * What a site writes, and the most each may weigh gzipped.
 *
 * A budget is about 15% above what the entry measures today. Tight enough
 * that anything worth noticing trips it, loose enough that it is not tripped
 * by rewording a condition.
 */
const entries = [
  {
    name: "beacon",
    budget: 640,
    source: `
${start}

const beacon = startBeacon();
beacon.report({ event: "signup", page: location.pathname });
`,
  },
  {
    name: "beacon + vitals",
    budget: 1250,
    source: `
${start}
${vitals}

reportVitals(startBeacon());
`,
  },
  {
    name: "beacon + errors",
    budget: 880,
    source: `
${start}
${errors}

reportErrors(startBeacon());
`,
  },
  {
    name: "all of it",
    budget: 1500,
    source: `
${start}
${vitals}
${errors}

const beacon = startBeacon();
reportVitals(beacon);
reportErrors(beacon);
beacon.report({ event: "signup", page: location.pathname });
`,
  },
];

/** How wide the name column has to be for the report below to line up. */
const nameWidth = Math.max(...entries.map((entry) => entry.name.length));

let over = 0;

for (const entry of entries) {
  const built = await esbuild.build({
    stdin: {
      contents: entry.source,
      resolveDir: process.cwd(),
      sourcefile: "page.js",
    },
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
    console.error(`esbuild produced no output for ${entry.name}.`);
    process.exit(1);
  }

  const minified = output.contents.byteLength;
  const gzipped = gzipSync(output.contents, { level: 9 }).byteLength;
  const verdict = gzipped > entry.budget ? "OVER" : "ok";

  console.log(
    `${entry.name.padEnd(nameWidth)}  ${String(minified).padStart(5)} min` +
      `  ${String(gzipped).padStart(5)} gzip` +
      `  ${String(entry.budget).padStart(5)} budget  ${verdict}`,
  );

  if (gzipped > entry.budget) {
    over += 1;
  }
}

if (over > 0) {
  console.error("");
  console.error(`${String(over)} entry point(s) over budget.`);
  console.error("");
  console.error("Every page of every measured site downloads this. Either");
  console.error("take the weight back out, or raise the budget in");
  console.error("scripts/js/beacon-size.mjs and say in the pull request what");
  console.error("the page is getting for the bytes.");
  process.exit(1);
}
