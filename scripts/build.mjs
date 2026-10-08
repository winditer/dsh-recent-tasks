/**
 * dsh-recent-tasks build — bundles the client half into the one artifact the DSH
 * web-module loader accepts.
 *
 * The loader requires a CLASSIC script (no ESM syntax) whose single top-level
 * statement calls `window.__ModuleLoader__.load({ id, factory })`, with `id`
 * EXACTLY equal to the package name (`arrive()` matches the factory by the graph
 * row id, i.e. the package name). Its `require` resolves only platform seed words
 * (react, react/jsx-runtime, …) and other plugin packages, so every local module
 * must be inlined here and anything else must stay external.
 *
 * Exported as a function so test/bundle.test.js asserts the artifact's contract
 * without shelling out.
 */

import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const ENTRY = resolve(ROOT, 'src/client.js');
const OUT_FILE = resolve(ROOT, 'dist/client.js');

/** Specifiers the browser module table is guaranteed to resolve. */
export const ALLOWED_EXTERNALS = Object.freeze([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);

/** The exact wrapper the loader expects, with `id` derived from package.json. */
export function wrapBundle(body, id) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    throw new Error(`bundle load id must be a valid package name, got: ${JSON.stringify(id)}`);
  }
  return `window.__ModuleLoader__.load({
  id: "${id}",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
    return module.exports;
  }
});
`;
}

/** Build `src/client.js` into `dist/client.js`; returns the final bundle text. */
export async function buildClientBundle({ outFile = OUT_FILE } = {}) {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  const id = String(pkg.name ?? '').trim();
  const raw = resolve(dirname(outFile), '_client.bundle.js');
  mkdirSync(dirname(outFile), { recursive: true });
  try {
    await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      // Classic JSX keeps the only runtime specifier `react`; the loader seeds
      // both `react` and `react/jsx-runtime`, but one is less to go wrong.
      jsx: 'transform',
      // The client half is a .js file containing JSX (the loader only cares about
      // the bundled artifact, and .mjs/.jsx would break `node --test`'s import of
      // src/client.js elsewhere).
      loader: { '.js': 'jsx' },
      external: [...ALLOWED_EXTERNALS],
      outfile: raw,
      legalComments: 'none',
      sourcemap: false,
    });
    const wrapped = wrapBundle(readFileSync(raw, 'utf8'), id);
    writeFileSync(outFile, wrapped, 'utf8');
    return wrapped;
  } finally {
    rmSync(raw, { force: true });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const wrapped = await buildClientBundle();
  console.log(`✓ built dist/client.js (${(wrapped.length / 1024).toFixed(1)} KB)`);
}