/**
 * Wrapper around electron-builder's programmatic API.
 *
 * The CLI error handler (cli-util.ts) calls log.error() which invokes
 * Logger.createMessage -> String.replace, and when the NSIS error message
 * is very long this throws RangeError: Invalid string length, masking the
 * real build error.  By calling the API directly we control error formatting
 * and can truncate before logging.
 */
const { build } = require("electron-builder");
const fs = require("node:fs");
const path = require("node:path");

const MAX_ERROR_LEN = 20_000;

// Sanity check the staged harness dir before electron-builder packages it.
// On the rc.5.5 release the `harness/node_modules/` directory was silently
// absent from the installed app even though the CI build reported success —
// the actual deploy had lost it during the cpSync of 390 top-level packages.
// Surface that class of failure here so the release job fails instead of
// shipping a CLI binary with no dependencies.
const HARNESS_DIR = path.resolve(__dirname, "..", ".desktop-runtime", "harness");
const NODE_MODULES_MIN_PACKAGES = 200;
const EXPECTED_RUNTIME_DIRS = ["apps", "node_modules"];

function failIntegrity(message) {
  console.error(`\n[build-desktop] integrity check failed: ${message}\n`);
  process.exit(1);
}

function checkHarnessDir() {
  if (!fs.existsSync(HARNESS_DIR)) {
    failIntegrity(`harness dir does not exist at ${HARNESS_DIR}`);
  }

  const present = new Set(fs.readdirSync(HARNESS_DIR));
  for (const required of EXPECTED_RUNTIME_DIRS) {
    if (!present.has(required)) {
      failIntegrity(`harness/${required} is missing from staged dir`);
    }
  }

  const nodeModulesDir = path.join(HARNESS_DIR, "node_modules");
  const packages = fs.readdirSync(nodeModulesDir);
  if (packages.length < NODE_MODULES_MIN_PACKAGES) {
    failIntegrity(
      `harness/node_modules has only ${packages.length} top-level entries ` +
      `(expected >= ${NODE_MODULES_MIN_PACKAGES}); packaging would produce ` +
      `a release with no runtime dependencies`,
    );
  }

  console.log(
    `[build-desktop] integrity check passed: ` +
    `${packages.length} packages under harness/node_modules`,
  );
}

async function main() {
  checkHarnessDir();

  try {
    await build({
      win: ["nsis"],
      publish: "never",
      config: {
        // The package.json "build" field is loaded automatically; we just
        // need to make sure the cwd is correct.
      },
    });
  } catch (error) {
    let msg;
    try {
      msg =
        typeof error === "string"
          ? error
          : error?.stack || error?.message || String(error);
    } catch {
      msg = "[unserializable error]";
    }

    if (msg.length > MAX_ERROR_LEN) {
      process.stderr.write(
        `\nBuild failed (error truncated to ${MAX_ERROR_LEN} chars):\n`,
      );
      process.stderr.write(msg.slice(0, MAX_ERROR_LEN));
      process.stderr.write("\n... [truncated]\n");
    } else {
      process.stderr.write(`\nBuild failed:\n${msg}\n`);
    }

    // If the error has a cause or additional data, print that too.
    if (error?.cause) {
      try {
        const cause = String(error.cause);
        process.stderr.write(
          `\nCaused by: ${cause.slice(0, MAX_ERROR_LEN)}\n`,
        );
      } catch {
        /* ignore */
      }
    }

    process.exit(1);
  }
}

main();
