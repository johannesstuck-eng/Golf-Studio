export type MediaKind = 'video' | 'audio';
export type SourceType = 'media' | 'group';

export interface Player {
    id: string;
    name: string;
}

export interface ProjectSettings {
    id: string;
    course: string;
    holes: 9 | 18;
    players: Player[];
    name: string;
    createdAt: string;
    orientation?: 'horizontal' | 'vertical';
    resolution?: '1080p' | '4K';
    frameRate?: 30 | 60;
}

export interface MediaItem {
    id: string;
    path: string;
    name: string;
    kind: MediaKind;
    device: string;
    deviceKey: string;
    recordedAt: string;
    durationSeconds: number;
    width: number | null;
    height: number | null;
    fps: number | null;
    codec: string;
    audioCodec: string | null;
    hasAudio: boolean;
    sizeBytes: number;
    containerFormat?: string;
    bitRate?: number | null;
    pixelFormat?: string | null;
    bitDepth?: number | null;
    colorSpace?: string | null;
    colorTransfer?: string | null;
    colorPrimaries?: string | null;
    audioSampleRate?: number | null;
    audioChannels?: number | null;
}

export type ExportProfileId = 'source-matched' | 'lossless-master';

export interface ExportRequest {
    project: GolfProject;
    sequenceIds: string[];
    profile: ExportProfileId;
}

export interface ExportProgress {
    phase: 'preparing' | 'encoding' | 'complete' | 'error' | 'canceled';
    percent: number;
    message: string;
    outputPath?: string;
}

export type MediaEngineState = 'ready' | 'missing' | 'not-executable' | 'wrong-binary' | 'incompatible' | 'timed-out' | 'failed';

export interface MediaEngineBinaryStatus {
    state: MediaEngineState;
    ready: boolean;
    source: 'bundled' | 'environment';
    version?: string;
    message: string;
}

export interface MediaEngineStatus {
    ready: boolean;
    ffmpeg: MediaEngineBinaryStatus;
    ffprobe: MediaEngineBinaryStatus;
}

export interface MulticamSuggestion {
    id: string;
    mediaIds: string[];
    startAt: string;
    endAt: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
}

export interface MulticamGroup {
    id: string;
    name: string;
    mediaIds: string[];
    createdAt: string;
    syncStatus: 'timestamp-only' | 'manual' | 'audio';
    syncOffsetsSeconds?: Record<string, number>;
}

export type MulticamSyncConfidence = 'high' | 'medium' | 'low';

export interface MulticamAudioSyncRequest {
    groupId: string;
    media: Array<Pick<MediaItem, 'id' | 'path' | 'recordedAt' | 'durationSeconds' | 'hasAudio'>>;
}

export interface MulticamAudioSyncResult {
    groupId: string;
    referenceMediaId: string | null;
    referenceByMediaId: Record<string, string>;
    offsetsSeconds: Record<string, number>;
    confidenceByMediaId: Record<string, MulticamSyncConfidence>;
    waveforms: Record<string, number[]>;
    failures: string[];
}

export interface MulticamSyncProgress {
    groupId: string;
    completed: number;
    total: number;
    message: string;
}

export interface GolfBlock {
    id: string;
    hole: number;
    playerId: string;
    type: BlockType;
    label: string;
    order: number;
    sequenceIds: string[];
    details: ShotDetails;
}

export interface ShotDetails {
    shotNumber: number | null;
    club: string;
    distanceMeters: number | null;
    result: string;
    notes: string;
}

export interface HoleData {
    number: number;
    par: number;
    lengthMeters: number | null;
    strokeIndex: number | null;
    teeColor: string;
}

export interface PlayerHoleScore {
    hole: number;
    playerId: string;
    strokes: number | null;
}

export interface CourseData {
    scorecardSourcePath: string | null;
    holes: HoleData[];
}

export interface ScorecardHoleCandidate {
    number: number;
    sourceLabel: string;
    par: number;
    lengthMeters: number;
    strokeIndex: number;
}

export interface ScorecardTeeCandidate {
    id: string;
    label: string;
    holes: ScorecardHoleCandidate[];
}

export interface ScorecardAnalysis {
    status: 'ready' | 'manual';
    tees: ScorecardTeeCandidate[];
    warnings: string[];
}

export interface ScorecardChooseResult extends ScorecardAnalysis {
    canceled: boolean;
    path?: string;
}

export interface VirtualSequence {
    id: string;
    sourceType: SourceType;
    sourceId: string;
    inFrame: number;
    outFrame: number;
    sourceFps: number;
    activeMediaId?: string;
    multicamAngles?: MulticamAngle[];
    /**
     * Final picture decisions for this moment. Times are integer microseconds,
     * relative to the start of the sequence. Cuts must be ordered, contiguous,
     * non-overlapping and cover the complete sequence duration.
     */
    videoCuts?: VideoCut[];
    /** Audio is deliberately independent from picture cuts. */
    audioPlan?: AudioPlan;
    review?: SequenceReview;
    targetBlockId: string;
    createdAt: string;
    updatedAt: string;
}

