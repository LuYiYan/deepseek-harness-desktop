const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let serverProcess;
let mainWindow;

app.setName("DeepSeek Harness");
app.setPath("userData", path.join(app.getPath("appData"), "DeepSeek Harness Desktop"));

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

function waitForServer(url, timeoutMs = 45000) {
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
    },
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
    ...serverCommand.options,
  });

  serverProcess.once("exit", (code, signal) => {
    serverProcess = undefined;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(getSplashHtml(`DeepSeek Harness service stopped. Code: ${code ?? signal ?? "unknown"}`));
    }
  });

  await waitForServer(url);
  return url;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#101418",
    title: "DeepSeek Harness",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(getSplashHtml("Starting the local Harness service..."));

  try {
    const url = await startHarnessServer();
    await mainWindow.loadURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mainWindow.loadURL(getSplashHtml(`Could not start DeepSeek Harness. ${message}`));
    dialog.showErrorBox("DeepSeek Harness failed to start", message);
  }
}

app.whenReady().then(createWindow);

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
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = undefined;
  }
});
