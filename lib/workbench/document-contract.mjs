import * as z from 'zod/v4';
import { LINK_EVENTS, LINK_ACTIONS, MAX_SCENE_LINKS } from '../../features/scene-composer/links.mjs';
import { simulationEventsSchema } from '../../features/scene-composer/simulation-replay.mjs';

export const documentId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
const commandId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const coordinate = z.number().min(-1e7).max(1e7);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const ids = z.array(documentId).min(1).max(2010).refine(a => new Set(a).size === a.length, 'Duplicate node IDs.');
const text = z.string().max(100000);
const tint = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const shape = z.object({ type: z.enum(['rectangle', 'circle', 'capsule']), width: z.number().min(1).max(8192), height: z.number().min(1).max(8192), radius: z.number().min(1).max(8192), offset: point }).partial().strict();
const appearance = z.object({ assetId: z.string().max(96).optional(), animation: text.optional(), visible: z.boolean().optional(), solidEnabled: z.boolean().optional(), tint: tint.optional() }).strict();
const feedback = z.discriminatedUnion('type', [
  z.object({ type: z.literal('show_text'), pages: z.array(text).max(100) }).strict(),
  z.object({ type: z.literal('wait'), seconds: z.number().min(0).max(3600) }).strict(),
  z.object({ type: z.literal('play_animation'), animation: text, waitForEnd: z.boolean() }).strict(),
  z.object({ type: z.literal('play_audio'), assetId: documentId, waitForEnd: z.boolean(), volumeDb: z.number().min(-80).max(12) }).strict(),
]);
const entry = z.object({ name: text, pages: z.array(text).max(100).optional(), appearance: appearance.optional(), feedback: z.array(feedback).max(100).optional() }).strict();
const asset = z.object({ id: documentId, name: z.string().min(1).max(240), mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mpeg']), source: z.string().min(1).max(90000000), generation: z.object({ sourceTaskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict();
const definition = { definitionId: documentId };
const command = (type, fields = {}) => z.object({ type: z.literal(type), ...fields }).strict();
const linkFields = { sourceInstanceId: documentId, event: z.enum(LINK_EVENTS), targetInstanceId: documentId, action: z.enum(LINK_ACTIONS), value: z.union([z.boolean(), z.literal('source_toggle')]), enabled: z.boolean() };
export const sceneLinkInputSchema = z.object({ id: documentId, ...linkFields, enabled: z.boolean().default(true) }).strict();

export const sceneCommandSchema = z.discriminatedUnion('type', [
  command('rename', { name: z.string().min(1).max(120) }),
  command('set-view', { view: z.object({ x: coordinate, y: coordinate, zoom: z.number().min(0.02).max(16), grid: z.number().int().min(1).max(256), showGrid: z.boolean(), showNames: z.boolean(), showShapes: z.boolean(), showActor: z.boolean() }).partial().strict() }),
  command('import-material', { project: z.unknown(), definitionId: documentId, materialId: documentId.optional() }),
  command('replace-material', { materialId: documentId, project: z.unknown(), definitionId: documentId }),
  command('add-instance', { materialId: documentId, x: coordinate, y: coordinate, instanceId: documentId.optional() }),
  command('move-instances', { ids, dx: coordinate.optional(), dy: coordinate.optional(), x: coordinate.optional(), y: coordinate.optional() }),
  command('scale-instances', { ids, scale: z.number().min(0.05).max(32) }),
  command('flip-instances', { ids, flipH: z.boolean() }),
  command('set-node-flags', { ids, locked: z.boolean().optional(), hidden: z.boolean().optional(), included: z.boolean().optional() }),
  command('reorder', { ids, action: z.enum(['front', 'back', 'forward', 'backward', 'index', 'before', 'after']), target: z.union([documentId, z.number().int().min(1).max(2010)]).optional() }),
  command('replace-instances', { ids, materialId: documentId }),
  command('remove-instances', { ids }),
  command('replace-map', { map: z.unknown() }),
  command('move-map', { x: coordinate, y: coordinate }),
  command('set-map-collisions', { collisions: z.array(z.array(point).min(3).max(10000)).max(10000) }),
  command('set-anchor', { instanceId: documentId, anchor: point }),
  command('set-links', { links: z.array(sceneLinkInputSchema).max(MAX_SCENE_LINKS) }),
  command('add-link', { link: sceneLinkInputSchema }),
  command('update-link', { linkId: documentId, patch: z.object(linkFields).partial().strict() }),
  command('remove-links', { ids: z.array(documentId).min(1).max(MAX_SCENE_LINKS) }),
]);
export const interactableCommandSchema = z.discriminatedUnion('type', [
  command('rename', { name: z.string().min(1).max(200) }),
  command('add-object', { kind: z.enum(['inspect', 'toggle', 'pickup', 'sequence']), definitionId: documentId.optional(), name: z.string().min(1).max(200).optional() }),
  command('remove-object', definition),
  command('rename-object', { ...definition, name: z.string().min(1).max(200) }),
  command('add-asset', { asset }),
  command('bind-asset', { ...definition, assetId: documentId, target: z.enum(['visual', 'toggle-state', 'sequence-entry']).default('visual'), index: z.number().int().min(0).max(99).optional() }),
  command('set-visual', { ...definition, visual: z.object({ width: z.number().min(1).max(8192), height: z.number().min(1).max(8192), offset: point, scale: z.number().min(0.01).max(100), flipH: z.boolean(), flipV: z.boolean(), zIndex: z.number().min(-4096).max(4096), visible: z.boolean(), tint, idleAnimation: text, focusAnimation: text, float: z.boolean(), dot: z.boolean() }).partial().strict() }),
  command('set-shape', { ...definition, target: z.enum(['detection', 'pointer', 'solid']), shape, enabled: z.boolean().optional() }),
  command('set-activation', { ...definition, activation: z.object({ mode: z.enum(['proximity_press', 'pointer_click', 'automatic_enter', 'external_request']), action: z.string().min(1).max(100), key: z.string().min(1).max(32), cancelOnExit: z.boolean(), enabled: z.boolean() }).partial().strict() }),
  command('set-content', { ...definition, content: z.object({ prompt: text, pages: z.array(text).max(100), charactersPerSecond: z.number().min(0).max(300), promptOffset: point }).partial().strict() }),
  command('set-behavior', { ...definition, behavior: z.object({ kind: z.enum(['inspect', 'toggle', 'pickup', 'sequence']), repeat: z.boolean(), initialToggle: z.boolean(), states: z.array(entry).length(2), entries: z.array(entry).min(1).max(100), onEnd: z.enum(['stop', 'loop', 'stay_last']) }).partial().strict() }),
  command('set-feedback', { ...definition, feedback: z.array(feedback).max(100) }),
  command('set-completion', { ...definition, completion: z.enum(['remain', 'hide', 'free']), cooldownSeconds: z.number().min(0).max(3600).optional() }),
]);
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
