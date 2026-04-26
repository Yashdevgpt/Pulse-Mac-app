const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

let serverProcess = null;
let mainWindow = null;
let serverPort = 0;

const findFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const resolveServerPath = () => {
  if (app.isPackaged) {
    // electron-builder copies the project (asar disabled) into Resources/app
    return path.join(process.resourcesPath, 'app', 'server.mjs');
  }
  return path.join(__dirname, '..', 'server.mjs');
};

const ensureUserEnv = () => {
  if (!app.isPackaged) return null;
  const userDataDir = app.getPath('userData');
  const envPath = path.join(userDataDir, '.env');
  if (fs.existsSync(envPath)) return envPath;

  fs.mkdirSync(userDataDir, { recursive: true });
  const templatePath = path.join(process.resourcesPath, 'app', '.env.example');
  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, envPath);
  } else {
    fs.writeFileSync(envPath, '# Pulse environment\n', 'utf8');
  }

  dialog.showMessageBoxSync({
    type: 'info',
    message: 'Pulse needs configuration',
    detail:
      `A starter .env was created at:\n\n${envPath}\n\n` +
      'Add your Supabase + Firebase keys, then re-open Pulse.\n\n' +
      'AI keys (Gemini / OpenRouter) are entered inside the app under Admin → AI Keys.',
    buttons: ['Reveal in Finder & Quit'],
  });
  shell.showItemInFolder(envPath);
  app.quit();
  return null;
};

const startServer = () =>
  new Promise(async (resolve, reject) => {
    const userEnvPath = ensureUserEnv();
    if (app.isPackaged && !userEnvPath) {
      reject(new Error('User config missing'));
      return;
    }

    const port = await findFreePort();
    serverPort = port;
    const serverPath = resolveServerPath();
    const cwd = path.dirname(serverPath);

    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Pulse server not found at ${serverPath}`));
      return;
    }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      DISABLE_HMR: 'true',
    };
    if (app.isPackaged) {
      env.PULSE_MODE = 'production';
      env.PULSE_ENV_PATH = userEnvPath;
    }

    serverProcess = spawn(process.execPath, [serverPath], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Pulse server did not start within 30s'));
      }
    }, 30_000);

    const onReady = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);
      if (!resolved && text.includes('Pulse running')) {
        resolved = true;
        clearTimeout(timeout);
        resolve(port);
      }
    };

    serverProcess.stdout.on('data', onReady);
    serverProcess.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));

    serverProcess.on('exit', (code, signal) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Pulse server exited before ready (code=${code} signal=${signal})`));
      }
      serverProcess = null;
    });
  });

const createWindow = (port) => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}/`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const buildAppMenu = () => {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

app.whenReady().then(async () => {
  buildAppMenu();
  try {
    const port = await startServer();
    createWindow(port);
  } catch (error) {
    console.error('Failed to start Pulse server:', error);
    dialog.showErrorBox('Pulse failed to start', String(error?.message || error));
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
      createWindow(serverPort);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});
