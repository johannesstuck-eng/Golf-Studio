import { compileRenderPlan as compileSharedRenderPlan } from '../shared/render-plan.mjs';
import type { GolfProject } from './types';
import type { RenderPlan, RenderPlanProject } from '../shared/render-plan.mjs';

/**
 * Typed renderer adapter for the canonical plan compiler shared with Electron.
 * The shared compiler validates the runtime object and never mutates it.
 */
export function compileRenderPlan(project: GolfProject, sequenceIds: string[]): RenderPlan {
    return compileSharedRenderPlan(project as unknown as RenderPlanProject, sequenceIds);
}

export type { RenderDiagnostic, RenderPlan } from '../shared/render-plan.mjs';
