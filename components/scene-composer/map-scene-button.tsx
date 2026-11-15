'use client';
import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import type { MapEditorController } from '@/components/map-stitcher/use-map-editor-controller';
export function MapSceneButton({ c }: { c: MapEditorController }) {
  const [starting, setStarting] = useState(false);
  const wb = useWorkbench();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={c.busy || starting || !c.sourceAsset}
      onClick={() => {
        if (starting) return;
        setStarting(true);
        void c
          .composeScene()
          .then(async (href) => {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            await wb.navigate(href);
          })
          .catch(c.report)
          .finally(() => setStarting(false));
      }}
    >
      <Layers />
      {starting ? '准备场景…' : '用于制作场景'}
    </Button>
  );
}
