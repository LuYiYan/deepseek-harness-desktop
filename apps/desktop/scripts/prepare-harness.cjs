const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");
const runtimeRoot = path.resolve(desktopRoot, ".desktop-runtime");
const deployDir = path.join(runtimeRoot, "harness");
const nodeRuntimeDir = path.join(runtimeRoot, "node");
const buildDir = path.join(os.tmpdir(), `dsh-desktop-runtime-${process.pid}`);

if (fs.existsSync(deployDir)) {
  try {
    fs.rmSync(deployDir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  } catch (error) {
    const archivedDeployDir = `${deployDir}-${Date.now()}.old`;
    console.warn(`Could not remove ${deployDir}; moving it to ${archivedDeployDir}`);
    fs.renameSync(deployDir, archivedDeployDir);
  }
}

fs.rmSync(nodeRuntimeDir, {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 250,
});

fs.rmSync(buildDir, {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 250,
});

const ignoredTopLevel = new Set([
  ".git",
  ".agents",
  ".claude",
  ".github",
  ".worktrees",
  ".desktop-runtime",
  ".pnpm-store",
  ".reasonix",
  ".vs",
  "coverage",
  "dist-exe",
  "worktrees",
]);

function shouldCopy(source) {
  const relative = path.relative(workspaceRoot, source);

  if (!relative) {
    return true;
  }

  const parts = relative.split(path.sep);

  if (parts[0] === "node_modules" || parts.includes("node_modules")) {
    return false;
  }

  if (ignoredTopLevel.has(parts[0])) {
    return false;
  }

  if (parts[0] === "apps" && parts[1] === "desktop") {
    return ![".desktop-harness", ".desktop-runtime"].includes(parts[2])
      && !parts[2]?.startsWith("dist-desktop");
  }

  if (parts.includes(".git")) {
    return false;
  }

  return true;
}

console.log(`Preparing desktop runtime at ${deployDir}`);

fs.cpSync(workspaceRoot, buildDir, {
  recursive: true,
  dereference: true,
  filter: shouldCopy,
});

const installResult = spawnSync(
  "pnpm",
  [
    "install",
    ...(process.env.GITHUB_ACTIONS === "true" ? [] : ["--offline"]),
    "--ignore-scripts",
    "--shamefully-hoist",
    // The packaged runtime runs compiled `lib/`, not dev tooling, so omit
    // devDependencies (electron, typescript, vitest, tsx, ...). This keeps the
    // installer under the NSIS size limits that otherwise fail the build.
    "--prod",
    // Install only the web profile's real dependency closure, not the whole
    // workspace. The bundle packages declare exactly the plugins the profile
    // mounts; filtering on them excludes every other workspace package's
    // external deps — the Claude Code subagent SDK (~260MB), the LSP/typert
    // TypeScript runtime, alternative-provider SDKs, and test-support tooling —
    // none of which `dsh web` ever loads.
    //
    // The bundle packages declare cordis, the plugin loader, and dsh-invariants
    // as peerDependencies (they must be process singletons). Those peers are
    // runtime infrastructure the web profile loads through the Loader, so pin
    // them here as explicit roots rather than relying on pnpm auto-installing
    // peers.
    "--filter", "@deepseek-ai/dsh-base",
    "--filter", "@deepseek-ai/dsh-web-app",
    "--filter", "@deepseek-ai/cordis",
    "--filter", "@deepseek-ai/cordis-plugin-loader",
    "--filter", "@deepseek-ai/dsh-invariants",
  ],
  {
    cwd: buildDir,
    env: {
      ...process.env,
      CI: "true",
      PNPM_CONFIG_CONFIRM_MODULES_PURGE: "false",
    },
    shell: true,
    stdio: "inherit",
  },
);

if (installResult.status !== 0) {
  process.exit(installResult.status ?? 1);
}

function isDirectory(target) {
  try {
    // statSync follows symlinks; pnpm stores package dependencies under
    // .pnpm/<pkg>/node_modules/<dep> as symlinks, so Dirent.isDirectory()
    // would report false for them and silently skip the copy.
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function copyPackage(sourceDir, targetDir) {
  const existing = fs.lstatSync(targetDir, { throwIfNoEntry: false });

  // A real directory already staged here was copied earlier: deduplicate.
  // A symlink is the pnpm hoist placeholder (`--shamefully-hoist` links the
  // top-level node_modules entry into .pnpm); it must be replaced with the
  // resolved package contents so the packaged app resolves dependencies.
  if (existing && !existing.isSymbolicLink()) {
    return false;
  }

  if (existing) {
    fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }

  // Resolve the source symlink before copying so the filter's path.relative
  // works against a concrete tree (cpSync's dereference + filter interaction
  // is not specified and has proven unreliable across Node versions).
  const realSource = fs.realpathSync(sourceDir);

  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.cpSync(realSource, targetDir, {
    recursive: true,
    filter: (source) => !path.relative(realSource, source).split(path.sep).includes("node_modules"),
  });

  return true;
}

function copyPnpmStorePackagesIntoNodeModules() {
  const sourceStore = path.join(buildDir, "node_modules", ".pnpm");
  const targetNodeModules = path.join(buildDir, "node_modules");

  if (!fs.existsSync(sourceStore)) {
    return;
  }

  let copied = 0;

  for (const storeEntry of fs.readdirSync(sourceStore, { withFileTypes: true })) {
    if (!storeEntry.isDirectory()) {
      continue;
    }

    const packageNodeModules = path.join(sourceStore, storeEntry.name, "node_modules");

    if (!fs.existsSync(packageNodeModules)) {
      continue;
    }

    for (const entry of fs.readdirSync(packageNodeModules, { withFileTypes: true })) {
      const sourceDir = path.join(packageNodeModules, entry.name);

      if (!isDirectory(sourceDir)) {
        continue;
      }

      if (entry.name.startsWith("@")) {
        if (entry.name === "@deepseek-ai") {
          // Workspace packages are staged by copyWorkspacePackagesIntoNodeModules.
          continue;
        }

        const targetScope = path.join(targetNodeModules, entry.name);
        fs.mkdirSync(targetScope, { recursive: true });

        for (const scopedEntry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
          const scopedSourceDir = path.join(sourceDir, scopedEntry.name);

          if (!isDirectory(scopedSourceDir)) {
            continue;
          }

          const scopedTargetDir = path.join(targetScope, scopedEntry.name);

          if (copyPackage(scopedSourceDir, scopedTargetDir)) {
            copied += 1;
          }
        }

        continue;
      }

      if (copyPackage(sourceDir, path.join(targetNodeModules, entry.name))) {
        copied += 1;
      }
    }
  }

  console.log(`Copied ${copied} external packages into desktop runtime node_modules`);
}

function copyWorkspacePackagesIntoNodeModules() {
  const roots = ["apps", "packages", "vendor", "native"];
  const packageDirs = [];

  function collectPackages(baseDir) {
    if (!fs.existsSync(baseDir)) {
      return;
    }

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      // Nested workspace members live under a directory that is itself a
      // package (`native/landlock-run/packages/*`), so recursion must continue
      // past a package.json. Skip trees that never hold workspace members.
      if (entry.name === "node_modules"
        || entry.name === ".git"
        || entry.name === ".desktop-runtime"
        || entry.name === ".desktop-harness") {
        continue;
      }

      const entryPath = path.join(baseDir, entry.name);
      const packageJson = path.join(entryPath, "package.json");

      if (fs.existsSync(packageJson)) {
        packageDirs.push(entryPath);
      }

      collectPackages(entryPath);
    }
  }

  for (const root of roots) {
    collectPackages(path.join(workspaceRoot, root));
  }

  const scopedRoot = path.join(buildDir, "node_modules", "@deepseek-ai");
  fs.mkdirSync(scopedRoot, { recursive: true });

  for (const packageDir of packageDirs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));

    if (typeof manifest.name !== "string" || !manifest.name.startsWith("@deepseek-ai/")) {
      continue;
    }

    const packageName = manifest.name.slice("@deepseek-ai/".length);
    const targetDir = path.join(scopedRoot, packageName);

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(packageDir, targetDir, {
      recursive: true,
      dereference: true,
      filter: (source) => {
        const relative = path.relative(packageDir, source);

        return !relative.split(path.sep).some((part) => (
          part === "node_modules"
          || part === ".git"
          || part === ".desktop-harness"
          || part === ".desktop-runtime"
          || part.startsWith("dist-desktop")
        ));
      },
    });
  }
}

