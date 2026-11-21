const { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } = require('electron');
const { watch } = require('node:fs');
const { link, readFile, readdir, realpath, rename, unlink, writeFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const appURL = 'plot://app/index.html';
const dist = path.join(__dirname, '../dist');
const extensions = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.fods', '.csv', '.tsv', '.tab', '.txt', '.json']);
const projectSuffix = '.sciplot.json';
protocol.registerSchemesAsPrivileged([{
  scheme: 'plot',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

let window;
let directoryWatcher;
let scanTimer;
let snapshot = { root: null, files: [], skipped: 0 };
let scanVersion = 0;
let folderDialogOpen = false;
const fitWindows = new Map();

const settingsPath = () => path.join(app.getPath('userData'), 'folder.json');

async function scanFolder(root) {
  const files = [];
  const folders = [root];
  let skipped = 0;
  while (folders.length) {
    const folder = folders.pop();
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (folder === root || !['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      if (error.code !== 'ENOENT') skipped += 1;
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        folders.push(absolute);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        const name = entry.name.toLowerCase();
        const kind = name.endsWith(projectSuffix) || /^sciplot-project(?: \(\d+\))?\.json$/.test(name)
          ? 'project' : 'data';
        files.push({ id: path.relative(root, absolute), name: entry.name, kind });
      }
    }
  }
  files.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { root, files, skipped };
}

async function refreshFolder() {
  const version = ++scanVersion;
  const { root } = snapshot;
  if (!root) return snapshot;
  let next;
  try {
    next = await scanFolder(root);
  } catch (error) {
    next = { root, files: [], skipped: 0, error: error.message };
  }
  if (version === scanVersion) {
    snapshot = next;
    if (window && !window.isDestroyed()) window.webContents.send('folder:changed', snapshot);
  }
  return snapshot;
}

function watchFolder(root) {
  directoryWatcher?.close();
  directoryWatcher = undefined;
  clearTimeout(scanTimer);
  snapshot = { root, files: [], skipped: 0 };
  const scheduleRefresh = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => void refreshFolder(), 250);
  };
  try {
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.split(path.sep).some((part) => part.startsWith('.') || part.startsWith('~$'))) {
        scheduleRefresh();
      }
    });
    directoryWatcher = watcher;
    watcher.on('error', () => {
      if (directoryWatcher !== watcher) return;
      watcher.close();
      directoryWatcher = undefined;
      scheduleRefresh();
    });
  } catch {
    // The scan reports inaccessible directories, and users can retry with Refresh.
  }
  return refreshFolder();
}

function fromApp(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromMainWindow(event)) throw new Error('Invalid application origin');
    return handler(...args);
  });
}

function fromMainWindow(event) {
  return window && event.sender === window.webContents && event.senderFrame?.url === appURL;
}

