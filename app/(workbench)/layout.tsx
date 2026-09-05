import type { ReactNode } from 'react';

import { WorkbenchProvider } from '@/components/workbench/workbench-provider';
import { WorkbenchChrome } from '@/components/workbench/workbench-chrome';
import '@/components/workbench/workbench.css';

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return (
    <WorkbenchProvider><WorkbenchChrome>{children}</WorkbenchChrome></WorkbenchProvider>
  );
}
