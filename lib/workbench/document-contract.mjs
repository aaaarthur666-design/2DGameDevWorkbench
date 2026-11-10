import * as z from 'zod/v4';
import { documentId, commandId, revision, coordinate } from './document-contract-common.mjs';
import { sceneCommandSchema } from './scene-document-contract.mjs';
import { interactableCommandSchema } from './interactable-document-contract.mjs';
import { simulationEventsSchema } from '../../features/editor-documents/simulation-replay.mjs';

export { documentId } from './document-contract-common.mjs';
export { sceneCommandSchema, sceneLinkInputSchema } from './scene-document-contract.mjs';
export { interactableCommandSchema } from './interactable-document-contract.mjs';

const mutation = { documentId, expectedRevision: revision, commandId };
export const documentInputs = {
  documents: z.object({ kind: z.enum(['scene', 'interactable']).optional(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }).strict(),
  'document-get': z.object({ documentId, revision: revision.optional(), metadataOnly: z.boolean().optional() }).strict(),
  'document-create': z.object({ kind: z.enum(['scene', 'interactable']), documentId: documentId.optional(), commandId, name: z.string().min(1).max(200).optional(), content: z.unknown().optional() }).strict(),
  'document-save': z.object({ ...mutation, content: z.unknown() }).strict(),
  'document-apply': z.object({ ...mutation, commands: z.array(z.union([sceneCommandSchema, interactableCommandSchema])).min(1).max(100) }).strict(),
  'document-restore': z.object({ ...mutation, revision }).strict(),
  'document-validate': z.object({ documentId, revision: revision.optional() }).strict(),
  'document-simulate': z.object({ documentId, revision: revision.optional(), events: simulationEventsSchema, expectEvents: z.array(z.object({ name: z.enum(['focus_entered', 'focus_exited', 'interaction_started', 'interaction_finished', 'interaction_completed', 'interaction_cancelled', 'picked_up', 'toggled', 'sequence_advanced', 'play_animation', 'play_audio', 'state_changed', 'link_applied', 'link_skipped', 'link_error']), instanceId: documentId.optional(), count: z.number().int().min(1).max(1000).default(1) }).strict()).max(100).optional(), expectStates: z.array(z.object({ instanceId: documentId, completed: z.boolean().optional(), toggleState: z.boolean().optional(), sequenceIndex: z.number().int().min(0).max(100).optional(), successCount: z.number().int().min(0).max(1000000).optional(), enabled: z.boolean().optional(), visible: z.boolean().optional(), solidEnabled: z.boolean().optional() }).strict()).max(200).optional() }).strict(),
  'document-adopt-image': z.object({ ...mutation, sourceTaskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), definitionId: documentId.optional() }).strict(),
  'document-export': z.object({ documentId, revision }).strict(),
  'document-observe': z.object({ documentId, revision: revision.optional(), region: z.object({ x: coordinate, y: coordinate, width: z.number().positive().max(30000), height: z.number().positive().max(30000) }).strict().optional(), maxWidth: z.number().int().min(128).max(2048).optional(), maxHeight: z.number().int().min(128).max(2048).optional(), time: z.number().min(0).max(3600).optional().describe('Animation time without interaction replay; omit when supplying events.'), mode: z.enum(['editor', 'export']).optional(), overlay: z.boolean().optional(), events: simulationEventsSchema.optional().describe('Replay up to 200 validated inputs before rendering. Mutually exclusive with time; use tick events to advance replay time.') }).strict().refine(input => input.events === undefined || input.time === undefined, { message: 'Use tick events for replay time; events and time cannot be supplied together.', path: ['time'] }),
};
export const documentTools = [
  ['workbench_list_documents', 'documents', 'List saved shared scene/interactable documents. Browser drafts must be saved before they are visible. No generation or export.'],
  ['workbench_get_document', 'document-get', 'Read a saved document and its stable IDs, exact revision and self-contained content. Optional revision reads an immutable historical snapshot.'],
  ['workbench_create_document', 'document-create', 'Create a shared scene or interactable document from valid existing content or an empty template. commandId makes retries idempotent. No generation or export.'],
  ['workbench_save_document', 'document-save', 'Save complete validated document content, preserving document identity. Requires expectedRevision and an idempotency commandId. Prefer apply_document_commands for typed AI edits.'],
  ['workbench_apply_document_commands', 'document-apply', 'Apply a single-document transaction of documented typed scene or interactable commands. Read the document first and supply expectedRevision plus a unique commandId; all commands commit together or none do. Assets are snapshotted; no eval, generation or export.'],
  ['workbench_restore_document', 'document-restore', 'Restore a saved historical revision as a new current revision. Requires expectedRevision and commandId; history is retained.'],
  ['workbench_validate_document', 'document-validate', 'Validate a saved document at an exact revision, including embedded media and scene diagnostics. Read-only; no generation, export or Godot engine validation.'],
  ['workbench_simulate_document', 'document-simulate', 'Replay up to 200 validated inputs on a saved scene/interactable revision, including typed scene links. Optional expectEvents checks emitted events; expectStates checks exact instance toggle/completion/count/enabled/visible/solidEnabled fields. Returns chronological events, effective states and link diagnostics. No expectations means passed only describes an error-free bounded replay, not behavior acceptance. No document mutation or Godot physics claim; standalone interactable instance IDs are definition IDs.'],
  ['workbench_adopt_document_image', 'document-adopt-image', 'Explicitly adopt one completed image-assets task into a document using its exact task ID and SHA256. Prop adoption needs an interactable definitionId; scene backgrounds become a map layer. Requires expectedRevision and commandId. No generation, export or replacement of state-specific art.'],
  ['workbench_export_document', 'document-export', 'Export an exact saved scene revision as portable source and Godot packages, retaining its contentHash. Does not generate artwork, alter the scene or claim engine validation.'],
  ['workbench_observe_document', 'document-observe', 'Render an exact saved scene revision into PNG and optional geometry overlay. Optional events replays up to 200 validated inputs and links before rendering, so opened doors and runtime flags appear in the image; returns replay steps, states and revision evidence. events and time are mutually exclusive: use tick events for replay time. Optional world-space region, dimensions and editor/export mode. No arbitrary supplied state, browser draft, generation or Godot engine validation.'],
];
