export type RenderDiagnosticSeverity = 'error' | 'warning';

export interface RenderDiagnostic {
    severity: RenderDiagnosticSeverity;
    code: string;
    message: string;
    sequenceId?: string;
    cutId?: string;
    mediaId?: string;
    tracerId?: string;
    blockId?: string;
    groupId?: string;
    order?: number;
}

export interface RenderPlanMedia {
    id: string;
    kind?: 'video' | 'audio';
    durationSeconds?: number;
    hasAudio?: boolean;
    [key: string]: unknown;
}

export interface RenderPlanGroup {
    id: string;
    mediaIds: string[];
    [key: string]: unknown;
}

export interface RenderPlanAngle {
    mediaId: string;
    /** Source-local range. New schemas should prefer microseconds. */
    sourceStartUs?: number;
    sourceEndUs?: number;
    inUs?: number;
    outUs?: number;
    /** Coverage on the moment-relative master timeline. */
    momentStartUs?: number;
    momentEndUs?: number;
    /** v8 compatibility fields. */
    inFrame?: number;
    outFrame?: number;
    sourceFps?: number;
    [key: string]: unknown;
}

export interface CameraCut {
    id: string;
    /** Half-open range relative to the moment. */
    startUs: number;
    endUs: number;
    mediaId: string | null;
    /** Optional explicit source-local override. */
    sourceStartUs?: number;
    sourceEndUs?: number;
    status?: string;
    locked?: boolean;
    [key: string]: unknown;
}

export interface AudioCut extends CameraCut {
    offsetUs?: number;
    gainDb?: number;
}

export interface AudioPlan {
    mediaId?: string | null;
    sourceMediaId?: string;
    sourceStartUs?: number;
    sourceEndUs?: number;
    cuts?: AudioCut[];
    mode?: 'master' | 'follow-camera' | 'muted';
    offsetUs?: number;
    gainDb?: number;
    muted?: boolean;
    status?: string;
    [key: string]: unknown;
}

export interface RenderPlanSequence {
    id: string;
    sourceType: 'media' | 'group';
    sourceId: string;
    targetBlockId: string;
    durationUs?: number;
    masterInUs?: number;
    masterOutUs?: number;
    videoCuts?: CameraCut[];
    audioCuts?: AudioCut[];
    audioPlan?: AudioPlan;
    review?: SequenceReview;
    multicamAngles?: RenderPlanAngle[];
    /** v8 compatibility fields. */
    inFrame?: number;
    outFrame?: number;
    sourceFps?: number;
    activeMediaId?: string;
    [key: string]: unknown;
}

export interface SequenceReview {
    status: 'unreviewed' | 'needs-review' | 'approved';
    reviewedFingerprint: string | null;
}

export interface TracerBinding {
    cutId?: string;
    mediaId?: string;
}

export interface RenderPlanTracer {
    id: string;
    sequenceId: string;
    enabled?: boolean;
    binding?: TracerBinding;
    startUs?: number;
    endUs?: number;
    impactFrame?: number | null;
    endFrame?: number | null;
    disappearFrame?: number | null;
    points?: Array<{ frame: number; x: number; y: number; [key: string]: unknown }>;
    [key: string]: unknown;
}

export interface RenderPlanProject {
    media: RenderPlanMedia[];
    groups: RenderPlanGroup[];
    sequences: RenderPlanSequence[];
    blocks: Array<{ id: string; hole?: number; playerId?: string; [key: string]: unknown }>;
    shotTracers?: RenderPlanTracer[];
    [key: string]: unknown;
}

export interface RenderVideoSegment {
    id: string;
    sequenceId: string;
    cutId: string;
    order: number;
    mediaId: string;
    blockId: string;
    startUs: number;
    endUs: number;
    filmStartUs: number;
    filmEndUs: number;
    sourceStartUs: number;
    sourceEndUs: number;
    sourceFps: number | null;
}

export interface RenderAudioSegment {
    id: string;
    sequenceId: string;
    audioCutId: string;
    mediaId: string;
    startUs: number;
    endUs: number;
    filmStartUs: number;
    filmEndUs: number;
    sourceStartUs: number;
    sourceEndUs: number;
    offsetUs: number;
    gainDb: number;
}

export interface TracerPlacement {
    id: string;
    tracerId: string;
    sequenceId: string;
    cutId: string;
    mediaId: string;
    startUs: number;
    endUs: number;
    filmStartUs: number;
    filmEndUs: number;
    effect: RenderPlanTracer;
}

export interface RenderMoment {
    sequenceId: string;
    order: number;
    blockId: string;
    hole: number | null;
    playerId: string | null;
    startUs: number;
    endUs: number;
    durationUs: number;
    videoSegmentIds: string[];
    audioSegmentIds: string[];
    tracerPlacementIds: string[];
    review: SequenceReview | null;
}

export interface RenderPlan {
    version: 1;
    valid: boolean;
    renderFingerprint: string;
    totalDurationUs: number;
    moments: RenderMoment[];
    videoSegments: RenderVideoSegment[];
    audioSegments: RenderAudioSegment[];
    tracerPlacements: TracerPlacement[];
    diagnostics: RenderDiagnostic[];
}

/**
 * Pure, deterministic compiler shared by preview and export. Invalid references
 * are reported as diagnostics; the compiler never substitutes another camera.
 */
export function compileRenderPlan(project: RenderPlanProject, sequenceIds: string[]): RenderPlan;
