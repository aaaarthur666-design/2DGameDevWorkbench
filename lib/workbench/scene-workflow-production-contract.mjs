import * as z from 'zod/v4';
import { validateImageAssetDimensions } from './image-dimensions.mjs';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
const prompt = z.string().trim().min(1).max(12000);
const dimension = z.number().int().min(16).max(3840);
const point = z
  .object({
    x: z.number().int().min(-1e7).max(1e7),
    y: z.number().int().min(-1e7).max(1e7),
  })
  .strict();
const name = z.string().trim().min(1).max(200);

/** Pure model-facing schemas: provider resolution and execution live in Bridge. */
export const generationStepSchema = z
  .object({
    purpose: z.literal('object'),
    materialId: id,
    definitionId: id,
    name: name.max(80),
    prompt,
    width: dimension.default(1024),
    height: dimension.default(1024),
    visualWidth: z.number().positive().max(8192).default(64),
    visualHeight: z.number().positive().max(8192).default(64),
  })
  .strict()
  .refine((value) => {
    try {
      validateImageAssetDimensions(value.width, value.height);
      return true;
    } catch {
      return false;
    }
  }, '图片宽高须为 16 的倍数，总计 655360–8294400 像素，最长边不超过 3840，比例在 1:3–3:1 内。');

export const mapStepSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      name,
      prompt,
      aspectRatio: z.enum(['1:1', '3:2', '2:3']).default('3:2'),
      origin: point.default({ x: 0, y: 0 }),
    })
    .strict(),
  z
    .object({
      operation: z.literal('extend'),
      name,
      prompt: prompt.max(11600),
      neighborTileKey: z.string().min(1).max(100),
      direction: z.enum(['left', 'right', 'up', 'down']),
      overlapPercent: z.number().int().min(1).max(50).default(15),
    })
    .strict(),
]);
