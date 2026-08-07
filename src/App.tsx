import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Aperture, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarClock, Camera, Check, ChevronLeft, ChevronRight,
    CircleHelp, ClipboardList, Clock3, Copy, Download, FileAudio, FileVideo, Film, Flag, FolderOpen, HardDrive,
    GripVertical, ImageUp, Import, Layers, LayoutDashboard, LayoutGrid, ListOrdered, MonitorPlay, Pause, Pencil, Play, Plus, RotateCcw, Save,
    Crosshair, Scissors, Settings2, ShieldCheck, SkipBack, SkipForward, Sparkles, Trash2, Trophy, Users, WandSparkles, X,
} from 'lucide-react';
import {
    addBlock, addCountedStroke, applyScorecardTee, blockLabel, clearHoleBlockOrderOverride, clearPlayerOrderOverride, createProject, deleteBlock, duplicateBlock,
    effectiveHoleBlockOrder, effectivePlayerOrder, hasHoleBlockOrderOverride, hasPlayerOrderOverride, markSequenceReviewed, moveBlock, moveBlockInHoleOrder, moveBlockInHoleOrderBy, movePlayerInOrder, moveSequence,
    multicamAnglesForRange, multicamMediaStartMs, multicamSyncOffset, multicamTimeline, normalizeProject, playerScoreToPar, proposeShotTracer, removeSequence, roughCutSequenceIds, setMulticamSyncOffset, setMulticamSyncOffsets, setScorecardSource, setSequenceCameraCutBoundary, setSequenceCameraForMoment, setSequenceCameraFrom,
    playerHoleStrokeCount, setMediaAssignedHole, strokeNumberForBlock, suggestMulticam, toggleSequenceOverlay, toggleShotTracer, updateBlockDetails, updateHoleData, updatePlayerScore,
    updateProjectSettings, updateSequenceOverlay, updateShotTracer, upsertSequence,
} from './model';
import {
    BLOCK_TYPES,
    type BlockType,
    type ExportProfileId,
    type ExportProgress,
    type GolfBlock,
    type GolfProject,
    type MediaItem,
    type MediaEngineStatus,
    type MulticamAudioSyncResult,
    type MulticamAngle,
    type MulticamGroup,
    type MulticamSyncProgress,
    type OverlayPosition,
    type OverlayType,
    type ProjectSettings,
    type ScorecardChooseResult,
    type ShotTracerEffect,
    type CameraLockPoint,
    type ShotTracerCameraLock,
    type ShotTracerPoint,
    type SourceType,
    type VirtualSequence,
} from './types';
import { detectBallCandidates, localBallCandidates, type BallCandidate } from './ballDetection';
import { tracerVisualState } from './tracerPlayback';
import { buildExportSummary } from './exportProfile';
import { EDITORIAL_STYLE, editorialTransition, scoreBeforeHole } from './editorialStyle';
import { createTracerFlight, insertTracerIntermediate } from './tracerWorkflow';
import { lockTracerPointsToWorld, screenToWorld, svgCameraMatrix, worldToScreen } from './cameraLock';
import { Dashboard } from './AgentDashboard';
import { firstSequenceForHole, sequenceProductionStatus, summarizeRoundDesk, type ProductionStatus } from './roundDesk';
import { nextPlayableMomentSeconds, sequencePlaybackAudioSource, sequencePlaybackSource, sequencePreviewSource, shouldAdvanceVideoCut } from './roughCut';
import { compileRenderPlan } from './renderPlan';

const makeId = () => crypto.randomUUID();
type StudioScreen = 'round' | 'import' | 'review' | 'build' | 'export';
type TracerWorkflowStep = 'impact-frame' | 'impact-point' | 'landing-frame' | 'landing-point' | 'intermediate-frame' | 'intermediate-point' | 'edit';
type CameraLockStep = 'impact-a' | 'impact-b' | 'landing-a' | 'landing-b';

function formatDuration(seconds: number): string {
    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const rest = rounded % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
        : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatClock(value: string): string {
    return value
        ? new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
        : 'Zeit unbekannt';
}

function frameTime(frame: number, fps: number): string {
    const seconds = frame / fps;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
}

async function seekVideoForAnalysis(video: HTMLVideoElement, seconds: number): Promise<void> {
    if (Math.abs(video.currentTime - seconds) < .0005 && video.readyState >= 2) return;
    await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Der Videoframe konnte nicht rechtzeitig gelesen werden.')); }, 1800);
        const cleanup = () => { window.clearTimeout(timeout); video.removeEventListener('seeked', done); video.removeEventListener('error', failed); };
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('Das Video konnte für die Analyse nicht gelesen werden.')); };
        video.addEventListener('seeked', done, { once: true });
        video.addEventListener('error', failed, { once: true });
        video.currentTime = seconds;
    });
}

async function analyzeVideoBallCandidates(video: HTMLVideoElement, sequence: VirtualSequence, relativeFrame: number, focus?: { x: number; y: number; radius: number }): Promise<BallCandidate[]> {
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('Warte kurz, bis das Video vollständig geladen ist.');
    const width = Math.min(640, video.videoWidth);
    const height = Math.max(1, Math.round(width / video.videoWidth * video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Die lokale Bildanalyse ist auf diesem System nicht verfügbar.');
    const originalTime = video.currentTime;
    const duration = sequence.outFrame - sequence.inFrame;
    const offsets = [0, 1, 2, 3, 5, 7].map((offset) => Math.min(duration - 1, Math.max(0, relativeFrame + offset)));
    const uniqueOffsets = [...new Set(offsets)];
    if (uniqueOffsets.length < 3) throw new Error('Für die Erkennung werden mindestens drei Frames nach dem Treffmoment benötigt.');
    const frames: Uint8ClampedArray[] = [];
    try {
        for (const offset of uniqueOffsets) {
            await seekVideoForAnalysis(video, (sequence.inFrame + offset) / sequence.sourceFps);
            context.drawImage(video, 0, 0, width, height);
            frames.push(context.getImageData(0, 0, width, height).data);
        }
    } finally {
        video.currentTime = originalTime;
    }
    return detectBallCandidates(frames, width, height, 4, focus);
}

function candidateToStage(candidate: BallCandidate, video: HTMLVideoElement, stage: HTMLElement): BallCandidate {
    const stageRect = stage.getBoundingClientRect();
    const videoRatio = video.videoWidth / video.videoHeight;
    const stageRatio = stageRect.width / stageRect.height;
    let displayWidth = stageRect.width;
    let displayHeight = stageRect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (videoRatio > stageRatio) {
        displayHeight = displayWidth / videoRatio;
        offsetY = (stageRect.height - displayHeight) / 2;
    } else {
        displayWidth = displayHeight * videoRatio;
        offsetX = (stageRect.width - displayWidth) / 2;
    }
    return {
        ...candidate,
        x: (offsetX + candidate.x * displayWidth) / stageRect.width,
        y: (offsetY + candidate.y * displayHeight) / stageRect.height,
    };
}

function stagePointToVideo(point: { x: number; y: number }, video: HTMLVideoElement, stage: HTMLElement): { x: number; y: number } {
    const stageRect = stage.getBoundingClientRect();
    const videoRatio = video.videoWidth / video.videoHeight;
    const stageRatio = stageRect.width / stageRect.height;
    let displayWidth = stageRect.width;
    let displayHeight = stageRect.height;
    let offsetX = 0;
    let offsetY = 0;
    if (videoRatio > stageRatio) { displayHeight = displayWidth / videoRatio; offsetY = (stageRect.height - displayHeight) / 2; }
    else { displayWidth = displayHeight * videoRatio; offsetX = (stageRect.width - displayWidth) / 2; }
    return {
        x: Math.min(1, Math.max(0, (point.x * stageRect.width - offsetX) / displayWidth)),
        y: Math.min(1, Math.max(0, (point.y * stageRect.height - offsetY) / displayHeight)),
    };
}

function fileUrl(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/').map((part, index) => (
        index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)
    ));
    return `file:///${parts.join('/')}`;
}

function Brand() {
    return <div className="brand"><span className="brand-mark"><Aperture size={20} /></span><span>CUT<b>18</b></span></div>;
}

interface SetupProps {
    onCreate: (settings: ProjectSettings) => void;
    onOpen: () => void;
    onRetryMediaEngine: () => void;
    onDashboard: () => void;
    error: string;
    mediaEngineStatus: MediaEngineStatus | null;
}

function SetupScreen({ onCreate, onOpen, onRetryMediaEngine, onDashboard, error, mediaEngineStatus }: SetupProps) {
    const [course, setCourse] = useState('');
    const [holes, setHoles] = useState<9 | 18>(9);
    const [players, setPlayers] = useState([{ id: makeId(), name: 'Joe' }, { id: makeId(), name: 'Ferdi' }]);
    const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
    const [resolution, setResolution] = useState<'1080p' | '4K'>('4K');
    const [frameRate, setFrameRate] = useState<30 | 60>(60);
    const valid = course.trim() && players.some((player) => player.name.trim());
    return <main className="setup-shell">
        <header className="setup-brand"><Brand /></header><button className="mission-entry setup" onClick={onDashboard}><LayoutDashboard size={16} /> Mission Control</button>
        <section className="setup-card">
            <div className="eyebrow"><span /> NEUES PROJEKT</div>
            <h1>Welche Runde<br />schneiden wir?</h1>
            <p className="setup-copy">Lege die Golfstruktur einmal an. Die App bereitet Löcher, Spieler und Schlagblöcke automatisch vor.</p>
            {error && <div className="error-banner">{error}</div>}
            {window.golfStudio && <div className={`media-engine-status ${mediaEngineStatus?.ready ? 'ready' : mediaEngineStatus ? 'error' : 'checking'}`} role={mediaEngineStatus && !mediaEngineStatus.ready ? 'alert' : 'status'}>
                <ShieldCheck size={16} />
                <div><b>{mediaEngineStatus?.ready ? 'Media Engine bereit' : mediaEngineStatus ? 'Media Engine nicht verfügbar' : 'Media Engine wird geprüft …'}</b>
                    <span>{mediaEngineStatus?.ready
                        ? `FFmpeg ${mediaEngineStatus.ffmpeg.version} · FFprobe ${mediaEngineStatus.ffprobe.version}`
                        : mediaEngineStatus
                            ? [mediaEngineStatus.ffmpeg, mediaEngineStatus.ffprobe].find((item) => !item.ready)?.message
                            : 'Import und Export werden lokal vorbereitet.'}</span>
                    {mediaEngineStatus && !mediaEngineStatus.ready && <button type="button" className="media-engine-retry" onClick={onRetryMediaEngine}><RotateCcw size={12} /> Erneut prüfen</button>}
                </div>
            </div>}
            <label className="field-label" htmlFor="course">Golfplatz</label>
            <div className="input-wrap"><Flag size={18} /><input id="course" value={course} onChange={(event) => setCourse(event.target.value)} placeholder="z. B. GC München Eichenried" autoFocus /></div>
            <div className="setup-row">
                <OptionButtons label="Anzahl Löcher" values={[9, 18]} value={holes} onChange={(value) => setHoles(value as 9 | 18)} suffix=" Loch" />
                <div><span className="field-label">Spieler</span><div className="player-count"><Users size={17} /> {players.length}</div></div>
            </div>
            <div className="player-heading"><span className="field-label">Spielernamen</span><button className="text-button" onClick={() => setPlayers((value) => [...value, { id: makeId(), name: '' }])}><Plus size={15} /> Spieler</button></div>
            <div className="player-list">{players.map((player, index) => <div className="player-input" key={player.id}>
                <span>{index + 1}</span><input value={player.name} onChange={(event) => setPlayers((value) => value.map((item) => item.id === player.id ? { ...item, name: event.target.value } : item))} placeholder={`Spieler ${index + 1}`} />
                {players.length > 1 && <button aria-label="Spieler entfernen" onClick={() => setPlayers((value) => value.filter((item) => item.id !== player.id))}><X size={15} /></button>}
            </div>)}</div>
            <div className="output-grid">
                <OptionButtons label="Format" values={['horizontal', 'vertical']} labels={['Horizontal', 'Vertikal']} value={orientation} onChange={(value) => setOrientation(value as 'horizontal' | 'vertical')} />
                <OptionButtons label="Auflösung" values={['1080p', '4K']} value={resolution} onChange={(value) => setResolution(value as '1080p' | '4K')} />
                <OptionButtons label="Framerate" values={[30, 60]} value={frameRate} onChange={(value) => setFrameRate(value as 30 | 60)} suffix=" fps" />
            </div>
            <button className="primary large" disabled={!valid} onClick={() => {
                const cleanPlayers = players.filter((player) => player.name.trim()).map((player) => ({ ...player, name: player.name.trim() }));
                const cleanCourse = course.trim();
                onCreate({ id: makeId(), course: cleanCourse, holes, players: cleanPlayers, name: `${cleanCourse} · ${holes} Loch`, createdAt: new Date().toISOString(), orientation, resolution, frameRate });
            }}>Projekt anlegen <span>→</span></button>
            <button className="open-existing" onClick={onOpen}><FolderOpen size={16} /> Vorhandenes Projekt öffnen</button>
        </section>
        <p className="local-note"><HardDrive size={14} /> Alle Aufnahmen bleiben auf deinem Rechner.</p>
    </main>;
}

function OptionButtons({ label, values, labels, value, onChange, suffix = '' }: { label: string; values: (string | number)[]; labels?: string[]; value: string | number; onChange: (value: string | number) => void; suffix?: string }) {
    return <div><span className="field-label">{label}</span><div className={`segmented columns-${values.length}`}>{values.map((item, index) => <button type="button" className={value === item ? 'active' : ''} onClick={() => onChange(item)} key={item}>{labels?.[index] ?? item}{suffix}</button>)}</div></div>;
}

function ProjectSettingsDialog({ project, onApply, onClose }: { project: GolfProject; onApply: (project: GolfProject) => void; onClose: () => void }) {
    const [draft, setDraft] = useState(project.settings);
    const [error, setError] = useState('');
    const inactiveSequences = draft.holes < project.settings.holes
        ? project.sequences.filter((sequence) => (project.blocks.find((block) => block.id === sequence.targetBlockId)?.hole ?? 0) > draft.holes).length
        : 0;
    const apply = () => {
        try {
            onApply(updateProjectSettings(project, draft));
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Die Projekteinstellungen konnten nicht gespeichert werden.');
        }
    };
    return <div className="data-editor-backdrop"><section className="project-settings-dialog"><header><div><div className="eyebrow"><span /> PROJEKTEINSTELLUNGEN</div><h2>Runde bearbeiten</h2><p>Diese Angaben steuern Sichtung, Round Builder und Export.</p></div><button className="preview-close" onClick={onClose}><X size={18} /></button></header>
        <div className="project-settings-form"><label className="wide"><span>Golfplatz / Projektname</span><input value={draft.course} onChange={(event) => setDraft({ ...draft, course: event.target.value })} /></label>
            <OptionButtons label="Rundenlänge" values={[9, 18]} value={draft.holes} onChange={(value) => setDraft({ ...draft, holes: value as 9 | 18 })} suffix=" Loch" />
            <OptionButtons label="Ausrichtung" values={['horizontal', 'vertical']} labels={['Querformat', 'Hochformat']} value={draft.orientation ?? 'horizontal'} onChange={(value) => setDraft({ ...draft, orientation: value as 'horizontal' | 'vertical' })} />
            <OptionButtons label="Auflösung" values={['1080p', '4K']} value={draft.resolution ?? '4K'} onChange={(value) => setDraft({ ...draft, resolution: value as '1080p' | '4K' })} />
            <OptionButtons label="Bildrate" values={[30, 60]} value={draft.frameRate ?? 60} onChange={(value) => setDraft({ ...draft, frameRate: value as 30 | 60 })} suffix=" fps" />
            <div className="settings-players wide"><span>Spieler</span>{draft.players.map((player, index) => <label key={player.id}><Users size={15} /><input value={player.name} onChange={(event) => setDraft({ ...draft, players: draft.players.map((item, playerIndex) => playerIndex === index ? { ...item, name: event.target.value } : item) })} /></label>)}</div>
            {draft.holes < project.settings.holes && <div className="settings-preserve-note wide"><ShieldCheck size={18} /><div><b>Loch 10–18 werden ausgeblendet, nicht gelöscht.</b><span>{inactiveSequences ? `${inactiveSequences} bereits zugewiesene Sequenzen bleiben erhalten und erscheinen wieder, wenn du auf 18 Loch zurückstellst.` : 'Falls dort schon Daten liegen, bleiben sie im Projekt erhalten.'}</span></div></div>}
            {error && <div className="inline-message wide">{error}</div>}
        </div><footer><button className="secondary" onClick={onClose}>Abbrechen</button><button className="primary" onClick={apply}><Check size={15} /> Änderungen übernehmen</button></footer></section></div>;
}

function TopBar({ project, screen, onScreen, onSave, onDashboard, onSettings }: { project: GolfProject; screen: StudioScreen; onScreen: (value: StudioScreen) => void; onSave: () => void; onDashboard: () => void; onSettings: () => void }) {
    return <header className="topbar"><Brand /><nav className="steps">
        <button className={screen === 'round' ? 'active round-step' : 'round-step'} onClick={() => onScreen('round')}><Flag size={14} /> Round Desk</button><i />
        <button className={screen === 'import' ? 'active' : project.media.length ? 'done' : ''} onClick={() => onScreen('import')}><b>1</b> Import</button><i />
        <button className={screen === 'review' ? 'active' : project.sequences.length ? 'done' : ''} onClick={() => onScreen('review')}><b>2</b> Sichten</button><i />
        <button className={screen === 'build' ? 'active' : screen === 'export' ? 'done' : ''} onClick={() => onScreen('build')}><b>3</b> Runde bauen</button><i /><button className={screen === 'export' ? 'active' : ''} onClick={() => onScreen('export')}><b>4</b> Export</button>
    </nav><div className="top-actions"><button className="icon-button" title="Projekteinstellungen" onClick={onSettings}><Settings2 size={18} /></button><button className="icon-button" title="Mission Control" onClick={onDashboard}><LayoutDashboard size={18} /></button><button className="icon-button" title="Hilfe"><CircleHelp size={19} /></button><button className="secondary" onClick={onSave}><Save size={16} /> Speichern</button></div></header>;
}

function Sidebar({ project, screen, onScreen, onNew }: { project: GolfProject; screen: StudioScreen; onScreen: (value: StudioScreen) => void; onNew: () => void }) {
    return <aside className="sidebar">
        <div className="project-summary"><span>AKTUELLES PROJEKT</span><h2>{project.settings.course}</h2><p>{project.settings.holes} Loch · {project.settings.players.map((player) => player.name).join(' & ')}</p></div>
        <div className="side-section"><div className="side-label">PROJEKT</div>
            <button className={`side-link ${screen === 'round' ? 'active' : ''}`} onClick={() => onScreen('round')}><Film size={17} /> Round Desk <span>{project.settings.holes}</span></button>
            <button className={`side-link ${screen === 'import' ? 'active' : ''}`} onClick={() => onScreen('import')}><Import size={17} /> Medienimport <span>{project.media.length || ''}</span></button>
            <button className={`side-link ${screen === 'review' ? 'active' : ''}`} onClick={() => onScreen('review')}><Scissors size={17} /> Sichten <span>{project.sequences.length || ''}</span></button>
            <button className={`side-link ${screen === 'build' ? 'active' : ''}`} onClick={() => onScreen('build')}><LayoutGrid size={17} /> Runde bauen <span>{project.settings.holes}</span></button>
            <button className={`side-link ${screen === 'export' ? 'active' : ''}`} onClick={() => onScreen('export')}><Download size={17} /> Export <span>{project.sequences.length || ''}</span></button>
            <button className="side-link"><Layers size={17} /> Multicam-Gruppen <span>{project.groups.length || ''}</span></button>
        </div>
        <div className="side-section holes-section"><div className="side-label">RUNDE</div><div className="holes-grid">{Array.from({ length: project.settings.holes }, (_, index) => <button key={index}>L{index + 1}</button>)}</div><p>{project.blocks.filter((block) => block.hole <= project.settings.holes).length} vorbereitete Golfblöcke · {project.sequences.length} Sequenzen</p></div>
        <button className="new-project" onClick={onNew}><Plus size={15} /> Neues Projekt</button>
    </aside>;
}

function MediaIcon({ media }: { media: MediaItem }) {
    return <div className={`media-icon ${media.kind}`}>{media.kind === 'audio' ? <FileAudio size={23} /> : <FileVideo size={23} />}<span>{media.kind === 'audio' ? 'AUDIO' : media.height && media.height >= 2160 ? '4K' : 'HD'}</span></div>;
}

function QuickSortMedia({ project, setProject, startMediaId, onClose }: { project: GolfProject; setProject: (project: GolfProject) => void; startMediaId?: string | null; onClose: () => void }) {
    const videos = project.media.filter((media) => media.kind === 'video');
    const requestedIndex = videos.findIndex((media) => media.id === startMediaId);
    const firstUnassigned = videos.findIndex((media) => !media.assignedHole);
    const [index, setIndex] = useState(Math.max(0, requestedIndex >= 0 ? requestedIndex : firstUnassigned));
    const current = videos[index];
    const assignedCount = videos.filter((media) => media.assignedHole).length;
    const move = useCallback((direction: -1 | 1) => setIndex((value) => Math.min(videos.length - 1, Math.max(0, value + direction))), [videos.length]);
    const assign = (hole: number | null) => {
        if (!current) return;
        setProject(setMediaAssignedHole(project, current.id, hole));
        if (index < videos.length - 1) setIndex(index + 1);
    };
    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if ((event.target as HTMLElement)?.matches('button, input, select, textarea')) return;
            if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
            if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [move, onClose]);
    if (!current) return null;
    return <div className="quick-sort-backdrop"><section className="quick-sort-dialog"><header><div><div className="eyebrow"><span /> SCHNELLSICHTUNG</div><h2>Clips vorsortieren</h2><p>Clip ansehen, Loch anklicken, nächster Clip. Die Zuordnung begleitet dich danach beim Sichten.</p></div><div className="quick-sort-progress"><b>{assignedCount}/{videos.length}</b><span>ZUGEORDNET</span></div><button className="icon-button" aria-label="Schnellsichtung schließen" onClick={onClose}><X size={18} /></button></header>
        <div className="quick-sort-body"><div className="quick-sort-viewer"><video key={current.id} src={fileUrl(current.path)} controls autoPlay preload="metadata" /><div className="quick-sort-clip-meta"><button disabled={index === 0} onClick={() => move(-1)}><ChevronLeft size={18} /></button><div><span>CLIP {index + 1} VON {videos.length}</span><b>{current.name}</b><small>{formatClock(current.recordedAt)} · {formatDuration(current.durationSeconds)} · {current.device}</small></div><button disabled={index === videos.length - 1} onClick={() => move(1)}><ChevronRight size={18} /></button></div></div>
            <aside className="quick-sort-holes"><div><span>AKTUELLE ZUORDNUNG</span><b>{current.assignedHole ? `LOCH ${current.assignedHole}` : 'NOCH OFFEN'}</b><small>Ein Klick speichert und springt weiter.</small></div><div className="quick-hole-grid">{Array.from({ length: project.settings.holes }, (_, holeIndex) => { const hole = holeIndex + 1; return <button className={current.assignedHole === hole ? 'active' : ''} onClick={() => assign(hole)} key={hole}><span>L</span>{hole}</button>; })}</div><button className="quick-sort-unassigned" onClick={() => assign(null)}>Ohne Zuordnung weiter</button></aside></div>
        <footer><span><kbd>←</kbd><kbd>→</kbd> Clip wechseln</span><div className="quick-sort-track"><i style={{ width: `${videos.length ? assignedCount / videos.length * 100 : 0}%` }} /></div><button className="primary" onClick={onClose}>Schnellsichtung beenden</button></footer>
    </section></div>;
}

interface ImportProps { project: GolfProject; setProject: (project: GolfProject) => void; onReview: (mediaId?: string) => void }

