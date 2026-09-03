import type { ReactNode } from 'react';

import { WorkbenchNavigation } from '@/components/workbench/workbench-navigation';
import { workbenchModules } from '@/lib/workbench/modules';

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return (
    <div className="workbench-app-shell min-h-svh">
      <WorkbenchNavigation modules={workbenchModules} />
      <div className="workbench-route-shell">{children}</div>
    </div>
  );
}
