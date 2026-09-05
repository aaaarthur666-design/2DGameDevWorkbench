import JSZip from 'jszip';
import { canvasToBlob, downloadBlob, safeFileName } from './image-utils';
import type { FrameRoninTile, MapDisplayLayer, RegionShape } from './frame-ronin-types';
import { renderStitchedMap } from './layer-engine';
import { mapShapeToWorldPixels } from './region-engine';

export interface RegionExportRecord {
  id: string;
  tileKey: string;
  mapLayer: RegionShape['mapLayer'];
  layer: RegionShape['layer'];
  mode: RegionShape['mode'];
  points: Array<{ x: number; y: number }>;
}

export interface RegionExportManifest {
  format: 'frame-ronin-regions';
  version: 1;
  canvas: { originX: number; originY: number; width: number; height: number };
  coordinateSystem: 'pixel-world-y-down';
  regions: RegionExportRecord[];
}

export function buildRegionManifest(
  tiles: FrameRoninTile[],
  shapes: RegionShape[],
  sourceWidth: number,
  sourceHeight: number,
  canvas: RegionExportManifest['canvas'],
): RegionExportManifest {
  const tileMap = new Map(tiles.map((tile) => [tile.key, tile]));
  return {
    format: 'frame-ronin-regions',
    version: 1,
    canvas,
    coordinateSystem: 'pixel-world-y-down',
    regions: shapes.flatMap((shape) => {
      const tile = tileMap.get(shape.tileKey);
      if (!tile) return [];
      return [{ ...shape, points: mapShapeToWorldPixels(shape, tile, sourceWidth, sourceHeight) }];
    }),
  };
}

export function buildGodotScene(manifest: RegionExportManifest, layers: Array<MapDisplayLayer | 'top'>) {
  const useSeparatedComposite = layers.includes('surface') && layers.includes('object');
  const extResources = layers.map((layer, index) =>
    `[ext_resource type="Texture2D" path="res://assets/map_${layer}.png" id="${index + 1}_${layer}"]`,
  );
  const collisionRegions = manifest.regions.filter((region) => region.layer === 'collision' && region.points.length >= 3);
  const nodes = layers.flatMap((layer, index) => {
    if (layer === 'top') return [];
    const zIndex = layer === 'object' ? 20 : layer === 'mask' ? 10 : 0;
    const visible = useSeparatedComposite ? layer === 'surface' || layer === 'object' : layer === 'overall';
    return [[
      `[node name="${godotName(layer)}" type="Sprite2D" parent="."]`,
      `position = Vector2(${manifest.canvas.originX}, ${manifest.canvas.originY})`,
      `texture = ExtResource("${index + 1}_${layer}")`,
      'centered = false',
      `z_index = ${zIndex}`,
      ...(visible ? [] : ['visible = false']),
      'texture_filter = 1',
    ].join('\n')];
  });
  if (layers.includes('top')) {
    const topIndex = layers.indexOf('top');
    nodes.push([
      '[node name="Top" type="Sprite2D" parent="."]',
      `position = Vector2(${manifest.canvas.originX}, ${manifest.canvas.originY})`,
      `texture = ExtResource("${topIndex + 1}_top")`,
      'centered = false',
      'z_index = 100',
      'texture_filter = 1',
    ].join('\n'));
  }
  if (collisionRegions.length) {
    nodes.push('[node name="Collisions" type="StaticBody2D" parent="."]');
    collisionRegions.forEach((region, index) => {
      nodes.push([
        `[node name="Collision_${index + 1}" type="CollisionPolygon2D" parent="Collisions"]`,
        `polygon = PackedVector2Array(${region.points.flatMap((point) => [clean(point.x), clean(point.y)]).join(', ')})`,
      ].join('\n'));
    });
  }
  return [
    `[gd_scene load_steps=${layers.length + 1} format=3]`,
    '',
    ...extResources,
    '',
    '[node name="FrameRoninMap" type="Node2D"]',
    ...nodes.flatMap((node) => ['', node]),
    '',
  ].join('\n');
}

