import { SpritePipelineWorkspace } from '@/components/sprite-generator/sprite-pipeline-workspace';
import { workbenchModules } from '@/lib/workbench/modules';

export default function SpriteGeneratorPage() {
  const spriteModule = workbenchModules.find(
    (candidate) => candidate.id === 'sprite-generator',
  );

  if (!spriteModule) return null;

  return (
    <div className="h-[calc(100svh-var(--workbench-nav-height))] min-h-0 overflow-hidden">
      <SpritePipelineWorkspace module={spriteModule} />
    </div>
  );
}
