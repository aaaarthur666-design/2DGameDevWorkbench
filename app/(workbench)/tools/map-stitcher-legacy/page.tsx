import { MapEditor } from '@/components/map-stitcher/map-editor';

export default function LegacyMapStitcherPage() {
  return (
    <div className="h-[calc(100svh-var(--workbench-nav-height))] min-h-0 overflow-hidden">
      <MapEditor />
    </div>
  );
}