function ImportScreen({ project, setProject, onReview }: ImportProps) {
    const [dragging, setDragging] = useState(false);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [quickSortOpen, setQuickSortOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [syncingSuggestionId, setSyncingSuggestionId] = useState<string | null>(null);
    const [syncProgress, setSyncProgress] = useState<MulticamSyncProgress | null>(null);
    const suggestions = useMemo(() => suggestMulticam(project.media), [project.media]);
    const mergeMedia = (incoming: MediaItem[]) => {
        const known = new Set(project.media.map((media) => media.path.toLowerCase()));
        const additions = incoming.filter((media) => !known.has(media.path.toLowerCase()));
        const media = [...project.media, ...additions].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
        setProject({ ...project, media, suggestions: suggestMulticam(media), modifiedAt: new Date().toISOString() });
        if (additions[0]) setSelected(additions[0].id);
        setMessage(additions.length ? `${additions.length} Datei${additions.length === 1 ? '' : 'en'} importiert.` : 'Keine neuen unterstützten Dateien gefunden.');
    };
    const choose = async () => {
        if (!window.golfStudio) return setMessage('Die Desktop-Brücke ist nicht verfügbar. Bitte die App neu starten.');
        setBusy(true); setMessage('');
        try { mergeMedia(await window.golfStudio.chooseMedia()); }
        catch (error) { setMessage(error instanceof Error ? error.message : 'Import fehlgeschlagen.'); }
        finally { setBusy(false); }
    };
    const acceptGroup = async (groupId: string) => {
        const suggestion = suggestions.find((item) => item.id === groupId);
        if (!suggestion) return;
        if (project.groups.some((group) => group.mediaIds.length === suggestion.mediaIds.length && group.mediaIds.every((id) => suggestion.mediaIds.includes(id)))) return;
        const group: MulticamGroup = { id: makeId(), name: `Multicam ${project.groups.length + 1}`, mediaIds: suggestion.mediaIds, createdAt: new Date().toISOString(), syncStatus: 'timestamp-only' };
        const withGroup = { ...project, groups: [...project.groups, group], modifiedAt: new Date().toISOString() };
        setProject(withGroup);
        if (!window.golfStudio) return;
        setSyncingSuggestionId(groupId);
        setMessage('Multicam-Tonspuren werden automatisch synchronisiert …');
        const unsubscribe = window.golfStudio.onMulticamSyncProgress((progress) => { if (progress.groupId === group.id) setSyncProgress(progress); });
        try {
            const media = group.mediaIds.map((id) => withGroup.media.find((item) => item.id === id)).filter((item): item is MediaItem => Boolean(item));
            const result = await window.golfStudio.syncMulticamAudio({ groupId: group.id, media });
            const synchronized = Object.keys(result.offsetsSeconds).length >= 2
                ? setMulticamSyncOffsets(withGroup, group.id, result.offsetsSeconds, 'audio')
                : withGroup;
            setProject(synchronized);
            setMessage(Object.keys(result.offsetsSeconds).length >= 2
                ? `${group.name} wurde über ${Object.keys(result.offsetsSeconds).length} Tonspuren synchronisiert.`
                : `${group.name} wurde angelegt. Die Tonspuren waren nicht eindeutig; Zeitstempel bleiben aktiv.`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Die automatische Tonsynchronisierung ist fehlgeschlagen.');
        } finally {
            unsubscribe(); setSyncingSuggestionId(null); setSyncProgress(null);
        }
    };
    return <section className="workspace import-workspace">
        <div className="workspace-heading"><div><div className="eyebrow"><span /> MEDIENIMPORT</div><h1>Rohmaterial hinzufügen</h1><p>Videos und Audiodateien werden nur analysiert – niemals kopiert oder hochgeladen.</p></div>{project.media.length > 0 && <button className="primary" onClick={choose}><Plus size={16} /> Dateien hinzufügen</button>}</div>
        {message && <div className="inline-message">{message}</div>}
        <div className={`dropzone ${dragging ? 'dragging' : ''} ${project.media.length ? 'compact' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={async (event) => {
            event.preventDefault(); setDragging(false);
            if (!window.golfStudio) return setMessage('Die Desktop-Brücke ist nicht verfügbar.');
            setBusy(true);
            try { mergeMedia(await window.golfStudio.probeDroppedFiles([...event.dataTransfer.files])); }
            catch (error) { setMessage(error instanceof Error ? error.message : 'Import fehlgeschlagen.'); }
            finally { setBusy(false); }
        }}><div className="drop-icon"><Camera size={28} /></div><div><strong>{busy ? 'Metadaten werden analysiert …' : 'Dateien hier ablegen'}</strong><span>MP4, MOV, WAV, M4A und weitere · auch 4K/60 fps</span></div><button className="secondary" onClick={choose} disabled={busy}><FolderOpen size={16} /> Auswählen</button></div>
        {project.media.length > 0 ? <div className="content-grid"><section className="media-panel"><div className="panel-heading"><div><h3>Importierte Dateien</h3><span>{project.media.length} Dateien · {formatBytes(project.media.reduce((sum, media) => sum + media.sizeBytes, 0))}</span></div><div className="panel-heading-actions"><button className="secondary" onClick={() => setQuickSortOpen(true)}><Film size={15} /> Schnellsichtung</button>{selected && <button className="primary" onClick={() => onReview(selected)}><Scissors size={15} /> Sichten</button>}</div></div>
            <div className="media-table-head"><span>DATEI</span><span>LOCH</span><span>AUFNAHME</span><span>FORMAT</span><span>DAUER</span></div><div className="media-list">{project.media.map((media) => <button className={`media-row ${selected === media.id ? 'selected' : ''}`} onClick={() => setSelected(media.id)} onDoubleClick={() => onReview(media.id)} key={media.id}><span className="media-name"><MediaIcon media={media} /><span><b>{media.name}</b><small>{media.device}</small></span></span><span className={`media-hole-badge ${media.assignedHole ? 'assigned' : ''}`}>{media.assignedHole ? `L${media.assignedHole}` : '–'}</span><span className="capture"><CalendarClock size={14} /> {formatClock(media.recordedAt)}</span><span>{media.kind === 'audio' ? media.codec.toUpperCase() : `${media.width ?? '?'}×${media.height ?? '?'} · ${media.fps ?? '?'} fps`}</span><span>{formatDuration(media.durationSeconds)}</span></button>)}</div>
        </section><aside className="suggestions-panel"><div className="suggestion-title"><WandSparkles size={19} /><div><h3>Multicam-Vorschläge</h3><span>Basierend auf Aufnahmezeiten</span></div></div>{suggestions.length ? suggestions.map((suggestion, index) => {
            const sources = suggestion.mediaIds.map((id) => project.media.find((media) => media.id === id)).filter(Boolean) as MediaItem[];
            const accepted = project.groups.some((group) => group.mediaIds.length === suggestion.mediaIds.length && group.mediaIds.every((id) => suggestion.mediaIds.includes(id)));
            const synchronizing = syncingSuggestionId === suggestion.id;
            return <article className="suggestion-card" key={suggestion.id}><div className="confidence"><span className={suggestion.confidence} /> {suggestion.confidence === 'high' ? 'SEHR WAHRSCHEINLICH' : suggestion.confidence === 'medium' ? 'WAHRSCHEINLICH' : 'UNKLAR'}</div><div className="suggestion-name"><span>G{index + 1}</span><div><b>{formatClock(suggestion.startAt)}</b><small>{sources.length} Quellen · {formatDuration((Date.parse(suggestion.endAt) - Date.parse(suggestion.startAt)) / 1000)}</small></div></div><div className="source-stack">{sources.slice(0, 4).map((source) => <span title={source.name} key={source.id}>{source.kind === 'audio' ? <FileAudio size={14} /> : <Camera size={14} />}{source.device.replace('DJI ', '')}</span>)}</div><p>{synchronizing ? syncProgress?.message ?? 'Tonspuren werden vorbereitet …' : suggestion.reason}</p>{synchronizing && <div className="sync-progress"><span style={{ width: `${syncProgress ? syncProgress.completed / Math.max(1, syncProgress.total) * 100 : 8}%` }} /></div>}<button className={`accept ${accepted ? 'accepted' : ''}`} disabled={accepted || Boolean(syncingSuggestionId)} onClick={() => void acceptGroup(suggestion.id)}><Check size={15} /> {synchronizing ? 'Synchronisiere …' : accepted ? 'Gruppe angelegt' : 'Anlegen & automatisch synchronisieren'}</button></article>;
        }) : <div className="empty-suggestions"><Sparkles size={24} /><b>Noch keine Überschneidungen</b><p>Importiere Aufnahmen mehrerer Kameras mit ungefähr gleicher Gerätezeit.</p></div>}</aside></div> : <section className="how-it-works"><div><span>01</span><b>Alles auf einmal importieren</b><p>Osmo, iPhone und Mikrofondateien können gemeinsam ausgewählt werden.</p></div><div><span>02</span><b>Geräte werden erkannt</b><p>Aufnahmezeit, Dauer, Codec, Auflösung und Tonspuren werden lokal ausgelesen.</p></div><div><span>03</span><b>Direkt mit dem Sichten beginnen</b><p>Rohclip öffnen, In und Out markieren und einem Golfblock zuweisen.</p></div></section>}
        {quickSortOpen && <QuickSortMedia project={project} setProject={setProject} startMediaId={selected} onClose={() => setQuickSortOpen(false)} />}
    </section>;
}

interface ReviewProps { project: GolfProject; setProject: (project: GolfProject) => void; initialMediaId?: string; initialSequenceId?: string; initialHole?: number }
type ReviewHoleFilter = 'all' | 'unassigned' | number;

function WaveformRow({ label, values, localSeconds, durationSeconds, reference = false }: { label: string; values: number[]; localSeconds: number; durationSeconds: number; reference?: boolean }) {
    const analyzedDuration = Math.min(600, durationSeconds);
    const center = values.length ? Math.round(Math.min(1, Math.max(0, localSeconds / Math.max(1, analyzedDuration))) * (values.length - 1)) : 0;
    const radius = Math.min(90, Math.max(30, Math.round(values.length / Math.max(1, analyzedDuration) * 8)));
    const windowValues = Array.from({ length: radius * 2 + 1 }, (_, index) => values[center - radius + index] ?? 0);
    return <div className={`waveform-row ${reference ? 'reference' : ''}`}><div><b>{label}</b><small>{reference ? 'REFERENZ' : `${localSeconds.toFixed(2)} s`}</small></div><div className="waveform-window"><span className="waveform-playhead" />{windowValues.map((value, index) => <i style={{ height: `${Math.max(3, value * 100)}%` }} key={index} />)}</div></div>;
}

function ReviewScreen({ project, setProject, initialMediaId, initialSequenceId, initialHole }: ReviewProps) {
    const requestedSequence = project.sequences.find((sequence) => sequence.id === initialSequenceId);
    const requestedBlock = project.blocks.find((block) => block.id === requestedSequence?.targetBlockId);
    const requestedMedia = project.media.find((media) => media.id === (requestedSequence?.sourceType === 'media' ? requestedSequence.sourceId : initialMediaId));
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const previewRefs = useRef(new Map<string, HTMLVideoElement>());
    const initialLoad = useRef(Boolean(requestedSequence));
    const player = () => videoRef.current ?? audioRef.current;
    const [sourceType, setSourceType] = useState<SourceType>(requestedSequence?.sourceType ?? 'media');
    const [sourceId, setSourceId] = useState(requestedSequence?.sourceId ?? initialMediaId ?? project.media[0]?.id ?? '');
    const initialGroup = project.groups.find((group) => group.id === requestedSequence?.sourceId);
    const [activeMediaId, setActiveMediaId] = useState(requestedSequence?.activeMediaId ?? initialGroup?.mediaIds[0] ?? '');
    const [currentFrame, setCurrentFrame] = useState(requestedSequence?.inFrame ?? 0);
    const [inFrame, setInFrame] = useState(requestedSequence?.inFrame ?? 0);
    const [outFrame, setOutFrame] = useState(requestedSequence?.outFrame ?? 1);
    const [playing, setPlaying] = useState(false);
    const [playSelection, setPlaySelection] = useState(false);
    const [hole, setHole] = useState(requestedBlock?.hole ?? initialHole ?? requestedMedia?.assignedHole ?? 1);
    const [holeFilter, setHoleFilter] = useState<ReviewHoleFilter>(initialHole ?? 'all');
    const [playerId, setPlayerId] = useState(requestedBlock?.playerId ?? project.settings.players[0]?.id ?? '');
    const [blockType, setBlockType] = useState<BlockType>(requestedBlock?.type ?? 'tee-shot');
    const [targetBlockId, setTargetBlockId] = useState(requestedBlock?.id ?? '');
    const [editingId, setEditingId] = useState<string | undefined>(requestedSequence?.id);
    const [message, setMessage] = useState('');
    const [syncAnalysis, setSyncAnalysis] = useState<MulticamAudioSyncResult | null>(null);
    const [syncProgress, setSyncProgress] = useState<MulticamSyncProgress | null>(null);
    const [syncBusy, setSyncBusy] = useState(false);
    const [syncOpen, setSyncOpen] = useState(false);
    const [draftSyncOffset, setDraftSyncOffset] = useState(0);
    const filteredMedia = useMemo(() => project.media.filter((media) => {
        if (holeFilter === 'all') return true;
        return holeFilter === 'unassigned' ? !media.assignedHole : media.assignedHole === holeFilter;
    }), [holeFilter, project.media]);
    const filteredGroups = useMemo(() => project.groups.filter((group) => {
        if (holeFilter === 'all') return true;
        const assignments = group.mediaIds.map((id) => project.media.find((media) => media.id === id)?.assignedHole).filter(Boolean);
        return holeFilter === 'unassigned' ? assignments.length === 0 : assignments.includes(holeFilter);
    }), [holeFilter, project.groups, project.media]);
    useEffect(() => {
        const sources = sourceType === 'media' ? filteredMedia : filteredGroups;
        if (!sources.some((item) => item.id === sourceId)) setSourceId(sources[0]?.id ?? '');
    }, [filteredGroups, filteredMedia, sourceId, sourceType]);
    useEffect(() => {
        if (hole > project.settings.holes) { setHole(1); setTargetBlockId(''); }
        if (typeof holeFilter === 'number' && holeFilter > project.settings.holes) setHoleFilter('all');
    }, [hole, holeFilter, project.settings.holes]);
    const currentGroup = sourceType === 'group' ? project.groups.find((group) => group.id === sourceId) : undefined;
    const groupTimeline = sourceType === 'group' ? multicamTimeline(project, sourceId) : null;
    const groupMedia = groupTimeline?.media ?? [];
    const source = sourceType === 'media'
        ? project.media.find((media) => media.id === sourceId)
        : groupMedia.find((media) => media.id === activeMediaId) ?? groupMedia[0];
    const storedSourceHole = sourceType === 'media'
        ? source?.assignedHole
        : groupMedia.find((media) => media.assignedHole)?.assignedHole;
    const sourceAssignedHole = storedSourceHole && storedSourceHole <= project.settings.holes ? storedSourceHole : undefined;
    const activeSyncOffset = sourceType === 'group' && source ? multicamSyncOffset(project, sourceId, source.id) : 0;
    const fps = sourceType === 'group'
        ? groupTimeline?.fps ?? project.settings.frameRate ?? 30
        : source?.fps && source.fps > 0 ? source.fps : project.settings.frameRate ?? 30;
    const maxFrames = Math.max(1, Math.round((sourceType === 'group' && groupTimeline
        ? (groupTimeline.endMs - groupTimeline.startMs) / 1000
        : source?.durationSeconds ?? 0) * fps));
    const sourceSequences = project.sequences.filter((sequence) => sequence.sourceType === sourceType && sequence.sourceId === sourceId);
    const availableBlocks = project.blocks
        .filter((block) => block.hole === hole && block.playerId === playerId)
        .sort((left, right) => left.order - right.order);
    const matchingBlocks = availableBlocks.filter((block) => block.type === blockType);
    const targetBlock = matchingBlocks.find((block) => block.id === targetBlockId) ?? matchingBlocks[0];
    const effectiveMediaStartMs = useCallback((media: MediaItem): number => {
        const stored = multicamMediaStartMs(project, sourceId, media);
        if (sourceType !== 'group' || media.id !== source?.id) return stored;
        return stored - (draftSyncOffset - multicamSyncOffset(project, sourceId, media.id)) * 1000;
    }, [draftSyncOffset, project, source?.id, sourceId, sourceType]);
    const masterTimeMs = groupTimeline ? groupTimeline.startMs + currentFrame / fps * 1000 : 0;
    const visibleGroupMedia = sourceType === 'group' ? groupMedia.filter((media) => {
        const mediaStart = effectiveMediaStartMs(media);
        return masterTimeMs >= mediaStart && masterTimeMs <= mediaStart + media.durationSeconds * 1000;
    }) : [];
    const selectionCameraCount = sourceType === 'group' ? multicamAnglesForRange(project, sourceId, inFrame, outFrame, fps).length : 0;
    const mediaTimeForFrame = useCallback((frame: number, media: MediaItem): number => {
        if (sourceType !== 'group' || !groupTimeline) return frame / fps;
        const offsetSeconds = (effectiveMediaStartMs(media) - groupTimeline.startMs) / 1000;
        return Math.min(media.durationSeconds, Math.max(0, frame / fps - offsetSeconds));
    }, [effectiveMediaStartMs, fps, groupTimeline, sourceType]);
    const seek = useCallback((frame: number) => {
        const target = Math.min(maxFrames, Math.max(0, Math.round(frame)));
        setCurrentFrame(target);
        const element = player();
        if (element && source) element.currentTime = mediaTimeForFrame(target, source);
        if (sourceType === 'group') previewRefs.current.forEach((preview, mediaId) => {
            const media = groupMedia.find((item) => item.id === mediaId);
            if (media && preview.readyState >= 1) preview.currentTime = mediaTimeForFrame(target, media);
        });
    }, [groupMedia, maxFrames, mediaTimeForFrame, source, sourceType]);
    const resetMarks = useCallback(() => {
        setCurrentFrame(0); setInFrame(0); setOutFrame(Math.min(maxFrames, Math.max(1, Math.round(fps * 5)))); setEditingId(undefined); setMessage('');
    }, [fps, maxFrames]);
    useEffect(() => {
        if (initialLoad.current) { initialLoad.current = false; return; }
        resetMarks();
    }, [sourceId, sourceType, resetMarks]);
    useEffect(() => {
        if (!editingId && sourceAssignedHole) { setHole(sourceAssignedHole); setTargetBlockId(''); }
    }, [sourceAssignedHole, sourceId, sourceType]);
    useEffect(() => {
        if (sourceType === 'group' && !groupMedia.some((media) => media.id === activeMediaId)) setActiveMediaId(groupMedia[0]?.id ?? '');
    }, [activeMediaId, groupMedia, sourceType]);
    useEffect(() => {
        if (sourceType === 'group' && visibleGroupMedia.length && !visibleGroupMedia.some((media) => media.id === activeMediaId)) setActiveMediaId(visibleGroupMedia[0].id);
    }, [currentFrame, sourceId]);
    useEffect(() => {
        if (!matchingBlocks.some((block) => block.id === targetBlockId)) setTargetBlockId(matchingBlocks[0]?.id ?? '');
    }, [matchingBlocks, targetBlockId]);
    useEffect(() => { setDraftSyncOffset(activeSyncOffset); }, [activeMediaId, activeSyncOffset, sourceId]);
    useEffect(() => { if (source) seek(currentFrame); }, [activeMediaId, draftSyncOffset]);
    useEffect(() => {
        if (sourceType !== 'group' || !currentGroup || groupMedia.length < 2 || !window.golfStudio) return;
        let canceled = false;
        setSyncBusy(true); setSyncAnalysis(null); setSyncProgress(null);
        const unsubscribe = window.golfStudio.onMulticamSyncProgress((progress) => { if (!canceled && progress.groupId === sourceId) setSyncProgress(progress); });
        const media = currentGroup.mediaIds.map((id) => project.media.find((item) => item.id === id)).filter((item): item is MediaItem => Boolean(item));
        void window.golfStudio.syncMulticamAudio({ groupId: sourceId, media }).then((result) => {
            if (canceled) return;
            setSyncAnalysis(result);
            if (currentGroup.syncStatus === 'timestamp-only' && Object.keys(result.offsetsSeconds).length >= 2) {
                setProject(setMulticamSyncOffsets(project, sourceId, result.offsetsSeconds, 'audio'));
                setMessage(`${Object.keys(result.offsetsSeconds).length} Tonspuren automatisch synchronisiert.`);
            }
        }).catch((error) => {
            if (!canceled) setMessage(error instanceof Error ? error.message : 'Tonsynchronisierung fehlgeschlagen.');
        }).finally(() => { if (!canceled) setSyncBusy(false); });
        return () => { canceled = true; unsubscribe(); };
    }, [sourceId, sourceType]);
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (target?.closest('input, select, textarea, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
            const handled = ['ArrowLeft', 'ArrowRight', ' ', 'i', 'I', 'o', 'O'].includes(event.key);
            if (!handled) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'ArrowLeft') seek(currentFrame - 1);
            if (event.key === 'ArrowRight') seek(currentFrame + 1);
            if (event.key.toLowerCase() === 'i') setInFrame(currentFrame);
            if (event.key.toLowerCase() === 'o') setOutFrame(Math.max(inFrame + 1, currentFrame));
            if (event.key === ' ') { const element = player(); if (element) element.paused ? void element.play() : element.pause(); }
        };
        document.addEventListener('keydown', key, true);
        return () => document.removeEventListener('keydown', key, true);
    }, [currentFrame, inFrame, seek]);
    const togglePlay = () => { const element = player(); if (element) element.paused ? void element.play() : element.pause(); };
    const playRange = () => { seek(inFrame); setPlaySelection(true); window.setTimeout(() => void player()?.play(), 0); };
    const frameFromMediaTime = (media: MediaItem, localSeconds: number) => {
        if (sourceType !== 'group' || !groupTimeline) return Math.round(localSeconds * fps);
        const offsetSeconds = (effectiveMediaStartMs(media) - groupTimeline.startMs) / 1000;
        return Math.round((offsetSeconds + localSeconds) * fps);
    };
    const handleTimeUpdate = (element: HTMLMediaElement, media: MediaItem) => {
        const frame = frameFromMediaTime(media, element.currentTime);
        setCurrentFrame(frame);
        if (sourceType === 'group') previewRefs.current.forEach((preview, mediaId) => {
            const previewMedia = groupMedia.find((item) => item.id === mediaId);
            if (previewMedia && preview.readyState >= 1) preview.currentTime = mediaTimeForFrame(frame, previewMedia);
        });
        if (playSelection && frame >= outFrame) { element.pause(); setPlaySelection(false); seek(outFrame); }
    };
    const saveSequence = () => {
        if (!source) return;
        try {
            const multicamAngles = sourceType === 'group' ? multicamAnglesForRange(project, sourceId, inFrame, outFrame, fps) : undefined;
            if (sourceType === 'group' && !multicamAngles?.length) throw new Error('In diesem Bereich ist keine Kamera aktiv.');
            const selectedMediaId = multicamAngles?.some((angle) => angle.mediaId === activeMediaId) ? activeMediaId : multicamAngles?.[0]?.mediaId;
            const next = upsertSequence(project, { id: editingId, sourceType, sourceId, inFrame, outFrame, sourceFps: fps, activeMediaId: selectedMediaId, multicamAngles, hole, playerId, blockType, targetBlockId: targetBlock?.id });
            setProject(next); setEditingId(undefined); setMessage(sourceType === 'group' ? `Multicam-Sequenz mit ${multicamAngles?.length ?? 0} Kameras gespeichert.` : 'Sequenz im Projekt gespeichert.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Sequenz konnte nicht gespeichert werden.'); }
    };
    const editSequence = (sequence: VirtualSequence) => {
        const target = project.blocks.find((block) => block.id === sequence.targetBlockId);
        if (!target) return;
        setEditingId(sequence.id); setInFrame(sequence.inFrame); setOutFrame(sequence.outFrame); setHole(target.hole); setPlayerId(target.playerId); setBlockType(target.type); setTargetBlockId(target.id); setActiveMediaId(sequence.activeMediaId ?? ''); seek(sequence.inFrame); setMessage('');
    };
    const applySyncDraft = () => {
        if (sourceType !== 'group' || !source) return;
        player()?.pause();
        setProject(setMulticamSyncOffset(project, sourceId, source.id, draftSyncOffset));
        setMessage(`Feinsynchronisierung für ${source.name} gespeichert.`);
    };
    const localReferenceId = source ? syncAnalysis?.referenceByMediaId[source.id] ?? syncAnalysis?.referenceMediaId : syncAnalysis?.referenceMediaId;
    const referenceMedia = groupMedia.find((media) => media.id === localReferenceId);
    const referenceLocalTime = referenceMedia ? mediaTimeForFrame(currentFrame, referenceMedia) : 0;
    const activeLocalTime = source ? mediaTimeForFrame(currentFrame, source) : 0;
    const activeConfidence = source ? syncAnalysis?.confidenceByMediaId[source.id] : undefined;
    const contextSummary = summarizeRoundDesk(project);
    const contextHoleSummary = contextSummary.holes.find((item) => item.hole === hole);
    return <section className="review-workspace">
        <aside className="source-browser"><div className="source-tabs"><button className={sourceType === 'media' ? 'active' : ''} onClick={() => setSourceType('media')}>Clips</button><button className={sourceType === 'group' ? 'active' : ''} onClick={() => setSourceType('group')}>Multicam</button></div>
            <label className="source-hole-filter"><Flag size={14} /><select value={String(holeFilter)} onChange={(event) => setHoleFilter(event.target.value === 'all' || event.target.value === 'unassigned' ? event.target.value : Number(event.target.value))}><option value="all">Alle Löcher</option><option value="unassigned">Nicht zugeordnet</option>{Array.from({ length: project.settings.holes }, (_, index) => <option value={index + 1} key={index}>Loch {index + 1}</option>)}</select><span>{sourceType === 'media' ? filteredMedia.length : filteredGroups.length}</span></label>
            <div className="source-list">{sourceType === 'media' ? filteredMedia.map((media) => <button className={sourceId === media.id ? 'active' : ''} onClick={() => setSourceId(media.id)} key={media.id}><MediaIcon media={media} /><span><b>{media.name}</b><small>{media.assignedHole ? `LOCH ${media.assignedHole} · ` : ''}{formatDuration(media.durationSeconds)} · {media.fps ?? '?'} fps</small></span><em className={media.assignedHole ? 'hole-assigned' : ''}>{media.assignedHole ? `L${media.assignedHole}` : project.sequences.filter((sequence) => sequence.sourceType === 'media' && sequence.sourceId === media.id).length}</em></button>) : filteredGroups.map((group) => <button className={sourceId === group.id ? 'active' : ''} onClick={() => setSourceId(group.id)} key={group.id}><div className="group-icon"><Layers size={20} /></div><span><b>{group.name}</b><small>{group.mediaIds.length} Quellen</small></span><em>{project.sequences.filter((sequence) => sequence.sourceType === 'group' && sequence.sourceId === group.id).length}</em></button>)}</div>
        </aside>
        <div className="review-main">{source ? <>{contextHoleSummary && <div className="moment-round-context"><span>GEPRÜFT {contextSummary.productionProgress}%</span><i /><b>LOCH {contextHoleSummary.hole}</b><small>{PRODUCTION_STATUS_COPY[contextHoleSummary.productionStatus]}</small></div>}<div className="review-heading"><div><div className="eyebrow"><span /> SICHTEN & ZUWEISEN</div><h1>{sourceType === 'group' ? project.groups.find((group) => group.id === sourceId)?.name : source.name}</h1><p>{sourceType === 'group' ? `${visibleGroupMedia.length || groupMedia.length} Kameras am aktuellen Zeitpunkt · aktive Perspektive: ${source.name}` : `${source.device} · ${source.width ?? 'Audio'}${source.height ? `×${source.height}` : ''} · ${fps} fps`}</p>{sourceAssignedHole && <span className="review-source-hole">VORSORTIERT · LOCH {sourceAssignedHole}</span>}</div><div className="keyboard-hints"><kbd>←</kbd><kbd>→</kbd> Frame · <kbd>I</kbd> In · <kbd>O</kbd> Out · <kbd>Leertaste</kbd> Play</div></div>
            {sourceType === 'group' && <div className="camera-monitor-grid">{(visibleGroupMedia.length ? visibleGroupMedia : groupMedia.slice(0, 4)).map((media) => <button className={media.id === source.id ? 'active' : ''} onClick={() => { player()?.pause(); setActiveMediaId(media.id); }} key={media.id}><video muted preload="metadata" src={fileUrl(media.path)} ref={(element) => { if (element) previewRefs.current.set(media.id, element); else previewRefs.current.delete(media.id); }} onLoadedMetadata={(event) => { event.currentTarget.currentTime = mediaTimeForFrame(currentFrame, media); }} /><span><b>{media.device}</b><small>{media.name}</small></span>{media.id === source.id && <em>AKTIV</em>}</button>)}</div>}
            {sourceType === 'group' && <section className={`audio-sync-panel ${syncOpen ? 'open' : ''}`}><header><div><b>{syncBusy ? 'Tonspuren werden analysiert …' : currentGroup?.syncStatus === 'audio' ? 'Automatisch über Ton synchronisiert' : currentGroup?.syncStatus === 'manual' ? 'Manuell feinjustiert' : 'Synchronisierung prüfen'}</b><small>{syncBusy ? syncProgress?.message ?? 'Lokale Audioanalyse läuft im Hintergrund.' : `${groupMedia.length} Kameras · ${syncAnalysis?.failures.length ?? 0} Hinweise`}</small></div><div>{activeConfidence && <span className={`sync-confidence ${activeConfidence}`}>{activeConfidence === 'high' ? 'SICHER' : activeConfidence === 'medium' ? 'PRÜFEN' : 'UNSICHER'}</span>}<button onClick={() => setSyncOpen((open) => !open)}>{syncOpen ? 'Schließen' : 'Tonspuren & Finetuning'}</button></div></header>{syncBusy && <div className="sync-progress"><span style={{ width: `${syncProgress ? syncProgress.completed / Math.max(1, syncProgress.total) * 100 : 8}%` }} /></div>}{syncOpen && <div className="audio-sync-editor">{referenceMedia && <WaveformRow label={referenceMedia.name} values={syncAnalysis?.waveforms[referenceMedia.id] ?? []} localSeconds={referenceLocalTime} durationSeconds={referenceMedia.durationSeconds} reference />}{source.id !== referenceMedia?.id && <WaveformRow label={source.name} values={syncAnalysis?.waveforms[source.id] ?? []} localSeconds={activeLocalTime} durationSeconds={source.durationSeconds} />}<div className="sync-slider"><span>FRÜHER</span><input type="range" min={Math.min(-30, draftSyncOffset - 5)} max={Math.max(30, draftSyncOffset + 5)} step={1 / fps} value={draftSyncOffset} disabled={source.id === referenceMedia?.id} onChange={(event) => setDraftSyncOffset(Number(event.target.value))} /><span>SPÄTER</span><output>{draftSyncOffset >= 0 ? '+' : ''}{draftSyncOffset.toFixed(3)} s</output></div><footer><p>{source.id === referenceMedia?.id ? 'Diese Kamera ist die Referenz. Wähle oben eine andere Kamera für das Finetuning.' : 'Ziehe den Regler, bis markante Tonspitzen und das Bildereignis übereinstimmen.'}</p><button disabled={source.id === referenceMedia?.id || draftSyncOffset === (syncAnalysis?.offsetsSeconds[source.id] ?? 0)} onClick={() => setDraftSyncOffset(syncAnalysis?.offsetsSeconds[source.id] ?? 0)}><RotateCcw size={14} /> Automatik</button><button className="primary" disabled={source.id === referenceMedia?.id || draftSyncOffset === activeSyncOffset} onClick={applySyncDraft}><Check size={14} /> Korrektur übernehmen</button></footer></div>}</section>}
            <div className="viewer-shell"><div className="viewer">{source.kind === 'video' ? <video ref={videoRef} src={fileUrl(source.path)} onLoadedMetadata={() => seek(inFrame)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget, source)} onError={() => setMessage('Die Mediendatei konnte nicht geöffnet werden. Prüfe, ob sie noch am gespeicherten Ort liegt.')} /> : <div className="audio-view"><FileAudio size={70} /><b>{source.name}</b><audio ref={audioRef} src={fileUrl(source.path)} onLoadedMetadata={() => seek(inFrame)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget, source)} /></div>}<button className="viewer-play" onClick={togglePlay}>{playing ? <Pause size={25} /> : <Play size={25} />}</button></div>
                <div className="transport"><button onClick={() => seek(currentFrame - 1)} title="Ein Frame zurück"><ChevronLeft size={20} /></button><button className="transport-play" onClick={togglePlay}>{playing ? <Pause size={18} /> : <Play size={18} />}</button><button onClick={() => seek(currentFrame + 1)} title="Ein Frame vor"><ChevronRight size={20} /></button><strong>{frameTime(currentFrame, fps)}</strong><span>Frame {currentFrame} / {maxFrames}</span></div>
                <Filmstrip currentFrame={currentFrame} inFrame={inFrame} outFrame={outFrame} maxFrames={maxFrames} sequences={sourceSequences} onSeek={seek} onInChange={(frame) => setInFrame(Math.min(frame, outFrame - 1))} onOutChange={(frame) => setOutFrame(Math.max(frame, inFrame + 1))} />
                <div className="mark-controls"><button onClick={() => setInFrame(Math.min(currentFrame, outFrame - 1))}><b>I</b><span>IN setzen<small>{frameTime(inFrame, fps)} · F{inFrame}</small></span></button><button onClick={playRange}><Play size={17} /><span>Auswahl abspielen<small>{formatDuration((outFrame - inFrame) / fps)}</small></span></button><button onClick={() => setOutFrame(Math.max(currentFrame, inFrame + 1))}><b>O</b><span>OUT setzen<small>{frameTime(outFrame, fps)} · F{outFrame}</small></span></button></div>
            </div>
            <section className="assign-panel"><div><span className="field-label">Loch</span><select value={hole} onChange={(event) => { const nextHole = Number(event.target.value); setHole(nextHole); setTargetBlockId(''); if (sourceType === 'media' && source) setProject(setMediaAssignedHole(project, source.id, nextHole)); }}>{Array.from({ length: project.settings.holes }, (_, index) => <option value={index + 1} key={index}>Loch {index + 1}</option>)}</select></div><div><span className="field-label">Spieler</span><select value={playerId} onChange={(event) => { setPlayerId(event.target.value); setTargetBlockId(''); }}>{project.settings.players.map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}</select></div><div><span className="field-label">Schlag / Inhalt</span><select value={blockType} onChange={(event) => { setBlockType(event.target.value as BlockType); setTargetBlockId(''); }}>{BLOCK_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><button className="primary assign-button" onClick={saveSequence}><Scissors size={16} /> {editingId ? 'Änderungen speichern' : sourceType === 'group' ? `${selectionCameraCount} Kameras zuweisen` : 'Sequenz zuweisen'}</button>{editingId && <button className="icon-button" title="Bearbeitung abbrechen" onClick={resetMarks}><X size={17} /></button>}</section>
            {message && <div className="inline-message review-message">{message}</div>}
            <AssignedSequences project={project} sequences={sourceSequences} onEdit={editSequence} onDelete={(id) => setProject(removeSequence(project, id))} />
        </> : <div className="empty-review"><Scissors size={42} /><h2>{sourceType === 'media' ? 'Noch keine Medien importiert' : 'Noch keine Multicam-Gruppe angelegt'}</h2><p>Wechsle zum Import und füge Rohmaterial hinzu.</p></div>}</div>
    </section>;
}

function Filmstrip({ currentFrame, inFrame, outFrame, maxFrames, sequences, onSeek, onInChange, onOutChange }: { currentFrame: number; inFrame: number; outFrame: number; maxFrames: number; sequences: VirtualSequence[]; onSeek: (frame: number) => void; onInChange: (frame: number) => void; onOutChange: (frame: number) => void }) {
    const stripRef = useRef<HTMLDivElement>(null);
    const [dragTarget, setDragTarget] = useState<'in' | 'out' | null>(null);
    const percent = (frame: number) => `${Math.min(100, Math.max(0, frame / maxFrames * 100))}%`;
    const frameAt = (clientX: number) => {
        const rect = stripRef.current!.getBoundingClientRect();
        return Math.min(maxFrames, Math.max(0, Math.round((clientX - rect.left) / rect.width * maxFrames)));
    };
    return <div ref={stripRef} className="filmstrip" onPointerDown={(event) => {
        const element = event.target as HTMLElement;
        const target = element.classList.contains('in-handle') ? 'in' : element.classList.contains('out-handle') ? 'out' : null;
        setDragTarget(target);
        event.currentTarget.setPointerCapture(event.pointerId);
        if (target === 'in') onInChange(frameAt(event.clientX));
        else if (target === 'out') onOutChange(frameAt(event.clientX));
        else onSeek(frameAt(event.clientX));
    }} onPointerMove={(event) => {
        if (dragTarget === 'in') onInChange(frameAt(event.clientX));
        if (dragTarget === 'out') onOutChange(frameAt(event.clientX));
    }} onPointerUp={(event) => { setDragTarget(null); event.currentTarget.releasePointerCapture(event.pointerId); }}>
        <div className="filmstrip-grid" />
        {sequences.map((sequence) => <div className="used-range" key={sequence.id} style={{ left: percent(sequence.inFrame), width: percent(sequence.outFrame - sequence.inFrame) }} />)}
        <div className="selected-range" style={{ left: percent(inFrame), width: percent(outFrame - inFrame) }}><i className="in-handle" /><i className="out-handle" /></div>
        <div className="playhead" style={{ left: percent(currentFrame) }}><i /></div>
    </div>;
}

function AssignedSequences({ project, sequences, onEdit, onDelete }: { project: GolfProject; sequences: VirtualSequence[]; onEdit: (sequence: VirtualSequence) => void; onDelete: (id: string) => void }) {
    return <section className="assigned"><div className="assigned-heading"><h3>Zugewiesene Bereiche</h3><span>Farbig auf der Filmleiste markiert · zum Korrigieren öffnen</span></div>{sequences.length ? <div className="assigned-list">{sequences.sort((left, right) => left.inFrame - right.inFrame).map((sequence) => {
        const block = project.blocks.find((item) => item.id === sequence.targetBlockId);
        const player = project.settings.players.find((item) => item.id === block?.playerId);
        return <article key={sequence.id}><button className="sequence-open" onClick={() => onEdit(sequence)}><span className="sequence-number">{block?.hole ?? '?'}</span><span><b>Loch {block?.hole} · {player?.name} · {block ? blockLabel(block.type) : 'Unbekannter Block'}</b><small>{frameTime(sequence.inFrame, sequence.sourceFps)} – {frameTime(sequence.outFrame, sequence.sourceFps)} · {sequence.outFrame - sequence.inFrame} Frames{sequence.multicamAngles?.length ? ` · ${sequence.multicamAngles.length} Kameras` : ''}</small></span></button><button className="delete-sequence" title="Sequenz löschen" onClick={() => onDelete(sequence.id)}><Trash2 size={16} /></button></article>;
    })}</div> : <div className="assigned-empty">Setze In und Out und weise den ersten Bereich einem Golfblock zu.</div>}</section>;
}

const nullableNumber = (value: string): number | null => value === '' ? null : Number(value);

function ScorecardEditor({ project, setProject, onClose }: { project: GolfProject; setProject: (project: GolfProject) => void; onClose: () => void }) {
    const [message, setMessage] = useState('');
    const [analysis, setAnalysis] = useState<ScorecardChooseResult | null>(null);
    const [selectedTeeId, setSelectedTeeId] = useState('');
    const [analyzing, setAnalyzing] = useState(false);
    const chooseScorecard = async () => {
        if (!window.golfStudio) return setMessage('Dateiauswahl ist nur in der Desktop-App verfügbar.');
        setAnalyzing(true);
        setMessage('Scorecard wird lokal analysiert …');
        try {
            const result = await window.golfStudio.chooseScorecard(project.settings.holes);
            if (result.canceled || !result.path) return setMessage('Keine Scorecard ausgewählt.');
            setAnalysis(result);
            setSelectedTeeId(result.tees[0]?.id ?? '');
            if (result.status === 'ready') {
                setMessage(`${result.tees[0]?.holes.length ?? 0} Löcher und ${result.tees.length} Abschläge erkannt. Bitte Abschlag prüfen und übernehmen.`);
            } else {
                setProject(setScorecardSource(project, result.path));
                setMessage(result.warnings[0] ?? 'Diese Scorecard muss manuell übertragen werden.');
            }
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Scorecard konnte nicht analysiert werden.'); }
        finally { setAnalyzing(false); }
    };
    const selectedTee = analysis?.tees.find((tee) => tee.id === selectedTeeId);
    const sourcePath = analysis?.path ?? project.courseData.scorecardSourcePath;
    const sourceName = sourcePath?.split(/[\\/]/).pop();
    const isImage = Boolean(sourcePath && /\.(png|jpe?g|webp)$/i.test(sourcePath));
    const applyRecognizedData = () => {
        if (!selectedTee || !analysis?.path) return;
        const updated = applyScorecardTee(project, analysis.path, selectedTee);
        if (updated === project) return setMessage('Die erkannten Lochdaten sind nicht vollständig und wurden nicht übernommen.');
        setProject(updated);
        setMessage(`${selectedTee.holes.length} Löcher · Abschlag ${selectedTee.label} übernommen.`);
        setAnalysis(null);
    };
    return <div className="data-editor-backdrop"><section className="scorecard-editor"><header><div><div className="eyebrow"><span /> PLATZDATEN</div><h2>Scorecard · {project.settings.course}</h2><p>Diese Daten speisen Loch-, Score- und Leaderboard-Grafiken.</p></div><button className="preview-close" onClick={onClose}><X size={18} /></button></header>
        <div className="scorecard-source"><div><ClipboardList size={20} /><span><b>{sourceName ?? 'Keine Scorecard hinterlegt'}</b><small>{sourceName ? 'Bleibt lokal auf diesem Rechner' : 'PDF oder Foto als Referenz auswählen'}</small></span></div><button className="secondary" disabled={analyzing} onClick={chooseScorecard}><ImageUp size={15} /> {analyzing ? 'Analysiere …' : 'Scorecard auswählen'}</button></div>
        {message && <div className="inline-message">{message}</div>}
        {analysis?.status === 'ready' && selectedTee && <section className="scorecard-analysis"><div className="scorecard-analysis-heading"><div><span>LOKAL ERKANNT</span><h3>Welchen Abschlag habt ihr gespielt?</h3><p>Wähle einen Abschlag und prüfe die Werte. Erst der grüne Button übernimmt sie ins Projekt.</p></div><ShieldCheck size={25} /></div><div className="scorecard-tee-options">{analysis.tees.map((tee) => {
            const totalMeters = tee.holes.reduce((sum, hole) => sum + hole.lengthMeters, 0);
            const totalPar = tee.holes.reduce((sum, hole) => sum + hole.par, 0);
            return <button className={tee.id === selectedTeeId ? 'active' : ''} onClick={() => setSelectedTeeId(tee.id)} key={tee.id}><b>{tee.label}</b><small>{totalMeters.toLocaleString('de-DE')} m · Par {totalPar}</small></button>;
        })}</div><div className="scorecard-analysis-preview">{selectedTee.holes.map((hole) => <span key={hole.number}><b>{hole.number}</b><small>Par {hole.par}</small><em>{hole.lengthMeters} m</em></span>)}</div><button className="primary scorecard-apply" onClick={applyRecognizedData}><Check size={16} /> Abschlag {selectedTee.label} und {selectedTee.holes.length} Löcher übernehmen</button></section>}
        {analysis?.status === 'manual' && isImage && sourcePath && <div className="scorecard-reference-preview"><img src={fileUrl(sourcePath)} alt="Ausgewählte Scorecard" /><p>Foto bereit zur manuellen Übertragung. Eine automatische Fotoerkennung ist noch nicht aktiv.</p></div>}
        <div className="scorecard-table" style={{ gridTemplateColumns: `55px 85px 100px 75px 110px repeat(${project.settings.players.length}, minmax(95px, 1fr))` }}><div className="scorecard-head"><span>LOCH</span><span>PAR</span><span>LÄNGE (M)</span><span>HCP</span><span>ABSCHLAG</span>{project.settings.players.map((player) => <span key={player.id}>SCORE {player.name.toUpperCase()}</span>)}</div>{project.courseData.holes.filter((hole) => hole.number <= project.settings.holes).map((hole) => <div className="scorecard-row" key={hole.number}><b>{hole.number}</b><select value={hole.par} onChange={(event) => setProject(updateHoleData(project, hole.number, { par: Number(event.target.value) }))}>{[3, 4, 5, 6].map((par) => <option value={par} key={par}>Par {par}</option>)}</select><input type="number" min={0} value={hole.lengthMeters ?? ''} placeholder="–" onChange={(event) => setProject(updateHoleData(project, hole.number, { lengthMeters: nullableNumber(event.target.value) }))} /><input type="number" min={1} max={project.settings.holes} value={hole.strokeIndex ?? ''} placeholder="–" onChange={(event) => setProject(updateHoleData(project, hole.number, { strokeIndex: nullableNumber(event.target.value) }))} /><input value={hole.teeColor} placeholder="z. B. Gelb" onChange={(event) => setProject(updateHoleData(project, hole.number, { teeColor: event.target.value }))} />{project.settings.players.map((player) => {
            const score = project.playerScores.find((item) => item.hole === hole.number && item.playerId === player.id);
            return <input type="number" min={1} value={score?.strokes ?? ''} placeholder="–" aria-label={`Score ${player.name} Loch ${hole.number}`} onChange={(event) => setProject(updatePlayerScore(project, hole.number, player.id, nullableNumber(event.target.value)))} key={player.id} />;
        })}</div>)}</div>
        <footer><p>PDF-Werte werden nur nach deiner Bestätigung übernommen. Fotos bleiben vorerst eine manuelle Vorlage.</p><button className="primary" onClick={onClose}><Check size={15} /> Fertig</button></footer>
    </section></div>;
}

function BlockDetailsEditor({ project, blockId, setProject, onClose }: { project: GolfProject; blockId: string; setProject: (project: GolfProject) => void; onClose: () => void }) {
    const block = project.blocks.find((item) => item.id === blockId);
    if (!block) return null;
    const player = project.settings.players.find((item) => item.id === block.playerId);
    const clubs = ['Driver', '3-Wood', '5-Wood', 'Hybrid', '3-Eisen', '4-Eisen', '5-Eisen', '6-Eisen', '7-Eisen', '8-Eisen', '9-Eisen', 'Pitching Wedge', 'Gap Wedge', 'Sand Wedge', 'Lob Wedge', 'Putter'];
    const par = project.courseData.holes.find((hole) => hole.number === block.hole)?.par ?? 4;
    const shotNumber = strokeNumberForBlock(project, block.id);
    return <div className="data-editor-backdrop"><section className="block-details-editor"><header><div><div className="eyebrow"><span /> SCHLAGDETAILS</div><h2>Loch {block.hole} · {player?.name} · {block.label}</h2><p>Wird für Golfgrafiken und den späteren Shot Tracer verwendet.</p></div><button className="preview-close" onClick={onClose}><X size={18} /></button></header><div className="block-details-form"><label><span>Schlagnummer · manuell korrigierbar</span><input type="number" min={1} value={block.details.shotNumber ?? ''} placeholder={shotNumber ? String(shotNumber) : ''} onChange={(event) => setProject(updateBlockDetails(project, block.id, { shotNumber: nullableNumber(event.target.value) }))} /></label><label><span>Schläger</span><input list="golf-clubs" value={block.details.club} placeholder="z. B. Driver" onChange={(event) => setProject(updateBlockDetails(project, block.id, { club: event.target.value }))} /><datalist id="golf-clubs">{clubs.map((club) => <option value={club} key={club} />)}</datalist></label><label><span>Distanz (Meter)</span><input type="number" min={0} value={block.details.distanceMeters ?? ''} placeholder="z. B. 238" onChange={(event) => setProject(updateBlockDetails(project, block.id, { distanceMeters: nullableNumber(event.target.value) }))} /></label><label><span>Ergebnis / Lage</span><select value={block.details.result} onChange={(event) => setProject(updateBlockDetails(project, block.id, { result: event.target.value }))}><option value="">Nicht angegeben</option>{['Fairway', 'Rough', 'Grün', 'Bunker', 'Penalty', 'Eingelocht'].map((result) => <option value={result} key={result}>{result}</option>)}</select></label><label className="wide"><span>Notiz</span><textarea value={block.details.notes} placeholder="Optionaler Kommentar zum Schlag" onChange={(event) => setProject(updateBlockDetails(project, block.id, { notes: event.target.value }))} /></label></div><footer><div className="detail-preview"><span>OVERLAY-VORSCHAU</span><b>{player?.name} · Schlag {shotNumber ?? '–'} / Par {par}</b><small>{[block.details.club, block.details.distanceMeters ? `${block.details.distanceMeters} m` : '', block.details.result].filter(Boolean).join(' · ') || 'Noch keine Schlagdetails'}</small></div><button className="primary" onClick={onClose}><Check size={15} /> Fertig</button></footer></section></div>;
}

function OverlaySettings({ project, sequence, type, setProject }: { project: GolfProject; sequence: VirtualSequence; type: OverlayType; setProject: (project: GolfProject) => void }) {
    const overlay = project.overlays.find((item) => item.sequenceId === sequence.id && item.type === type && item.enabled);
    if (!overlay) return null;
    const durationFrames = sequence.outFrame - sequence.inFrame;
    const positions: [OverlayPosition, string][] = [['top-left', 'Oben links'], ['top-right', 'Oben rechts'], ['bottom-left', 'Unten links'], ['bottom-right', 'Unten rechts']];
    return <div className="overlay-settings"><label><span>Position</span><select value={overlay.position} onChange={(event) => setProject(updateSequenceOverlay(project, sequence.id, type, { position: event.target.value as OverlayPosition }))}>{positions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div><label><span>Ein bei</span><input type="number" min={0} max={durationFrames / sequence.sourceFps} step={1 / sequence.sourceFps} value={(overlay.startFrame / sequence.sourceFps).toFixed(2)} onChange={(event) => setProject(updateSequenceOverlay(project, sequence.id, type, { startFrame: Number(event.target.value) * sequence.sourceFps }))} /></label><label><span>Aus bei</span><input type="number" min={0} max={durationFrames / sequence.sourceFps} step={1 / sequence.sourceFps} value={(overlay.endFrame / sequence.sourceFps).toFixed(2)} onChange={(event) => setProject(updateSequenceOverlay(project, sequence.id, type, { endFrame: Number(event.target.value) * sequence.sourceFps }))} /></label></div></div>;
}

function shotTracerPath(points: ShotTracerPoint[], smoothing: number): string {
    if (!points.length) return '';
    const scaled = points.map((point) => ({ x: point.x * 1000, y: point.y * 1000 }));
    if (scaled.length === 1) return `M ${scaled[0].x} ${scaled[0].y}`;
    let path = `M ${scaled[0].x} ${scaled[0].y}`;
    for (let index = 0; index < scaled.length - 1; index += 1) {
        const before = scaled[Math.max(0, index - 1)];
        const start = scaled[index];
        const end = scaled[index + 1];
        const after = scaled[Math.min(scaled.length - 1, index + 2)];
        const factor = smoothing / 6;
        const first = { x: start.x + (end.x - before.x) * factor, y: start.y + (end.y - before.y) * factor };
        const second = { x: end.x - (after.x - start.x) * factor, y: end.y - (after.y - start.y) * factor };
        path += ` C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`;
    }
    return path;
}

function ShotTracerLayer({ tracer, frame, editing, marking, tracking, candidates, cameraMarkers, videoRef, sequence, mediaRange, onMark, onPoint, onCandidate, onCursor }: {
    tracer?: ShotTracerEffect;
    frame: number;
    editing: boolean;
    marking: boolean;
    tracking: boolean;
    candidates: BallCandidate[];
    cameraMarkers: { x: number; y: number; label: string }[];
    videoRef: React.RefObject<HTMLVideoElement | null>;
    sequence: VirtualSequence;
    mediaRange?: MulticamAngle;
    onMark: (x: number, y: number) => void;
    onPoint: (index: number, x: number, y: number) => void;
    onCandidate: (candidate: BallCandidate) => void;
    onCursor: (point?: { x: number; y: number }) => void;
}) {
    const [dragIndex, setDragIndex] = useState<number>();
    const strokeRef = useRef<SVGPathElement>(null);
    const headRef = useRef<SVGCircleElement>(null);
    const motionGroupRef = useRef<SVGGElement>(null);
    useEffect(() => {
        const video = videoRef.current;
        const stroke = strokeRef.current;
        const head = headRef.current;
        if (!video || !stroke || !tracer || tracer.points.length < 2) return;
        let videoFrameHandle: number | undefined;
        let animationFrameHandle: number | undefined;
        let stopped = false;
        const paint = (mediaTime: number) => {
            const mediaStart = mediaRange ? mediaRange.inFrame / mediaRange.sourceFps : sequence.inFrame / sequence.sourceFps;
            const relativeFrame = Math.max(0, (mediaTime - mediaStart) * sequence.sourceFps);
            const visual = tracerVisualState(tracer, relativeFrame);
            motionGroupRef.current?.setAttribute('transform', svgCameraMatrix(tracer.cameraLock, relativeFrame) ?? '');
            const tail = (tracer.tailLength ?? .16) * 100;
            stroke.style.strokeDasharray = `${tail} 100`;
            stroke.style.strokeDashoffset = String(tail - visual.progress * 100);
            stroke.style.opacity = String(visual.opacity);
            if (head) {
                const length = stroke.getTotalLength();
                if (Number.isFinite(length) && length > 0) {
                    const point = stroke.getPointAtLength(length * visual.progress);
                    head.setAttribute('cx', String(point.x));
                    head.setAttribute('cy', String(point.y));
                }
                head.style.opacity = String(visual.opacity);
            }
        };
        const requestVideoFrame = video.requestVideoFrameCallback?.bind(video);
        if (requestVideoFrame) {
            const tick = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
                if (stopped) return;
                paint(metadata.mediaTime);
                videoFrameHandle = requestVideoFrame(tick);
            };
            videoFrameHandle = requestVideoFrame(tick);
        } else {
            const tick = () => {
                if (stopped) return;
                paint(video.currentTime);
                animationFrameHandle = requestAnimationFrame(tick);
            };
            animationFrameHandle = requestAnimationFrame(tick);
        }
        paint(video.currentTime);
        return () => {
            stopped = true;
            if (videoFrameHandle !== undefined) video.cancelVideoFrameCallback?.(videoFrameHandle);
            if (animationFrameHandle !== undefined) cancelAnimationFrame(animationFrameHandle);
        };
    }, [mediaRange, tracer, sequence, videoRef]);
    if (!tracer) return <svg className="shot-tracer-layer" aria-hidden="true" />;
    const visual = tracerVisualState(tracer, frame);
    const path = shotTracerPath(tracer.points, tracer.smoothing);
    const tail = (tracer.tailLength ?? .16) * 100;
    const coordinates = (event: React.PointerEvent<SVGSVGElement | SVGCircleElement>) => {
        const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement!;
        const rect = svg.getBoundingClientRect();
        return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
    };
    return <svg className={`shot-tracer-layer ${editing ? 'editing' : ''} ${marking ? 'marking' : ''}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" data-active={tracer.enabled} onPointerDown={(event) => {
        if (!marking) return;
        const point = coordinates(event); onMark(point.x, point.y);
    }} onPointerMove={(event) => {
        onCursor(coordinates(event));
        if (dragIndex === undefined) return;
        const point = coordinates(event); onPoint(dragIndex, point.x, point.y);
    }} onPointerUp={() => setDragIndex(undefined)} onPointerLeave={() => { setDragIndex(undefined); onCursor(undefined); }}>
        <defs><filter id={`tracer-glow-${tracer.id}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={tracer.glow} result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <g ref={motionGroupRef} transform={svgCameraMatrix(tracer.cameraLock, frame)}>
        {editing && <path className="tracer-guide" d={path} />}
        {tracer.points.length >= 2 && <path ref={strokeRef} className="tracer-stroke" d={path} pathLength={100} style={{ stroke: tracer.color, strokeWidth: tracer.thickness, strokeDasharray: `${tail} 100`, strokeDashoffset: tail - visual.progress * 100, opacity: visual.opacity, filter: `url(#tracer-glow-${tracer.id})` }} />}
        {tracer.points.length > 0 && <circle ref={headRef} className="tracer-head" cx={tracer.points[0].x * 1000} cy={tracer.points[0].y * 1000} r={Math.max(7, tracer.thickness * 1.7)} style={{ fill: tracer.color, opacity: visual.opacity, filter: `url(#tracer-glow-${tracer.id})` }} />}
        {editing && tracer.points.map((point, index) => point.kind === 'curve' && index > 0 && index < tracer.points.length - 1 ? <g className="curve-control-lines" key={`control-${index}`}><line x1={tracer.points[index - 1].x * 1000} y1={tracer.points[index - 1].y * 1000} x2={point.x * 1000} y2={point.y * 1000} /><line x1={point.x * 1000} y1={point.y * 1000} x2={tracer.points[index + 1].x * 1000} y2={tracer.points[index + 1].y * 1000} /></g> : null)}
        {editing && tracer.points.map((point, index) => <g className={`tracer-anchor ${point.kind === 'curve' ? 'curve-handle' : ''}`} key={`${point.frame}-${index}`} transform={`translate(${point.x * 1000} ${point.y * 1000})`}><circle r={point.kind === 'curve' ? 26 : 22} onPointerDown={(event) => { event.stopPropagation(); setDragIndex(index); event.currentTarget.setPointerCapture(event.pointerId); }} /><text y={5} textAnchor="middle">{point.kind === 'impact' ? 'I' : point.kind === 'landing' ? 'L' : point.kind === 'curve' ? 'H' : index + 1}</text><text className="tracer-keyframe-label" y={49} textAnchor="middle">F{point.frame}</text></g>)}
        </g>
        {editing && candidates.map((candidate, index) => <g className="ball-candidate" key={`${candidate.x}-${candidate.y}`} transform={`translate(${candidate.x * 1000} ${candidate.y * 1000})`} onPointerDown={(event) => { event.stopPropagation(); onCandidate(candidate); }}><circle r={34} /><circle className="candidate-core" r={7} /><text y={-45} textAnchor="middle">#{index + 1} · {Math.round(candidate.confidence * 100)}%</text></g>)}
        {cameraMarkers.map((marker, index) => <g className="camera-lock-marker" key={`${marker.label}-${index}`} transform={`translate(${marker.x * 1000} ${marker.y * 1000})`}><line x1={-24} y1={0} x2={24} y2={0} /><line x1={0} y1={-24} x2={0} y2={24} /><text y={-34} textAnchor="middle">{marker.label}</text></g>)}
    </svg>;
}

function TrackingMagnifier({ video, cursor, frame }: { video: HTMLVideoElement | null; cursor?: { x: number; y: number }; frame: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        const stage = video?.closest('.preview-stage') as HTMLElement | null;
        if (!canvas || !video || !stage || !cursor || !video.videoWidth || !video.videoHeight) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        const stageRect = stage.getBoundingClientRect();
        const videoRatio = video.videoWidth / video.videoHeight;
        const stageRatio = stageRect.width / stageRect.height;
        let displayWidth = stageRect.width;
        let displayHeight = stageRect.height;
        let offsetX = 0;
        let offsetY = 0;
        if (videoRatio > stageRatio) { displayHeight = displayWidth / videoRatio; offsetY = (stageRect.height - displayHeight) / 2; }
        else { displayWidth = displayHeight * videoRatio; offsetX = (stageRect.width - displayWidth) / 2; }
        const sourceX = Math.min(1, Math.max(0, (cursor.x * stageRect.width - offsetX) / displayWidth)) * video.videoWidth;
        const sourceY = Math.min(1, Math.max(0, (cursor.y * stageRect.height - offsetY) / displayHeight)) * video.videoHeight;
        const crop = Math.max(28, Math.min(video.videoWidth, video.videoHeight) * .075);
        try {
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(video, sourceX - crop / 2, sourceY - crop / 2, crop, crop, 0, 0, canvas.width, canvas.height);
        } catch { context.clearRect(0, 0, canvas.width, canvas.height); }
    }, [video, cursor, frame]);
    if (!cursor) return null;
    return <canvas ref={canvasRef} className="tracking-magnifier" width={132} height={132} style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }} />;
}

function LegacyShotTracerControls({ project, sequence, tracer, frame, editing, marking, direction, analyzing, detectionStatus, candidateCount, setProject, onEdit, onMarking, onDirection, onAnalyze }: {
    project: GolfProject;
    sequence: VirtualSequence;
    tracer?: ShotTracerEffect;
    frame: number;
    editing: boolean;
    marking: boolean;
    direction: -1 | 1;
    analyzing: boolean;
    detectionStatus: string;
    candidateCount: number;
    setProject: (project: GolfProject) => void;
    onEdit: (value: boolean) => void;
    onMarking: (value: boolean) => void;
    onDirection: (value: -1 | 1) => void;
    onAnalyze: () => void;
}) {
    const duration = sequence.outFrame - sequence.inFrame;
    const seconds = (value: number | null) => ((value ?? 0) / sequence.sourceFps).toFixed(2);
    const updateTiming = (key: 'impactFrame' | 'endFrame' | 'disappearFrame', value: number) => {
        if (!tracer) return;
        const frameValue = Math.round(value * sequence.sourceFps);
        let points = tracer.points;
        if (points.length >= 3 && key !== 'disappearFrame') {
            const start = key === 'impactFrame' ? frameValue : tracer.impactFrame ?? 0;
            const end = key === 'endFrame' ? frameValue : tracer.endFrame ?? duration;
            points = points.map((point, index) => index === 0 ? { ...point, frame: start } : index === points.length - 1 ? { ...point, frame: end } : { ...point, frame: Math.round(start + (end - start) * 0.48) });
        }
        setProject(updateShotTracer(project, sequence.id, { [key]: frameValue, points }));
    };
    return <div className="inspector-section tracer-controls"><span className="field-label">Shot Tracer</span><button className={`tracer-toggle ${tracer?.enabled ? 'active' : ''}`} onClick={() => { setProject(toggleShotTracer(project, sequence.id)); if (!tracer?.enabled) onEdit(true); }}><WandSparkles size={18} /><span><b>{tracer?.enabled ? 'Tracer aktiv' : 'Tracer hinzufügen'}</b><small>{tracer?.enabled ? 'Flugbahn liegt auf dieser Sequenz' : 'Assistierten 3-Punkt-Tracer erstellen'}</small></span><i>{tracer?.enabled ? 'AN' : 'AUS'}</i></button>{tracer?.enabled && <div className="tracer-editor-controls"><button className={`tracer-edit-button ${editing ? 'active' : ''}`} onClick={() => onEdit(!editing)}><Crosshair size={14} /> {editing ? 'Editor schließen' : 'Flugbahn bearbeiten'}</button>{editing && <><div className="tracer-instruction"><b>{marking ? 'Jetzt den Ball am Treffpunkt im Video anklicken' : candidateCount ? 'Ballkandidat im Videobild bestätigen' : 'Ball automatisch suchen oder Anker verschieben'}</b><small>{candidateCount ? `${candidateCount} Kandidaten gefunden · höchste Wahrscheinlichkeit zuerst` : '1 Treffpunkt · 2 Scheitelpunkt · 3 Flugende'}</small></div><button className="auto-ball-button" disabled={analyzing} onClick={onAnalyze}><Sparkles size={14} /> {analyzing ? 'Frames werden analysiert …' : 'Ball automatisch suchen'}</button>{detectionStatus && <div className={`detection-status ${candidateCount ? 'success' : ''}`}>{detectionStatus}</div>}<div className="tracer-direction"><span>Flugrichtung</span><button className={direction === -1 ? 'active' : ''} onClick={() => onDirection(-1)}>← Links</button><button className={direction === 1 ? 'active' : ''} onClick={() => onDirection(1)}>Rechts →</button></div><button className={`mark-ball-button ${marking ? 'active' : ''}`} onClick={() => onMarking(!marking)}><Crosshair size={14} /> {marking ? 'Markierung abbrechen' : 'Ball manuell markieren'}</button><button className="secondary regenerate-tracer" onClick={() => setProject(proposeShotTracer(project, sequence.id, tracer.points[0]?.x ?? .32, tracer.points[0]?.y ?? .76, direction))}><RotateCcw size={13} /> Vorschlag neu berechnen</button><div className="tracer-time-grid"><label><span>Treffer</span><input type="number" min={0} max={duration / sequence.sourceFps} step={1 / sequence.sourceFps} value={seconds(tracer.impactFrame)} onChange={(event) => updateTiming('impactFrame', Number(event.target.value))} /></label><label><span>Flugende</span><input type="number" min={0} max={duration / sequence.sourceFps} step={1 / sequence.sourceFps} value={seconds(tracer.endFrame)} onChange={(event) => updateTiming('endFrame', Number(event.target.value))} /></label><label><span>Ausblenden</span><input type="number" min={0} max={duration / sequence.sourceFps} step={1 / sequence.sourceFps} value={seconds(tracer.disappearFrame)} onChange={(event) => updateTiming('disappearFrame', Number(event.target.value))} /></label></div><div className="tracer-look-grid"><label><span>Farbe</span><input type="color" value={tracer.color} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { color: event.target.value }))} /></label><label><span>Stärke {tracer.thickness}px</span><input type="range" min={1} max={16} value={tracer.thickness} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { thickness: Number(event.target.value) }))} /></label><label><span>Glow {tracer.glow}</span><input type="range" min={0} max={30} value={tracer.glow} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { glow: Number(event.target.value) }))} /></label><label><span>Glättung {Math.round(tracer.smoothing * 100)}%</span><input type="range" min={0} max={1} step={.01} value={tracer.smoothing} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { smoothing: Number(event.target.value) }))} /></label></div><div className="tracer-frame-status"><span>Aktueller Frame</span><b>{frame} / {duration}</b></div></>}</div>}</div>;
}

