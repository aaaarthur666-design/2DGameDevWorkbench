import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { repositoryRoot, findCapability } from './runtime.mjs';
import {
  endpointUrl,
  bearerHeaders,
  requestJson,
  requestBinary,
} from './adapters/http.mjs';
import { listMapProjectRecords, readMapProjectPreview } from './map-projects.mjs';
import { readAssetTrash, trashEntry, updateAssetTrash } from './asset-trash.mjs';
import { assetInputs } from './asset-contract.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const safeId = (value) =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_-]*$/i.test(value);
const imageExt = /\.(png|gif|jpe?g|webp)$/i;
const statusLabels = {
  saved: '已保存',
  review_required: '待检查',
  approved: '已检查，可导出',
  exported: '已导出',
  failed: '保留画面，需处理',
};
const route = (manifest, capabilityId) =>
  manifest.capabilities.find((c) => c.id === capabilityId)?.ui?.route;
async function confined(root, file) {
  const [base, resolved] = await Promise.all([realpath(root), realpath(file)]);
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('文件越过资产目录。');
  return resolved;
}
async function readJson(file, maxBytes = 64 * 1024 * 1024) {
  if ((await stat(file)).size > maxBytes) throw new Error('记录超过读取上限。');
  return JSON.parse(await readFile(file, 'utf8'));
}
function connection(manifest) {
  const { connector } = findCapability(manifest, 'sprite-generator');
  return {
    base: process.env[connector.urlEnv] || connector.defaultUrl,
    headers: bearerHeaders(process.env[connector.tokenEnv]),
  };
}
async function nativeRequest(manifest, suffix) {
  const c = connection(manifest);
  return requestJson(endpointUrl(c.base, suffix), {
    headers: c.headers,
    timeoutMs: 10000,
  });
}
async function taskFile(manifest, task, file, withHash = false) {
  const entry = {
    key: file,
    name: path.basename(file),
    path: file,
    available: false,
  };
  try {
    if (!task.outputs.includes(file) || !safeId(task.id))
      throw new Error('未登记的文件。');
    const outputRoot = path.resolve(
      repositoryRoot,
      manifest.workspace.outputDirectory,
    );
    const taskRoot = await confined(outputRoot, path.join(outputRoot, task.id));
    const resolved = await confined(
      taskRoot,
      path.resolve(repositoryRoot, file),
    );
    const info = await stat(resolved);
    const maxBytes = (task.exportId || task.projectId) ? 512 * 1024 * 1024 : 64 * 1024 * 1024;
    if (!info.isFile() || info.size > maxBytes)
      throw new Error('文件不可读取。');
    Object.assign(entry, {
      available: true,
      bytes: info.size,
      absolutePath: resolved,
    });
    if (withHash || task.projectId) {
      entry.sha256 = hash(await readFile(resolved));
      if (task.projectId && entry.sha256 !== task.sha256) throw new Error('地图工程文件已变化。');
    }
  } catch {
    entry.available = false;
    entry.issue = '文件缺失、过大或不在此任务目录中。';
  }
  return entry;
}
async function records(manifest, issues) {
  const directory = path.resolve(
    repositoryRoot,
    manifest.workspace.taskDirectory,
  );
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (e) {
    if (e.code !== 'ENOENT')
      issues.push({ source: 'runtime', message: '本地任务目录暂不可读。' });
    return [];
  }
  const tasks = [];
  for (const entry of entries.filter(
    (e) => e.isFile() && /^[a-z0-9][a-z0-9_-]*\.json$/i.test(e.name),
  )) {
    try {
      const task = await readJson(
        await confined(directory, path.join(directory, entry.name)),
      );
      if (
        !safeId(task.id) ||
        entry.name !== `${task.id}.json` ||
        !Array.isArray(task.outputs) ||
        !task.input
      )
        throw new Error();
      tasks.push(task);
    } catch {
      issues.push({
        source: 'runtime',
        record: entry.name,
        message: '记录损坏或过大，未纳入资产目录。',
      });
    }
  }
  return tasks.sort(
    (a, b) =>
      (a.updatedAt || '').localeCompare(b.updatedAt || '') ||
      a.id.localeCompare(b.id),
  );
}
// Scene exports have their own durable records, not fabricated production tasks.
async function sceneRecords(manifest, issues) {
  const directory = path.resolve(repositoryRoot, manifest.workspace.sceneExportDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (e) {
    if (e.code !== 'ENOENT') issues.push({ source: 'scene-exports', message: '场景导出目录暂不可读。' });
    return [];
  }
  const rows = [];
  for (const entry of entries.filter((e) => e.isFile() && /^scene-export-[a-z0-9_-]+\.json$/i.test(e.name))) {
    try {
      const record = await readJson(await confined(directory, path.join(directory, entry.name)), 1024 * 1024);
      if (!safeId(record.exportId) || entry.name !== `${record.exportId}.json` ||
          typeof record.sceneId !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(record.sceneId) ||
          !Number.isInteger(record.revision) || record.revision < 0 || record.status !== 'completed' ||
          !Array.isArray(record.outputs) || !record.outputs.every((p) => typeof p === 'string')) throw new Error();
      const files = ['scene-source.zip', 'scene-godot.zip'].map((name) => `${manifest.workspace.outputDirectory}/${record.exportId}/${name}`);
      if (!files.every((f) => record.outputs.includes(f))) throw new Error();
      rows.push({ ...record, id: record.exportId, outputs: files });
    } catch {
      issues.push({ source: 'scene-exports', record: entry.name, message: '场景导出记录损坏或身份不匹配。' });
    }
  }
  return rows.sort((a, b) => a.exportId.localeCompare(b.exportId));
}

async function sceneMetadata(manifest, record) {
  if (typeof record.sceneName === 'string') return record;
  // Legacy exports did not persist display metadata. Read it from their saved source ZIP.
  const file = await taskFile(manifest, record, record.outputs[0]);
  if (!file.available) return {};
  const zip = await JSZip.loadAsync(await readFile(file.absolutePath));
  const source = zip.file('scene.json');
  if (!source || source._data.uncompressedSize > 8 * 1024 * 1024) throw new Error('场景元数据不可读取。');
  const scene = JSON.parse(await source.async('string'));
  if (scene.format !== 'workbench-scene' || scene.id !== record.sceneId || scene.revision !== record.revision) throw new Error('场景身份不匹配。');
  return {
    sceneName: typeof scene.name === 'string' ? scene.name : undefined,
    instanceCount: Array.isArray(scene.instances) ? scene.instances.length : undefined,
    materialCount: Array.isArray(scene.materials) ? scene.materials.length : undefined,
    mapName: typeof scene.map?.name === 'string' ? scene.map.name : undefined,
  };
}

function localRecord(catalog, asset) {
  return asset.origin === 'map-project' ? catalog.mapById.get(asset.projectId) : asset.origin === 'scene-export'
    ? catalog.sceneById.get(asset.exportId)
    : catalog.taskById.get(asset.taskId);
}

const earliest = (...values) => values.filter((v) => typeof v === 'string' && v).sort((a, b) => a.localeCompare(b))[0];

function decorate(manifest, asset) {
  asset.viewPath = `${manifest.agentAssets.assetCatalog.route}?asset=${encodeURIComponent(asset.id)}`;
  asset.viewUrl = new URL(asset.viewPath, manifest.workspace.frontend.url).href;
  asset.previewUrl = `/api/workbench/assets/preview?assetId=${encodeURIComponent(asset.id)}`;
  if (asset.origin === 'map-project') asset.previewUrl += `&projectRevision=${asset.projectRevision}`;
  asset.statusLabel ||= statusLabels[asset.status] || '请查看详情';
  asset.engineValidated = false;
  return asset;
}
async function scan(manifest) {
  const issues = [];
  const assets = new Map();
  const tasks = await records(manifest, issues);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const scenes = await sceneRecords(manifest, issues);
  const maps = await listMapProjectRecords(repositoryRoot, manifest, issues);
  const mapById = new Map(maps.map((m) => [m.projectId, m]));
  const sceneById = new Map(scenes.map((s) => [s.exportId, s]));
  const native = await nativeRequest(manifest, '/v1/artworks').catch(
    () => null,
  );
  if (!Array.isArray(native?.data?.assets))
    issues.push({
      source: 'sprite-pipeline',
      message:
        '序列帧资产接口离线或版本过旧；当前仅展示本地已保存记录，请勿据此判断原生资产不存在。',
    });
  else issues.push(...(native.data.issues || []));
  const transfers = new Map();
  const jobTasks = new Map();
  const jobRecords = new Map();
  for (const task of tasks) {
    const jobId = task.adapter?.remoteJobId || task.input.jobId;
    if (jobId && task.capabilityId === 'sprite-generator' && task.input.provider !== 'fixture' &&
        task.input.characterId !== 'diagnostic_dummy' && !task.input.diagnosticOnly)
      jobRecords.set(jobId, [...(jobRecords.get(jobId) || []), task]);
  }
  const objectHistory = new Map();
  const put = (a) => assets.set(a.id, a);
  for (const task of tasks) {
    if (
      task.input.provider === 'fixture' ||
      task.input.characterId === 'diagnostic_dummy' ||
      task.input.diagnosticOnly
    )
      continue;
    if (task.capabilityId === 'sprite-generator') {
      const jobId = task.adapter?.remoteJobId || task.input.jobId;
      if (jobId) jobTasks.set(jobId, [...(jobTasks.get(jobId) || []), task.id]);
    }
    if (!task.outputs.length) continue;
    let result = {};
    const resultPath = task.outputs.find((p) => p.endsWith('/result.json'));
    if (resultPath) {
      const f = await taskFile(manifest, task, resultPath);
      if (f.available) {
        try {
          result = await readJson(f.absolutePath, 8 * 1024 * 1024);
        } catch {
          issues.push({
            source: 'runtime',
            record: task.id,
            message: '结果元数据不可读取。',
          });
        }
      }
    }
    if (
      task.capabilityId === 'reference-art' &&
      task.input.operation === 'transfer' &&
      task.status === 'completed' &&
      result.characterId
    ) {
      transfers.set(result.characterId, {
        sourceTaskId: task.input.sourceTaskId,
        taskId: task.id,
      });
      continue;
    }
    const base = {
      taskId: task.id,
      taskIds: [task.id],
      origin: 'runtime',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      status: 'saved',
      files: task.outputs,
      hasArtwork: true,
    };
    if (
      task.capabilityId === 'reference-art' &&
      task.input.operation === 'generate'
    ) {
      const primary = task.outputs.find((p) => p.endsWith('/reference.png'));
      if (primary)
        put({
          ...base,
          id: `reference:${task.id}`,
          kind: 'character',
          title: task.input.name || '角色原图',
          primary,
          width: result.width,
          height: result.height,
          facing: task.input.facing || 'right',
          editorPath: `${route(manifest, task.capabilityId)}?task=${encodeURIComponent(task.id)}`,
        });
    }
    if (
      task.capabilityId === 'sprite-generator' &&
      result.jobId &&
      result.jobRecord?.request?.provider !== 'fixture' &&
      !result.jobRecord?.request?.motion_repair &&
      result.jobRecord?.character?.character_id !== 'diagnostic_dummy'
    ) {
      for (const candidate of result.candidates || []) {
        const ci = candidate.candidateIndex;
        const prefix = `/frames/candidate-${String(ci).padStart(2, '0')}/`;
        const frames = task.outputs
          .filter((p) => p.includes(prefix) && p.endsWith('.png'))
          .sort();
        if (!frames.length) continue;
        const exported = result.jobRecord?.export?.candidate_index === ci;
        const preview =
          exported && task.outputs.find((p) => p.endsWith('/preview.gif'));
        const id = `animation:${result.jobId}:${ci}`;
        const previous = assets.get(id);
        const relatedTasks = jobRecords.get(result.jobId) || [];
        put({
          ...base,
          id,
          createdAt: result.jobRecord?.created_at || earliest(previous?.createdAt, ...relatedTasks.map((t) => t.createdAt), task.createdAt),
          taskIds: [...new Set([...(previous?.taskIds || []), ...relatedTasks.map((t) => t.id), task.id])],
          kind: 'animation',
          title: `${result.jobRecord?.character?.display_name || task.input.characterId || '角色'} · ${result.jobRecord?.action?.display_name || task.input.actionId || '动作'}`,
          jobId: result.jobId,
          characterId: result.jobRecord?.character?.character_id,
          actionId: result.jobRecord?.action?.action_id,
          candidateIndex: ci,
          candidateCount: result.candidates.length,
          frameCount: frames.length,
          fps: result.jobRecord?.action?.fps,
          loop: result.jobRecord?.action?.loop,
          primary: preview || frames[0],
          files: [
            ...frames,
            ...(exported
              ? task.outputs.filter((p) =>
                  /\/(preview\.gif|sprite-sheet\.png|sprite-frames\.godot\.zip)$/.test(p),
                )
              : []),
          ],
          status: exported ? 'exported' : candidate.status,
          freshness: 'saved_snapshot',
          editorPath: `${route(manifest, task.capabilityId)}?job=${encodeURIComponent(result.jobId)}&candidate=${ci}`,
        });
      }
    }
    if (
      task.capabilityId === 'interactable-editor' &&
      task.status === 'completed'
    ) {
      const project = task.input.project;
      const primary = task.outputs.find((p) =>
        p.endsWith('/interactable-project.json'),
      );
      if (!project?.projectId || !primary) continue;
      // A full save replaces that project's current object set; subset exports do not remove siblings.
      if (task.input.operation === 'save-project')
        for (const [id, a] of assets)
          if (a.kind === 'interactable' && a.projectId === project.projectId)
            assets.delete(id);
      const selected = task.input.selectedDefinitionIds;
      for (const o of project.objects || []) {
        if (selected?.length && !selected.includes(o.definitionId)) continue;
        const id = `interactable:${project.projectId}:${o.definitionId}`;
        const previous = objectHistory.get(id);
        const history = {
          createdAt: earliest(previous?.createdAt, task.createdAt),
          taskIds: [...new Set([...(previous?.taskIds || []), task.id])],
        };
        objectHistory.set(id, history);
        put({
          ...base,
          ...history,
          id,
          kind: 'interactable',
          projectId: project.projectId,
          definitionId: o.definitionId,
          title: o.displayName || project.name,
          width: o.visual?.width,
          height: o.visual?.height,
          behavior: o.behavior?.kind,
          hasArtwork: Boolean(o.visual?.assetId),
          visualAssetId: o.visual?.assetId || null,
          primary,
          status:
            task.input.operation === 'export-godot' ? 'exported' : 'saved',
          editorPath: `${route(manifest, task.capabilityId)}?task=${encodeURIComponent(task.id)}&object=${encodeURIComponent(o.definitionId)}`,
        });
      }
    }
  }
  for (const row of native?.data?.assets || []) {
    if (
      !['character', 'animation'].includes(row.kind) ||
      typeof row.id !== 'string'
    )
      continue;
    const previous = assets.get(row.id);
    const editorPath = row.jobId
      ? `${route(manifest, 'sprite-generator')}?job=${encodeURIComponent(row.jobId)}&candidate=${row.candidateIndex}`
      : row.characterId
        ? `${route(manifest, 'sprite-generator')}?character=${encodeURIComponent(row.characterId)}`
        : undefined;
    put({
      ...previous,
      ...row,
      createdAt: row.createdAt || previous?.createdAt,
      origin: 'sprite-pipeline',
      freshness: 'live',
      nativeId: row.id,
      editorPath,
      taskIds: [...new Set([...(previous?.taskIds || []), ...(jobTasks.get(row.jobId) || [])])],
      files: undefined,
    });
  }
  for (const [characterId, transfer] of transfers) {
    const a = assets.get(`reference:${transfer.sourceTaskId}`);
    const nativeAsset = assets.get(`character:${characterId}`);
    if (a) {
      a.characterId = characterId;
      a.aliases = [`character:${characterId}`];
      a.taskIds.push(transfer.taskId);
      if (nativeAsset) {
        a.relatedNativeId = nativeAsset.id;
        assets.delete(nativeAsset.id);
      }
    }
  }
  for (const record of maps) {
    const files = await Promise.all(record.outputs.map((file) => taskFile(manifest, record, file)));
    const previewAvailable = record.preview && await readMapProjectPreview(repositoryRoot, manifest, record).then(() => true, () => false);
    put({ id: `map-project:${record.projectId}`, kind: 'map', origin: 'map-project',
      projectId: record.projectId, projectRevision: record.revision, title: record.title,
      tileCount: record.tileCount, createdAt: record.createdAt, updatedAt: record.updatedAt,
      status: 'saved', files: record.outputs, primary: record.outputs[0], hasArtwork: true,
      previewKind: previewAvailable ? 'image' : 'none', availability: files.every((f) => f.available) ? 'available' : 'missing',
      manualWorkflow: true, taskIds: [],
      editorPath: `${route(manifest, 'map-stitcher')}?map=${encodeURIComponent(record.projectId)}&saved=1`,
    });
  }
  for (const record of scenes) {
    let metadata = {};
    try { metadata = await sceneMetadata(manifest, record); }
    catch { issues.push({ source: 'scene-exports', record: record.exportId, message: '场景源包元数据不可读取，请检查源文件。' }); }
    const files = await Promise.all(record.outputs.map((file) => taskFile(manifest, record, file)));
    put({
      id: `scene:${record.exportId}`,
      kind: 'scene',
      origin: 'scene-export',
      exportId: record.exportId,
      sceneId: record.sceneId,
      sceneRevision: record.revision,
      title: metadata.sceneName || `完整场景 · ${record.sceneId}`,
      instanceCount: metadata.instanceCount,
      materialCount: metadata.materialCount,
      mapName: metadata.mapName,
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
      status: 'exported',
      files: record.outputs,
      primary: record.outputs[0],
      hasArtwork: true,
      previewKind: 'none',
      availability: files.every((f) => f.available) ? 'available' : 'missing',
      taskIds: [],
    });
  }
  for (const a of assets.values()) {
    if (a.origin === 'runtime') {
      const f = await taskFile(manifest, taskById.get(a.taskId), a.primary);
      a.availability = f.available ? 'available' : 'missing';
      a.previewKind = a.primary.endsWith('.gif')
        ? 'animation'
        : a.kind === 'interactable'
          ? 'none'
          : 'image';
    }
    decorate(manifest, a);
  }
  const trash = await readAssetTrash(manifest);
  for (const asset of assets.values()) {
    const entry = trashEntry(trash, asset);
    if (entry) asset.trashedAt = entry.trashedAt;
  }
  for (const entry of trash.entries) {
    if (![...assets.values()].some((asset) => trashEntry({ entries: [entry] }, asset))) {
      assets.set(entry.asset.id, { ...entry.asset, trashedAt: entry.trashedAt, availability: 'unknown', sourceUnavailable: true });
    }
  }
  return {
    assets: [...assets.values()],
    taskById,
    sceneById,
    mapById,
    coverage: {
      complete: issues.length === 0,
      runtimeRecords: tasks.length,
      sceneExportRecords: scenes.length,
      mapProjectRecords: maps.length,
      nativeAvailable: Boolean(native?.data?.assets),
      browserDrafts: 'not_indexed',
      issues,
      note: '地图仅收录已保存到本机服务的完整可编辑工程，不收录单张生成、扩展、拼接或导入图片。旧浏览器地图草稿需在原浏览器打开并保存后收录。浏览器独有的场景、交互物草稿和下载文件不自动收录；地图制作仍由人工操作。',
    },
  };
}
function publicRow(a) {
  const {
    primary: _primary,
    files: _files,
    nativeId: _nativeId,
    visualAssetId: _visualAssetId,
    ...row
  } = a;
  return row;
}
export async function listAssets(manifest, input) {
  const q = assetInputs.assets.parse(input);
  const catalog = await scan(manifest);
  const snapshot = hash(
    JSON.stringify(
      catalog.assets.map((a) => [a.id, a.updatedAt, a.status, a.availability, a.trashedAt]),
    ) + JSON.stringify(catalog.coverage),
  );
  if (q.snapshot && q.snapshot !== snapshot)
    throw new Error('资产目录已变化，请从第一页重新查询以避免漏项。');
  const rows = catalog.assets.filter(
    (a) =>
      (q.scope === 'trashed' ? Boolean(a.trashedAt) : !a.trashedAt) &&
      (!q.kind || a.kind === q.kind) &&
      (!q.query ||
        `${a.title} ${a.id} ${a.characterId || ''} ${a.actionId || ''}`
          .toLowerCase()
          .includes(q.query.toLowerCase())) &&
      [
        'characterId',
        'actionId',
        'candidateIndex',
        'candidateCount',
        'status',
        'availability',
      ].every((k) => q[k] === undefined || a[k] === q[k]),
  );
  rows.sort(
    (a, b) =>
      (b[q.sortBy] || '').localeCompare(a[q.sortBy] || '') ||
      a.id.localeCompare(b.id),
  );
  const next = q.offset + q.limit;
  return {
    schemaVersion: 1,
    assets: rows.slice(q.offset, next).map(publicRow),
    total: rows.length,
    snapshot,
    nextOffset: next < rows.length ? next : null,
    coverage: catalog.coverage,
    createsTask: false,
  };
}
async function detail(manifest, catalog, assetId) {
  const a = catalog.assets.find(
    (a) => a.id === assetId || a.aliases?.includes(assetId),
  );
  if (!a)
    throw new Error(
      catalog.coverage.complete
        ? '所选资产不存在，请重新查询目录。'
        : '当前可读取的目录中未找到该资产；部分来源离线或不可读，不能据此判断资产已删除。',
    );
  if (a.sourceUnavailable) return { ...publicRow(a), files: [], readiness: { filesAvailable: false, issues: ['素材来源暂不可读取，仍可从回收站恢复；恢复不会修复丢失的文件。'] } };
  let fields = {};
  let files;
  if (a.origin === 'sprite-pipeline') {
    fields = (
      await nativeRequest(
        manifest,
        `/v1/artworks/${encodeURIComponent(a.nativeId)}`,
      )
    ).data.asset;
    if (fields.id !== a.id) throw new Error('原生资产身份不匹配。');
    files = fields.files;
  } else {
    const task = localRecord(catalog, a);
    files = await Promise.all(
      a.files
        .filter(
          (f) => !f.endsWith('/result.json') && !f.includes('diagnostics'),
        )
        .map((f) => taskFile(manifest, task, f, true)),
    );
    const primary = files.find((f) => f.key === a.primary);
    if (primary?.available && imageExt.test(primary.name)) {
      try {
        const m = await sharp(primary.absolutePath).metadata();
        fields = { width: m.width, height: m.height };
      } catch {
        primary.available = false;
        primary.issue = '图片损坏。';
      }
    }
  }
  const issues = [];
  if (files.some((f) => !f.available))
    issues.push('部分源文件缺失或不可读取。');
  if (a.kind === 'animation' && a.status !== 'exported')
    issues.push(
      a.status === 'approved'
        ? '动画已检查，尚未导出。'
        : '动画尚未完成检查与导出。',
    );
  if (a.kind === 'interactable' && !a.hasArtwork)
    issues.push('此交互物只有逻辑，尚未绑定外观美术。');
  if (a.kind === 'map')
    issues.push('完整地图草稿，可打开继续编辑；下载提供 map-source.zip，未自动生成 PNG、PSD 或 Godot 包。');
  if (a.kind === 'scene')
    issues.push('已保存场景源包和 Godot 包；请将源包导入场景组装器继续编辑，引擎运行效果尚未验证。');
  const asset = {
    ...publicRow(a),
    ...fields,
    history: (a.taskIds || []).map((id) => catalog.taskById.get(id)).filter(Boolean).map((task) => ({
      taskId: task.id,
      operation: task.input.operation,
      createdAt: task.createdAt,
      status: task.status,
      viewPath: `/advanced?tab=records&task=${encodeURIComponent(task.id)}`,
    })),
    files,
    readiness: {
      filesAvailable: files.every((f) => f.available),
      engineValidated: false,
      issues,
    },
  };
  asset.revision = hash(
    JSON.stringify(files.map((f) => [f.key, f.sha256 || null, f.available])),
  );
  return asset;
}
export async function getAsset(manifest, input) {
  const { assetId } = assetInputs.asset.parse(input);
  const catalog = await scan(manifest);
  return {
    asset: await detail(manifest, catalog, assetId),
    coverage: catalog.coverage,
    createsTask: false,
  };
}
export async function assetManifest(manifest, input) {
  const q = assetInputs['asset-manifest'].parse(input);
  const catalog = await scan(manifest);
  const assets = [];
  for (const id of new Set(q.assetIds)) {
    const a = await detail(manifest, catalog, id);
    if (!assets.some((row) => row.id === a.id)) assets.push(a);
  }
  const value = {
    format: 'forge-asset-manifest',
    schemaVersion: 1,
    projectName: q.projectName,
    generatedAt: new Date().toISOString(),
    assets,
    coverage: catalog.coverage,
    engineValidated: false,
  };
  const escape = (s) => String(s).replace(/[\r\n|<>]/g, ' ');
  const markdown =
    `# ${escape(q.projectName)}\n\n${assets.length} 件已选资产。清单引用已有文件；未复制素材或验证游戏引擎。\n\n| 资产 | 类型 | 状态 | 文件 | 待处理 |\n| --- | --- | --- | --- | --- |\n` +
    assets
      .map(
        (a) =>
          `| ${escape(a.title)}${a.candidateIndex ? ` · 候选 ${a.candidateIndex}` : ''} | ${a.kind} | ${escape(a.statusLabel)} | ${a.files.filter((f) => f.available).length}/${a.files.length} | ${escape(a.readiness.issues.join('；')) || '—'} |`,
      )
      .join('\n') +
    '\n\n' +
    catalog.coverage.note +
    '\n';
  return {
    manifest: value,
    markdown,
    createsTask: false,
    summary: `已整理 ${assets.length} 件资产的交接清单；未修改源文件。`,
  };
}
export async function readAssetPreview(manifest, assetId, projectRevision) {
  const catalog = await scan(manifest);
  const a = catalog.assets.find((a) => a.id === assetId);
  if (!a) throw new Error('资产预览不存在。');
  if (a.origin === 'map-project') {
    if (projectRevision !== undefined && String(a.projectRevision) !== String(projectRevision)) throw new Error('地图工程版本已更新，请刷新资产库。');
    return readMapProjectPreview(repositoryRoot, manifest, localRecord(catalog, a));
  }
  if (a.origin === 'sprite-pipeline') {
    const c = connection(manifest);
    const result = await requestBinary(
      endpointUrl(
        c.base,
        `/v1/artworks/file?${new URLSearchParams({ asset_id: a.nativeId, key: 'preview' })}`,
      ),
      { headers: c.headers, maxBytes: 40 * 1024 * 1024, timeoutMs: 10000 },
    );
    if (!/^image\/(png|gif|jpeg|webp)(;|$)/i.test(result.contentType))
      throw new Error('不是可预览的图片。');
    return { bytes: result.buffer, mime: result.contentType };
  }
  if (!imageExt.test(a.primary)) throw new Error('此资产没有图像预览。');
  const f = await taskFile(manifest, localRecord(catalog, a), a.primary);
  if (!f.available) throw new Error('资产图片缺失。');
  return {
    bytes: await readFile(f.absolutePath),
    mime: a.primary.endsWith('.gif') ? 'image/gif' : 'image/png',
  };
}

// Download saved material bytes; this does not run the production/export adapter.
function archiveFiles(asset, source) {
  return asset.files.flatMap((file) => {
    let name;
    if (asset.kind === 'animation') {
      const frame =
        /^frame-(\d+)$/.exec(file.key) ||
        (source.origin === 'runtime'
          ? /^frame[_-](\d+)\.png$/i.exec(file.name)
          : null);
      if (frame && file.key !== 'source')
        name = `frames/frame_${frame[1].padStart(3, '0')}.png`;
      else if (file.key === 'sheet' || file.name === 'sprite-sheet.png')
        name = 'export/sprite-sheet.png';
      else if (file.key === 'export-preview') name = 'export/preview.gif';
      else if (file.key === 'godot' || file.name === 'sprite-frames.godot.zip') name = 'godot/sprite-frames.zip';
      else if (file.name.endsWith('.gif')) name = 'preview.gif';
    } else if (source.origin === 'map-project') {
      if (file.name === 'map-source.zip') name = file.name;
    } else if (asset.kind === 'character' || asset.kind === 'map') {
      if (file.key === 'source' || file.key === source.primary)
        name = `${asset.kind === 'character' ? 'reference' : 'map'}${path.extname(file.name).toLowerCase()}`;
      else if (asset.kind === 'map' && file.name.endsWith('.zip'))
        name = file.name;
    } else if (asset.kind === 'scene') {
      if (file.name === 'scene-source.zip' || file.name === 'scene-godot.zip') name = file.name;
    } else if (asset.kind === 'interactable') {
      if (
        file.name.endsWith('.zip') ||
        file.name === 'interactable-project.json' ||
        imageExt.test(file.name)
      )
        name = file.name;
    }
    return name ? [{ file, name }] : [];
  });
}

export async function buildAssetArchive(manifest, input) {
  const { assetIds } = assetInputs['asset-manifest'].parse(input);
  const catalog = await scan(manifest);
  const zip = new JSZip();
  const seen = new Set();
  const lines = [
    'Forge 素材包',
    '',
    '每个文件夹对应一件所选资产。PNG 帧按文件名顺序播放；已有引擎包可另行解压。',
    '这些是当前保存的素材，下载不会执行生成、审核或引擎导出。',
    '',
  ];
  let totalBytes = 0;
  let fileCount = 0;
  const maxMB = assetIds.some((id) => catalog.assets.some((a) => a.id === id && ['scene', 'map'].includes(a.kind))) ? 768 : 128;
  const maxBytes = maxMB * 1024 * 1024;
  for (const id of new Set(assetIds)) {
    const asset = await detail(manifest, catalog, id);
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    const source = catalog.assets.find((a) => a.id === asset.id);
    const files = archiveFiles(asset, source);
    const title = `${asset.title}${asset.candidateIndex ? ` · 候选 ${asset.candidateIndex}` : ''}`;
    if (!files.length)
      throw new Error(
        `${title}：暂无可下载的素材文件，请回到原工具保存或导出。`,
      );
    const label =
      title
        .replace(/[^\p{L}\p{N} _·（）()-]/gu, '_')
        .slice(0, 60)
        .replace(/[. ]+$/, '') || 'asset';
    const folder = `${asset.kind}/${label}-${hash(asset.id).slice(0, 8)}`;
    const names = new Set();
    for (const { file, name } of files) {
      if (!file.available || !file.sha256)
        throw new Error(
          `${title}：${file.name} 缺失或不可读取，请检查源文件后重试。`,
        );
      if (totalBytes + file.bytes > maxBytes)
        throw new Error(`所选素材超过 ${maxMB} MB，请减少选择后分批下载。`);
      let bytes;
      if (source.origin === 'sprite-pipeline') {
        const c = connection(manifest);
        ({ buffer: bytes } = await requestBinary(
          endpointUrl(
            c.base,
            `/v1/artworks/file?${new URLSearchParams({ asset_id: source.nativeId, key: file.key })}`,
          ),
          {
            headers: c.headers,
            maxBytes: Math.min(64 * 1024 * 1024, maxBytes - totalBytes),
            timeoutMs: 30000,
          },
        ));
      } else {
        const resolved = await taskFile(
          manifest,
          localRecord(catalog, source),
          file.key,
        );
        if (!resolved.available)
          throw new Error(
            `${title}：${file.name} 已无法读取，请刷新资产库后重试。`,
          );
        bytes = await readFile(resolved.absolutePath);
      }
      if (hash(bytes) !== file.sha256)
        throw new Error(`${title}：文件在打包期间发生变化，请刷新后重新下载。`);
      totalBytes += bytes.length;
      if (totalBytes > maxBytes)
        throw new Error(`所选素材超过 ${maxMB} MB，请减少选择后分批下载。`);
      // Entry names are derived from known roles, never filesystem paths supplied by a client.
      if (
        name.includes('..') ||
        name.includes('\\') ||
        name.startsWith('/') ||
        names.has(name)
      )
        throw new Error('素材文件名称冲突，请回到原工具检查。');
      names.add(name);
      zip.file(`${folder}/${name}`, bytes);
      fileCount++;
    }
    const info = [
      title,
      `状态：${asset.statusLabel}`,
      asset.width ? `尺寸：${asset.width} × ${asset.height}` : '',
      asset.frameCount ? `帧数：${asset.frameCount}` : '',
      asset.fps ? `播放速度：${asset.fps} FPS` : '',
      asset.kind === 'scene' ? `场景版本：${asset.sceneRevision}；导出记录：${asset.exportId}` : '',
      ...(asset.readiness?.issues || []),
    ]
      .filter(Boolean)
      .join('\n');
    zip.file(`${folder}/素材说明.txt`, info + '\n');
    lines.push(`${folder} — ${files.length} 个素材文件`);
  }
  zip.file('使用说明.txt', lines.join('\n') + '\n');
  return {
    bytes: await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE',
    }),
    filename: 'forge-assets.zip',
    assetCount: seen.size,
    fileCount,
  };
}