function lockNavigation(view, url) {
  view.webContents.on('will-navigate', (event, destination) => {
    if (destination !== url) event.preventDefault();
  });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

const webPreferences = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

function attachFitHandlers() {
  fromApp('fit:open', (data, title) => {
    if (typeof data?.chart?.id !== 'string' || !Array.isArray(data.datasets)) throw new Error('Invalid fit data');
    const bounds = window.getBounds();
    const work = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(900, work.width);
    const height = Math.min(620, work.height);
    const offset = (fitWindows.size % 8) * 28;
    const view = new BrowserWindow({
      title: typeof title === 'string' ? title.slice(0, 180) : 'Fit', show: false, width, height,
      minWidth: 600, minHeight: 420,
      x: Math.max(work.x, Math.min(work.x + work.width - width, bounds.x + 52 + offset)),
      y: Math.max(work.y, Math.min(work.y + work.height - height, bounds.y + 42 + offset)),
      webPreferences,
    });
    const id = view.webContents.id;
    const url = `${appURL}?fit=${id}`;
    fitWindows.set(id, { view, url, chartId: data.chart.id, data });
    lockNavigation(view, url);
    view.on('closed', () => {
      fitWindows.delete(id);
      if (window && !window.isDestroyed()) window.webContents.send('fit:closed', id);
    });
    view.once('ready-to-show', () => { if (!view.isDestroyed()) view.show(); });
    void view.loadURL(url).catch(() => { if (!view.isDestroyed()) view.destroy(); });
    return id;
  });
  ipcMain.on('fit:update', (event, id, data) => {
    if (!fromMainWindow(event)) return;
    const entry = fitWindows.get(id);
    if (!entry || (data !== null && data?.chart?.id !== entry.chartId)) return;
    entry.data = data;
    if (!entry.view.isDestroyed()) entry.view.webContents.send('fit:changed', data);
  });
  const fitEntry = (event) => {
    const entry = fitWindows.get(event.sender.id);
    if (!entry || event.senderFrame?.url !== entry.url) throw new Error('Invalid fit window');
    return entry;
  };
  ipcMain.handle('fit:get', (event) => fitEntry(event).data);
  ipcMain.handle('fit:apply', (event, models) => {
    const entry = fitEntry(event);
    if (!entry.data || !window || window.isDestroyed() || !Array.isArray(models) ||
        models.some((choice) => !Array.isArray(choice) || choice.length !== 3 ||
          typeof choice[0] !== 'string' || typeof choice[1] !== 'string' || typeof choice[2] !== 'boolean')) return false;
    window.webContents.send('fit:applied', entry.chartId, models);
    return true;
  });
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && !relative.split(path.sep).includes('..');
}

function attachFolderHandlers() {
  fromApp('folder:get', () => snapshot);
  fromApp('folder:refresh', refreshFolder);
  fromApp('folder:choose', async () => {
    if (folderDialogOpen) return snapshot;
    folderDialogOpen = true;
    try {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
      if (result.canceled) return snapshot;
      const root = await realpath(result.filePaths[0]);
      await writeFile(settingsPath(), JSON.stringify({ root }), 'utf8');
      return await watchFolder(root);
    } finally {
      folderDialogOpen = false;
    }
  });
  fromApp('folder:read', async (id) => {
    const { root, files } = snapshot;
    if (!root || typeof id !== 'string' || !files.some((file) => file.id === id)) {
      throw new Error('File no longer belongs to the selected folder');
    }
    const candidate = path.join(root, id);
    if (await realpath(candidate) !== candidate || root !== snapshot.root) {
      throw new Error('The selected file has moved');
    }
    const bytes = await readFile(candidate);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
  fromApp('folder:saveProject', async (json, name, directory) => {
    const { root } = snapshot;
    if (!root || typeof json !== 'string' || typeof name !== 'string' || typeof directory !== 'string') {
      throw new Error('Invalid project save request');
    }
    const candidate = path.resolve(root, directory);
    const preferred = insideRoot(root, candidate) ? await realpath(candidate).catch(() => root) : root;
    const safeName = name.replace(/[\\/:\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(0, 64) || 'sciplot-project';
    const result = await dialog.showSaveDialog(window, {
      defaultPath: path.join(insideRoot(root, preferred) ? preferred : root, safeName + projectSuffix),
      filters: [{ name: 'SciPlot', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const parent = await realpath(path.dirname(result.filePath));
    const filename = path.basename(result.filePath);
    const target = path.join(parent, filename.toLowerCase().endsWith(projectSuffix) ? filename : `${filename.replace(/\.json$/i, '')}${projectSuffix}`);
    const relative = path.relative(root, target);
    if (root !== snapshot.root || !insideRoot(root, target) || relative.split(path.sep).some((part) => part.startsWith('.') || part.startsWith('~$'))) {
      throw new Error('Choose a visible location inside the connected folder');
    }
    const temporary = path.join(parent, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, json, { encoding: 'utf8', flag: 'wx' });
      if (root !== snapshot.root) throw new Error('The connected folder changed');
      // The dialog confirmed replacement only for its original path.
      if (target === result.filePath) await rename(temporary, target);
      else await link(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    await refreshFolder();
    return relative;
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 850,
    minWidth: 900,
    minHeight: 550,
    webPreferences,
  });
  lockNavigation(window, appURL);
  window.on('closed', () => {
    window = undefined;
    for (const entry of fitWindows.values()) if (!entry.view.isDestroyed()) entry.view.destroy();
  });
  return window.loadURL(appURL);
}

app.whenReady().then(async () => {
  protocol.handle('plot', (request) => {
    const url = new URL(request.url);
    const resource = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (url.hostname !== 'app' || !resource.startsWith(dist + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(resource).href);
  });
  attachFolderHandlers();
  attachFitHandlers();
  await createWindow();
  try {
    const settings = JSON.parse(await readFile(settingsPath(), 'utf8'));
    if (typeof settings.root === 'string' && path.isAbsolute(settings.root)) {
      const root = await realpath(settings.root).catch(() => settings.root);
      await watchFolder(root);
    }
  } catch {
    // First launch or a damaged setting. The window prompts for a folder.
  }
  app.on('activate', () => { if (!window) void createWindow(); });
});

app.on('before-quit', () => {
  clearTimeout(scanTimer);
  directoryWatcher?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
