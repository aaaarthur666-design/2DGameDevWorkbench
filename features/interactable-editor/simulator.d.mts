import type { Interactable, Appearance } from './contract.mjs';
export type InteractionState = {
  completed: boolean;
  toggleState: boolean;
  sequenceIndex: number;
  successCount: number;
};
export type SimInstance = {
  definition: Interactable;
  id: string;
  x: number;
  y: number;
  state: InteractionState;
  cooldown: number;
  inRange: boolean;
  pending: boolean;
  animation: {
    name: string;
    feedback: boolean;
    started: number;
    ends: number;
  } | null;
};
export type SimEvent = {
  name: string;
  instanceId: string;
  time: number;
  result: InteractionState;
  assetId?: string;
  volumeDb?: number;
  animation?: string;
  reason?: string;
};
export class InteractionSimulation {
  constructor(objects: Interactable[]);
  objects: SimInstance[];
  actor: { x: number; y: number };
  focus: SimInstance | null;
  active: SimInstance | null;
  time: number;
  waiting: {
    type: string;
    pages: string[];
    index: number;
    shown: number;
    remaining?: number;
    animation?: string;
    assetId?: string;
  } | null;
  events: SimEvent[];
  tick(delta: number): void;
  press(): void;
  click(x: number, y: number): void;
  request(i?: SimInstance, source?: boolean): boolean;
  advanceText(): void;
  finishAudio(): void;
  cancel(): void;
  moveActor(x: number, y: number): void;
  reset(): void;
  snapshot(): InteractionState[];
  restore(states: InteractionState[]): void;
}
export function stateAppearance(
  o: Interactable,
  state: InteractionState,
): Partial<Appearance>;
export function initialState(o: Interactable): InteractionState;
export function committedState(
  o: Interactable,
  state: InteractionState,
): InteractionState;
export function shapeContains(
  shape: Interactable['pointer'],
  x: number,
  y: number,
  radius?: number,
): boolean;