export interface VideoCut {
    id: string;
    /** Null is an unresolved source and must block final rendering. */
    mediaId: string | null;
    /** Inclusive start, relative to the sequence start. */
    startUs: number;
    /** Exclusive end, relative to the sequence start. */
    endUs: number;
    origin: VideoCutOrigin;
    locked?: boolean;
}

export type VideoCutOrigin = 'automatic' | 'manual' | 'mixed' | 'migrated';

export interface AudioPlan {
    /** A fixed source for continuous audio; null is valid only in muted mode. */
    mediaId: string | null;
    mode: 'master' | 'follow-camera' | 'muted';
    /** Fine adjustment relative to the synchronized sequence timeline. */
    offsetUs: number;
    gainDb: number;
    muted: boolean;
}

export interface SequenceReview {
    status: 'unreviewed' | 'needs-review' | 'approved';
    /** Fingerprint of the render-relevant state that was approved. */
    reviewedFingerprint: string | null;
}

export interface MulticamAngle {
    mediaId: string;
    inFrame: number;
    outFrame: number;
    sourceFps: number;
}

export type OverlayType = 'player-card' | 'hole-info' | 'score-card';
export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface SequenceOverlay {
    id: string;
    sequenceId: string;
    type: OverlayType;
    enabled: boolean;
    startFrame: number;
    endFrame: number;
    position: OverlayPosition;
}

export interface ShotTracerPoint {
    frame: number;
    x: number;
    y: number;
    kind?: 'impact' | 'curve' | 'intermediate' | 'landing';
}

export interface CameraLockPoint {
    x: number;
    y: number;
}

export interface ShotTracerCameraLock {
    referenceFrame: number;
    targetFrame: number;
    referencePoints: [CameraLockPoint, CameraLockPoint];
    targetPoints: [CameraLockPoint, CameraLockPoint];
}

export interface ShotTracerEffect {
    id: string;
    sequenceId: string;
    /** The exact picture decision and camera for which the tracer is calibrated. */
    binding?: ShotTracerBinding;
    enabled: boolean;
    impactFrame: number | null;
    endFrame: number | null;
    disappearFrame: number | null;
    points: ShotTracerPoint[];
    color: string;
    thickness: number;
    glow: number;
    smoothing: number;
    tailLength: number;
    occlusionStartFrame: number | null;
    occlusionEndFrame: number | null;
    cameraLock: ShotTracerCameraLock | null;
}

export interface ShotTracerBinding {
    cutId?: string;
    mediaId?: string;
}

export interface PlayerOrder {
    hole: number;
    blockOrder: number;
    playerIds: string[];
}

export interface HoleBlockOrder {
    hole: number;
    blockIds: string[];
}

export interface GolfProject {
    schemaVersion: number;
    settings: ProjectSettings;
    media: MediaItem[];
    suggestions: MulticamSuggestion[];
    groups: MulticamGroup[];
    blocks: GolfBlock[];
    sequences: VirtualSequence[];
    overlays: SequenceOverlay[];
    shotTracers: ShotTracerEffect[];
    playerOrders: PlayerOrder[];
    holeBlockOrders: HoleBlockOrder[];
    courseData: CourseData;
    playerScores: PlayerHoleScore[];
    modifiedAt: string;
}

export const BLOCK_TYPES = [
    ['tee-shot', 'Tee Shot'],
    ['approach', 'Approach'],
    ['greenside', 'Greenside'],
    ['bunker', 'Bunker'],
    ['putt', 'Putt'],
    ['extra-shot', 'Zusätzlicher Schlag'],
    ['penalty', 'Penalty / Sonderfall'],
    ['hole-intro', 'Loch-Intro'],
    ['course', 'Platzaufnahme'],
    ['cart-cam', 'Cart-Cam'],
    ['banter', 'Banter'],
    ['pre-shot', 'Pre-Shot Commentary'],
    ['post-shot', 'Post-Shot Commentary'],
    ['reaction', 'Reaktion'],
    ['hole-outro', 'Lochabschluss'],
    ['score-update', 'Score-Update'],
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number][0];

export interface SequenceDraft {
    id?: string;
    sourceType: SourceType;
    sourceId: string;
    inFrame: number;
    outFrame: number;
    sourceFps: number;
    activeMediaId?: string;
    multicamAngles?: MulticamAngle[];
    hole: number;
    playerId: string;
    blockType: BlockType;
    targetBlockId?: string;
}
