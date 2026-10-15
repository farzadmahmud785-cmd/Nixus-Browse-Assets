const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Nixus Browse",
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.setMenuBarVisibility(false);

    let activeDownloads = new Map();

    mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
        const downloadId = Date.now();
        const filename = item.getFilename();
        const filePath = path.join(app.getPath('downloads'), filename);
        item.setSavePath(filePath);

        activeDownloads.set(downloadId, item);
        const totalBytes = item.getTotalBytes();

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-started', {
                id: downloadId,
                name: filename,
                total: totalBytes
            });
        }

        item.on('updated', (event, state) => {
            if (state === 'progressing') {
                const received = item.getReceivedBytes();
                const total = item.getTotalBytes();
                const percent = total > 0 ? Math.round((received / total) * 100) : 0;
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('download-progress', {
                        id: downloadId,
                        percent: percent,
                        received: (received / (1024 * 1024)).toFixed(2),
                        total: (total / (1024 * 1024)).toFixed(2)
                    });
                }
            }
        });

        item.once('done', (event, state) => {
            activeDownloads.delete(downloadId);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download-completed', {
                    id: downloadId,
                    success: state === 'completed',
                    name: filename
                });
            }
        });
    });

    ipcMain.on('cancel-download', (event, downloadId) => {
        const item = activeDownloads.get(downloadId);
        if (item) {
            try {
                item.cancel();
            } catch (e) {}
            activeDownloads.delete(downloadId);
        }
    });

    // Intercept window close when downloads are running
    mainWindow.on('close', (e) => {
        if (activeDownloads.size > 0) {
            e.preventDefault();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('trigger-download-warning');
            }
        }
    });

    ipcMain.on('force-close-app', () => {
        activeDownloads.clear();
        app.exit(0);
    });
}

ipcMain.on('open-downloads', () => {
    shell.openPath(app.getPath('downloads'));
});

app.whenReady().then(async () => {
    const extensionsDir = path.join(__dirname, 'extensions');
    if (fs.existsSync(extensionsDir)) {
        const folders = fs.readdirSync(extensionsDir);
        for (const folder of folders) {
            const extPath = path.join(extensionsDir, folder);
            if (fs.statSync(extPath).isDirectory()) {
                try {
                    await session.defaultSession.loadExtension(extPath);
                } catch (err) {}
            }
        }
    }

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});