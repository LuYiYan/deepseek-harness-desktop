const { app, BrowserWindow, dialog, Menu, nativeImage, Notification, Tray } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let serverProcess;
let mainWindow;
let tray;
let isQuitting = false;

app.setName("DeepSeek Harness");
app.setPath("userData", path.join(app.getPath("appData"), "DeepSeek Harness Desktop"));

// A second launch focuses the existing window instead of booting a second
// server and profile. Acquired before ready so the losing process quits
// without touching userData.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function getHarnessRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "harness");
  }

  return path.resolve(__dirname, "../../..");
}

function getCliBin(harnessRoot) {
  return path.join(harnessRoot, "apps", "cli", "lib", "bin.js");
}

function getNodeExecutable() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "node", "node.exe");
  }

  return process.env.DSH_DESKTOP_NODE || "node";
}

// Packaged installs get a dedicated, per-user harness home under the app's
// userData, so the installed app never touches a developer's real ~/.dsh and
// has a predictable place to seed first-run configuration. Development keeps
// the ambient environment (and therefore the developer's own ~/.dsh).
function getDshHome() {
  return app.isPackaged ? app.getPath("userData") : undefined;
}

function getSeedRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "seed")
    : path.join(__dirname, "..", "seed");
}

// Windows Defender's real-time protection re-scans every module file the Node
// backend reads during cold boot (13k+ files), which dominates first-launch
// startup time on Windows. On the first launch of a packaged build, offer to
// add the install directory, the per-user harness home, and the two runtime
// executables to Defender's exclusion list once, through an elevated
// PowerShell (a single UAC prompt). A marker file records the attempt so the
// prompt is never re-raised; a declined UAC is respected. The whole step is
// best-effort and idempotent.
function maybeInstallDefenderExclusions() {
  if (process.platform !== "win32" || !app.isPackaged) return;

  const home = app.getPath("userData");
  const marker = path.join(home, ".defender-exclusions-attempted");
  if (fs.existsSync(marker)) return;

  // Record the attempt up front so a declined prompt does not reappear on
  // every launch. Success cannot be cheaply verified from here (reading
  // exclusions requires elevation), so the marker is not gated on it.
  try {
    fs.writeFileSync(marker, String(Date.now()));
  } catch {
    return;
  }

  const singleQuote = (value) => "'" + String(value).replace(/'/g, "''") + "'";
  const script = [
    "$ErrorActionPreference = 'Continue'",
    `Add-MpPreference -ExclusionPath ${singleQuote(path.dirname(process.resourcesPath))}`,
    `Add-MpPreference -ExclusionPath ${singleQuote(home)}`,
    `Add-MpPreference -ExclusionProcess ${singleQuote(process.execPath)}`,
    `Add-MpPreference -ExclusionProcess ${singleQuote(path.join(process.resourcesPath, "node", "node.exe"))}`,
  ].join("; ");

  // `-EncodedCommand` (UTF-16LE base64) carries the script through
  // `Start-Process -Verb RunAs` without any quoting loss.
  const encoded = Buffer.from(script, "utf16le").toString("base64");

  try {
    spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    ).unref();
  } catch {
    // Startup must never depend on this optimization succeeding.
  }
}

// Copy the bundled first-run environment into the harness home on the first
// launch only: existing user files are never overwritten, so a later edit or a
// key rotation survives restarts and re-installs.
function seedFirstRunEnvironment(home) {
  const seedRoot = getSeedRoot();
  if (!fs.existsSync(seedRoot)) return;
  fs.mkdirSync(home, { recursive: true });
  for (const name of [".credentials.yaml", "settings.yaml"]) {
    const source = path.join(seedRoot, name);
    const target = path.join(home, name);
    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.copyFileSync(source, target);
    }
  }
}

function getServerCommand(cliBin, host, port) {
  if (app.isPackaged) {
    const patchPath = path.join(app.getPath("userData"), "desktop.patch.yml");
    fs.writeFileSync(patchPath, [
      "- id: hmr",
      "  disabled: true",
      "- id: 5b3301cd",
      "  disabled: true",
      "",
    ].join("\n"));

    return {
      command: getNodeExecutable(),
      args: [cliBin, "web", "--patch", patchPath, "--host", host, "--port", String(port)],
      options: { windowsHide: true },
    };
  }

  const pnpm = process.env.DSH_DESKTOP_PNPM || "pnpm";
  const args = ["dsh", "web", "--host", host, "--port", String(port)];

  return {
    command: pnpm,
    args,
    options: process.platform === "win32" ? { shell: true } : {},
  };
}

function getSplashHtml(message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>DeepSeek Harness</title>
        <style>
          body {
            margin: 0;
            font-family: Segoe UI, Arial, sans-serif;
            background: #101418;
            color: #eef3f7;
            display: grid;
            min-height: 100vh;
            place-items: center;
          }
          main {
            width: min(420px, calc(100vw - 48px));
          }
          h1 {
            font-size: 24px;
            font-weight: 650;
            margin: 0 0 12px;
            letter-spacing: 0;
          }
          p {
            color: #aeb8c2;
            font-size: 14px;
            line-height: 1.55;
            margin: 0;
          }
          .bar {
            height: 3px;
            background: #2a333c;
            margin-top: 24px;
            overflow: hidden;
          }
          .bar::before {
            animation: slide 1.25s infinite ease-in-out;
            background: #55d18f;
            content: "";
            display: block;
            height: 100%;
            width: 38%;
          }
          @keyframes slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(270%); }
          }
        </style>
      </head>
      <body>
        <main>
          <h1>DeepSeek Harness</h1>
          <p>${message}</p>
          <div class="bar"></div>
        </main>
      </body>
    </html>
  `)}`;
}

function findFreePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

// First boot composes the whole web profile and can be slow on a cold disk or
// under antivirus scanning, so the readiness window is generous (2 minutes);
// a real crash is surfaced sooner by the exit race in startHarnessServer.
function waitForServer(url, timeoutMs = 120000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(attempt, 500);
      });

      request.setTimeout(2000, () => {
        request.destroy();
      });
    };

    attempt();
  });
}

async function startHarnessServer() {
  const host = "127.0.0.1";
  const port = app.isPackaged ? await findFreePort(host) : 3080;
  const harnessRoot = getHarnessRoot();
  const cliBin = getCliBin(harnessRoot);
  const url = `http://${host}:${port}`;
  const logDir = path.join(app.getPath("userData"), "logs");

  const dshHome = getDshHome();
  if (dshHome !== undefined) seedFirstRunEnvironment(dshHome);

  if (!app.isPackaged) {
    try {
      await waitForServer(url, 1500);
      return url;
    } catch {
      // No existing dev server on the conventional port; start one below.
    }
  }

  fs.mkdirSync(logDir, { recursive: true });

  const stdout = fs.openSync(path.join(logDir, "dsh-web.out.log"), "a");
  const stderr = fs.openSync(path.join(logDir, "dsh-web.err.log"), "a");

  const serverCommand = getServerCommand(cliBin, host, port);

  serverProcess = spawn(serverCommand.command, serverCommand.args, {
    cwd: harnessRoot,
    env: {
      ...process.env,
      CI: "true",
      PNPM_CONFIG_CONFIRM_MODULES_PURGE: "false",
      ...(dshHome !== undefined ? { DSH_HOME: dshHome } : {}),
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
    ...serverCommand.options,
  });

  // Fail the startup wait as soon as the child exits, instead of waiting out
  // the full timeout; a later exit (after the app is running) still updates
  // the splash through the same handler.
  const serverExited = new Promise((_, reject) => {
    serverProcess.once("exit", (code, signal) => {
      serverProcess = undefined;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(getSplashHtml(`DeepSeek Harness 服务已停止。代码：${code ?? signal ?? "unknown"}`));
      }

      if (!isQuitting && Notification.isSupported()) {
        new Notification({
          title: "DeepSeek Harness",
          body: `Harness 服务已停止。代码：${code ?? signal ?? "unknown"}`,
        }).show();
      }

      reject(new Error(`Service exited with code ${code ?? signal ?? "unknown"}`));
    });
  });

  await Promise.race([waitForServer(url), serverExited]);
  return url;
}

// ---------- window state ----------
const windowStateFile = path.join(app.getPath("userData"), "window-state.json");

function loadWindowBounds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStateFile, "utf8"));
    const bounds = {};
    for (const key of ["width", "height", "x", "y"]) {
      if (typeof parsed?.[key] === "number") bounds[key] = parsed[key];
    }
    return bounds;
  } catch {
    // First launch or a corrupt state file: fall back to defaults.
    return {};
  }
}

function persistWindowBounds() {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return;
  try {
    fs.writeFileSync(windowStateFile, JSON.stringify(mainWindow.getNormalBounds()));
  } catch {
    // Best-effort: a failed write must not affect shutdown.
  }
}

// ---------- tray ----------
function showMainWindow() {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  // The harness badge is the only packaged icon asset; resize it to a
  // tray-suitable 16px. Replace with a dedicated app icon when one lands.
  const badgePath = path.join(getHarnessRoot(), "packages", "skill", "skill-badge", "assets", "dsh-badge.png");
  let icon = nativeImage.createEmpty();
  try {
    icon = nativeImage.createFromPath(badgePath).resize({ width: 16, height: 16 });
  } catch {
    // Empty icon keeps the tray entry without a visible glyph.
  }
  tray = new Tray(icon);
  tray.setToolTip("DeepSeek Harness");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示 DeepSeek Harness", click: () => showMainWindow() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
  tray.on("click", () => showMainWindow());
}

// ---------- auto-update ----------
// Best-effort: a missing publish config, an offline network, or a
// code-signature mismatch must never block startup. Updates are downloaded in
// the background and installed on next launch.
function maybeCheckForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Best-effort: an update check failure is never fatal.
    });
  } catch {
    // electron-updater absent or an update check error; startup continues.
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    ...loadWindowBounds(),
    backgroundColor: "#101418",
    title: "DeepSeek Harness",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("close", persistWindowBounds);
  mainWindow.loadURL(getSplashHtml("正在启动本地 Harness 服务..."));

  // Fire-and-forget: runs in parallel with the (slow) backend boot below and
  // never blocks it, whether the user answers the UAC prompt or not.
  maybeInstallDefenderExclusions();

  try {
    const url = await startHarnessServer();
    await mainWindow.loadURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mainWindow.loadURL(getSplashHtml(`无法启动 DeepSeek Harness。${message}`));
    dialog.showErrorBox("DeepSeek Harness 启动失败", message);
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    createTray();
    createWindow();
    maybeCheckForUpdates();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = undefined;
    }
  });
}
