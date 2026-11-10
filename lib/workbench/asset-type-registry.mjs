// Optional asset types own their implementation imports. Removing a registration
// removes that implementation from the shared catalog/package dependency graph.
export const assetTypeRegistrations = Object.freeze(
  [
    { kind: 'character' },
    { kind: 'prop' },
    { kind: 'animation' },
    {
      kind: 'map',
      coverageKey: 'mapProjectRecords',
      load: () => import('./asset-map-type.mjs'),
    },
    { kind: 'interactable' },
    {
      kind: 'scene',
      coverageKey: 'sceneExportRecords',
      load: () => import('./asset-scene-type.mjs'),
    },
  ].map(Object.freeze),
);

export const registeredAssetKinds = Object.freeze(
  assetTypeRegistrations.map((type) => type.kind),
);

export function assetKindEnabled(manifest, kind) {
  return (
    registeredAssetKinds.includes(kind) &&
    !(manifest.agentAssets?.assetCatalog?.disabledKinds || []).includes(kind)
  );
}

export function requireAssetKind(manifest, kind) {
  if (!assetKindEnabled(manifest, kind))
    throw new Error(`素材类型未启用：${kind}`);
}

export async function assetTypeExtensions(manifest) {
  return Promise.all(
    assetTypeRegistrations
      .filter((type) => type.load && assetKindEnabled(manifest, type.kind))
      .map(async (type) => ({ ...type, implementation: await type.load() })),
  );
}

export async function assetTypeExtension(manifest, kind) {
  requireAssetKind(manifest, kind);
  return assetTypeRegistrations.find((type) => type.kind === kind)?.load?.();
}