// `copyWorkspacePackagesIntoNodeModules` only stages the workspace packages
// under apps/, packages/, vendor/, and native/. Workspace members that live
// elsewhere (website, examples, python/sdk-runtime) are still junctions that
// `linkWorkspacePackages` wrote into node_modules/@deepseek-ai; the final copy
// runs with `dereference: false`, so a leftover junction would fail with EPERM
// when cpSync tries to recreate it as a symlink. Resolve each remaining link
// and replace it with its real contents (nested node_modules excluded, matching
// copyPackage).
function materializeRemainingWorkspaceLinks() {
  const targetNodeModules = path.join(buildDir, "node_modules");
  let materialized = 0;

  function materialize(fullPath) {
    const realSource = fs.realpathSync(fullPath);
    fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    fs.cpSync(realSource, fullPath, {
      recursive: true,
      filter: (source) => !path.relative(realSource, source).split(path.sep).includes("node_modules"),
    });
    materialized += 1;
  }

  for (const entry of fs.readdirSync(targetNodeModules, { withFileTypes: true })) {
    if (entry.name === ".pnpm") continue;
    const fullPath = path.join(targetNodeModules, entry.name);
    if (fs.lstatSync(fullPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
      materialize(fullPath);
      continue;
    }
    if (entry.isDirectory() && entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(fullPath, { withFileTypes: true })) {
        const scopedPath = path.join(fullPath, scoped.name);
        if (fs.lstatSync(scopedPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
          materialize(scopedPath);
        }
      }
    }
  }

  if (materialized > 0) {
    console.log(`Materialized ${materialized} remaining workspace links into node_modules`);
  }
}

// Materialize the external packages from the reinstall's virtual store into the
// top-level node_modules as real files, then materialize the linked workspace
// packages the same way. A single whole-tree `dereference` copy is deliberately
// avoided: dereferencing the `.pnpm` junctions follows cyclic peer-dependency
// links (cordis↔include, the api triples) into an unbounded recursion that
// crashes Node with STATUS_STACK_BUFFER_OVERRUN on Windows. Each package is
// instead resolved through `realpathSync` and copied with its nested
// `node_modules` excluded, so no junction cycle is ever followed.
copyPnpmStorePackagesIntoNodeModules();
copyWorkspacePackagesIntoNodeModules();
materializeRemainingWorkspaceLinks();

fs.cpSync(buildDir, deployDir, {
  recursive: true,
  dereference: false,
  filter: (source) => {
    const relative = path.relative(buildDir, source);
    const parts = relative.split(path.sep);
    // `.pnpm` and every nested node_modules hold junctions that crash Node's
    // recursive copy on Windows (STATUS_STACK_BUFFER_OVERRUN). The flattened
    // top-level node_modules already provides every runtime dependency, so both
    // are redundant — `.pnpm` is dropped and nested node_modules are stripped
    // right after this copy — and can be skipped outright.
    return !parts.includes(".pnpm") && !parts.slice(1).includes("node_modules");
  },
});

// Integrity check: `fs.cpSync` is known to silently produce a partial copy
// when it follows tens of thousands of nested pnpm symlinks under heavy load
// on Windows runners.  Verify the deployed tree and patch any missing
// top-level node_modules entries by re-copying them individually — a single
// large recursive copy is the failure mode that bites, but a small per-package
// copy completes reliably.
const deployedNodeModules = path.join(deployDir, "node_modules");
if (!fs.existsSync(deployedNodeModules)) {
  fs.mkdirSync(deployedNodeModules, { recursive: true });
}

const sourceNodeModules = path.join(buildDir, "node_modules");
// `.pnpm` is deliberately skipped by the deploy copy above (its junctions are
// redundant once the top level is flattened, and dereferencing them re-enters
// the cyclic store); it must not count as a missing entry here.
const sourceTopLevel = new Set(fs.readdirSync(sourceNodeModules).filter((p) => p !== ".pnpm"));
const deployedTopLevel = new Set(fs.readdirSync(deployedNodeModules));
const missingTopLevel = [...sourceTopLevel].filter((p) => !deployedTopLevel.has(p));

if (missingTopLevel.length > 0) {
  console.warn(
    `cpSync missed ${missingTopLevel.length} top-level node_modules entries; ` +
    `re-copying individually: ${missingTopLevel.slice(0, 5).join(", ")}${missingTopLevel.length > 5 ? ", ..." : ""}`,
  );
  for (const pkg of missingTopLevel) {
    const src = path.join(sourceNodeModules, pkg);
    const dst = path.join(deployedNodeModules, pkg);
    if (fs.existsSync(dst)) {
      fs.rmSync(dst, { recursive: true, force: true });
    }
    fs.cpSync(src, dst, {
      recursive: true,
      dereference: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  }
}

const finalTopLevel = fs.readdirSync(deployedNodeModules);

if (finalTopLevel.length < 200) {
  console.error(
    `Integrity check failed: ${deployedNodeModules} has only ` +
    `${finalTopLevel.length} top-level entries (expected >= 200). ` +
    `First few: ${finalTopLevel.slice(0, 5).join(", ")}. ` +
    `fs.cpSync produced a partial copy that even the per-package fallback ` +
    `could not recover; aborting.`,
  );
  process.exit(1);
}

const expectedWorkspaceScope = path.join(deployedNodeModules, "@deepseek-ai");
if (!fs.existsSync(expectedWorkspaceScope)) {
  console.error(
    `Integrity check failed: workspace packages directory ` +
    `${expectedWorkspaceScope} is missing.`,
  );
  process.exit(1);
}

console.log(
  `Integrity check passed: ${finalTopLevel.length} top-level packages staged under node_modules/`,
);

// The top-level hoist dereferenced above makes the `.pnpm` virtual store
// redundant at runtime. Dropping it from the deploy keeps the packaged runtime
// from duplicating the whole dependency tree (which otherwise pushes the
// installer past the NSIS size limits).
fs.rmSync(path.join(deployDir, "node_modules", ".pnpm"), {
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 250,
});

// pnpm creates per-package node_modules symlinks inside every workspace
// package (e.g. apps/cli/node_modules/@deepseek-ai/dsh-base).  The
// dereferenced cpSync above follows those symlinks and materialises deeply
// nested node_modules trees whose paths exceed NSIS / Windows MAX_PATH
// limits, causing the installer build to fail with thousands of "path not
// found" warnings.  The top-level node_modules already has every dependency
// the runtime needs, so strip every nested copy.
function stripNestedNodeModules(root) {
  const topLevelModules = path.join(root, "node_modules");
  let removed = 0;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules") {
        const fullPath = path.join(dir, entry.name);

        // Keep only the top-level node_modules.
        if (fullPath === topLevelModules) {
          continue;
        }

        fs.rmSync(fullPath, {
          recursive: true,
          force: true,
          maxRetries: 8,
          retryDelay: 250,
        });
        removed += 1;
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      }
    }
  }

  walk(root);
  console.log(`Stripped ${removed} nested node_modules directories from deploy`);
}

