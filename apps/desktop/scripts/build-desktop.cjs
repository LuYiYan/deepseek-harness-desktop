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

const MAX_ERROR_LEN = 20_000;

async function main() {
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
