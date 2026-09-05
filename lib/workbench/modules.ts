import manifest from '@/workbench/manifest.json';

export type WorkbenchModuleIcon = 'frames' | 'map' | 'interactable' | 'reference';

export type WorkbenchModule = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  href: string;
  icon: WorkbenchModuleIcon;
  accent: 'violet' | 'cyan';
  capabilities: readonly string[];
  status: 'ready' | 'beta' | 'planned';
  surface: 'editor' | 'preview';
  productionLine: string;
  entryTitle: string;
  starterHint: string;
  stages: readonly string[];
};

/**
 * The web shell and Agent runner both derive capabilities from the same
 * machine-readable manifest. Tool logic stays behind adapters/connectors.
 */
export const workbenchModules: readonly WorkbenchModule[] =
  manifest.capabilities.map((capability) => ({
    id: capability.id,
    name: capability.name,
    shortName: capability.shortName,
    description: capability.description,
    productionLine: capability.ui.productionLine,
    entryTitle: capability.ui.entryTitle,
    starterHint: capability.ui.starterHint,
    stages: capability.ui.stages,
    href: capability.ui.route,
    icon:
      capability.ui.icon === 'reference'
        ? 'reference'
        : capability.ui.icon === 'interactable'
        ? 'interactable'
        : capability.ui.icon === 'map'
          ? 'map'
          : 'frames',
    accent: capability.ui.accent === 'cyan' ? 'cyan' : 'violet',
    capabilities: capability.ui.capabilities,
    status:
      capability.ui.status === 'planned'
        ? 'planned'
        : capability.ui.status === 'beta'
          ? 'beta'
          : 'ready',
    surface: capability.ui.surface === 'editor' ? 'editor' : 'preview',
  }));

export const productionLines = manifest.productionLines;