function LegacyShotTracerControlsV2({ project, sequence, tracer, frame, editing, tracking, landingMode, landingOcclusion, trackingStep, analyzing, detectionStatus, candidateCount, setProject, onEdit, onStartTracking, onStopTracking, onJumpToLanding, onToggleLandingOcclusion, onStepChange, onSeekFrame, onDeleteLast, onAnalyze }: {
    project: GolfProject;
    sequence: VirtualSequence;
    tracer?: ShotTracerEffect;
    frame: number;
    editing: boolean;
    tracking: boolean;
    landingMode: boolean;
    landingOcclusion: boolean;
    trackingStep: number;
    analyzing: boolean;
    detectionStatus: string;
    candidateCount: number;
    setProject: (project: GolfProject) => void;
    onEdit: (value: boolean) => void;
    onStartTracking: () => void;
    onStopTracking: () => void;
    onJumpToLanding: () => void;
    onToggleLandingOcclusion: (value: boolean) => void;
    onStepChange: (frames: number) => void;
    onSeekFrame: (frame: number) => void;
    onDeleteLast: () => void;
    onAnalyze: () => void;
}) {
    const duration = sequence.outFrame - sequence.inFrame;
    const pointCount = tracer?.points.length ?? 0;
    const minimumLandingFrame = Math.min(duration - 1, (tracer?.points.at(-1)?.frame ?? 0) + 1);
    return <div className="inspector-section tracer-controls"><span className="field-label">Shot Tracer</span>
        <button className={`tracer-toggle ${tracer?.enabled ? 'active' : ''}`} onClick={() => { setProject(toggleShotTracer(project, sequence.id)); if (!tracer?.enabled) onEdit(true); }}><WandSparkles size={18} /><span><b>{tracer?.enabled ? 'Tracer aktiv' : 'Tracer hinzufügen'}</b><small>{tracer?.enabled ? `${pointCount} zeitbasierte Anker` : 'Manuell in wenigen Klicks einmessen'}</small></span><i>{tracer?.enabled ? 'AN' : 'AUS'}</i></button>
        {tracer?.enabled && <div className="tracer-editor-controls">
            <button className={`tracer-edit-button ${editing ? 'active' : ''}`} onClick={() => onEdit(!editing)}><Crosshair size={14} /> {editing ? 'Editor schließen' : 'Flugbahn bearbeiten'}</button>
            {editing && <>
                <div className={`tracer-instruction ${tracking ? 'tracking-active' : ''}`}><b>{landingMode ? 'Landeframe wählen und Landepunkt anklicken' : tracking ? 'Ball im aktuellen Frame anklicken' : 'Click-to-Track ist bereit'}</b><small>{landingMode ? 'Der große Regler springt direkt durch den Clip. Der nächste Klick beendet die Flugbahn.' : tracking ? `${pointCount} Punkte gesetzt · Klick springt ${trackingStep} Frames weiter` : 'Start und Landung reichen aus. Dazwischen sind Korrekturpunkte optional.'}</small></div>
                {!tracking ? <button className="manual-track-button" onClick={onStartTracking}><Crosshair size={14} /> {pointCount ? 'Neu einmessen' : 'Manuell einmessen'}</button> : <button className="manual-track-button finish" disabled={pointCount < 2} onClick={onStopTracking}><Check size={14} /> Tracking abschließen</button>}
                {tracking && <>
                    {!landingMode && <><button className="jump-to-landing" disabled={pointCount === 0} onClick={onJumpToLanding}><Flag size={14} /> Direkt zur Balllandung</button><div className="tracking-step"><span>Optionale Zwischenpunkte</span>{[1, 3, 5].map((step) => <button key={step} className={trackingStep === step ? 'active' : ''} onClick={() => onStepChange(step)}>{step} F</button>)}</div></>}
                    {landingMode && <div className="landing-picker"><div><span>Landeframe</span><b>{frame} / {duration - 1}</b></div><input className="landing-frame-slider" type="range" min={minimumLandingFrame} max={Math.max(minimumLandingFrame, duration - 1)} step={1} value={Math.max(minimumLandingFrame, frame)} onChange={(event) => onSeekFrame(Number(event.target.value))} /><div className="landing-jumps"><button onClick={() => onSeekFrame(Math.max(minimumLandingFrame, frame - sequence.sourceFps))}>−1 Sek.</button><button onClick={() => onSeekFrame(frame + sequence.sourceFps)}>+1 Sek.</button><button onClick={() => onSeekFrame(duration - 1)}>Clipende</button></div><label className="occlusion-toggle"><input type="checkbox" checked={landingOcclusion} onChange={(event) => onToggleLandingOcclusion(event.target.checked)} /><span><b>Ball fliegt hinter einem Hindernis</b><small>Tracer verschwindet nach dem letzten sichtbaren Punkt und erscheint an der Landung wieder.</small></span></label></div>}
                    <div className="tracking-frame-nav"><button onClick={() => onSeekFrame(frame - 1)}><ChevronLeft size={14} /> 1 Frame</button><b>Frame {frame}</b><button onClick={() => onSeekFrame(frame + 1)}>1 Frame <ChevronRight size={14} /></button></div>
                    {!landingMode && <button className="auto-ball-button" disabled={analyzing || pointCount === 0} onClick={onAnalyze}><Sparkles size={14} /> {analyzing ? 'Lokaler Bereich wird geprüft …' : 'Lokal um letzten Punkt suchen'}</button>}
                    {candidateCount > 0 && <div className="candidate-hint">Enter übernimmt Kandidat #1</div>}
                    <button className="secondary delete-track-point" disabled={pointCount === 0} onClick={onDeleteLast}><Trash2 size={13} /> Letzten Punkt löschen</button>
                    <div className="tracking-hotkeys"><span>←/→ oder A/D: 1 Frame</span><span>Shift: 5 Frames</span><span>Entf: Undo</span><span>Esc: Fertig</span></div>
                </>}
                {detectionStatus && <div className={`detection-status ${candidateCount ? 'success' : ''}`}>{detectionStatus}</div>}
                {!tracking && pointCount >= 2 && <div className="tracer-keyframe-list">{tracer.points.map((point, index) => <button key={`${point.frame}-${index}`} onClick={() => onSeekFrame(point.frame)}><i>{index + 1}</i><span>Frame {point.frame}</span></button>)}</div>}
                <div className="tracer-look-grid"><label><span>Farbe</span><input type="color" value={tracer.color} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { color: event.target.value }))} /></label><label><span>Stärke {tracer.thickness}px</span><input type="range" min={1} max={16} value={tracer.thickness} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { thickness: Number(event.target.value) }))} /></label><label><span>Schweif {Math.round((tracer.tailLength ?? .16) * 100)}%</span><input type="range" min={.04} max={.5} step={.01} value={tracer.tailLength ?? .16} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { tailLength: Number(event.target.value) }))} /></label><label><span>Glow {tracer.glow}</span><input type="range" min={0} max={30} value={tracer.glow} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { glow: Number(event.target.value) }))} /></label><label><span>Glättung {Math.round(tracer.smoothing * 100)}%</span><input type="range" min={0} max={1} step={.01} value={tracer.smoothing} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { smoothing: Number(event.target.value) }))} /></label></div>
                <div className="tracer-frame-status"><span>Aktueller Frame</span><b>{frame} / {duration}</b></div>
            </>}
        </div>}
    </div>;
}

