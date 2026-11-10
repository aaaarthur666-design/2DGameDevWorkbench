// Receives the shared collector and reference parser to avoid a module cycle.
export function collectSceneDocumentMedia(content, add, parseDocumentMediaReference) {
  if (content.map) {
    add(content.map, 'source', 'application/zip', '地图源包');
    for (const layer of content.map.layers) add(layer, 'source', 'image/png', layer.name, layer);
  }
  const split = content.mapSplit;
  for (const element of [...(split?.baseline || []), ...(split?.elements || [])])
    for (const part of element.parts) {
      add(part, 'source', 'image/png', element.name, part);
      add(part, 'mask', 'image/png', element.name, part);
    }
  let visitedCount = 0;
  const visited = new WeakSet();
  const visit = (owner, depth = 0) => {
    if (!owner || typeof owner !== 'object') return;
    if (depth > 32 || ++visitedCount > 100000) throw new Error('分层历史媒体结构过深或过大。');
    if (visited.has(owner)) return;
    visited.add(owner);
    for (const [key, value] of Object.entries(owner)) {
      if (typeof value === 'string' && (/^(?:data:image\/png;base64,|media\/[0-9]+\.bin$)/.test(value) || parseDocumentMediaReference(value)))
        add(owner, key, 'image/png', '分层历史媒体');
      else if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(split);
  for (const material of content.materials) for (const asset of material.project.assets) add(asset, 'source', asset.mime, asset.name);
}
