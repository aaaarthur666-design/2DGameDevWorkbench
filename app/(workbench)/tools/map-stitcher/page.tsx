import { FrameRoninMapEditor } from '@/components/map-stitcher/frame-ronin-map-editor';

export default async function MapStitcherPage({ searchParams }: { searchParams: Promise<{ origin?: string }> }) {
  const { origin } = await searchParams;
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <FrameRoninMapEditor initialOriginOpen={origin === 'generate'} />
    </div>
  );
}
