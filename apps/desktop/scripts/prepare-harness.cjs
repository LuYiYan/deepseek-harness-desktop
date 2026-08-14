const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(desktopRoot, "../..");
const deployDir = path.resolve(workspaceRoot, "work", "desktop-runtime");
const nodeRuntimeDir = path.resolve(workspaceRoot, "work", "desktop-node");

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

fs.cpSync(workspaceRoot, deployDir, {
  recursive: true,
  dereference: true,
  filter: shouldCopy,
});

const installResult = spawnSync(
  "pnpm",
  ["install", "--offline", "--ignore-scripts", "--shamefully-hoist"],
  {
    cwd: deployDir,
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

function copyPackage(sourceDir, targetDir) {
  if (fs.existsSync(targetDir)) {
    return false;
  }

  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: true,
    filter: (source) => !path.relative(sourceDir, source).split(path.sep).includes("node_modules"),
  });

  return true;
}

function copyPnpmStorePackagesIntoNodeModules() {
  const sourceStore = path.join(workspaceRoot, "node_modules", ".pnpm");
  const targetNodeModules = path.join(deployDir, "node_modules");

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
      if (!entry.isDirectory()) {
        continue;
      }

      const sourceDir = path.join(packageNodeModules, entry.name);

      if (entry.name.startsWith("@")) {
        const targetScope = path.join(targetNodeModules, entry.name);
        fs.mkdirSync(targetScope, { recursive: true });

        for (const scopedEntry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
          if (!scopedEntry.isDirectory() || entry.name === "@deepseek-ai") {
            continue;
          }

          const scopedSourceDir = path.join(sourceDir, scopedEntry.name);
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

      const entryPath = path.join(baseDir, entry.name);
      const packageJson = path.join(entryPath, "package.json");

      if (fs.existsSync(packageJson)) {
        packageDirs.push(entryPath);
        continue;
      }

      collectPackages(entryPath);
    }
  }

  for (const root of roots) {
    collectPackages(path.join(workspaceRoot, root));
  }

  const scopedRoot = path.join(deployDir, "node_modules", "@deepseek-ai");
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

copyPnpmStorePackagesIntoNodeModules();
copyWorkspacePackagesIntoNodeModules();

fs.mkdirSync(nodeRuntimeDir, { recursive: true });
fs.copyFileSync(process.execPath, path.join(nodeRuntimeDir, process.platform === "win32" ? "node.exe" : "node"));

const cliBin = path.join(deployDir, "apps", "cli", "lib", "bin.js");

if (!fs.existsSync(cliBin)) {
  console.error(`Expected deployed CLI entry at ${cliBin}`);
  process.exit(1);
}
