const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('golfStudio', {
    isDesktop: true,
    platform: process.platform,
    chooseMedia: () => ipcRenderer.invoke('media:choose'),
    probeDroppedFiles: (files) => {
        const paths = files
            .map((file) => webUtils.getPathForFile(file))
            .filter(Boolean);
        return ipcRenderer.invoke('media:probe-paths', paths);
    },
    saveProject: (project) => ipcRenderer.invoke('project:save', project),
    openProject: () => ipcRenderer.invoke('project:open'),
    chooseScorecard: () => ipcRenderer.invoke('scorecard:choose'),
    exportVideo: (request) => ipcRenderer.invoke('export:start', request),
    cancelExport: () => ipcRenderer.invoke('export:cancel'),
    onExportProgress: (callback) => {
        const listener = (_event, progress) => callback(progress);
        ipcRenderer.on('export:progress', listener);
        return () => ipcRenderer.removeListener('export:progress', listener);
    },
});
