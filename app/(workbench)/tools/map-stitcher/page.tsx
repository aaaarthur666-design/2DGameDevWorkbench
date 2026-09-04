import { FrameRoninMapEditor } from '@/components/map-stitcher/frame-ronin-map-editor';

export default function MapStitcherPage() {
  return (
    <div className="h-[calc(100svh-var(--workbench-nav-height))] min-h-0 overflow-hidden">
      <FrameRoninMapEditor />
    </div>
  );
}
