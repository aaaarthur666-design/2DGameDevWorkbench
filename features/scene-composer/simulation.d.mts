import { InteractionSimulation, type SimInstance, type SimEvent, type InteractionState } from '../interactable-editor/simulator.mjs';
import type { Scene } from './model.mjs';
import type { SceneLink } from './links.mjs';
export type LinkState = InteractionState & { enabled: boolean; visible: boolean; solidEnabled: boolean };
export type SceneSimInstance = SimInstance & { readonly enabled: boolean; readonly visible: boolean; visibleOverride: boolean | null };
export type SceneSimEvent = SimEvent & { linkId?: string; sourceInstanceId?: string; targetInstanceId?: string; action?: SceneLink['action']; value?: boolean; changed?: boolean; targetState?: LinkState };
export class SceneSimulation extends InteractionSimulation {
  constructor(scene: Scene);
  objects: SceneSimInstance[];
  links: SceneLink[];
  eventLog: SceneSimEvent[];
  eventCount: number;
  linkAttempts: number;
  linkDiagnostics: Array<{ code: string; message: string; linkId?: string }>;
  getLinkState(instanceId: string): LinkState | null;
  flushLinks(): void;
}
export function createSceneSimulation(scene: Scene): SceneSimulation;