export function buildGodotRegionRuntime() {
  return `class_name FrameRoninRegions\n\nextends RefCounted\n\nstatic func load_manifest(path: String = "res://regions.json") -> Dictionary:\n\tvar file := FileAccess.open(path, FileAccess.READ)\n\tif file == null:\n\t\tpush_error("Unable to open FrameRonin region manifest: " + path)\n\t\treturn {}\n\tvar parsed = JSON.parse_string(file.get_as_text())\n\treturn parsed if parsed is Dictionary else {}\n\nstatic func regions_for_layer(manifest: Dictionary, layer: String) -> Array:\n\treturn manifest.get("regions", []).filter(func(region): return region.get("layer", "") == layer)\n`;
}

export async function exportGodotPackage(
  tiles: FrameRoninTile[],
  shapes: RegionShape[],
  sourceWidth: number,
  sourceHeight: number,
  projectName: string,
) {
  const sourceTile = tiles.find((tile) => tile.key === '0,0');
  if (!sourceTile?.images.overall) throw new Error('中心卡片缺少整体层');
  const zip = new JSZip();
  const assets = zip.folder('assets');
  if (!assets) throw new Error('无法创建引擎资源目录');
  const layerCandidates: Array<MapDisplayLayer | 'top'> = ['overall', 'surface', 'object', 'mask'];
  if (shapes.some((shape) => shape.layer === 'top')) layerCandidates.push('top');
  const exportedLayers: Array<MapDisplayLayer | 'top'> = [];
  let primary: Awaited<ReturnType<typeof renderStitchedMap>> | null = null;

  for (const layer of layerCandidates) {
    if (!shouldExportLayer(layer, tiles, shapes)) continue;
    const rendered = await renderStitchedMap(tiles, layer, shapes, sourceWidth, sourceHeight);
    primary ??= rendered;
    assets.file(`map_${layer}.png`, await canvasToBlob(rendered.canvas));
    exportedLayers.push(layer);
  }
  if (!primary) throw new Error('地图中没有可导出的整体层');
  const manifest = buildRegionManifest(tiles, shapes, sourceWidth, sourceHeight, {
    originX: primary.originX,
    originY: primary.originY,
    width: primary.width,
    height: primary.height,
  });
  zip.file('regions.json', JSON.stringify(manifest, null, 2));
  zip.file('map_export.json', JSON.stringify({
    format: 'frame-ronin-engine-package',
    version: 1,
    target: 'godot',
    generatedAt: new Date().toISOString(),
    layers: exportedLayers,
    source: { width: sourceWidth, height: sourceHeight },
    canvas: manifest.canvas,
  }, null, 2));

  zip.file('project.godot', '[application]\nconfig/name="FrameRonin Map"\nrun/main_scene="res://map_scene.tscn"\n\n[display]\nwindow/stretch/mode="canvas_items"\n\n[rendering]\ntextures/default_filters/use_nearest_mipmap_filter=false\ntextures/canvas_textures/default_texture_filter=0\n');
  zip.file('map_scene.tscn', buildGodotScene(manifest, exportedLayers));
  zip.file('frame_ronin_regions.gd', buildGodotRegionRuntime());
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const fileName = `${safeFileName(projectName.replace(/\.[^.]+$/, ''))}_godot.zip`;
  downloadBlob(blob, fileName);
  return { blob, fileName, manifest, layers: exportedLayers };
}

function shouldExportLayer(layer: MapDisplayLayer | 'top', tiles: FrameRoninTile[], shapes: RegionShape[]) {
  if (layer === 'mask') return tiles.some((tile) => tile.images.overall && tile.images.object);
  if (layer === 'top') return shapes.some((shape) => shape.layer === 'top');
  return tiles.some((tile) => Boolean(tile.images[layer]));
}

function godotName(layer: string) {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

function clean(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
