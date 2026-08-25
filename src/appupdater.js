// RoseLite's own updater. This is deliberately separate from updater.js, which
// drives ROSE Online's official game-file updater.
//
// Packaged Windows builds check the public GitHub release feed shortly after
// launch. Updates download in the background; the player can restart
// immediately or let electron-updater install the update when RoseLite exits.

function canAutoUpdate({ isPackaged, platform = process.platform, disabled = false }) {
  return isPackaged && platform === 'win32' && !disabled;
}

function startAppUpdater({ app, dialog, getWindow, updater, logger = console, delayMs = 2000, platform = process.platform }) {
  const disabled = process.env.ROSELITE_NOUPDATE === '1';
  if (!canAutoUpdate({ isPackaged: app.isPackaged, platform, disabled })) return () => {};

  // Lazy-load so `node src/appupdater.js` and normal development runs do not
  // initialize Electron's updater machinery.
  const client = updater || require('electron-updater').autoUpdater;
  client.logger = logger;
  client.autoDownload = true;
  client.autoInstallOnAppQuit = true;

  let promptOpen = false;
  const onChecking = () => logger.info('[app-updater] checking for updates');
  const onAvailable = (info) => logger.info(`[app-updater] version ${info.version} available`);
  const onNotAvailable = () => logger.info('[app-updater] RoseLite is up to date');
  const onError = (err) => logger.warn('[app-updater] update check failed:', err.message || err);
  const onDownloaded = async (info) => {
    if (promptOpen) return;
    promptOpen = true;
    try {
      const options = {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'RoseLite update ready',
        message: `RoseLite ${info.version} is ready to install.`,
        detail: 'Restart RoseLite to finish the update. If you choose Later, it will install automatically when you close the app.'
      };
      const parent = getWindow && getWindow();
      const result = parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      if (result.response === 0) client.quitAndInstall(false, true);
    } catch (err) {
      logger.warn('[app-updater] could not show the restart prompt:', err.message || err);
    } finally {
      promptOpen = false;
    }
  };

  client.on('checking-for-update', onChecking);
  client.on('update-available', onAvailable);
  client.on('update-not-available', onNotAvailable);
  client.on('update-downloaded', onDownloaded);
  client.on('error', onError);

  const timer = setTimeout(() => {
    try {
      Promise.resolve(client.checkForUpdates()).catch(onError);
    } catch (err) {
      onError(err);
    }
  }, delayMs);

  return () => {
    clearTimeout(timer);
    client.removeListener('checking-for-update', onChecking);
    client.removeListener('update-available', onAvailable);
    client.removeListener('update-not-available', onNotAvailable);
    client.removeListener('update-downloaded', onDownloaded);
    client.removeListener('error', onError);
  };
}

module.exports = { canAutoUpdate, startAppUpdater };

if (require.main === module) {
  const assert = require('assert');
  const { EventEmitter } = require('events');

  (async () => {
    assert.strictEqual(canAutoUpdate({ isPackaged: true, platform: 'win32' }), true);
    assert.strictEqual(canAutoUpdate({ isPackaged: false, platform: 'win32' }), false);
    assert.strictEqual(canAutoUpdate({ isPackaged: true, platform: 'darwin' }), false);
    assert.strictEqual(canAutoUpdate({ isPackaged: true, platform: 'win32', disabled: true }), false);

    const client = new EventEmitter();
    let checks = 0, restarts = 0;
    client.checkForUpdates = async () => { checks += 1; };
    client.quitAndInstall = (silent, runAfter) => {
      assert.strictEqual(silent, false);
      assert.strictEqual(runAfter, true);
      restarts += 1;
    };
    const stop = startAppUpdater({
      app: { isPackaged: true },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      getWindow: () => null,
      updater: client,
      logger: { info() {}, warn() {} },
      delayMs: 0,
      platform: 'win32'
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.strictEqual(checks, 1);
    assert.strictEqual(client.autoDownload, true);
    assert.strictEqual(client.autoInstallOnAppQuit, true);
    client.emit('update-downloaded', { version: '9.9.9' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(restarts, 1);
    stop();
    assert.strictEqual(client.listenerCount('update-downloaded'), 0);
    console.log('appupdater.js self-check ok');
  })().catch((err) => { console.error(err); process.exitCode = 1; });
}