function ShotTracerControls({ project, sequence, tracer, frame, editing, workflowStep, cameraLockStep, detectionStatus, setProject, onEdit, onStart, onConfirmImpactFrame, onConfirmLandingFrame, onBeginIntermediate, onConfirmIntermediateFrame, onFinish, onStartCameraLock, onClearCameraLock, onSeekFrame }: {
    project: GolfProject;
    sequence: VirtualSequence;
    tracer?: ShotTracerEffect;
    frame: number;
    editing: boolean;
    workflowStep?: TracerWorkflowStep;
    cameraLockStep?: CameraLockStep;
    detectionStatus: string;
    setProject: (project: GolfProject) => void;
    onEdit: (value: boolean) => void;
    onStart: () => void;
    onConfirmImpactFrame: () => void;
    onConfirmLandingFrame: () => void;
    onBeginIntermediate: () => void;
    onConfirmIntermediateFrame: () => void;
    onFinish: () => void;
    onStartCameraLock: () => void;
    onClearCameraLock: () => void;
    onSeekFrame: (frame: number) => void;
}) {
    const duration = sequence.outFrame - sequence.inFrame;
    const impactFrame = tracer?.points.find((point) => point.kind === 'impact')?.frame ?? tracer?.impactFrame ?? 0;
    const landingFrame = tracer?.points.find((point) => point.kind === 'landing')?.frame ?? tracer?.endFrame ?? duration - 1;
    const choosingFrame = workflowStep === 'impact-frame' || workflowStep === 'landing-frame' || workflowStep === 'intermediate-frame';
    const cameraPrompt = cameraLockStep === 'impact-a' ? ['Kamera-Lock · Impact A', 'Ersten festen Hintergrundpunkt im Impact-Frame anklicken.']
        : cameraLockStep === 'impact-b' ? ['Kamera-Lock · Impact B', 'Zweiten festen Hintergrundpunkt anklicken – möglichst weit von A entfernt.']
            : cameraLockStep === 'landing-a' ? ['Kamera-Lock · Landung A', 'Jetzt denselben Hintergrundpunkt A im Landeframe anklicken.']
                : cameraLockStep === 'landing-b' ? ['Kamera-Lock · Landung B', 'Jetzt denselben Hintergrundpunkt B im Landeframe anklicken.'] : undefined;
    const prompt = cameraPrompt ?? (workflowStep === 'impact-frame' ? ['1 · Impact-Frame setzen', 'Mit Regler oder Tasten zum Treffmoment gehen.']
        : workflowStep === 'impact-point' ? ['2 · Ball am Impact markieren', `Frame ${frame} steht fest. Jetzt den Ball im Bild anklicken.`]
            : workflowStep === 'landing-frame' ? ['3 · Landeframe setzen', 'Manuell zur tatsächlichen Landung springen – nicht automatisch zum Clipende.']
                : workflowStep === 'landing-point' ? ['4 · Landepunkt markieren', `Frame ${frame} steht fest. Jetzt die Landeposition im Bild anklicken.`]
                    : workflowStep === 'intermediate-frame' ? ['Zwischenframe wählen', 'Einen Frame zwischen Impact und Landung auswählen.']
                        : workflowStep === 'intermediate-point' ? ['Zwischenpunkt markieren', `Position des Balls beziehungsweise der gewünschten Flugbahn bei Frame ${frame} anklicken.`]
                            : ['Flugbahn bearbeiten', 'I = Impact · H = Kurven-Handle · L = Landung. Alle Punkte können direkt verschoben werden.']);
    const sliderMin = workflowStep === 'landing-frame' ? Math.min(duration - 1, impactFrame + 1) : workflowStep === 'intermediate-frame' ? Math.min(duration - 1, impactFrame + 1) : 0;
    const sliderMax = workflowStep === 'intermediate-frame' ? Math.max(sliderMin, landingFrame - 1) : Math.max(sliderMin, duration - 1);
    return <div className="inspector-section tracer-controls"><span className="field-label">Shot Tracer</span>
        <button className={`tracer-toggle ${tracer?.enabled ? 'active' : ''}`} onClick={() => { setProject(toggleShotTracer(project, sequence.id)); if (!tracer?.enabled) onEdit(true); }}><WandSparkles size={18} /><span><b>{tracer?.enabled ? 'Tracer aktiv' : 'Tracer hinzufügen'}</b><small>{tracer?.enabled ? 'Manueller Impact–Landung-Workflow' : 'Impact, Landung und Kurve festlegen'}</small></span><i>{tracer?.enabled ? 'AN' : 'AUS'}</i></button>
        {tracer?.enabled && <div className="tracer-editor-controls"><button className={`tracer-edit-button ${editing ? 'active' : ''}`} onClick={() => onEdit(!editing)}><Crosshair size={14} /> {editing ? 'Editor schließen' : 'Flugbahn bearbeiten'}</button>{editing && <>
            <div className={`tracer-instruction ${workflowStep || cameraLockStep ? 'tracking-active' : ''}`}><b>{prompt[0]}</b><small>{prompt[1]}</small></div>
            {!workflowStep && !cameraLockStep && <button className="manual-track-button" onClick={onStart}><Crosshair size={14} /> {tracer.points.some((point) => point.kind === 'landing') ? 'Neu einmessen' : 'Einmessen starten'}</button>}
            {!workflowStep && !cameraLockStep && tracer.points.some((point) => point.kind === 'landing') && <div className="camera-lock-actions"><button className={tracer.cameraLock ? 'active' : ''} onClick={onStartCameraLock}><Aperture size={13} /> {tracer.cameraLock ? 'Kamera-Lock neu setzen' : 'Kamera-Lock einrichten'}</button>{tracer.cameraLock && <button onClick={onClearCameraLock}>Lock entfernen</button>}</div>}
            {choosingFrame && <div className="manual-frame-picker"><div><span>Aktueller Frame</span><b>{frame} / {duration - 1}</b></div><input type="range" min={sliderMin} max={sliderMax} step={1} value={Math.min(sliderMax, Math.max(sliderMin, frame))} onChange={(event) => onSeekFrame(Number(event.target.value))} /><div className="manual-frame-buttons"><button onClick={() => onSeekFrame(frame - 5)}>−5 F</button><button onClick={() => onSeekFrame(frame - 1)}>−1 F</button><button onClick={() => onSeekFrame(frame + 1)}>+1 F</button><button onClick={() => onSeekFrame(frame + 5)}>+5 F</button></div>{workflowStep === 'impact-frame' && <button className="confirm-tracer-frame" onClick={onConfirmImpactFrame}><Check size={13} /> Impact-Frame übernehmen</button>}{workflowStep === 'landing-frame' && <button className="confirm-tracer-frame landing" onClick={onConfirmLandingFrame}><Flag size={13} /> Landeframe übernehmen</button>}{workflowStep === 'intermediate-frame' && <button className="confirm-tracer-frame" onClick={onConfirmIntermediateFrame}><Plus size={13} /> Zwischenframe übernehmen</button>}</div>}
            {workflowStep === 'edit' && !cameraLockStep && <><div className="tracer-edit-actions"><button onClick={onBeginIntermediate}><Plus size={13} /> Zwischenpunkt hinzufügen</button><button className="finish" onClick={onFinish}><Check size={13} /> Fertig</button></div><div className="camera-lock-actions"><button className={tracer.cameraLock ? 'active' : ''} onClick={onStartCameraLock}><Aperture size={13} /> {tracer.cameraLock ? 'Kamera-Lock neu setzen' : 'Kamera-Lock einrichten'}</button>{tracer.cameraLock && <button onClick={onClearCameraLock}>Lock entfernen</button>}</div></>}
            {cameraLockStep && <button className="secondary cancel-camera-lock" onClick={onClearCameraLock}>Kamera-Lock abbrechen</button>}
            {tracer.cameraLock && !cameraLockStep && <div className="camera-lock-status"><Check size={12} /> Kamera an Impact und Landung fixiert</div>}
            {detectionStatus && <div className="detection-status success">{detectionStatus}</div>}
            {tracer.points.length >= 2 && <div className="tracer-keyframe-list">{tracer.points.map((point, index) => <button key={`${point.frame}-${index}`} onClick={() => onSeekFrame(point.frame)}><i>{point.kind === 'impact' ? 'I' : point.kind === 'landing' ? 'L' : point.kind === 'curve' ? 'H' : index + 1}</i><span>Frame {point.frame}</span></button>)}</div>}
            <div className="tracer-look-grid"><label><span>Farbe</span><input type="color" value={tracer.color} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { color: event.target.value }))} /></label><label><span>Stärke {tracer.thickness}px</span><input type="range" min={1} max={16} value={tracer.thickness} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { thickness: Number(event.target.value) }))} /></label><label><span>Schweif {Math.round((tracer.tailLength ?? .16) * 100)}%</span><input type="range" min={.04} max={.5} step={.01} value={tracer.tailLength ?? .16} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { tailLength: Number(event.target.value) }))} /></label><label><span>Glow {tracer.glow}</span><input type="range" min={0} max={30} value={tracer.glow} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { glow: Number(event.target.value) }))} /></label><label><span>Glättung {Math.round(tracer.smoothing * 100)}%</span><input type="range" min={0} max={1} step={.01} value={tracer.smoothing} onChange={(event) => setProject(updateShotTracer(project, sequence.id, { smoothing: Number(event.target.value) }))} /></label></div>
            <div className="tracking-hotkeys"><span>←/→ oder A/D: 1 Frame</span><span>Shift: 5 Frames</span></div>
        </>}</div>}
    </div>;
}

