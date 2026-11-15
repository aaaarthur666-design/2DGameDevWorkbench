import { Box, Grid2X2, Images, Paintbrush, Layers } from 'lucide-react';
import type { WorkbenchModuleIcon } from '@/lib/workbench/modules';

export function ModuleIcon({
  icon,
  className,
}: {
  icon: WorkbenchModuleIcon;
  className?: string;
}) {
  const Icon = icon === 'scene' ? Layers : icon === 'reference' ? Paintbrush : icon === 'interactable' ? Box : icon === 'frames' ? Images : Grid2X2;
  return <Icon aria-hidden="true" className={className} />;
}
