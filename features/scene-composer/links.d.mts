import type { z } from 'zod';
import type { Scene } from './model.mjs';
export const LINK_EVENTS: ['toggled', 'picked_up', 'sequence_advanced', 'interaction_finished', 'interaction_completed', 'state_changed'];
export const LINK_ACTIONS: ['set_toggle', 'set_enabled', 'set_visible'];
export const MAX_SCENE_LINKS: number;
export const MAX_LINK_ACTIONS: number;
export type SceneLink = {
  id: string;
  sourceInstanceId: string;
  event: typeof LINK_EVENTS[number];
  targetInstanceId: string;
  action: typeof LINK_ACTIONS[number];
  value: boolean | 'source_toggle';
  enabled: boolean;
};
export type LinkDiagnostic = { severity: 'error'; code: string; linkId?: string; message: string };
export const sceneLinkSchema: z.ZodType<SceneLink>;
export function sceneLinkDiagnostics(scene: Scene): LinkDiagnostic[];
export function validateSceneLinks<T extends Scene>(scene: T): T;
