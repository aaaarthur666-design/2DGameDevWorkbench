import { createSceneSimulation } from './simulation.mjs';
import { createInteractableSimulation } from '../editor-documents/simulation-replay.mjs';
export { simulationEventSchema, simulationEventsSchema, simulationInstanceState, replaySimulationEvents } from '../editor-documents/simulation-replay.mjs';

export function createDocumentSimulation(kind, content) {
  if (kind === 'scene') return createSceneSimulation(content);
  if (kind === 'interactable') return createInteractableSimulation(content);
  throw new Error('Unsupported simulation document kind.');
}
