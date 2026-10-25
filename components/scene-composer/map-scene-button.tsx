'use client';
import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkbench } from '@/components/workbench/workbench-provider';
import type { MapEditorController } from '@/components/map-stitcher/use-map-editor-controller';
export function MapSceneButton({ c }: { c: MapEditorController }) {
  const [starting, setStarting] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const { navigate } = useWorkbench();
  useEffect(() => {
    if (!pendingHref || c.busy) return;
    // Let the map workspace publish its completed operation before the navigation save guard runs.
    const timer = setTimeout(() => {
      void navigate(pendingHref).finally(() => {
        setPendingHref(null);
        setStarting(false);
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingHref, c.busy, navigate]);
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
          .then((href) => {
            setPendingHref(href);
          })
          .catch((error) => {
            c.report(error);
            setStarting(false);
          });
      }}
    >
      <Layers />
      {starting ? '准备场景…' : '用于制作场景'}
    </Button>
  );
}
