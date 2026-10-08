// dsh-recent-tasks — host half entry point (`exports["."]`).
//
// The implementation lives in `../src/host.js` so the unit tests can import it
// directly, with no build step, while the loader keeps importing a stable
// `lib/index.js`. `files` ships both directories.
export * from '../src/host.js';