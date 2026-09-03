import { WorkbenchHome } from '@/components/workbench/workbench-home';
import { workbenchModules } from '@/lib/workbench/modules';

export default function Home() {
  return <WorkbenchHome modules={workbenchModules} />;
}
