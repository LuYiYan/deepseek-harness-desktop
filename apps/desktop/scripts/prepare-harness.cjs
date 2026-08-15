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
  const sourceStore = path.join(workspaceRoot, "node_modules", ".pnpm");
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

// The `--shamefully-hoist --prod` install already places every production
// dependency at the top level of the staged node_modules, so the external-package
// store copy is no longer needed; only the linked workspace packages are staged
// here. Both the top-level hoist and these workspace copies are dereferenced by
// the final `cpSync`.
copyWorkspacePackagesIntoNodeModules();

fs.cpSync(buildDir, deployDir, {
  recursive: true,
  dereference: true,
});

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
