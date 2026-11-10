import * as z from 'zod/v4';
import { LINK_EVENTS, LINK_ACTIONS, MAX_SCENE_LINKS } from '../../features/scene-composer/links.mjs';
import { documentId, coordinate, point, command } from './document-contract-common.mjs';

const ids = z.array(documentId).min(1).max(2010).refine(a => new Set(a).size === a.length, 'Duplicate node IDs.');
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
