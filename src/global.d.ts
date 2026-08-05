import type { ExportProgress, ExportRequest, GolfProject, MediaItem } from './types';

declare global {
    interface Window {
        golfStudio?: {
            isDesktop: boolean;
            platform: string;
            openExternal: (url: string) => Promise<{ opened: boolean }>;
            chooseMedia: () => Promise<MediaItem[]>;
            probeDroppedFiles: (files: File[]) => Promise<MediaItem[]>;
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
