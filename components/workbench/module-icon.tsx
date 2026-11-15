import { Box, Images, Paintbrush } from 'lucide-react';
import type { WorkbenchModuleIcon } from '@/lib/workbench/modules';

export function ModuleIcon({
  icon,
  className,
}: {
  icon: WorkbenchModuleIcon;
  className?: string;
}) {
  const Icon = icon === 'reference' ? Paintbrush : icon === 'interactable' ? Box : Images;
  return <Icon aria-hidden="true" className={className} />;
}