stripNestedNodeModules(deployDir);

fs.mkdirSync(nodeRuntimeDir, { recursive: true });
fs.copyFileSync(process.execPath, path.join(nodeRuntimeDir, process.platform === "win32" ? "node.exe" : "node"));

const cliBin = path.join(deployDir, "apps", "cli", "lib", "bin.js");

if (!fs.existsSync(cliBin)) {
  console.error(`Expected deployed CLI entry at ${cliBin}`);
  process.exit(1);
}

// Stage the first-run environment the desktop shell seeds into the app's own
// DSH_HOME on first launch. settings.yaml is the shipped default model
// (committed under apps/desktop/seed); .credentials.yaml is copied from this
// builder's harness home so a release made on a configured machine is usable
// immediately after install — it is never committed to the repository.
const seedDir = path.join(runtimeRoot, "seed");
fs.rmSync(seedDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
fs.mkdirSync(seedDir, { recursive: true });

fs.copyFileSync(
  path.join(desktopRoot, "seed", "settings.yaml"),
  path.join(seedDir, "settings.yaml"),
);

// A release shipped for public download must never embed the builder's API
// key. Bundling the local credentials is explicit opt-in
// (DSH_DESKTOP_BUNDLE_CREDENTIALS=1) for a personal build that should be usable
// immediately after install. Public builds ship no .credentials.yaml, and the
// first-run settings UI ("Settings → Models → API key") lets each user store
// their own key through credentials.set.
if (process.env.DSH_DESKTOP_BUNDLE_CREDENTIALS !== "1") {
  console.log("Not bundling credentials (public build); users configure their key in Settings → Models");
} else {
  const builderHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ""
    ? process.env.DSH_HOME
    : path.join(os.homedir(), ".dsh");
  const builderCredentials = path.join(builderHome, ".credentials.yaml");

  if (fs.existsSync(builderCredentials)) {
    fs.copyFileSync(builderCredentials, path.join(seedDir, ".credentials.yaml"));
    console.log(`Staged first-run credentials from ${builderCredentials}`);
  } else {
    console.warn(`No ${builderCredentials}; installer will ship without a pre-configured API key`);
  }
}
