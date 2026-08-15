/**
 * afterPack hook for electron-builder.
 *
 * electron-builder silently skips `node_modules/` when staging extraResources
 * because the project root `.gitignore` lists it.  Without this hook the
 * released installer contains a working CLI binary (`harness/apps/cli/lib/bin.js`)
 * but no runtime dependencies, so the spawn'd Node process crashes with
 * `Timed out waiting for http://127.0.0.1:<port>` because the harness
 * server never starts.
 *
 * This hook re-copies the deployDir's `node_modules/` into the staged app's
 * `resources/harness/node_modules/` after electron-builder has finished
 * staging — bypassing its gitignore-based filtering entirely.  The rest of
 * the harness tree (apps/, docs/, etc.) is already correctly staged by
 * `extraResources`; we only patch the missing subtree.
 *
 * Mirrors the approach used by ClawX's release pipeline.
 */
const fs = require("node:fs");
const path = require("node:path");

const DEPLOY_ROOT = path.resolve(__dirname, "..", ".desktop-runtime", "harness");
const MIN_PACKAGES = 200;

function fail(message) {
  console.error(`\n[afterPack] ${message}\n`);
  process.exit(1);
}

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const stagedHarness = path.join(appOutDir, "resources", "harness");
  const stagedNodeModules = path.join(stagedHarness, "node_modules");
  const sourceNodeModules = path.join(DEPLOY_ROOT, "node_modules");

  if (!fs.existsSync(sourceNodeModules)) {
    fail(`source node_modules not found at ${sourceNodeModules}`);
  }

  const sourceTopLevel = fs.readdirSync(sourceNodeModules);
  if (sourceTopLevel.length < MIN_PACKAGES) {
    fail(
      `source node_modules has only ${sourceTopLevel.length} entries ` +
      `(expected >= ${MIN_PACKAGES}); refusing to stage a broken runtime`,
    );
  }

  // electron-builder's extraResources staging respects `.gitignore`, which
  // lists `node_modules/` at the project root.  The staging is therefore
  // missing `resources/harness/node_modules/` entirely.  Replace any
  // partial tree with the deployDir's full node_modules.
  if (fs.existsSync(stagedNodeModules)) {
    fs.rmSync(stagedNodeModules, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
  fs.mkdirSync(stagedNodeModules, { recursive: true });

  console.log(
    `[afterPack] copying ${sourceTopLevel.length} top-level node_modules entries ` +
    `from ${DEPLOY_ROOT}/node_modules to ${stagedNodeModules}`,
  );

  // Mirror the same copy semantics prepare-harness uses (recursive +
  // dereference), with per-entry retry so a single failing package doesn't
  // leave the runtime half-staged.
  let copied = 0;
  for (const entry of sourceTopLevel) {
    const src = path.join(sourceNodeModules, entry);
    const dst = path.join(stagedNodeModules, entry);
    fs.cpSync(src, dst, {
      recursive: true,
      dereference: true,
      maxRetries: 8,
      retryDelay: 250,
    });
    copied += 1;
  }

  const finalTopLevel = fs.readdirSync(stagedNodeModules);
  if (finalTopLevel.length < MIN_PACKAGES) {
    fail(
      `staged node_modules has only ${finalTopLevel.length} entries ` +
      `after copy (expected >= ${MIN_PACKAGES}); electron-builder would ` +
      `package a release with no runtime dependencies`,
    );
  }

  console.log(
    `[afterPack] staged ${copied} top-level packages under ` +
    `${path.relative(appOutDir, stagedNodeModules)}`,
  );
};