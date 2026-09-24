const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { configurePlaywrightBrowsersPath } = require('./playwright-env');
const { initChecker } = require('./checker');
const { executeRun, cancelRun, shutdown } = require('./run-check');
const { IPC } = require('../shared/ipc');

configurePlaywrightBrowsersPath();

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
let isQuitting = false;

function getWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

function registerIpc() {
  ipcMain.handle(IPC.RUN, (_event, payload) => executeRun(payload, getWindow));
  ipcMain.on(IPC.CANCEL, () => cancelRun());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 640,
    title: 'CopyChecker',
    backgroundColor: '#FFFFFF',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await initChecker('en-GB');
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  cancelRun();
  shutdown().finally(() => app.quit());
});
