import { SpriteWorkspacePreview } from '@/components/sprite-generator/sprite-workspace-preview';
import { workbenchModules } from '@/lib/workbench/modules';

export default function SpriteGeneratorPage() {
  const spriteModule = workbenchModules.find(
    (candidate) => candidate.id === 'sprite-generator',
  );

  if (!spriteModule) return null;

  return <SpriteWorkspacePreview module={spriteModule} />;
}
