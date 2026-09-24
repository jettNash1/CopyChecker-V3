const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function configurePlaywrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }

  if (!app.isPackaged) {
    return null;
  }

  const bundledPath = path.join(process.resourcesPath, 'playwright-browsers');
  if (fs.existsSync(bundledPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundledPath;
    return bundledPath;
  }

  return null;
}

module.exports = { configurePlaywrightBrowsersPath };
