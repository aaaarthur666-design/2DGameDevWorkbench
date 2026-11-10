import { createScene, validateScene, sceneSchema, sceneWarnings } from '../../features/scene-composer/model.mjs';
import { normalizeProject } from '../../features/interactable-editor/contract.mjs';
import { updateSplitSourceState } from '../../features/scene-composer/map-split-source.mjs';
import { updateMapCollisionOverride } from '../../features/scene-composer/map-collisions.mjs';
import { assertSceneMutationLocks } from '../../features/scene-composer/mutation-policy.mjs';
import { createSceneSimulation } from '../../features/scene-composer/simulation.mjs';
import { applySceneCommands } from './scene-document-commands.mjs';
import { sceneImageCommands } from './scene-document-assets.mjs';

async function prepareSave(current, content, { respectLocks, readRevision, freezeRevision }) {
  updateMapCollisionOverride(current.content, content);
  let previous = current.content;
  const split = content.mapSplit;
  if (previous.mapSplit?.stale && split && !split.stale && split.candidateId === previous.mapSplit.candidateId && split.candidateRevision === previous.mapSplit.candidateRevision) {
    // Undo after a shared save must prove the restored source against the
    // active version, rather than the replacement map that retired it.
    let matched = false;
    for (let revision = current.revision - 1; revision > 0; revision--) {
      const prior = await readRevision(revision);
      const priorSplit = prior.mapSplit;
      if (priorSplit?.candidateId !== split.candidateId || priorSplit.candidateRevision !== split.candidateRevision) break;
      if (!priorSplit.stale && priorSplit.sourceHash === split.sourceHash) {
        previous = await freezeRevision(prior);
        matched = true;
        break;
      }
    }
    if (!matched) { split.stale = true; split.review = 'unverified'; }
  }
  updateSplitSourceState(previous, content);
  if (respectLocks) {
    assertSceneMutationLocks(current.content, validateScene(content));
  }
}

export const sceneDocuments = {
  identity: content => content.id,
  create(id, name) { const content = createScene(name); content.id = id; return content; },
  normalize(input, { validate = true } = {}) {
    if (validate) return validateScene(input);
    const content = sceneSchema.parse(input);
    content.materials = content.materials.map(material => ({ ...material, project: normalizeProject(material.project) }));
    return content;
  },
  setRevision(content, revision) { content.revision = revision; },
  viewPath: '/tools/scene-composer',
  applyCommands: applySceneCommands,
  prepareSave,
  diagnostics: content => sceneWarnings(content).map(message => ({ severity: 'warning', message })),
  counts: content => ({ materials: content.materials.length, instances: content.instances.length, mapLayers: content.map?.layers.length || 0, links: content.links.length }),
  createSimulation: createSceneSimulation,
  imageCommands: sceneImageCommands,
};
