/* oxlint-disable next/no-img-element -- Verify the original saved PNG response. */
/* oxlint-disable next/no-html-link-for-pages -- Standalone Vite fixture has no Next router. */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useMapEditorController } from '../../components/map-stitcher/use-map-editor-controller';
import { useMapWorkspace } from '../../components/map-stitcher/use-map-workspace';
import { AssetLibrary } from '../../components/workbench/asset-library';
import { fetchMapProject } from '../../features/map-stitcher/project-client';
import { readWorkspaceDraft } from '../../lib/workbench/browser-store';
import { getEditorSessions } from '../../lib/workbench/editor-session';
import type { MapWorkspaceDraft } from '../../features/map-stitcher/workspace-draft';
import '../../app/globals.css';
import '../../components/workbench/workbench.css';

function Harness() {
  const c = useMapEditorController();
  const workspace = useMapWorkspace(c);
  const latest = useRef(c);
  useLayoutEffect(() => { latest.current = c; });
  const [result, setResult] = useState('正在从服务端恢复完整地图工程…');
  const [previewUrl, setPreviewUrl] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (workspace.loading || !c.sourceAsset || started.current) return;
    started.current = true;
    const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
    const state = async () => (await (await fetch('/__workspace-state')).json()) as {
      record: { revision: number; preview?: { sha256: string } }; writes: number; deniedGeneration: number;
    };
    const waitForSave = async (after: number) => {
      for (let n = 0; n < 150; n++) {
        const current = await state();
        if (current.record.revision > after && getEditorSessions().every((s) => !s.dirty)) return current;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('编辑器自动保存未在 15 秒内完成。');
    };
    void (async () => {
      const initial = await state();
      const first = await waitForSave(initial.record.revision);
      assert(first.record.preview, '旧工程首次保存没有补齐预览');
      assert(latest.current.queueState.paused, '恢复队列未暂停');
      if (new URLSearchParams(location.search).has('resume')) {
        assert(latest.current.tiles[0].feather.left === 35, '从资产卡返回后丢失图片编辑');
        assert(latest.current.pan.x === 123 && latest.current.zoom === 1.5, '从资产卡返回后丢失编辑器视图');
        assert(initial.record.preview?.sha256 === first.record.preview?.sha256, '重新打开后预览与原版本不一致');
        assert(first.deniedGeneration === 0, '恢复队列发起了生成请求');
        setResult('PASS：从资产库项目卡重新打开，图片编辑与视图完整恢复，预览保持一致，队列暂停，生成请求为 0。');
        return;
      }
      setResult('首次自动保存通过，正在验证仅修改视图…');
      latest.current.setPan({ x: 123, y: 456 });
      latest.current.setZoom(1.5);
      const view = await waitForSave(first.record.revision);
      assert(view.record.preview?.sha256 === first.record.preview?.sha256, '视图变化改变了预览');
      setResult('视图变化验证通过，正在验证图片编辑与源包同步…');
      latest.current.setFeather('left', 35);
      const edited = await waitForSave(view.record.revision);
      assert(edited.record.preview?.sha256 !== view.record.preview?.sha256, '图片变化未更新预览');
      const remote = await fetchMapProject(latest.current.workspaceId);
      assert(remote?.snapshot.tiles[0].feather.left === 35, '服务端源工程未保存图片编辑');
      assert(remote?.snapshot.pan.x === 123, '编辑器视图设置未保存');
      const local = await readWorkspaceDraft<MapWorkspaceDraft>(latest.current.workspaceId);
      assert(local?.serverSynced && local.serverRevision === edited.record.revision, '浏览器备份与服务端版本不同步');
      remote?.snapshot.tiles.forEach((tile) => Object.values(tile.images).forEach((a) => a && URL.revokeObjectURL(a.url)));
      const catalog = await (await fetch('/api/workbench/assets?kind=map')).json() as { total: number; assets: { previewUrl: string; previewKind: string }[] };
      assert(catalog.total === 1 && catalog.assets[0].previewKind === 'image', '资产库没有精确收录地图工程预览');
      assert(edited.deniedGeneration === 0, '验收中出现非预期生成请求');
      setPreviewUrl(catalog.assets[0].previewUrl);
      setResult('PASS：实际编辑器恢复 → IndexedDB 备份 → 自动保存 → 视图变化保持预览 → 图片编辑更新预览 → 服务端恢复 → 资产库单件收录。生成请求为 0。');
    })().catch((error) => setResult(`FAIL：${error.message}`));
  }, [workspace.loading, c.sourceAsset]);
  return <main className="wb-page">
    <h1>地图工程保存链路验收</h1>
    <output>{result}</output>
    {workspace.error && <p role="alert">{workspace.error}</p>}
    <p>此页挂载实际地图编辑器控制器和保存 Hook，使用隔离工程与未启用的图片服务。</p>
    {previewUrl && <img src={previewUrl} alt="实际编辑器保存后的地图预览" width={320} height={180} style={{objectFit:'contain'}} />}
    <p><a className="wb-button" href="/assets">查看真实资产库记录</a></p>
  </main>;
}
const catalog = new URLSearchParams(location.search).has('catalog');
createRoot(document.getElementById('root')!).render(catalog ? <AssetLibrary /> : <Harness />);
