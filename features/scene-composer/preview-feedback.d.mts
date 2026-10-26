import type { SimEvent, SimInstance } from '../interactable-editor/simulator.mjs';
import type { Scene } from './model.mjs';
export function previewEventLabel(scene: Scene, event: SimEvent & { sourceInstanceId?: string; targetInstanceId?: string; action?: string; value?: boolean; changed?: boolean }): string;
export function previewBehaviorLabel(instance: SimInstance): string;