function CameraPlanTimeline({ project, sequence, activeCutId, setProject, onSeek }: {
    project: GolfProject;
    sequence: VirtualSequence;
    activeCutId: string;
    setProject: (project: GolfProject) => void;
    onSeek: (frame: number) => void;
}) {
    const [dragging, setDragging] = useState<{ leftCutId: string; rightCutId: string }>();
    const cuts = [...(sequence.videoCuts ?? [])].sort((left, right) => left.startUs - right.startUs);
    const durationUs = Math.max(1, Math.round((sequence.outFrame - sequence.inFrame) / sequence.sourceFps * 1_000_000));
    if (cuts.length === 0) return null;
    const moveBoundary = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
        setProject(setSequenceCameraCutBoundary(project, sequence.id, dragging.leftCutId, dragging.rightCutId, ratio * durationUs));
    };
    return <section className={`camera-plan-timeline ${dragging ? 'dragging' : ''}`}>
        <header><span><Film size={13} /> FINALER FILM</span><small>{cuts.length > 1 ? 'Schnittkante ziehen, um den Kamerawechsel anzupassen' : 'Weitere Kamera ab Abspielposition übernehmen, um einen Schnitt anzulegen'}</small></header>
        <div className="camera-plan-track" onPointerMove={moveBoundary} onPointerUp={() => setDragging(undefined)} onPointerCancel={() => setDragging(undefined)}>
            {cuts.map((cut, cutIndex) => {
                const media = project.media.find((item) => item.id === cut.mediaId);
                return <button className={`camera-plan-segment ${cut.id === activeCutId ? 'active' : ''} ${cutIndex === cuts.length - 1 ? 'last' : ''}`} key={cut.id} style={{ width: `${Math.max(.5, (cut.endUs - cut.startUs) / durationUs * 100)}%` }} title={`${media?.name ?? 'Kamera offen'} · ${((cut.endUs - cut.startUs) / 1_000_000).toFixed(2)} s`} onClick={() => { if (!dragging) onSeek(Math.round(cut.startUs / 1_000_000 * sequence.sourceFps)); }}><b>{media?.device || `Cam ${cutIndex + 1}`}</b><small>{((cut.endUs - cut.startUs) / 1_000_000).toFixed(1)} s</small></button>;
            })}
            {cuts.slice(0, -1).map((cut, cutIndex) => cut.locked || cuts[cutIndex + 1].locked ? null : <button className="camera-plan-handle" key={`${cut.id}-boundary`} style={{ left: `${cut.endUs / durationUs * 100}%` }} aria-label={`Schnittkante ${cutIndex + 1} verschieben`} title="Ziehen, um den Umschnitt zu verschieben" onPointerDown={(event) => {
                event.preventDefault(); event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging({ leftCutId: cut.id, rightCutId: cuts[cutIndex + 1].id });
            }}><span /></button>)}
        </div>
    </section>;
}

