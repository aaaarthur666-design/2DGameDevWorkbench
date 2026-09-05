import { Box, Grid2X2, Images } from 'lucide-react';
import type { WorkbenchModuleIcon } from '@/lib/workbench/modules';

export function ModuleIcon({
  icon,
  className,
}: {
  icon: WorkbenchModuleIcon;
  className?: string;
}) {
  const Icon = icon === 'interactable' ? Box : icon === 'frames' ? Images : Grid2X2;
  return <Icon aria-hidden="true" className={className} />;
}
