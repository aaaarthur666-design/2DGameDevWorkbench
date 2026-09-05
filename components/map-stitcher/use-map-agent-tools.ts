'use client';
import { useEffect, useRef } from 'react';
import {
  MAP_DISPLAY_LAYERS,
  MAP_IMAGE_LAYERS,
  REGION_LAYERS,
  type MapDisplayLayer,
  type MapImageLayer,
  type RegionLayer,
  type RegionShape,
} from '@/features/map-stitcher/frame-ronin-types';
import { dataUrlToBlob, urlToBlob } from '@/features/map-stitcher/image-utils';
import type {
  MapEditorController,
  MapExportFormat,
} from './use-map-editor-controller';

interface BrowserTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
}
type AgentDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: BrowserTool,
      options: { signal: AbortSignal },
    ) => unknown;
  };
};
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('输入必须是对象。');
  return input as Record<string, unknown>;
}
function text(input: unknown, name: string) {
  if (typeof input !== 'string' || !input.trim())
    throw new Error(`${name} 必须是字符串。`);
  return input;
}
const schema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', properties, required, additionalProperties: false });
export function useMapAgentTools(controller: MapEditorController) {
  const current = useRef(controller);
  useEffect(() => {
    current.current = controller;
  });
  useEffect(() => {
    const context = (document as AgentDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = (
      name: string,
      title: string,
      description: string,
      inputSchema: Record<string, unknown>,
      execute: (
        c: MapEditorController,
        input: Record<string, unknown>,
      ) => unknown,
      readOnly = false,
    ): BrowserTool => ({
      name,
      title,
      description,
      inputSchema,
      annotations: { readOnlyHint: readOnly, untrustedContentHint: false },
      execute: (input) => execute(current.current, record(input)),
    });
    const tools: BrowserTool[] = [
      tool(
        'map_stitcher_read_summary',
        '读取地图编辑摘要',
        '读取文档、选择、锁定、区域范围和生成队列。',
        schema({}),
        (c) => ({
          format: 'pixelwork-v2',
          tileCount: c.tiles.length,
          imageCount: c.imageCount,
          regionCount: c.shapes.length,
          selectedKey: c.selectedKey,
          activeMapLayer: c.activeMapLayer,
          activeRegionLayer: c.activeRegionLayer,
          regionScope: c.preferences.regionScope,
          mode: c.mode,
          imageLocks: c.imageLocks,
          regionLocks: c.regionLocks,
          zoom: c.zoom,
          pan: c.pan,
          generatorMode: c.api.settings.active
            ? c.api.settings.provider
            : 'local',
          queue: c.queueState,
        }),
        true,
      ),
      tool(
        'map_stitcher_set_view',
        '调整地图编辑视图',
        '选择地图块、图片视图或区域类别，并调整缩放与平移。',
        schema({
          selectedKey: { type: 'string' },
          mapLayer: { type: 'string', enum: MAP_DISPLAY_LAYERS },
          regionLayer: { type: 'string', enum: REGION_LAYERS },
          zoom: { type: 'number', minimum: 0.05, maximum: 8 },
          panX: { type: 'number' },
          panY: { type: 'number' },
          fit: { type: 'boolean' },
        }),
        (c, input) => {
          if (typeof input.selectedKey === 'string')
            c.selectTile(input.selectedKey);
          if (typeof input.mapLayer === 'string') {
            if (!MAP_DISPLAY_LAYERS.includes(input.mapLayer as MapDisplayLayer))
              throw new Error('mapLayer 无效');
            c.selectView(input.mapLayer as MapDisplayLayer);
          }
          if (typeof input.regionLayer === 'string') {
            if (!REGION_LAYERS.includes(input.regionLayer as RegionLayer))
              throw new Error('regionLayer 无效');
            c.chooseRegionLayer(input.regionLayer as RegionLayer);
          }
          if (typeof input.zoom === 'number' && Number.isFinite(input.zoom))
            c.setZoom(Math.max(0.05, Math.min(8, input.zoom)));
          c.setPan((value) => ({
            x:
              typeof input.panX === 'number' && Number.isFinite(input.panX)
                ? input.panX
                : value.x,
            y:
              typeof input.panY === 'number' && Number.isFinite(input.panY)
                ? input.panY
                : value.y,
          }));
          if (input.fit === true) c.fitView();
          return { updated: true };
        },
      ),
      tool(
        'map_stitcher_import_images',
        '导入地图图片',
        '新建地图；第一张为中心，其余按首圈顺序填入。',
        schema(
          {
            images: {
              type: 'array',
              minItems: 1,
              maxItems: 64,
              items: { type: 'string' },
            },
            names: { type: 'array', items: { type: 'string' } },
          },
          ['images'],
        ),
        async (c, input) => {
          if (
            !Array.isArray(input.images) ||
            !input.images.length ||
            input.images.length > 64
          )
            throw new Error('images 数量必须为 1–64');
          const files: File[] = [];
          for (const [index, value] of input.images.entries()) {
            const url = text(value, 'image');
            if (!url.startsWith('data:image/') && !/^https?:\/\//.test(url))
              throw new Error('图片必须是 data:image 或 HTTP(S) URL');
            const blob = url.startsWith('data:')
              ? dataUrlToBlob(url)
              : await urlToBlob(url);
            files.push(
              new File(
                [blob],
                Array.isArray(input.names) &&
                  typeof input.names[index] === 'string'
                  ? input.names[index]
                  : `map_${index}.png`,
                { type: blob.type || 'image/png' },
              ),
            );
          }
          await c.importImages(files);
          return { imported: files.length };
        },
      ),
      tool(
        'map_stitcher_generate_layer',
        '生成或派生图片',
        '整体扩图、复制地表草稿、由透明物件生成参考或从真实黑白参考提取物件。遵循图片锁定与版本检查。',
        schema(
          {
            tileKey: { type: 'string' },
            layer: { type: 'string', enum: MAP_IMAGE_LAYERS },
          },
          ['tileKey', 'layer'],
        ),
        async (c, input) => {
          const layer = text(input.layer, 'layer') as MapImageLayer;
          if (!MAP_IMAGE_LAYERS.includes(layer)) throw new Error('layer 无效');
          const tileKey = text(input.tileKey, 'tileKey');
          await c.generateLayer(tileKey, layer);
          return {
            tileKey,
            layer,
            generated: true,
            semantics:
              layer === 'surface'
                ? '整体图片副本，需要去除物件'
                : layer === 'black' || layer === 'white'
                  ? '由透明物件派生参考'
                  : layer === 'object'
                    ? '真实黑白参考提取'
                    : '整体层扩图',
          };
        },
      ),
      tool(
        'map_stitcher_create_regions',
        '创建矢量区域',
        '创建卡片本地像素坐标的区域；检查类别锁定、边界和唯一 ID。',
        schema(
          {
            regions: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  tileKey: { type: 'string' },
                  mapLayer: {
                    type: 'string',
                    enum: ['overall', 'surface', 'object'],
                  },
                  layer: { type: 'string', enum: REGION_LAYERS },
                  mode: {
                    type: 'string',
                    enum: ['rectangle', 'polygon', 'free'],
                  },
                  points: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                      },
                      required: ['x', 'y'],
                    },
                  },
                },
                required: ['tileKey', 'layer', 'mode', 'points'],
              },
            },
          },
          ['regions'],
        ),
        (c, input) => {
          if (!Array.isArray(input.regions))
            throw new Error('regions 必须是数组');
          const regions = input.regions.map((value) => {
            const item = record(value);
            if (
              !['rectangle', 'polygon', 'free'].includes(String(item.mode)) ||
              !Array.isArray(item.points)
            )
              throw new Error('区域绘制模式或点数据无效');
            const points = item.points.map((raw) => {
              const point = record(raw);
              if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
                throw new Error('区域坐标无效');
              return { x: Number(point.x), y: Number(point.y) };
            });
            return {
              ...item,
              mapLayer: item.mapLayer ?? c.activeMapLayer,
              points,
            } as Omit<RegionShape, 'id'>;
          });
          const result = c.createRegions(regions, true);
          c.selectRegion(result.at(-1)!.id);
          return {
            created: result.length,
            ids: result.map((shape) => shape.id),
          };
        },
      ),
      tool(
        'map_stitcher_export',
        '导出地图资源',
        '保存 Pixelwork、全部 PNG、合成预览、PSD 或含完整源状态的 Godot 包。',
        schema(
          {
            format: {
              type: 'string',
              enum: [
                'png',
                'top-png',
                'all-png',
                'composite',
                'state',
                'psd',
                'godot',
              ],
            },
            layer: { type: 'string', enum: MAP_DISPLAY_LAYERS },
          },
          ['format'],
        ),
        async (c, input) => {
          const format = text(input.format, 'format') as MapExportFormat;
          if (
            ![
              'png',
              'top-png',
              'all-png',
              'composite',
              'state',
              'psd',
              'godot',
            ].includes(format)
          )
            throw new Error('format 无效');
          if (
            input.layer !== undefined &&
            !MAP_DISPLAY_LAYERS.includes(input.layer as MapDisplayLayer)
          )
            throw new Error('layer 无效');
          const result = await c.exportArtifact(
            format,
            input.layer as MapDisplayLayer | undefined,
          );
          return { format, fileName: result.fileName };
        },
      ),
      tool(
        'map_stitcher_generation_queue',
        '管理地图生成队列',
        '受并发和内存上限约束的批量生成、自动扩展、暂停、恢复、取消与重试。',
        schema(
          {
            action: {
              type: 'string',
              enum: [
                'fill-overall',
                'extract-objects',
                'auto-expand',
                'pause',
                'resume',
                'cancel',
                'retry',
              ],
            },
            limit: { type: 'integer', minimum: 1, maximum: 64 },
          },
          ['action'],
        ),
        (c, input) => {
          switch (input.action) {
            case 'fill-overall':
              c.enqueue('overall', true);
              break;
            case 'extract-objects':
              c.enqueue('object', true);
              break;
            case 'auto-expand':
              c.startAutomatic(
                typeof input.limit === 'number' ? input.limit : 8,
              );
              break;
            case 'pause':
              c.queue.pause();
              break;
            case 'resume':
              c.queue.resume();
              break;
            case 'cancel':
              c.cancelQueue();
              break;
            case 'retry':
              c.queue.retry();
              break;
            default:
              throw new Error('action 无效');
          }
          return c.queue.snapshot();
        },
      ),
    ];
    for (const item of tools)
      void Promise.resolve(
        context.registerTool(item, { signal: lifecycle.signal }),
      ).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);
}