function RoughCutPreview({ project, setProject, onlyHole, onClose, onEdit }: { project: GolfProject; setProject: (project: GolfProject) => void; onlyHole?: number; onClose: () => void; onEdit: (sequenceId: string) => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const editorialFadeRef = useRef<HTMLDivElement>(null);
    const transitionTimerRef = useRef<number | undefined>(undefined);
    const transitionInProgressRef = useRef(false);
    const cutAdvanceGuardRef = useRef(false);
    const mediaElement = () => videoRef.current ?? audioRef.current;
    const pendingOffset = useRef(0);
    const sequenceIds = useMemo(() => roughCutSequenceIds(project, onlyHole), [project, onlyHole]);
    const previewRenderPlan = useMemo(() => compileRenderPlan(project, sequenceIds), [project, sequenceIds]);
    const items = useMemo(() => sequenceIds.flatMap((sequenceId) => {
        const sequence = project.sequences.find((item) => item.id === sequenceId);
        if (!sequence) return [];
        const block = project.blocks.find((item) => item.id === sequence.targetBlockId);
        if (!block) return [];
        const player = project.settings.players.find((item) => item.id === block.playerId);
        return [{ sequence, block, player }];
    }), [project, sequenceIds, previewRenderPlan]);
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);
    const [localFrame, setLocalFrame] = useState(0);
    const [tracerEditing, setTracerEditing] = useState(false);
    const [markingBall, setMarkingBall] = useState(false);
    const [manualTracking, setManualTracking] = useState(false);
    const [tracerWorkflowStep, setTracerWorkflowStep] = useState<TracerWorkflowStep>();
    const [cameraLockStep, setCameraLockStep] = useState<CameraLockStep>();
    const [cameraLockDraft, setCameraLockDraft] = useState<{ referencePoints: CameraLockPoint[]; targetPoints: CameraLockPoint[] }>({ referencePoints: [], targetPoints: [] });
    const [cameraLockBasePoints, setCameraLockBasePoints] = useState<ShotTracerPoint[]>([]);
    const [landingMode, setLandingMode] = useState(false);
    const [landingOcclusion, setLandingOcclusion] = useState(false);
    const [trackingStep, setTrackingStep] = useState(3);
    const [trackingCursor, setTrackingCursor] = useState<{ x: number; y: number }>();
    const [tracerDirection, setTracerDirection] = useState<-1 | 1>(1);
    const [ballCandidates, setBallCandidates] = useState<BallCandidate[]>([]);
    const [analyzingBall, setAnalyzingBall] = useState(false);
    const [detectionStatus, setDetectionStatus] = useState('');
    const [holeTitleIndex, setHoleTitleIndex] = useState<number>();
    const [previewMediaId, setPreviewMediaId] = useState<string>();
    const [playbackError, setPlaybackError] = useState<string>();
    const currentItem = items[index];
    const currentPlayback = currentItem
        ? previewMediaId
            ? sequencePreviewSource(project, currentItem.sequence, previewMediaId)
            : sequencePlaybackSource(project, currentItem.sequence, localFrame / currentItem.sequence.sourceFps, previewRenderPlan)
        : null;
    const current = currentItem && currentPlayback ? { ...currentItem, ...currentPlayback } : undefined;
    const currentMomentPlan = useMemo(() => currentItem ? compileRenderPlan(project, [currentItem.sequence.id]) : undefined, [project, currentItem]);
    const currentReviewed = Boolean(currentItem?.sequence.review?.status === 'approved' && currentItem.sequence.review.reviewedFingerprint === currentMomentPlan?.renderFingerprint);
    const currentAudio = currentItem ? sequencePlaybackAudioSource(project, currentItem.sequence, localFrame / currentItem.sequence.sourceFps, previewRenderPlan) : null;
    const previous = items[index - 1];
    const next = items[index + 1];
    const transitionIn = current && previous ? editorialTransition(project, previous.sequence.id, current.sequence.id) : undefined;
    const transitionOut = current ? editorialTransition(project, current.sequence.id, next?.sequence.id) : undefined;
    const durations = items.map((item) => (item.sequence.outFrame - item.sequence.inFrame) / item.sequence.sourceFps);
    const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
    const elapsedBefore = durations.slice(0, index).reduce((sum, duration) => sum + duration, 0);
    const position = Math.min(totalDuration, elapsedBefore + localFrame / (currentItem?.sequence.sourceFps ?? 1));
    const currentTracer = current ? project.shotTracers.find((tracer) => tracer.sequenceId === current.sequence.id) : undefined;
    const activeTracer = currentTracer?.enabled
        && (!currentTracer.binding?.cutId || current?.cutId.startsWith('preview-') || currentTracer.binding.cutId === current?.cutId)
        && (!currentTracer.binding?.mediaId || currentTracer.binding.mediaId === current?.media.id)
        ? currentTracer : undefined;
    useEffect(() => { setTracerEditing(false); setMarkingBall(false); setManualTracking(false); setTracerWorkflowStep(undefined); setCameraLockStep(undefined); setCameraLockDraft({ referencePoints: [], targetPoints: [] }); setCameraLockBasePoints([]); setLandingMode(false); setLandingOcclusion(false); setTrackingCursor(undefined); setBallCandidates([]); setDetectionStatus(''); setPreviewMediaId(undefined); }, [currentItem?.sequence.id]);
    useEffect(() => setPlaybackError(undefined), [current?.sequence.id, current?.cutId, current?.media.id]);
    useEffect(() => () => { if (transitionTimerRef.current !== undefined) window.clearTimeout(transitionTimerRef.current); }, []);
    useEffect(() => {
        const element = mediaElement();
        const fade = editorialFadeRef.current;
        if (!current || !element || !fade) return;
        let animationHandle: number | undefined;
        let videoFrameHandle: number | undefined;
        let stopped = false;
        const duration = (current.sequence.outFrame - current.sequence.inFrame) / current.sequence.sourceFps;
        const audioFade = Math.min(duration / 2, EDITORIAL_STYLE.audioFadeFrames / current.sequence.sourceFps);
        const paint = (sourceTime: number) => {
            const relative = current.momentStartSeconds + Math.max(0, sourceTime - current.range.inFrame / current.range.sourceFps);
            const remaining = Math.max(0, duration - relative);
            const fadeIn = transitionIn?.kind === 'hole-change' ? Math.max(0, 1 - relative / Math.max(.001, transitionIn.dipSeconds)) : 0;
            const fadeOut = transitionOut?.kind === 'hole-change' ? Math.max(0, 1 - remaining / Math.max(.001, transitionOut.dipSeconds)) : 0;
            fade.style.opacity = String(Math.max(fadeIn, fadeOut));
            if (holeTitleIndex === undefined) {
                const gain = Math.min(1, relative / Math.max(.001, audioFade), remaining / Math.max(.001, audioFade));
                element.volume = Math.max(0, gain);
                if (audioRef.current) audioRef.current.volume = Math.min(1, Math.max(0, 10 ** ((currentAudio?.gainDb ?? 0) / 20) * gain));
            }
        };
        const requestVideoFrame = videoRef.current?.requestVideoFrameCallback?.bind(videoRef.current);
        if (requestVideoFrame) {
            const tick = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
                if (stopped) return;
                paint(metadata.mediaTime);
                videoFrameHandle = requestVideoFrame(tick);
            };
            videoFrameHandle = requestVideoFrame(tick);
        } else {
            const tick = () => {
                if (stopped) return;
                paint(element.currentTime);
                animationHandle = requestAnimationFrame(tick);
            };
            animationHandle = requestAnimationFrame(tick);
        }
        paint(element.currentTime);
        return () => {
            stopped = true;
            element.volume = 1;
            if (audioRef.current) audioRef.current.volume = Math.min(1, Math.max(0, 10 ** ((currentAudio?.gainDb ?? 0) / 20)));
            if (videoFrameHandle !== undefined) videoRef.current?.cancelVideoFrameCallback?.(videoFrameHandle);
            if (animationHandle !== undefined) cancelAnimationFrame(animationHandle);
        };
    }, [current?.sequence.id, current?.cutId, current?.media.id, currentAudio?.audioCutId, transitionIn?.kind, transitionOut?.kind, holeTitleIndex]);
    const startCurrent = () => {
        if (!current) return;
        const element = mediaElement();
        if (!element) return;
        const offsetWithinCut = Math.max(0, pendingOffset.current - current.momentStartSeconds);
        element.currentTime = current.range.inFrame / current.range.sourceFps + offsetWithinCut;
        pendingOffset.current = 0;
        if (playing) void element.play().catch(() => setPlaying(false));
    };
    const syncCurrentAudio = (momentSeconds: number, force = false) => {
        const audio = audioRef.current;
        if (!audio || !currentAudio || audio.readyState === 0) return;
        const target = currentAudio.sourceStartSeconds + Math.max(0, momentSeconds - currentAudio.momentStartSeconds);
        if (force || Math.abs(audio.currentTime - target) > .15) audio.currentTime = target;
    };
    const startCurrentAudio = () => {
        if (!currentAudio || !audioRef.current) return;
        audioRef.current.volume = Math.min(1, Math.max(0, 10 ** (currentAudio.gainDb / 20)));
        syncCurrentAudio(localFrame / (current?.sequence.sourceFps ?? 1), true);
        if (playing) void audioRef.current.play().catch(() => undefined);
    };
    const goTo = (next: number, offsetSeconds = 0) => {
        const target = Math.min(items.length - 1, Math.max(0, next));
        pendingOffset.current = Math.max(0, offsetSeconds);
        setIndex(target);
        setLocalFrame(Math.round(offsetSeconds * (items[target]?.sequence.sourceFps ?? 1)));
    };
    const advance = () => {
        if (transitionInProgressRef.current) return;
        if (index < items.length - 1 && transitionOut?.kind === 'hole-change') {
            transitionInProgressRef.current = true;
            setPlaying(false);
            mediaElement()?.pause();
            audioRef.current?.pause();
            if (editorialFadeRef.current) editorialFadeRef.current.style.opacity = '1';
            setHoleTitleIndex(index + 1);
            transitionTimerRef.current = window.setTimeout(() => {
                transitionInProgressRef.current = false;
                setHoleTitleIndex(undefined);
                setPlaying(true);
                goTo(index + 1);
            }, transitionOut.cardSeconds * 1000);
        } else if (index < items.length - 1) goTo(index + 1);
        else { setPlaying(false); mediaElement()?.pause(); audioRef.current?.pause(); }
    };
    const advanceCutOrSequence = () => {
        if (!current || cutAdvanceGuardRef.current) return;
        cutAdvanceGuardRef.current = true;
        const momentDuration = (current.sequence.outFrame - current.sequence.inFrame) / current.sequence.sourceFps;
        if (current.momentEndSeconds < momentDuration - .000001) {
            pendingOffset.current = current.momentEndSeconds;
            setLocalFrame(Math.round(current.momentEndSeconds * current.sequence.sourceFps));
            return;
        }
        advance();
    };
    useEffect(() => {
        cutAdvanceGuardRef.current = false;
        const video = videoRef.current;
        if (!video || !current || current.media.kind !== 'video' || !playing) return;
        let stopped = false;
        let handle: number | undefined;
        const requestVideoFrame = video.requestVideoFrameCallback?.bind(video);
        if (!requestVideoFrame) return;
        const tick = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
            if (stopped) return;
            if (shouldAdvanceVideoCut(metadata.mediaTime, current.range.outFrame, current.range.sourceFps)) {
                video.pause();
                advanceCutOrSequence();
                return;
            }
            handle = requestVideoFrame(tick);
        };
        handle = requestVideoFrame(tick);
        return () => {
            stopped = true;
            if (handle !== undefined) video.cancelVideoFrameCallback?.(handle);
        };
    }, [current?.sequence.id, current?.cutId, current?.media.id, current?.range.outFrame, current?.range.sourceFps, playing]);
    useEffect(() => {
        if (!currentItem || currentPlayback || !playing) return;
        const timer = window.setTimeout(() => {
            const nextMoment = nextPlayableMomentSeconds(previewRenderPlan, currentItem.sequence.id, localFrame / currentItem.sequence.sourceFps);
            if (nextMoment !== null) {
                pendingOffset.current = nextMoment;
                setLocalFrame(Math.round(nextMoment * currentItem.sequence.sourceFps));
            } else advance();
        }, 900);
        return () => window.clearTimeout(timer);
    }, [currentItem?.sequence.id, currentPlayback?.cutId, localFrame, playing, previewRenderPlan]);
    useEffect(() => {
        if (!playbackError) return;
        const timer = window.setTimeout(advanceCutOrSequence, 900);
        return () => window.clearTimeout(timer);
    }, [playbackError, current?.cutId]);
    const togglePlay = () => {
        const element = mediaElement();
        if (!element) return;
        if (playing) { element.pause(); audioRef.current?.pause(); setPlaying(false); }
        else { setPlaying(true); void element.play(); if (audioRef.current) void audioRef.current.play(); }
    };
    const seekGlobal = (seconds: number) => {
        let remaining = Math.min(totalDuration, Math.max(0, seconds));
        for (let itemIndex = 0; itemIndex < durations.length; itemIndex += 1) {
            if (remaining <= durations[itemIndex] || itemIndex === durations.length - 1) {
                if (itemIndex === index) {
                    const item = items[itemIndex];
                    const playback = item ? sequencePlaybackSource(project, item.sequence, remaining, previewRenderPlan) : null;
                    if (item && playback && mediaElement() && playback.cutId === current?.cutId) {
                        mediaElement()!.currentTime = playback.range.inFrame / playback.range.sourceFps + remaining - playback.momentStartSeconds;
                    } else pendingOffset.current = remaining;
                    syncCurrentAudio(remaining, true);
                    setLocalFrame(Math.round(remaining * (item?.sequence.sourceFps ?? 1)));
                } else goTo(itemIndex, remaining);
                return;
            }
            remaining -= durations[itemIndex];
        }
    };
    const seekLocalFrame = (frame: number) => {
        if (!current) return;
        const duration = current.sequence.outFrame - current.sequence.inFrame;
        const target = Math.min(duration - 1, Math.max(0, Math.round(frame)));
        const element = mediaElement();
        const targetSeconds = target / current.sequence.sourceFps;
        const playback = sequencePlaybackSource(project, current.sequence, targetSeconds, previewRenderPlan);
        if (element && playback?.cutId === current.cutId) element.currentTime = playback.range.inFrame / playback.range.sourceFps + targetSeconds - playback.momentStartSeconds;
        else pendingOffset.current = targetSeconds;
        syncCurrentAudio(targetSeconds, true);
        setLocalFrame(target);
        setPlaying(false);
        element?.pause();
    };
    const applyTracerImpact = (x: number, y: number) => {
        if (!current) return;
        const withImpact = updateShotTracer(project, current.sequence.id, { impactFrame: localFrame });
        setProject(proposeShotTracer(withImpact, current.sequence.id, x, y, tracerDirection));
        setMarkingBall(false);
        setBallCandidates([]);
        setDetectionStatus('Treffpunkt übernommen · Flugbahn vorgeschlagen.');
    };
    const detectAtFrame = async (targetFrame: number, trackingPoints?: ShotTracerPoint[]) => {
        if (!current || current.media.kind !== 'video' || !videoRef.current) return setDetectionStatus('Die automatische Suche ist nur für geladene Videoclips verfügbar.');
        setPlaying(false);
        videoRef.current.pause();
        setAnalyzingBall(true);
        setBallCandidates([]);
        setDetectionStatus(trackingPoints?.length ? 'Kleiner Bereich um den letzten Punkt wird lokal analysiert …' : 'Mehrere Frames werden lokal verglichen …');
        try {
            await seekVideoForAnalysis(videoRef.current, current.range.inFrame / current.range.sourceFps + targetFrame / current.sequence.sourceFps);
            setLocalFrame(targetFrame);
            const stage = videoRef.current.closest('.preview-stage') as HTMLElement | null;
            const focus = stage && trackingPoints?.length ? { ...stagePointToVideo(trackingPoints.at(-1)!, videoRef.current, stage), radius: trackingPoints.length > 1 ? .28 : .22 } : undefined;
            const detected = await analyzeVideoBallCandidates(videoRef.current, current.sequence, targetFrame, focus);
            let mapped = stage ? detected.map((candidate) => candidateToStage(candidate, videoRef.current!, stage)) : detected;
            if (trackingPoints?.length) mapped = localBallCandidates(mapped, trackingPoints.at(-1)!, trackingPoints.at(-2));
            setBallCandidates(mapped);
            setDetectionStatus(mapped.length ? `${mapped.length} lokaler Ballkandidat${mapped.length === 1 ? '' : 'en'} gefunden. Anklicken oder Enter für #1.` : 'Kein lokaler Kandidat sicher genug – Ball einfach selbst anklicken.');
        } catch (error) {
            setDetectionStatus(error instanceof Error ? error.message : 'Die lokale Ballerkennung ist fehlgeschlagen.');
        } finally { setAnalyzingBall(false); }
    };
    const autoDetectBall = () => void detectAtFrame(localFrame, manualTracking ? currentTracer?.points : undefined);
    const startManualTracking = () => {
        if (!current || !currentTracer) return;
        setProject(updateShotTracer(project, current.sequence.id, { enabled: true, impactFrame: localFrame, endFrame: localFrame + 1, disappearFrame: current.sequence.outFrame - current.sequence.inFrame, points: [], occlusionStartFrame: null, occlusionEndFrame: null }));
        setManualTracking(true);
        setLandingMode(false);
        setLandingOcclusion(false);
        setMarkingBall(true);
        setBallCandidates([]);
        setPlaying(false);
        mediaElement()?.pause();
        setDetectionStatus('Treffmoment einstellen und den Ball anklicken. Danach springt die App automatisch weiter.');
    };
    const stopManualTracking = () => {
        if (!current || !currentTracer) return;
        if (currentTracer.points.length < 2) {
            setManualTracking(false);
            setLandingMode(false);
            setMarkingBall(false);
            setTrackingCursor(undefined);
            setBallCandidates([]);
            setDetectionStatus('Für eine Flugbahn werden mindestens zwei Punkte benötigt. Du kannst jederzeit neu einmessen.');
            return;
        }
        const points = [...currentTracer.points].sort((left, right) => left.frame - right.frame);
        const endFrame = points.at(-1)!.frame;
        const duration = current.sequence.outFrame - current.sequence.inFrame;
        setProject(updateShotTracer(project, current.sequence.id, { impactFrame: points[0].frame, endFrame, disappearFrame: Math.min(duration, endFrame + Math.round(current.sequence.sourceFps * 1.25)), points }));
        setManualTracking(false);
        setLandingMode(false);
        setMarkingBall(false);
        setTrackingCursor(undefined);
        setBallCandidates([]);
        setDetectionStatus(`${points.length} Ballpunkte gespeichert. Geschwindigkeit folgt jetzt den markierten Frames.`);
    };
    const jumpToLanding = () => {
        if (!current || !currentTracer?.points.length) return;
        const duration = current.sequence.outFrame - current.sequence.inFrame;
        const lastVisibleFrame = currentTracer.points.at(-1)!.frame;
        const suggestedFrame = Math.max(lastVisibleFrame + 1, duration - Math.round(current.sequence.sourceFps));
        setLandingMode(true);
        setBallCandidates([]);
        seekLocalFrame(Math.min(duration - 1, suggestedFrame));
        setDetectionStatus('Landeframe mit dem großen Regler wählen und anschließend den Landepunkt im Video anklicken.');
    };
    const recordTrackedPoint = (x: number, y: number) => {
        if (!current || !currentTracer) return;
        const duration = current.sequence.outFrame - current.sequence.inFrame;
        const previousLastPoint = currentTracer.points.at(-1);
        if (landingMode && previousLastPoint && localFrame <= previousLastPoint.frame) {
            setDetectionStatus('Die Landung muss zeitlich nach dem letzten sichtbaren Ballpunkt liegen.');
            return;
        }
        const basePoints = currentTracer.points.filter((point) => point.frame !== localFrame);
        if (landingMode && previousLastPoint) {
            const gap = localFrame - previousLastPoint.frame;
            const bridgeFrame = Math.round(previousLastPoint.frame + gap * .46);
            const hasBridge = basePoints.some((point) => point.frame > previousLastPoint.frame && Math.abs(point.frame - bridgeFrame) < Math.max(2, gap * .18));
            if (gap >= Math.max(6, current.sequence.sourceFps * .25) && !hasBridge) {
                const horizontalDistance = Math.abs(x - previousLastPoint.x);
                const arcHeight = Math.min(.32, Math.max(.1, horizontalDistance * .32));
                const existingApex = Math.min(y, ...basePoints.map((point) => point.y));
                basePoints.push({ frame: bridgeFrame, x: previousLastPoint.x + (x - previousLastPoint.x) * .48, y: Math.max(.04, existingApex - arcHeight) });
            }
        }
        const points = [...basePoints, { frame: localFrame, x, y }].sort((left, right) => left.frame - right.frame);
        const impactFrame = points[0].frame;
        const endFrame = Math.max(impactFrame + 1, points.at(-1)!.frame);
        const occlusionStartFrame = landingMode && landingOcclusion && previousLastPoint ? previousLastPoint.frame : currentTracer.occlusionStartFrame;
        const occlusionEndFrame = landingMode && landingOcclusion ? localFrame : currentTracer.occlusionEndFrame;
        setProject(updateShotTracer(project, current.sequence.id, { points, impactFrame, endFrame, disappearFrame: Math.min(duration, endFrame + Math.round(current.sequence.sourceFps * 1.25)), occlusionStartFrame, occlusionEndFrame }));
        setBallCandidates([]);
        if (landingMode) {
            setManualTracking(false);
            setLandingMode(false);
            setMarkingBall(false);
            setTrackingCursor(undefined);
            setDetectionStatus(`Landepunkt bei Frame ${localFrame} gespeichert${landingOcclusion ? ' · Hindernis-Verdeckung aktiv' : ''}.`);
            return;
        }
        const nextFrame = Math.min(duration - 1, localFrame + trackingStep);
        if (nextFrame > localFrame) void detectAtFrame(nextFrame, points);
        else setDetectionStatus('Sequenzende erreicht. Tracking kann abgeschlossen werden.');
    };
    const deleteLastTrackedPoint = () => {
        if (!current || !currentTracer?.points.length) return;
        const points = currentTracer.points.slice(0, -1);
        const fallback = Math.max(0, localFrame - trackingStep);
        const target = points.at(-1)?.frame ?? fallback;
        setProject(updateShotTracer(project, current.sequence.id, { points, impactFrame: points[0]?.frame ?? target, endFrame: Math.max((points[0]?.frame ?? target) + 1, points.at(-1)?.frame ?? target + 1) }));
        setBallCandidates([]);
        seekLocalFrame(target);
        setDetectionStatus(points.length ? 'Letzten Punkt gelöscht.' : 'Alle Punkte gelöscht. Treffpunkt erneut anklicken.');
    };
    const startTracerWorkflow = () => {
        if (!current || !currentTracer) return;
        setProject(updateShotTracer(project, current.sequence.id, { points: [], impactFrame: localFrame, endFrame: localFrame + 1, disappearFrame: localFrame + 1, occlusionStartFrame: null, occlusionEndFrame: null }));
        setTracerWorkflowStep('impact-frame');
        setMarkingBall(false);
        setBallCandidates([]);
        setDetectionStatus('Impact-Frame manuell festlegen.');
        setPlaying(false);
        mediaElement()?.pause();
    };
    const confirmImpactFrame = () => {
        if (!current || !currentTracer) return;
        setProject(updateShotTracer(project, current.sequence.id, {
            enabled: true,
            binding: { mediaId: current.media.id, cutId: current.cutId.startsWith('preview-') ? undefined : current.cutId },
            impactFrame: localFrame,
            endFrame: localFrame + 1,
            disappearFrame: localFrame + 1,
            points: [],
        }));
        setTracerWorkflowStep('impact-point');
        setMarkingBall(true);
        setDetectionStatus(`Impact-Frame ${localFrame} gespeichert. Ball im Bild anklicken.`);
    };
    const confirmLandingFrame = () => {
        if (!current || !currentTracer) return;
        const impact = currentTracer.points.find((point) => point.kind === 'impact')?.frame ?? currentTracer.impactFrame ?? 0;
        if (localFrame <= impact) { setDetectionStatus('Der Landeframe muss nach dem Impact liegen.'); return; }
        const duration = current.sequence.outFrame - current.sequence.inFrame;
        const disappearFrame = Math.min(duration, localFrame + Math.round(current.sequence.sourceFps * 1.25));
        setProject(updateShotTracer(project, current.sequence.id, { endFrame: localFrame, disappearFrame }));
        setTracerWorkflowStep('landing-point');
        setMarkingBall(true);
        setDetectionStatus(`Landeframe ${localFrame} gespeichert. Landepunkt im Bild anklicken.`);
    };
    const beginIntermediatePoint = () => {
        if (!currentTracer) return;
        const impact = currentTracer.points.find((point) => point.kind === 'impact')?.frame ?? 0;
        const landing = currentTracer.points.find((point) => point.kind === 'landing')?.frame ?? currentTracer.endFrame ?? impact + 1;
        seekLocalFrame(Math.round((impact + landing) / 2));
        setTracerWorkflowStep('intermediate-frame');
        setMarkingBall(false);
        setDetectionStatus('Frame für den zusätzlichen Zwischenpunkt wählen.');
    };
    const confirmIntermediateFrame = () => {
        if (!currentTracer) return;
        const impact = currentTracer.points.find((point) => point.kind === 'impact')?.frame ?? 0;
        const landing = currentTracer.points.find((point) => point.kind === 'landing')?.frame ?? currentTracer.endFrame ?? impact + 1;
        if (localFrame <= impact || localFrame >= landing) { setDetectionStatus('Zwischenpunkte müssen zeitlich zwischen Impact und Landung liegen.'); return; }
        setTracerWorkflowStep('intermediate-point');
        setMarkingBall(true);
        setDetectionStatus(`Zwischenframe ${localFrame} gespeichert. Punkt im Bild anklicken.`);
    };
    const handleTracerWorkflowPoint = (x: number, y: number) => {
        if (!current || !currentTracer || !tracerWorkflowStep) return;
        if (tracerWorkflowStep === 'impact-point') {
            const impactPoint: ShotTracerPoint = { frame: localFrame, x, y, kind: 'impact' };
            setProject(updateShotTracer(project, current.sequence.id, { points: [impactPoint], impactFrame: localFrame, endFrame: localFrame + 1, disappearFrame: localFrame + 1 }));
            setTracerWorkflowStep('landing-frame');
            setMarkingBall(false);
            setDetectionStatus('Impact markiert. Jetzt den Landeframe manuell auswählen.');
            return;
        }
        if (tracerWorkflowStep === 'landing-point') {
            const impactPoint = currentTracer.points.find((point) => point.kind === 'impact') ?? currentTracer.points[0];
            if (!impactPoint || localFrame <= impactPoint.frame) return setDetectionStatus('Ungültiger Landeframe.');
            const points = createTracerFlight(impactPoint, localFrame, x, y);
            const duration = current.sequence.outFrame - current.sequence.inFrame;
            const disappearFrame = Math.min(duration, localFrame + Math.round(current.sequence.sourceFps * 1.25));
            setProject(updateShotTracer(project, current.sequence.id, { points, impactFrame: impactPoint.frame, endFrame: localFrame, disappearFrame, occlusionStartFrame: null, occlusionEndFrame: null }));
            setTracerWorkflowStep('edit');
            setMarkingBall(false);
            setTrackingCursor(undefined);
            setDetectionStatus('Impact und Landung stehen. Den H-Handle ziehen oder Zwischenpunkte ergänzen.');
            return;
        }
        if (tracerWorkflowStep === 'intermediate-point') {
            const points = insertTracerIntermediate(currentTracer.points, { frame: localFrame, x, y });
            setProject(updateShotTracer(project, current.sequence.id, { points }));
            setTracerWorkflowStep('edit');
            setMarkingBall(false);
            setTrackingCursor(undefined);
            setDetectionStatus('Zwischenpunkt hinzugefügt. Alle Punkte und der H-Handle sind verschiebbar.');
        }
    };
    const finishTracerWorkflow = () => {
        setTracerWorkflowStep(undefined);
        setMarkingBall(false);
        setTrackingCursor(undefined);
        setBallCandidates([]);
        setDetectionStatus('Tracer gespeichert. Die Flugbahn folgt den echten Timing-Punkten und blendet nach der Landung weich aus.');
    };
    const startCameraLock = () => {
        if (!current || !currentTracer) return;
        const impact = currentTracer.points.find((point) => point.kind === 'impact');
        const landing = currentTracer.points.find((point) => point.kind === 'landing');
        if (!impact || !landing) { setDetectionStatus('Impact und Landung müssen vor dem Kamera-Lock festgelegt sein.'); return; }
        const screenPoints = currentTracer.cameraLock
            ? currentTracer.points.map((point) => ({ ...point, ...worldToScreen(currentTracer.cameraLock, point.frame, point) }))
            : currentTracer.points;
        setProject(updateShotTracer(project, current.sequence.id, { points: screenPoints, cameraLock: null }));
        setCameraLockBasePoints(screenPoints);
        setCameraLockDraft({ referencePoints: [], targetPoints: [] });
        setCameraLockStep('impact-a');
        setMarkingBall(true);
        seekLocalFrame(impact.frame);
        setDetectionStatus('Referenzpunkt A im festen Hintergrund anklicken.');
    };
    const clearCameraLock = () => {
        if (!current || !currentTracer) return;
        const screenPoints = currentTracer.cameraLock
            ? currentTracer.points.map((point) => ({ ...point, ...worldToScreen(currentTracer.cameraLock, point.frame, point) }))
            : currentTracer.points;
        setProject(updateShotTracer(project, current.sequence.id, { points: screenPoints, cameraLock: null }));
        setCameraLockStep(undefined);
        setCameraLockDraft({ referencePoints: [], targetPoints: [] });
        setCameraLockBasePoints([]);
        setMarkingBall(false);
        setTrackingCursor(undefined);
        setDetectionStatus('Kamera-Lock entfernt.');
    };
    const handleCameraLockPoint = (x: number, y: number) => {
        if (!current || !currentTracer || !cameraLockStep) return;
        const point = { x, y };
        const impactFrame = currentTracer.points.find((item) => item.kind === 'impact')?.frame ?? currentTracer.impactFrame ?? 0;
        const landingFrame = currentTracer.points.find((item) => item.kind === 'landing')?.frame ?? currentTracer.endFrame ?? impactFrame + 1;
        if (cameraLockStep === 'impact-a') {
            setCameraLockDraft({ referencePoints: [point], targetPoints: [] });
            setCameraLockStep('impact-b');
            setDetectionStatus('Referenzpunkt B anklicken – möglichst weit von A entfernt.');
            return;
        }
        if (cameraLockStep === 'impact-b') {
            if (Math.hypot(point.x - cameraLockDraft.referencePoints[0].x, point.y - cameraLockDraft.referencePoints[0].y) < .04) { setDetectionStatus('Punkt B liegt zu nah an A. Bitte weiter entfernt markieren.'); return; }
            setCameraLockDraft({ referencePoints: [...cameraLockDraft.referencePoints, point], targetPoints: [] });
            setCameraLockStep('landing-a');
            seekLocalFrame(landingFrame);
            setDetectionStatus('Landeframe: denselben Hintergrundpunkt A erneut anklicken.');
            return;
        }
        if (cameraLockStep === 'landing-a') {
            setCameraLockDraft({ ...cameraLockDraft, targetPoints: [point] });
            setCameraLockStep('landing-b');
            setDetectionStatus('Jetzt denselben Hintergrundpunkt B erneut anklicken.');
            return;
        }
        const targetA = cameraLockDraft.targetPoints[0];
        if (!targetA || Math.hypot(point.x - targetA.x, point.y - targetA.y) < .04) { setDetectionStatus('Zielpunkt B liegt zu nah an A. Bitte erneut markieren.'); return; }
        const lock: ShotTracerCameraLock = {
            referenceFrame: impactFrame,
            targetFrame: landingFrame,
            referencePoints: cameraLockDraft.referencePoints as [CameraLockPoint, CameraLockPoint],
            targetPoints: [targetA, point],
        };
        const sourcePoints = cameraLockBasePoints.length ? cameraLockBasePoints : currentTracer.points;
        setProject(updateShotTracer(project, current.sequence.id, { points: lockTracerPointsToWorld(sourcePoints, lock), cameraLock: lock }));
        setCameraLockStep(undefined);
        setCameraLockDraft({ referencePoints: [], targetPoints: [] });
        setCameraLockBasePoints([]);
        setMarkingBall(false);
        setTrackingCursor(undefined);
        setDetectionStatus('Kamera-Lock aktiv: Tracer folgt jetzt Schwenk, Zoom und Rotation der Szene.');
    };
    useEffect(() => {
        if (!tracerEditing) return;
        const keydown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.matches('input, select, textarea')) return;
            const backwards = event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a';
            const forwards = event.key === 'ArrowRight' || event.key.toLowerCase() === 'd';
            if (backwards || forwards) {
                event.preventDefault(); event.stopPropagation(); seekLocalFrame(localFrame + (backwards ? -1 : 1) * (event.shiftKey ? 5 : 1));
            } else if (manualTracking && (event.key === 'Delete' || event.key === 'Backspace')) {
                event.preventDefault(); deleteLastTrackedPoint();
            } else if (manualTracking && event.key === 'Enter' && ballCandidates[0]) {
                event.preventDefault(); recordTrackedPoint(ballCandidates[0].x, ballCandidates[0].y);
            } else if (manualTracking && event.key === 'Escape') {
                event.preventDefault(); stopManualTracking();
            }
        };
        window.addEventListener('keydown', keydown, true);
        return () => window.removeEventListener('keydown', keydown, true);
    }, [tracerEditing, manualTracking, landingMode, landingOcclusion, localFrame, ballCandidates, currentTracer, project]);
    const switchCamera = (mediaId: string) => {
        if (!current || current.sequence.sourceType !== 'group') return;
        pendingOffset.current = localFrame / current.sequence.sourceFps;
        mediaElement()?.pause();
        setPreviewMediaId(mediaId);
    };
    const commitPreviewForMoment = () => {
        if (!current || !previewMediaId) return;
        pendingOffset.current = localFrame / current.sequence.sourceFps;
        setProject(setSequenceCameraForMoment(project, current.sequence.id, previewMediaId));
        setPreviewMediaId(undefined);
    };
    const commitPreviewFromHere = () => {
        if (!current || !previewMediaId) return;
        pendingOffset.current = localFrame / current.sequence.sourceFps;
        setProject(setSequenceCameraFrom(project, current.sequence.id, previewMediaId, Math.round(localFrame / current.sequence.sourceFps * 1_000_000)));
        setPreviewMediaId(undefined);
    };
    if (!current && currentItem) {
        const diagnostic = previewRenderPlan.diagnostics.find((item) => item.sequenceId === currentItem.sequence.id && item.severity === 'error');
        return <div className="preview-backdrop"><section className="rough-preview unavailable-preview"><header className="preview-header"><div><div className="eyebrow"><span /> ROHSCHNITT-VORSCHAU</div><h2>{onlyHole ? `Loch ${onlyHole}` : 'Komplette Runde'}</h2></div><div className="preview-now"><span>QUELLE FEHLT</span><b>Loch {currentItem.block.hole} · {currentItem.player?.name} · {currentItem.block.label}</b></div><button className="preview-close" onClick={onClose}><X size={18} /></button></header><div className="unavailable-preview-body"><FileVideo size={48} /><span>MOMENT {index + 1} VON {items.length}</span><h2>Dieser Bereich kann gerade nicht abgespielt werden.</h2><p>{diagnostic?.message ?? 'Die Videodatei oder der gewählte Kamera-Cut ist nicht verfügbar.'}</p><small>Die Filmvorschau überspringt den Bereich automatisch. Der Export bleibt blockiert, bis die Quelle repariert oder der Moment bewusst entfernt wurde.</small><div><button className="secondary" onClick={() => onEdit(currentItem.sequence.id)}><Scissors size={15} /> Moment reparieren</button><button className="primary" disabled={index === items.length - 1} onClick={advance}><SkipForward size={15} /> Jetzt überspringen</button></div></div></section></div>;
    }
    if (!current) return <div className="preview-backdrop"><section className="rough-preview empty"><button className="preview-close" onClick={onClose}><X size={18} /></button><MonitorPlay size={44} /><h2>Noch kein Rohschnitt vorhanden</h2><p>Weise zuerst mindestens eine Sequenz einem Golfblock zu.</p></section></div>;
    const holeData = project.courseData.holes.find((hole) => hole.number === current.block.hole);
    const scoreText = current.player ? scoreBeforeHole(project, current.player.id, current.block.hole) : 'E';
    const shotMeta = [current.block.details.club, current.block.details.distanceMeters ? `${current.block.details.distanceMeters} m` : '', current.block.details.result].filter(Boolean).join(' · ');
    const holeTitleItem = holeTitleIndex === undefined ? undefined : items[holeTitleIndex];
    const titleHoleData = holeTitleItem ? project.courseData.holes.find((hole) => hole.number === holeTitleItem.block.hole) : undefined;
    const cameraMarkers = (cameraLockStep === 'impact-a' || cameraLockStep === 'impact-b' ? cameraLockDraft.referencePoints : cameraLockStep ? cameraLockDraft.targetPoints : []).map((point, markerIndex) => ({ ...point, label: markerIndex === 0 ? 'A' : 'B' }));
    return <div className="preview-backdrop"><section className="rough-preview">
        <header className="preview-header"><div><div className="eyebrow"><span /> ROHSCHNITT-VORSCHAU</div><h2>{onlyHole ? `Loch ${onlyHole}` : 'Komplette Runde'}</h2></div><div className="preview-now"><span>JETZT</span><b>Loch {current.block.hole} · {current.player?.name} · {current.block.label}</b></div><button className="preview-close" onClick={onClose}><X size={18} /></button></header>
        <div className="preview-body"><div className="preview-player"><div className="preview-stage">
            {current.media.kind === 'video' ? <video muted key={`${current.sequence.id}:${current.cutId}`} ref={videoRef} src={fileUrl(current.media.path)} onLoadedMetadata={startCurrent} onError={() => setPlaybackError('Die Videodatei konnte nicht gelesen werden. Dieser Kamera-Cut wird übersprungen.')} onTimeUpdate={(event) => {
                const relativeSeconds = current.momentStartSeconds + Math.max(0, event.currentTarget.currentTime - current.range.inFrame / current.range.sourceFps);
                const relative = Math.round(relativeSeconds * current.sequence.sourceFps);
                setLocalFrame(relative);
                syncCurrentAudio(relativeSeconds);
                if (event.currentTarget.currentTime >= current.range.outFrame / current.range.sourceFps) advanceCutOrSequence();
            }} onEnded={advanceCutOrSequence} /> : <div className="preview-audio"><FileAudio size={64} /><b>{current.media.name}</b><audio key={`${current.sequence.id}:${current.cutId}`} ref={audioRef} src={fileUrl(current.media.path)} onLoadedMetadata={startCurrent} onTimeUpdate={(event) => {
                const relativeSeconds = current.momentStartSeconds + Math.max(0, event.currentTarget.currentTime - current.range.inFrame / current.range.sourceFps);
                setLocalFrame(Math.round(relativeSeconds * current.sequence.sourceFps));
                if (event.currentTarget.currentTime >= current.range.outFrame / current.range.sourceFps) advanceCutOrSequence();
            }} onEnded={advanceCutOrSequence} /></div>}
            {playbackError && <div className="preview-source-warning"><FileVideo size={31} /><div><b>Quelle nicht verfügbar</b><span>{playbackError}</span><small>Automatisch weiter in einem Moment …</small></div><button onClick={advanceCutOrSequence}><SkipForward size={14} /> Überspringen</button></div>}
            {currentAudio && <audio className="canonical-preview-audio" key={`${current.sequence.id}:${currentAudio.audioCutId}`} ref={audioRef} src={fileUrl(currentAudio.media.path)} onLoadedMetadata={startCurrentAudio} />}
            <ShotTracerLayer tracer={tracerWorkflowStep || cameraLockStep ? currentTracer : activeTracer} frame={localFrame} editing={tracerEditing} marking={markingBall} tracking={Boolean(tracerWorkflowStep || cameraLockStep)} candidates={[]} cameraMarkers={cameraMarkers} videoRef={videoRef} sequence={current.sequence} mediaRange={current.range} onMark={(x, y) => cameraLockStep ? handleCameraLockPoint(x, y) : handleTracerWorkflowPoint(x, y)} onCandidate={() => undefined} onCursor={setTrackingCursor} onPoint={(pointIndex, x, y) => {
                if (!current || !activeTracer) return;
                const worldPoint = screenToWorld(activeTracer.cameraLock, localFrame, { x, y });
                setProject(updateShotTracer(project, current.sequence.id, { points: activeTracer.points.map((point, index) => index === pointIndex ? { ...point, ...worldPoint } : point) }));
            }} />
            {(tracerWorkflowStep === 'impact-point' || tracerWorkflowStep === 'landing-point' || tracerWorkflowStep === 'intermediate-point' || cameraLockStep) && <TrackingMagnifier video={videoRef.current} cursor={trackingCursor} frame={localFrame} />}
            <div className="golf-overlay-layer fixed-editorial-overlays"><div className="fixed-scorebug"><i /><div><b>{current.player?.name.toUpperCase()}</b><span>H{current.block.hole} · PAR {holeData?.par ?? '–'}{holeData?.lengthMeters ? ` · ${holeData.lengthMeters} M` : ''}</span></div><strong>{scoreText}</strong></div>{shotMeta && localFrame / current.sequence.sourceFps <= EDITORIAL_STYLE.shotInfoSeconds && <div className="fixed-shot-info"><span>SCHLAG {strokeNumberForBlock(project, current.block.id) ?? '–'} / PAR {holeData?.par ?? '–'}</span><b>{current.block.details.club || current.block.label}</b>{current.block.details.distanceMeters && <em>{current.block.details.distanceMeters} M</em>}</div>}</div>
            <div ref={editorialFadeRef} className={`editorial-transition ${holeTitleItem ? 'show-card' : ''}`}><div className="hole-title-card"><span>{project.settings.course.toUpperCase()}</span><b>HOLE {holeTitleItem?.block.hole}</b><em>PAR {titleHoleData?.par ?? '–'}{titleHoleData?.lengthMeters ? ` · ${titleHoleData.lengthMeters} M` : ''}</em></div></div>
        </div>{(current.sequence.multicamAngles?.length ?? 0) > 1 && <CameraPlanTimeline project={project} sequence={current.sequence} activeCutId={current.cutId} setProject={setProject} onSeek={seekLocalFrame} />}<div className="preview-transport"><button onClick={() => goTo(index - 1)} disabled={index === 0}><SkipBack size={18} /></button><button className="preview-play" onClick={togglePlay}>{playing ? <Pause size={19} /> : <Play size={19} />}</button><button onClick={() => goTo(index + 1)} disabled={index === items.length - 1}><SkipForward size={18} /></button><strong>{formatDuration(position)} / {formatDuration(totalDuration)}</strong><span>Sequenz {index + 1} von {items.length}</span></div>
        <input className="rough-progress" type="range" min={0} max={Math.max(1, Math.round(totalDuration * 1000))} value={Math.round(position * 1000)} onChange={(event) => seekGlobal(Number(event.target.value) / 1000)} /></div>
        <aside className="preview-inspector"><div className="inspector-section"><span className="field-label">Aktuelle Sequenz</span><h3>{current.media.name}</h3><p>{frameTime(current.range.inFrame, current.range.sourceFps)} – {frameTime(current.range.outFrame, current.range.sourceFps)}</p><button className="secondary edit-current" onClick={() => onEdit(current.sequence.id)}><Scissors size={14} /> Im Sichtungseditor öffnen</button></div>
            <div className={`inspector-section moment-review ${currentReviewed ? 'reviewed' : currentMomentPlan?.valid ? 'pending' : 'blocked'}`}><span className="field-label">Film-Review</span><div><ShieldCheck size={17} /><span><b>{currentReviewed ? 'Filmstand geprüft' : currentMomentPlan?.valid ? 'Noch nicht geprüft' : 'Vor dem Export beheben'}</b><small>{currentReviewed ? 'Bild, Ton und Effekte entsprechen diesem Stand.' : currentMomentPlan?.valid ? 'Nach der Prüfung bewusst bestätigen.' : `${currentMomentPlan?.diagnostics.filter((item) => item.severity === 'error').length ?? 0} blockierende Punkte`}</small></span></div>{!currentReviewed && currentMomentPlan?.valid && <button className="primary" onClick={() => setProject(markSequenceReviewed(project, current.sequence.id, currentMomentPlan.renderFingerprint))}><Check size={14} /> Diesen Moment als geprüft markieren</button>}</div>
            {(current.sequence.multicamAngles?.length ?? 0) > 1 && <div className={`inspector-section preview-angle-deck ${previewMediaId ? 'previewing' : ''}`}><span className="field-label">Camera Plan</span><p>{previewMediaId ? 'Nur Vorschau – der gespeicherte Film ist noch unverändert.' : 'Kamera ansehen und anschließend bewusst in den finalen Film übernehmen.'}</p><div className="camera-choice-grid">{current.sequence.multicamAngles!.map((angle, angleIndex) => {
                const media = project.media.find((item) => item.id === angle.mediaId);
                if (!media) return null;
                return <button className={media.id === current.media.id ? 'active' : ''} onClick={() => switchCamera(media.id)} key={media.id}><span>{angleIndex + 1}</span><div><b>{media.device || `Kamera ${angleIndex + 1}`}</b><small>{media.name}</small></div>{media.id === current.media.id && <Check size={14} />}</button>;
            })}</div>{previewMediaId && <div className="camera-plan-commit"><button onClick={commitPreviewFromHere}><Scissors size={14} /> Ab hier übernehmen</button><button onClick={commitPreviewForMoment}><Check size={14} /> Ganzen Moment</button><button className="discard" onClick={() => setPreviewMediaId(undefined)}><X size={14} /> Verwerfen</button></div>}</div>}
            <div className="inspector-section fixed-style-summary"><span className="field-label">Fester Editorial-Look</span><div><ShieldCheck size={17} /><span><b>Automatisch aktiv</b><small>Scorebug · Schlaginfo · Lochtrenner · Audio-Microfade</small></span></div><p>Innerhalb eines Lochs bleiben die Schnitte direkt. Beim Lochwechsel folgen Dip-to-Black und Lochkarte.</p></div>
            <ShotTracerControls project={project} sequence={current.sequence} tracer={currentTracer} frame={localFrame} editing={tracerEditing} workflowStep={tracerWorkflowStep} cameraLockStep={cameraLockStep} detectionStatus={detectionStatus} setProject={setProject} onEdit={(value) => { setTracerEditing(value); if (!value) { setTracerWorkflowStep(undefined); setCameraLockStep(undefined); setTrackingCursor(undefined); } setMarkingBall(false); setBallCandidates([]); if (value) { setPlaying(false); mediaElement()?.pause(); } }} onStart={startTracerWorkflow} onConfirmImpactFrame={confirmImpactFrame} onConfirmLandingFrame={confirmLandingFrame} onBeginIntermediate={beginIntermediatePoint} onConfirmIntermediateFrame={confirmIntermediateFrame} onFinish={finishTracerWorkflow} onStartCameraLock={startCameraLock} onClearCameraLock={clearCameraLock} onSeekFrame={seekLocalFrame} />
        </aside></div>
    </section></div>;
}

