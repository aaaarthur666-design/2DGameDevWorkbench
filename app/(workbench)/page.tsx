import { WorkbenchShell } from '@/components/workbench/workbench-shell';
import { workbenchModules } from '@/lib/workbench/modules';

export default function Home() {
  return <WorkbenchShell modules={workbenchModules} />;
}
