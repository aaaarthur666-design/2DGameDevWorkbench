'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePanelRef } from 'react-resizable-panels';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  DEFAULT_PANEL_WIDTH,
  MAP_DOCK_MIN_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_CANVAS_WIDTH,
  MIN_PANEL_WIDTH,
  panelWidth,
} from '@/features/map-stitcher/editor-layout';
import type { MapEditorController } from './use-map-editor-controller';

export function MapWorkArea({
  c,
  children,
  inspector,
}: {
  c: MapEditorController;
  children: ReactNode;
  inspector: ReactNode;
}) {
  const { setPanelOpen, setPanelWidth } = c;
  const area = useRef<HTMLDivElement>(null);
  const inspectorRef = usePanelRef();
  const [areaWidth, setAreaWidth] = useState<number | null>(null);
  const docked = areaWidth === null || areaWidth >= MAP_DOCK_MIN_WIDTH;
  const pointerResize = useRef<{ id: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setAreaWidth(element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!docked || !c.panelOpen || !c.layoutReady) return;
    // The group registers conditional panels after the commit. Restore only
    // after registration, and cancel when a breakpoint removes the panel.
    const frame = requestAnimationFrame(() =>
      inspectorRef.current?.resize(c.panelWidth),
    );
    return () => cancelAnimationFrame(frame);
  }, [
    areaWidth,
    docked,
    c.panelOpen,
    c.layoutReady,
    c.panelWidth,
    inspectorRef,
  ]);
  useEffect(() => {
    if (docked || !c.panelOpen) return;
    const drawer = area.current?.querySelector('.map-inspector-drawer');
    const toggle = area.current
      ?.closest('[data-map-editor]')
      ?.querySelector<HTMLButtonElement>('[aria-controls="map-inspector"]');
    const frame = requestAnimationFrame(() =>
      drawer?.querySelector<HTMLButtonElement>('.map-close-panel')?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        !(event.target instanceof Node) ||
        !drawer?.contains(event.target)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setPanelOpen(false);
      toggle?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      if (
        document.activeElement === document.body ||
        drawer?.contains(document.activeElement)
      )
        toggle?.focus();
    };
  }, [docked, c.panelOpen, setPanelOpen]);
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      const start = pointerResize.current;
      if (!start || start.id !== event.pointerId) return;
      pointerResize.current = null;
      const width = inspectorRef.current?.getSize().inPixels;
      if (width && Math.abs(width - start.width) > 0.5)
        setPanelWidth(panelWidth(Math.round(width)));
    };
    const cancel = () => {
      pointerResize.current = null;
    };
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [inspectorRef, setPanelWidth]);
  const resetWidth = () => {
    c.setPanelWidth(DEFAULT_PANEL_WIDTH);
    inspectorRef.current?.resize(DEFAULT_PANEL_WIDTH);
  };
  return (
    <div ref={area} className="map-work-area" data-docked={docked}>
      <ResizablePanelGroup
        orientation="horizontal"
        className="map-panel-group"
        resizeTargetMinimumSize={{ fine: 8, coarse: 24 }}
      >
        <ResizablePanel
          id="map-canvas-panel"
          minSize={docked && c.panelOpen ? MIN_CANVAS_WIDTH : 0}
          className="map-canvas-panel"
        >
          <div className="map-canvas-container" inert={!docked && c.panelOpen}>
            {children}
          </div>
        </ResizablePanel>
        {docked && c.panelOpen && (
          <>
            <ResizableHandle
              withHandle
              className="map-panel-handle"
              aria-label="调整属性栏宽度"
              title="拖动调整宽度 · 方向键调整 · 双击恢复默认"
              onDoubleClick={resetWidth}
              onPointerDown={(event) => {
                const width = inspectorRef.current?.getSize().inPixels;
                if (width)
                  pointerResize.current = { id: event.pointerId, width };
              }}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(
                    event.key,
                  )
                )
                  return;
                const width = inspectorRef.current?.getSize().inPixels;
                if (width) setPanelWidth(panelWidth(Math.round(width)));
              }}
            />
            <ResizablePanel
              id="map-inspector-panel"
              panelRef={inspectorRef}
              defaultSize={c.panelWidth}
              minSize={MIN_PANEL_WIDTH}
              maxSize={MAX_PANEL_WIDTH}
              className="map-inspector-panel"
            >
              {inspector}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      {!docked && c.panelOpen && (
        <div className="map-inspector-drawer">
          <button
            className="map-drawer-backdrop"
            aria-label="关闭属性栏抽屉"
            onClick={() => c.setPanelOpen(false)}
          />
          {inspector}
        </div>
      )}
    </div>
  );
}