const PRODUCTION_STATUS_COPY: Record<ProductionStatus, string> = {
    empty: 'Noch ohne Film',
    blocked: 'Fehler beheben',
    'needs-review': 'Review offen',
    ready: 'Geprüft',
};

function RoundDesk({ project, setProject, onNavigate, onOpenSequence, onStartHole }: { project: GolfProject; setProject: (project: GolfProject) => void; onNavigate: (screen: StudioScreen) => void; onOpenSequence: (sequenceId: string) => void; onStartHole: (hole: number) => void }) {
    const [selectedHole, setSelectedHole] = useState<number>();
    const [previewOpen, setPreviewOpen] = useState(false);
    const backRef = useRef<HTMLButtonElement>(null);
    const holeRefs = useRef(new Map<number, HTMLButtonElement>());
    const summary = useMemo(() => summarizeRoundDesk(project), [project]);
    const selected = selectedHole ? summary.holes.find((hole) => hole.hole === selectedHole) : undefined;
    const blocks = selectedHole
        ? project.blocks.filter((block) => block.hole === selectedHole).sort((left, right) => left.order - right.order)
        : [];
    const openFirstMoment = () => {
        if (!selectedHole) return;
        const sequenceId = selected?.nextSequenceId ?? firstSequenceForHole(project, selectedHole);
        if (sequenceId) onOpenSequence(sequenceId);
        else if (project.media.length) onStartHole(selectedHole);
        else onNavigate('import');
    };
    useEffect(() => {
        if (selectedHole) window.requestAnimationFrame(() => backRef.current?.focus());
    }, [selectedHole]);
    const backToRound = () => {
        const previousHole = selectedHole;
        setSelectedHole(undefined);
        window.requestAnimationFrame(() => previousHole && holeRefs.current.get(previousHole)?.focus());
    };
    if (selected) {
        const holeData = project.courseData.holes.find((hole) => hole.number === selected.hole);
        return <section className="workspace round-desk hole-story-view">
            <header className="hole-story-header">
                <button ref={backRef} className="round-back" onClick={backToRound}><ChevronLeft size={16} /> Zurück zur Runde</button>
                <div className="hole-story-kicker"><span>HOLE STORY</span><i />{PRODUCTION_STATUS_COPY[selected.productionStatus]} <strong>GEPRÜFT {summary.productionProgress}%</strong></div>
                <div className="hole-story-title"><div><span>{String(selected.hole).padStart(2, '0')}</span><small>PAR {selected.par}</small></div><div><h1>Die Geschichte<br />dieses Lochs.</h1><p>{holeData?.lengthMeters ? `${holeData.lengthMeters} Meter · ` : ''}{selected.sequenceCount} Momente · {formatDuration(selected.durationSeconds)} im Rohschnitt</p></div></div>
                <button className="primary hole-story-action" onClick={openFirstMoment}>{selected.sequenceCount ? <><Play size={16} /> Ersten Moment öffnen</> : project.media.length ? <><Scissors size={16} /> Momente aus Material bauen</> : <><Import size={16} /> Material importieren</>}</button>
            </header>
            <div className="story-strip-heading"><div><span>STORY MOMENTS</span><h2>Vom Abschlag bis zum letzten Putt</h2></div><p>Keine starre Timeline: Jeder Moment gehört zu seiner Rolle in der Golfgeschichte.</p></div>
            <div className="story-moment-strip">
                {blocks.map((block, index) => {
                    const sequences = block.sequenceIds.map((id) => project.sequences.find((sequence) => sequence.id === id)).filter(Boolean) as VirtualSequence[];
                    const productionStatus = sequences.some((sequence) => sequenceProductionStatus(project, sequence) === 'blocked') ? 'blocked' : sequences.length && sequences.every((sequence) => sequenceProductionStatus(project, sequence) === 'ready') ? 'ready' : sequences.length ? 'needs-review' : 'empty';
                    const shotNumber = strokeNumberForBlock(project, block.id);
                    return <article className={`story-moment ${sequences.length ? 'filled' : ''} ${productionStatus}`} key={block.id}>
                        <span className="story-moment-index">{String(index + 1).padStart(2, '0')}</span>
                        <div className="story-moment-line"><i /></div>
                        <div><small>{project.settings.players.find((player) => player.id === block.playerId)?.name ?? 'Spieler'}{shotNumber ? ` · SCHLAG ${shotNumber} / PAR ${selected.par}` : ''}</small><h3>{block.label}</h3><p>{sequences.length ? `${sequences.length} ${sequences.length === 1 ? 'Aufnahme' : 'Aufnahmen'} · ${PRODUCTION_STATUS_COPY[productionStatus]}` : block.label === 'Nicht gefilmter Schlag' || block.type === 'penalty' ? 'Zählt ohne Videomaterial' : 'Noch ohne Aufnahme'}</p></div>
                        {sequences.length ? <button onClick={() => onOpenSequence(sequences.find((sequence) => sequenceProductionStatus(project, sequence) !== 'ready')?.id ?? sequences[0].id)} aria-label={`${blockLabel(block.type)} im Editor öffnen`}><ChevronRight size={16} /></button> : <span className="story-planned">GEPLANT</span>}
                    </article>;
                })}
            </div>
            <aside className="story-truth-note"><Sparkles size={16} /><div><b>Editorial Pass</b><p>Overlays, Shot-Tracer und Feinschnitt bleiben bewusst im vorhandenen Moment-Editor. Ein automatischer Story-Pass ist noch nicht verfügbar.</p></div></aside>
        </section>;
    }
    return <section className="workspace round-desk">
        <header className="round-desk-hero">
            <div><div className="eyebrow"><span /> THE ROUND DESK</div><h1>Deine Runde.<br /><em>Als Film gedacht.</em></h1><p>Was geprüft werden muss und was den Export technisch blockiert – ohne zwischen Werkzeugen zu suchen.</p></div>
            <div className="round-reel" role="progressbar" aria-label="Geprüfter Anteil der vorhandenen Filmmomente" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.productionProgress}><div><strong>{summary.productionProgress}<small>%</small></strong><span>GEPRÜFT</span></div><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" /><circle className="progress" cx="60" cy="60" r="52" pathLength="100" strokeDasharray={`${summary.productionProgress} 100`} /></svg></div>
        </header>
        {summary.nextSequenceId && <div className={`round-next-action ${summary.blockingIssueCount ? 'blocking' : 'review'}`}><div><span>ALS NÄCHSTES · LOCH {summary.nextHole}</span><b>{summary.nextLabel}</b></div><button className="primary" onClick={() => onOpenSequence(summary.nextSequenceId!)}>{summary.blockingIssueCount ? <><WandSparkles size={15} /> Jetzt beheben</> : <><Play size={15} /> Jetzt prüfen</>}</button></div>}
        <div className="round-desk-summary"><span><b>{summary.readyHoles}</b> Löcher geprüft</span><span className={summary.blockingIssueCount ? 'attention' : ''}><b>{summary.blockingIssueCount}</b> Blockierende Punkte</span><span><b>{summary.unreviewedSequenceCount}</b> Reviews offen</span><span><b>{formatDuration(summary.durationSeconds)}</b> Rohschnitt</span><button className="secondary" disabled={!summary.sequenceCount} onClick={() => setPreviewOpen(true)}><MonitorPlay size={15} /> Runde prüfen</button></div>
        <div className="round-map-heading"><div><span>ROUND MAP · {project.settings.holes} HOLES</span><h2>{project.settings.course}</h2></div><div className="round-map-legend"><span><i className="ready" /> Geprüft</span><span><i className="started" /> Review offen</span><span><i className="blocked" /> Blockiert</span></div></div>
        <div className={`round-map holes-${project.settings.holes}`}>
            {summary.holes.map((hole, index) => <button ref={(element) => { if (element) holeRefs.current.set(hole.hole, element); else holeRefs.current.delete(hole.hole); }} className={`round-hole ${hole.status} production-${hole.productionStatus} route-${index % 5}`} onClick={() => setSelectedHole(hole.hole)} key={hole.hole} aria-label={`Loch ${hole.hole}, Par ${hole.par}, ${PRODUCTION_STATUS_COPY[hole.productionStatus]}`}>
                <span className="round-hole-route"><i /><i /></span><span className="round-hole-number">{String(hole.hole).padStart(2, '0')}</span><span className="round-hole-meta"><b>PAR {hole.par}</b><small>{hole.lengthMeters ? `${hole.lengthMeters} M · ` : ''}{PRODUCTION_STATUS_COPY[hole.productionStatus]}</small></span>{hole.sequenceCount > 0 && <strong>{hole.sequenceCount}</strong>}
            </button>)}
        </div>
        <footer className="round-desk-foot"><Flag size={15} /><span>{summary.activeHoles ? `${summary.activeHoles} Löcher erzählen bereits eine Geschichte.` : 'Die Runde ist angelegt. Importiere Material, um die erste Hole Story zu beginnen.'}</span></footer>
        {previewOpen && <RoughCutPreview project={project} setProject={setProject} onClose={() => setPreviewOpen(false)} onEdit={(sequenceId) => { setPreviewOpen(false); onOpenSequence(sequenceId); }} />}
    </section>;
}

