import type { ExportProgress, ExportRequest, GolfProject, MediaEngineStatus, MediaItem, MulticamAudioSyncRequest, MulticamAudioSyncResult, MulticamSyncProgress } from './types';

declare global {
    interface Window {
        golfStudio?: {
            isDesktop: boolean;
            platform: string;
            getMediaEngineStatus: (force?: boolean) => Promise<MediaEngineStatus>;
            openExternal: (url: string) => Promise<{ opened: boolean }>;
            chooseMedia: () => Promise<MediaItem[]>;
            probeDroppedFiles: (files: File[]) => Promise<MediaItem[]>;
            syncMulticamAudio: (request: MulticamAudioSyncRequest) => Promise<MulticamAudioSyncResult>;
            onMulticamSyncProgress: (callback: (progress: MulticamSyncProgress) => void) => () => void;
            saveProject: (project: GolfProject) => Promise<{ canceled: boolean; path?: string }>;
            openProject: () => Promise<{ canceled: boolean; path?: string; project?: unknown }>;
            chooseScorecard: () => Promise<{ canceled: boolean; path?: string }>;
            exportVideo: (request: ExportRequest) => Promise<{ canceled: boolean; path?: string; error?: string }>;
            cancelExport: () => Promise<{ canceled: boolean }>;
            onExportProgress: (callback: (progress: ExportProgress) => void) => () => void;
        };
    }
}

export {};
