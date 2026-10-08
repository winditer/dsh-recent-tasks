#!/usr/bin/env bash
# Mount dsh-recent-tasks into a DSH profile.
#
# RUN THIS OUTSIDE ANY AGENT SANDBOX: a profile lives at ~/.dsh/profiles/<name>,
# which a workspace-write sandbox cannot write.
#
# Recommended instead, when the app is running: Settings -> Plugins -> install
# bundle, pointing at this directory. That path is what this script reproduces:
#   `pnpm add file:<repo>` in the profile, then the package name in
#   `dsh.profile.bundles`. dsh-desktop recomposes live when that list changes.
#
# WHY the dependency entry, not just the bundle list. `dsh.profile.bundles` alone
# is NOT durable: `reconcileProfilePlugins` re-derives the list from
# `dependencies`, and the desktop crash-recovery path (`sanitizeProfile`)
# replaces the whole list with the in-box names, keeping only dependency-backed
# entries. A name that is not a dependency is erased the first time the app
# recovers from a fatal boot.
#
# ONE package, both halves: this package declares `dsh.bundle.patch` (host half
# via `exports["."]`) AND `dsh.client` + `exports["./client"]` (browser half), so
# the single loader row in its own cordis.patch.yml covers both.
#
# The browser half is a build product. `file:` installs PACK a snapshot, so run
# `node scripts/build.mjs` first and re-run this script after every rebuild, or
# pass `--link` to develop against the working tree (a `link:` dependency that
# always reads these files).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_NAME="${DSH_PROFILE:-desktop}"
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE_NAME"
PKG="dsh-recent-tasks"

MODE="file"
for arg in "$@"; do
  case "$arg" in
    --link) MODE="link" ;;
    --file) MODE="file" ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "error: unknown argument '$arg' (use --file or --link)" >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$PROFILE" ]; then
  echo "error: profile not found at $PROFILE" >&2
  exit 1
fi

# `node` is not on PATH in this environment; fall back to a bundled runtime. Each
# candidate is EXECUTED, not just tested for the executable bit.
find_node() {
  local candidate
  if command -v node >/dev/null 2>&1 && node --version >/dev/null 2>&1; then
    command -v node
    return
  fi
  local candidates=(
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/bin/node"
  )
  for candidate in "${candidates[@]}"; do
    if [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

# `pnpm` likewise: prefer PATH, else the runtime that ships one.
find_pnpm() {
  local candidate
  if command -v pnpm >/dev/null 2>&1; then
    command -v pnpm
    return
  fi
  local candidates=(
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/pnpm"
  )
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

NODE_BIN="$(find_node)" || {
  echo "error: no node executable found (PATH, app runtime, or ~/.dsh runtimes)" >&2
  exit 1
}

# The browser half must exist: the loader discovers `exports["./client"]` and
# fails loudly ("client bundle not found; run `pnpm run build` before launch").
if [ ! -f "$REPO_ROOT/dist/client.js" ]; then
  echo "building dist/client.js ..."
  "$NODE_BIN" "$REPO_ROOT/scripts/build.mjs"
fi

PNPM_BIN="$(find_pnpm || true)"
if [ -n "$PNPM_BIN" ]; then
  echo "installing $PKG into $PROFILE (mode: $MODE) ..."
  if [ "$MODE" = "link" ]; then
    (cd "$PROFILE" && "$NODE_BIN" "$PNPM_BIN" add "link:$REPO_ROOT") || {
      echo "pnpm add failed; falling back to the manifest rewrite below" >&2
      PNPM_BIN=""
    }
  else
    (cd "$PROFILE" && "$NODE_BIN" "$PNPM_BIN" add "file:$REPO_ROOT") || {
      echo "pnpm add failed; falling back to the manifest rewrite below" >&2
      PNPM_BIN=""
    }
  fi
fi

if [ -z "$PNPM_BIN" ]; then
  # Manual equivalent: link the package and declare it, so the profile has the
  # same shape a pnpm install produces.
  mkdir -p "$PROFILE/node_modules"
  rm -rf "$PROFILE/node_modules/$PKG"
  ln -s "$REPO_ROOT" "$PROFILE/node_modules/$PKG"
  echo "linked: $PROFILE/node_modules/$PKG -> $REPO_ROOT"
fi

"$NODE_BIN" - "$PROFILE/package.json" "$PKG" "$REPO_ROOT" <<'NODE'
const fs = require('node:fs');
const [file, pkg, repoRoot] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
manifest.dsh.profile.bundles ??= [];
if (!manifest.dsh.profile.bundles.includes(pkg)) manifest.dsh.profile.bundles.push(pkg);
if (!manifest.dependencies?.[pkg]) {
  // Exactly the spec pnpm writes for a local directory. A `pnpm add` above has
  // already written it; this is the fallback for a manifest-only install.
  const rewritten = { ...manifest, dependencies: { ...(manifest.dependencies ?? {}), [pkg]: `link:${repoRoot}` } };
  fs.writeFileSync(file, `${JSON.stringify(rewritten, null, 2)}\n`);
}
const final = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!final.dsh.profile.bundles.includes(pkg)) throw new Error('bundle entry missing after install');
if (!final.dependencies?.[pkg]) throw new Error('dependency entry missing after install (crash recovery would erase the bundle)');
console.log('bundles:', final.dsh.profile.bundles.join(', '));
console.log('dependency:', `${pkg}=${final.dependencies[pkg]}`);
NODE

cat <<NOTE

done.
  - one package, one loader row: dsh-recent-tasks carries both the host half and
    the browser half (dsh.client + exports["./client"]).
  - the row id 'recent-tasks' is also the settings namespace, so the official
    settings surface picks the row up automatically; edits are written to this
    profile's cordis.patch.yml and hot-apply.
  - dsh-desktop recomposes live when dsh.profile.bundles changes; the browser
    half may need a page refresh, and a relaunch is the safe fallback.
  - verify the host half from a shell:
      curl -s -X POST http://127.0.0.1:19387/dsh-recent-tasks/api/state \\
        -H 'content-type: application/json' -d '{}'
    -> {"ok":true,"value":{"workspaceId":"...","path":".../DSH 最近任务",...}}
NOTE