// Management never prepares a production task or modifies shared source files.
export async function manageAssets(manifest, input) {
  const { operation, assetIds } = assetInputs['asset-manage'].parse(input);
  return updateAssetTrash(manifest, async (index) => {
    const needsCatalog = operation === 'trash' || assetIds.some((id) => !index.entries.some((entry) => entry.ids.includes(id)));
    const catalog = needsCatalog ? await scan(manifest) : null;
    const selected = [...new Set(assetIds)].map((id) => {
      const current = catalog?.assets.find((asset) => asset.id === id || asset.aliases?.includes(id));
      const entry = index.entries.find((entry) => entry.ids.includes(id)) || (current && trashEntry(index, current));
      if (operation === 'restore') {
        if (!entry) throw new Error('所选资产不在回收站，请刷新后重试。');
        return entry.asset;
      }
      const asset = current;
      if (!asset) throw new Error('所选资产当前不可读取，请刷新并核对选择；未更改回收站。');
      return asset;
    });
    const unique = [...new Map(selected.map((asset) => [asset.id, asset])).values()];
    for (const asset of unique) {
      const entry = trashEntry(index, asset);
      if (operation === 'restore') index.entries = index.entries.filter((item) => item !== entry);
      else if (!entry) index.entries.push({ ids: [asset.id, ...(asset.aliases || [])], trashedAt: new Date().toISOString(), asset: publicRow(asset) });
    }
    return { operation, assetIds: unique.map((asset) => asset.id), count: unique.length, createsTask: false, sourceFilesChanged: false };
  });
}