function RoundBuilder({ project, setProject, onOpenSequence }: { project: GolfProject; setProject: (project: GolfProject) => void; onOpenSequence: (sequenceId: string) => void }) {
    const [hole, setHole] = useState(1);
    const [builderView, setBuilderView] = useState<'players' | 'order'>('players');
    const [draggedBlockId, setDraggedBlockId] = useState<string>();
    const [dragOverBlockId, setDragOverBlockId] = useState<string>();
    const [newTypes, setNewTypes] = useState<Record<string, BlockType>>({});
    const [previewScope, setPreviewScope] = useState<'round' | number>();
    const [scorecardOpen, setScorecardOpen] = useState(false);
    const [editingBlockId, setEditingBlockId] = useState<string>();
    const holeBlocks = project.blocks.filter((block) => block.hole === hole);
    const holePar = project.courseData.holes.find((item) => item.number === hole)?.par ?? 4;
    const blocksByPlayer = new Map(project.settings.players.map((player) => [player.id, holeBlocks
        .filter((block) => block.playerId === player.id)
        .sort((left, right) => left.order - right.order)]));
    const blockRounds = Math.max(0, ...[...blocksByPlayer.values()].map((blocks) => blocks.length));
    const orderedBlocks = effectiveHoleBlockOrder(project, hole)
        .map((blockId) => holeBlocks.find((block) => block.id === blockId))
        .filter(Boolean) as GolfBlock[];
    const holeSequenceIds = new Set(holeBlocks.flatMap((block) => block.sequenceIds));
    const holeSequences = project.sequences.filter((sequence) => holeSequenceIds.has(sequence.id));
    const holeDuration = holeSequences.reduce((sum, sequence) => sum + (sequence.outFrame - sequence.inFrame) / sequence.sourceFps, 0);
    const totalDuration = project.sequences.reduce((sum, sequence) => sum + (sequence.outFrame - sequence.inFrame) / sequence.sourceFps, 0);
    const sourceName = (sequence: VirtualSequence) => sequence.sourceType === 'media'
        ? project.media.find((media) => media.id === sequence.sourceId)?.name ?? 'Fehlender Clip'
        : `${project.media.find((media) => media.id === sequence.activeMediaId)?.name ?? project.groups.find((group) => group.id === sequence.sourceId)?.name ?? 'Fehlende Multicam-Gruppe'}${sequence.multicamAngles?.length ? ` · ${sequence.multicamAngles.length} Kameras` : ''}`;
    const removeBlock = (blockId: string, sequenceCount: number) => {
        if (sequenceCount && !window.confirm(`Dieser Block enthält ${sequenceCount} Sequenz${sequenceCount === 1 ? '' : 'en'}. Block und Sequenzen wirklich löschen?`)) return;
        setProject(deleteBlock(project, blockId));
    };
    return <section className="builder-workspace">
        <div className="builder-heading"><div><div className="eyebrow"><span /> RUNDE BAUEN</div><h1>{project.settings.course}</h1><p>Golfblöcke statt klassischer Timeline · der Rohschnitt folgt automatisch dieser Reihenfolge.</p></div><div className="builder-heading-right"><div className="round-summary"><span><b>{project.sequences.length}</b> Sequenzen</span><span><b>{formatDuration(totalDuration)}</b> Rohschnitt</span><span><b>{project.settings.holes}</b> Löcher</span></div><button className="secondary scorecard-button" onClick={() => setScorecardOpen(true)}><ClipboardList size={16} /> Scorecard</button><button className="primary preview-round-button" disabled={!project.sequences.length} onClick={() => setPreviewScope('round')}><MonitorPlay size={16} /> Runde abspielen</button></div></div>
        <nav className="hole-tabs">{Array.from({ length: project.settings.holes }, (_, index) => {
            const number = index + 1;
            const count = project.blocks.filter((block) => block.hole === number).reduce((sum, block) => sum + block.sequenceIds.length, 0);
            return <button className={hole === number ? 'active' : count ? 'filled' : ''} onClick={() => setHole(number)} key={number}><span>{number}</span><small>{count ? `${count} Seq.` : 'leer'}</small></button>;
        })}</nav>
        <div className="hole-heading"><div><span>LOCH</span><b>{hole}</b></div><p>{holeSequences.length} Sequenzen · {formatDuration(holeDuration)} geschätzte Laufzeit</p><div className="hole-progress"><i style={{ width: `${Math.min(100, holeSequences.length / Math.max(1, project.settings.players.length * 4) * 100)}%` }} /></div><button className="secondary preview-hole-button" disabled={!holeSequences.length} onClick={() => setPreviewScope(hole)}><Play size={14} /> Loch abspielen</button></div>
        <div className="builder-view-switch" role="group" aria-label="Ansicht für Runde bauen"><button className={builderView === 'players' ? 'active' : ''} onClick={() => setBuilderView('players')}><LayoutGrid size={14} /> Nach Spielern</button><button className={builderView === 'order' ? 'active' : ''} onClick={() => setBuilderView('order')}><ListOrdered size={14} /> Wahre Reihenfolge</button><span>{builderView === 'order' ? 'Diese Reihenfolge steuert Vorschau und Export.' : 'Schläge und Material je Spieler bearbeiten.'}</span></div>
        {builderView === 'order' && <section className="true-order-board"><header><div><ListOrdered size={18} /><span><b>Wahre Schlagreihenfolge · Loch {hole}</b><small>Karten ziehen, bis sie dem tatsächlichen Spielverlauf entsprechen.</small></span></div>{hasHoleBlockOrderOverride(project, hole) && <button className="reset-player-order" onClick={() => setProject(clearHoleBlockOrderOverride(project, hole))}><RotateCcw size={12} /> Automatik wiederherstellen</button>}</header><div className="true-order-flow">{orderedBlocks.map((block, index) => {
            const player = project.settings.players.find((item) => item.id === block.playerId);
            const sequences = block.sequenceIds.map((id) => project.sequences.find((sequence) => sequence.id === id)).filter(Boolean) as VirtualSequence[];
            const duration = sequences.reduce((sum, sequence) => sum + (sequence.outFrame - sequence.inFrame) / sequence.sourceFps, 0);
            const shotNumber = strokeNumberForBlock(project, block.id);
            const countsWithoutVideo = !sequences.length && (block.label === 'Nicht gefilmter Schlag' || block.type === 'penalty');
            return <article draggable className={`true-order-card ${draggedBlockId === block.id ? 'dragging' : ''} ${dragOverBlockId === block.id ? 'drag-over' : ''} ${sequences.length ? 'filled' : countsWithoutVideo ? 'count-only' : 'empty'}`} key={block.id} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', block.id); setDraggedBlockId(block.id); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverBlockId(block.id); }} onDragLeave={() => setDragOverBlockId((current) => current === block.id ? undefined : current)} onDrop={(event) => { event.preventDefault(); if (draggedBlockId) setProject(moveBlockInHoleOrder(project, hole, draggedBlockId, block.id)); setDraggedBlockId(undefined); setDragOverBlockId(undefined); }} onDragEnd={() => { setDraggedBlockId(undefined); setDragOverBlockId(undefined); }}>
                <div className="true-order-card-top"><span className="true-order-position">{String(index + 1).padStart(2, '0')}</span><div className="true-order-player"><i>{player?.name.slice(0, 1).toUpperCase() ?? '?'}</i><span><b>{player?.name ?? 'Spieler'}</b><small>{shotNumber ? `SCHLAG ${shotNumber} / PAR ${holePar}` : 'ZWISCHENSZENE'}</small></span></div><GripVertical className="drag-handle" size={17} /></div>
                <div className="true-order-card-body"><span>{blockLabel(block.type)}</span><h3>{block.label}</h3><p>{sequences.length ? `${sequences.length} ${sequences.length === 1 ? 'Aufnahme' : 'Aufnahmen'} · ${formatDuration(duration)}` : countsWithoutVideo ? 'Zählt ohne Videomaterial' : 'Noch ohne Aufnahme'}</p>{block.details.club && <small>{block.details.club}{block.details.distanceMeters ? ` · ${block.details.distanceMeters} m` : ''}</small>}</div>
                <footer><button disabled={index === 0} title="Früher abspielen" onClick={() => setProject(moveBlockInHoleOrderBy(project, hole, block.id, -1))}><ArrowLeft size={13} /></button><button disabled={index === orderedBlocks.length - 1} title="Später abspielen" onClick={() => setProject(moveBlockInHoleOrderBy(project, hole, block.id, 1))}><ArrowRight size={13} /></button><span>{sequences.length ? 'IM FILM' : countsWithoutVideo ? 'ZÄHLT' : 'GEPLANT'}</span><button title="Schlagdetails bearbeiten" onClick={() => setEditingBlockId(block.id)}><Pencil size={13} /></button>{sequences[0] && <button title="Aufnahme öffnen" onClick={() => onOpenSequence(sequences[0].id)}><Play size={13} /></button>}</footer>
            </article>;
        })}</div><div className="true-order-hint"><GripVertical size={14} /><span><b>Drag & Drop:</b> Jede Karte ist ein Filmmoment. Die Position gilt unmittelbar für Lochvorschau, Rundenvorschau und Export.</span></div></section>}
        {builderView === 'players' && <>
        <section className="player-order-board"><header><div><Users size={17} /><span><b>Spielreihenfolge für Loch {hole}</b><small>Für jede Schlagrunde separat festlegen · bestimmt direkt den Rohschnitt</small></span></div></header><div className="order-rows">{Array.from({ length: blockRounds }, (_, blockOrder) => {
            const blocks = project.settings.players.map((player) => blocksByPlayer.get(player.id)?.[blockOrder]).filter(Boolean);
            const labels = [...new Set(blocks.map((block) => block!.label))];
            const label = labels.length === 1 ? labels[0] : `Schlagrunde ${blockOrder + 1}`;
            const order = effectivePlayerOrder(project, hole, blockOrder);
            const manual = hasPlayerOrderOverride(project, hole, blockOrder);
            return <div className={`order-row ${manual ? 'manual' : 'automatic'}`} key={blockOrder}><div className="order-label"><span>{String(blockOrder + 1).padStart(2, '0')}</span><div><b>{label}</b><small>{labels.length > 1 ? labels.join(' · ') : 'Spieler nacheinander'}</small><em>{manual ? 'MANUELL' : 'AUTO · AUS SICHTEN'}</em></div></div><div className="player-order-chips">{order.map((playerId, index) => {
                const player = project.settings.players.find((item) => item.id === playerId)!;
                const hasBlock = Boolean(blocksByPlayer.get(playerId)?.[blockOrder]);
                return <div className={`player-order-chip ${hasBlock ? '' : 'inactive'}`} key={playerId}><span>{index + 1}</span><b>{player.name}</b><div><button disabled={index === 0} title={`${player.name} früher`} onClick={() => setProject(movePlayerInOrder(project, hole, blockOrder, playerId, -1))}><ArrowLeft size={12} /></button><button disabled={index === order.length - 1} title={`${player.name} später`} onClick={() => setProject(movePlayerInOrder(project, hole, blockOrder, playerId, 1))}><ArrowRight size={12} /></button></div></div>;
            })}{manual && <button className="reset-player-order" title="Automatische Reihenfolge aus dem Sichten wiederherstellen" onClick={() => setProject(clearPlayerOrderOverride(project, hole, blockOrder))}><RotateCcw size={12} /> Auto</button>}</div></div>;
        })}</div></section>
        <div className="player-lanes">{project.settings.players.map((player) => {
            const blocks = blocksByPlayer.get(player.id) ?? [];
            const sequenceCount = blocks.reduce((sum, block) => sum + block.sequenceIds.length, 0);
            const strokeCount = playerHoleStrokeCount(project, hole, player.id);
            const addType = newTypes[player.id] ?? 'extra-shot';
            return <section className="player-lane" key={player.id}><header><div className="player-avatar">{player.name.slice(0, 1).toUpperCase()}</div><div><h2>{player.name}</h2><span>{strokeCount} Schläge / Par {holePar} · {sequenceCount} Sequenzen</span></div></header><div className="stroke-quick-actions"><span>Schlag fehlt im Material?</span><button onClick={() => setProject(addCountedStroke(project, hole, player.id, 'unfilmed'))}><Plus size={12} /> Nicht gefilmt</button><button className="penalty" onClick={() => setProject(addCountedStroke(project, hole, player.id, 'penalty'))}><Flag size={12} /> Strafschlag</button></div><div className="block-flow">{blocks.map((block, blockIndex) => {
                const sequences = block.sequenceIds.map((id) => project.sequences.find((sequence) => sequence.id === id)).filter(Boolean) as VirtualSequence[];
                const duration = sequences.reduce((sum, sequence) => sum + (sequence.outFrame - sequence.inFrame) / sequence.sourceFps, 0);
                const shotNumber = strokeNumberForBlock(project, block.id);
                const countsWithoutVideo = !sequences.length && (block.label === 'Nicht gefilmter Schlag' || block.type === 'penalty');
                return <article className={`golf-block ${sequences.length ? 'filled' : 'empty'} ${countsWithoutVideo ? 'count-only' : ''}`} key={block.id}><div className="block-head"><span className="block-order">{shotNumber ? `S${shotNumber}` : String(blockIndex + 1).padStart(2, '0')}</span><div>{shotNumber && <span className="stroke-context">SCHLAG {shotNumber} / PAR {holePar}</span>}<h3>{block.label}</h3><small>{sequences.length ? `${sequences.length} Sequenz${sequences.length === 1 ? '' : 'en'} · ${formatDuration(duration)}` : countsWithoutVideo ? 'Zählt im Schlagverlauf · kein Video nötig' : 'Noch nicht belegt'}{block.details.club ? ` · ${block.details.club}` : ''}{block.details.distanceMeters ? ` · ${block.details.distanceMeters} m` : ''}</small></div><div className="block-actions"><button title="Schlagdetails und Schlagnummer bearbeiten" onClick={() => setEditingBlockId(block.id)}><Pencil size={14} /></button><button disabled={blockIndex === 0} title="Block nach oben" onClick={() => setProject(moveBlock(project, block.id, -1))}><ArrowUp size={14} /></button><button disabled={blockIndex === blocks.length - 1} title="Block nach unten" onClick={() => setProject(moveBlock(project, block.id, 1))}><ArrowDown size={14} /></button><button title="Block duplizieren" onClick={() => setProject(duplicateBlock(project, block.id))}><Copy size={14} /></button><button title="Block löschen" onClick={() => removeBlock(block.id, sequences.length)}><Trash2 size={14} /></button></div></div>
                    {sequences.length ? <div className="block-sequences">{sequences.map((sequence, index) => <div className="builder-sequence" key={sequence.id}><button className="builder-sequence-main" onClick={() => onOpenSequence(sequence.id)}><span><Play size={11} /></span><div><b>{sourceName(sequence)}</b><small>{frameTime(sequence.inFrame, sequence.sourceFps)} – {frameTime(sequence.outFrame, sequence.sourceFps)}</small></div></button><div className="sequence-order-actions"><button disabled={index === 0} title="Sequenz nach oben" onClick={() => setProject(moveSequence(project, block.id, sequence.id, -1))}><ArrowUp size={12} /></button><button disabled={index === sequences.length - 1} title="Sequenz nach unten" onClick={() => setProject(moveSequence(project, block.id, sequence.id, 1))}><ArrowDown size={12} /></button></div></div>)}</div> : countsWithoutVideo ? <div className="block-placeholder counted"><Check size={16} /><span>Bewusst ohne Aufnahme · wird nicht abgespielt</span></div> : <div className="block-placeholder"><Scissors size={16} /><span>Im Sichtungseditor zuweisen</span></div>}
                </article>;
            })}</div><footer className="add-block"><select value={addType} onChange={(event) => setNewTypes((current) => ({ ...current, [player.id]: event.target.value as BlockType }))}>{BLOCK_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button onClick={() => setProject(addBlock(project, hole, player.id, addType))}><Plus size={15} /> Block hinzufügen</button></footer></section>;
        })}</div>
        </>}
        <div className="builder-note"><Clock3 size={16} /><div><b>{builderView === 'order' ? 'Verbindliche Filmreihenfolge' : 'Automatischer Rohschnitt'}</b><span>{builderView === 'order' ? 'Die sichtbare Kartenreihenfolge wird direkt für Vorschau und Export verwendet. Leere Karten und nicht gefilmte Schläge werden beim Abspielen übersprungen.' : `Die Reihenfolge läuft von Loch 1 bis ${project.settings.holes}, innerhalb jedes Lochs von oben nach unten. Leere Blöcke werden übersprungen.`}</span></div></div>
        {previewScope !== undefined && <RoughCutPreview project={project} setProject={setProject} onlyHole={previewScope === 'round' ? undefined : previewScope} onClose={() => setPreviewScope(undefined)} onEdit={(sequenceId) => { setPreviewScope(undefined); onOpenSequence(sequenceId); }} />}
        {scorecardOpen && <ScorecardEditor project={project} setProject={setProject} onClose={() => setScorecardOpen(false)} />}
        {editingBlockId && <BlockDetailsEditor project={project} blockId={editingBlockId} setProject={setProject} onClose={() => setEditingBlockId(undefined)} />}
    </section>;
}

function ExportScreen({ project }: { project: GolfProject }) {
    const [profile, setProfile] = useState<ExportProfileId>('source-matched');
    const [progress, setProgress] = useState<ExportProgress>();
    const [exporting, setExporting] = useState(false);
    const sequenceIds = useMemo(() => roughCutSequenceIds(project), [project]);
    const summary = useMemo(() => buildExportSummary(project, sequenceIds, profile), [project, sequenceIds, profile]);

    useEffect(() => window.golfStudio?.onExportProgress((update) => {
        setProgress(update);
        if (update.phase === 'complete' || update.phase === 'error' || update.phase === 'canceled') setExporting(false);
    }), []);

    const startExport = async () => {
        if (!summary.valid) {
            setProgress({ phase: 'error', percent: 0, message: summary.diagnostics.find((item) => item.severity === 'error')?.message ?? 'Der Filmstand ist noch nicht exportierbar.' });
            return;
        }
        if (!window.golfStudio) {
            setProgress({ phase: 'error', percent: 0, message: 'Export ist nur in der Desktop-App verfügbar.' });
            return;
        }
        setExporting(true);
        setProgress({ phase: 'preparing', percent: 0, message: 'Export wird vorbereitet …' });
        try {
            const result = await window.golfStudio.exportVideo({ project, sequenceIds, profile });
            if (result.canceled) {
                setExporting(false);
                setProgress((current) => current?.phase === 'canceled' ? current : undefined);
            } else if (result.error) {
                setExporting(false);
                setProgress({ phase: 'error', percent: 0, message: result.error });
            }
        } catch (error) {
            setExporting(false);
            setProgress({ phase: 'error', percent: 0, message: error instanceof Error ? error.message : 'Export fehlgeschlagen.' });
        }
    };

    const cancelExport = async () => {
        await window.golfStudio?.cancelExport();
    };

    return <section className="workspace export-workspace">
        <div className="workspace-heading"><div><div className="eyebrow"><span /> EXPORT</div><h1>Golfrunde ausgeben</h1><p>Direkt aus den Originaldateien gerendert – kein WebM, kein Proxy und keine Zwischenkonvertierung.</p></div></div>
        <div className="export-layout">
            <div className="export-main">
                <section className="export-panel source-panel"><header><Film size={19} /><div><span>VERWENDETE QUELLQUALITÄT</span><b>{summary.width} × {summary.height} · {summary.fps} fps · {summary.bitDepth} Bit</b></div></header><div className="export-source-grid">
                    <div><span>Rohschnitt</span><b>{summary.sequenceCount} Sequenzen</b></div>
                    <div><span>Laufzeit</span><b>{formatDuration(summary.durationSeconds)}</b></div>
                    <div><span>Quellcodecs</span><b>{summary.sourceCodecs.length ? summary.sourceCodecs.map((codec) => codec.toUpperCase()).join(' + ') : '–'}</b></div>
                    <div><span>Ausgabeformat</span><b>{summary.videoCodec} · {summary.container}</b></div>
                </div></section>
                <section className="export-panel"><div className="export-section-title"><div><span>EXPORTPROFIL</span><h2>Qualität wählen</h2></div><ShieldCheck size={21} /></div>
                    <div className="export-profiles">
                        <button className={profile === 'source-matched' ? 'selected' : ''} disabled={exporting} onClick={() => setProfile('source-matched')}><span className="profile-check">{profile === 'source-matched' && <Check size={14} />}</span><div><b>Quellgetreu</b><small>Empfohlen für fertige Videos</small><p>Auflösung und Bildrate bleiben mindestens auf dem Niveau des verwendeten Materials. Sehr hochwertige Neuencodierung.</p></div><em>{summary.videoCodec}<br />{summary.container}</em></button>
                        <button className={profile === 'lossless-master' ? 'selected' : ''} disabled={exporting} onClick={() => setProfile('lossless-master')}><span className="profile-check">{profile === 'lossless-master' && <Check size={14} />}</span><div><b>Verlustfreier Master</b><small>Für Archiv und weitere Bearbeitung</small><p>FFV1 speichert jedes gerenderte Pixel verlustfrei. Die Datei wird erheblich größer.</p></div><em>FFV1<br />MKV</em></button>
                    </div>
                </section>
                {!summary.valid && <section className="export-progress error"><div><b>Vor dem Export beheben</b><span>{summary.diagnostics.filter((item) => item.severity === 'error').length}</span></div><p>{summary.diagnostics.find((item) => item.severity === 'error')?.message}</p></section>}
                {progress && <section className={`export-progress ${progress.phase}`}><div><b>{progress.phase === 'complete' ? 'Export fertig' : progress.phase === 'error' ? 'Exportfehler' : progress.phase === 'canceled' ? 'Export abgebrochen' : 'Export läuft'}</b><span>{Math.round(progress.percent)} %</span></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div><p>{progress.message}</p>{progress.outputPath && <small>{progress.outputPath}</small>}</section>}
            </div>
            <aside className="export-summary-card"><span>DEIN EXPORT</span><h2>{project.settings.course}</h2><div className="export-format-badge"><b>{summary.container}</b><span>{summary.videoCodec}</span></div><dl><div><dt>Auflösung</dt><dd>{summary.width} × {summary.height}</dd></div><div><dt>Bildrate</dt><dd>{summary.fps} fps</dd></div><div><dt>Farbtiefe</dt><dd>{summary.bitDepth} Bit</dd></div><div><dt>Qualität</dt><dd>{summary.qualityLabel}</dd></div></dl>
                {exporting ? <button className="secondary export-cancel" onClick={cancelExport}><X size={16} /> Export abbrechen</button> : <button className="primary export-start" disabled={!summary.sequenceCount || !summary.valid} onClick={startExport}><Download size={17} /> Export starten</button>}
                {!summary.sequenceCount && <p className="export-empty">Baue zuerst mindestens eine Sequenz in die Runde ein.</p>}
                <p className="export-note">Overlays und Shot Tracer werden direkt in das Endformat gerendert. Es entsteht keine WebM-Zwischendatei.</p>
            </aside>
        </div>
    </section>;
}

function Studio({ initialProject, onNew, mediaEngineStatus, onRetryMediaEngine }: { initialProject: GolfProject; onNew: () => void; mediaEngineStatus: MediaEngineStatus | null; onRetryMediaEngine: () => void }) {
    const [project, setProject] = useState(initialProject);
    const [screen, setScreen] = useState<StudioScreen>('round');
    const [initialMediaId, setInitialMediaId] = useState<string>();
    const [initialSequenceId, setInitialSequenceId] = useState<string>();
    const [initialHole, setInitialHole] = useState<number>();
    const [saveState, setSaveState] = useState('Projekt lokal');
    const [dashboardOpen, setDashboardOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const save = async () => {
        if (!window.golfStudio) return setSaveState('Speichern nur in der Desktop-App verfügbar');
        try {
            const result = await window.golfStudio.saveProject(project);
            setSaveState(result.canceled ? 'Speichern abgebrochen' : 'Projekt gespeichert');
        } catch (error) { setSaveState(error instanceof Error ? error.message : 'Speichern fehlgeschlagen'); }
    };
    const goReview = (mediaId?: string) => { setInitialMediaId(mediaId); setInitialSequenceId(undefined); setInitialHole(undefined); setScreen('review'); };
    const openSequence = (sequenceId: string) => { setInitialSequenceId(sequenceId); setInitialMediaId(undefined); setInitialHole(undefined); setScreen('review'); };
    const startHoleReview = (hole: number) => { setInitialSequenceId(undefined); setInitialMediaId(undefined); setInitialHole(hole); setScreen('review'); };
    const navigate = (next: StudioScreen) => {
        if (next === 'review') { setInitialMediaId(undefined); setInitialSequenceId(undefined); setInitialHole(undefined); }
        setScreen(next);
    };
    const content = screen === 'round'
        ? <RoundDesk project={project} setProject={setProject} onNavigate={navigate} onOpenSequence={openSequence} onStartHole={startHoleReview} />
        : screen === 'import'
            ? <ImportScreen project={project} setProject={setProject} onReview={goReview} />
        : screen === 'review'
            ? <ReviewScreen key={initialSequenceId ?? initialMediaId ?? (initialHole ? `hole-${initialHole}` : 'review')} project={project} setProject={setProject} initialMediaId={initialMediaId} initialSequenceId={initialSequenceId} initialHole={initialHole} />
            : screen === 'build'
                ? <RoundBuilder project={project} setProject={setProject} onOpenSequence={openSequence} />
                : <ExportScreen project={project} />;
    const platformLabel = window.golfStudio?.platform === 'win32' ? 'Windows' : window.golfStudio?.platform === 'darwin' ? 'macOS · Apple Silicon' : window.golfStudio?.platform ?? 'Desktop';
    const engineLabel = mediaEngineStatus?.ready
        ? `Media Engine · FFmpeg ${mediaEngineStatus.ffmpeg.version}`
        : mediaEngineStatus ? 'Media Engine nicht verfügbar' : 'Media Engine wird geprüft';
    if (dashboardOpen) return <Dashboard onClose={() => setDashboardOpen(false)} />;
    return <main className="studio-shell"><TopBar project={project} screen={screen} onScreen={navigate} onSave={save} onDashboard={() => setDashboardOpen(true)} onSettings={() => setSettingsOpen(true)} /><Sidebar project={project} screen={screen} onScreen={navigate} onNew={onNew} />{content}<footer className="statusbar"><span><span className="status-dot" /> {saveState}</span><span className={mediaEngineStatus && !mediaEngineStatus.ready ? 'engine-error' : ''}><span className="status-dot" /> {engineLabel}{mediaEngineStatus && !mediaEngineStatus.ready && <button type="button" onClick={onRetryMediaEngine}>Erneut prüfen</button>}</span><span><HardDrive size={13} /> Lokal · {platformLabel}</span></footer>{settingsOpen && <ProjectSettingsDialog project={project} onApply={(updated) => { setProject(updated); setSaveState('Projekteinstellungen geändert · noch nicht gespeichert'); }} onClose={() => setSettingsOpen(false)} />}</main>;
}

export default function App() {
    const [project, setProject] = useState<GolfProject | null>(null);
    const [dashboardOpen, setDashboardOpen] = useState(false);
    const [error, setError] = useState('');
    const [mediaEngineStatus, setMediaEngineStatus] = useState<MediaEngineStatus | null>(null);
    const checkMediaEngine = useCallback((force = false) => {
        if (!window.golfStudio) return;
        setMediaEngineStatus(null);
        window.golfStudio.getMediaEngineStatus(force)
            .then(setMediaEngineStatus)
            .catch(() => setError('Die lokale Media Engine konnte nicht geprüft werden. Bitte Golf Studio neu starten.'));
    }, []);
    useEffect(() => {
        checkMediaEngine();
    }, [checkMediaEngine]);
    const open = async () => {
        if (!window.golfStudio) return setError('Die Desktop-Brücke ist nicht verfügbar. Bitte die App neu starten.');
        try {
            const result = await window.golfStudio.openProject();
            if (!result.canceled && result.project) setProject(normalizeProject(result.project));
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Projekt konnte nicht geöffnet werden.'); }
    };
    if (dashboardOpen) return <Dashboard onClose={() => setDashboardOpen(false)} />;
    return project
        ? <Studio initialProject={project} onNew={() => setProject(null)} mediaEngineStatus={mediaEngineStatus} onRetryMediaEngine={() => checkMediaEngine(true)} />
        : <SetupScreen error={error} onOpen={open} onDashboard={() => setDashboardOpen(true)} onCreate={(settings) => setProject(createProject(settings))} mediaEngineStatus={mediaEngineStatus} onRetryMediaEngine={() => checkMediaEngine(true)} />;
}
