import { realpath } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { instanceRect } from '../../features/scene-composer/render-model.mjs';
import { readMapProjectPackage, MAX_MAP_PROJECT_BYTES } from '../../features/map-stitcher/project-package.mjs';
import { listMapProjectRecords, readMapProject, saveMapProject } from './map-projects.mjs';
import { getDocument, saveDocument } from './editor-documents.mjs';
import { inspectSceneImageSource, replaceSceneImageSource } from './image-edit-scene-sources.mjs';
import { readImageAssetSource, MAX_IMAGE_BYTES } from './adapters/image-assets-source.mjs';
import { checkSource, confinedRead, digest, encodeImageTarget, failure, hash, inside, pixels, publicTarget, summary } from './image-edit-target-common.mjs';
import { resolveObjectSlot } from './image-edit-target-interactables.mjs';

async function mapTarget(root, manifest, ref, source) {
  const { record, bytes: packageBytes } = source || await readMapProject(root, manifest, ref.projectId);
  const actualRoot = await realpath(root);
  const outputRoot = await realpath(path.resolve(root, manifest.workspace.outputDirectory));
  const projectRoot = await realpath(path.resolve(root, manifest.workspace.outputDirectory, record.id));
  if (!inside(actualRoot, outputRoot) || !inside(outputRoot, projectRoot)) throw failure('地图图片源目录越过工作区或输出目录。', 400, 'UNSAFE_IMAGE_TARGET_PATH');
  const { draft, images } = await readMapProjectPackage(packageBytes);
  const tile = draft.snapshot.tiles.find(tile => tile.key === ref.tileKey);
  const image = tile?.images[ref.layer];
  if (!image) throw failure('指定地图块中的源图片不存在。', 404, 'IMAGE_TARGET_NOT_FOUND');
  const bytes = Buffer.from(images.get(image.path));
  const info = await pixels(bytes, { width: image.width, height: image.height, mime: image.type, sha256: image.generation?.sha256 });
  const locked = draft.snapshot.imageLocks[ref.layer] === true;
  return { ...summary(ref, info, { revision: record.revision, kind: 'background', name: `${record.title} · ${ref.tileKey} · ${ref.layer}`, locked, editable: !locked, lockScope: { kind: 'image-type-all-tiles', layer: ref.layer }, generation: image.generation, source: { projectId: ref.projectId, tileKey: ref.tileKey, layer: ref.layer, path: image.path, name: image.name, projectSha256: record.sha256 }, viewPath: `/tools/map-stitcher?project=${encodeURIComponent(ref.projectId)}`, dependencies: { preview: 'recompute-on-open', objectExtractionRequired: ['black', 'white'].includes(ref.layer), surfaceIsDraft: tile.surfaceIsDraft ?? false } }), bytes };
}
function sceneInstanceBinding(document, ref) {
  if (document.kind !== 'scene' || document.id !== ref.documentId) throw failure('目标不是指定场景文档。');
  const instance = document.content.instances.find(instance => instance.id === ref.instanceId);
  if (!instance) throw failure('场景实例已不存在。', 404, 'IMAGE_TARGET_NOT_FOUND');
  const material = document.content.materials.find(material => material.id === instance.materialId);
  if (!material || material.project.objects.length !== 1) throw failure('场景实例缺少明确的单物件素材。', 409, 'IMAGE_TARGET_NOT_FOUND');
  const slot = resolveObjectSlot(material.project, material.project.objects[0], ref);
  return { instance, material, ...slot, sharedInstanceCount: document.content.instances.filter(other => other.materialId === material.id).length };
}
async function sceneInstanceTarget(root, manifest, ref, selectedDocument) {
  const document = selectedDocument || (await getDocument(root, manifest, { documentId: ref.documentId })).document;
  const { instance, material, object, entry, asset, animated, inherited, sharedInstanceCount } = sceneInstanceBinding(document, ref);
  const source = await readImageAssetSource(asset.source, root), info = await pixels(source.buffer, { mime: asset.mime, sha256: asset.generation?.sha256 });
  const hasAnimation = animated || (ref.slot === 'visual' && Boolean(object.visual.idleAnimation || object.visual.focusAnimation));
  const slotFingerprint = digest({ instanceId: instance.id, materialId: material.id, definitionId: object.definitionId, slot: ref.slot, index: ref.index, content: entry || object.visual, assetId: asset.id, sha256: info.sha256 });
  const binding = ref.slot === 'visual' ? { imageBindingFingerprint: digest({ definitionId: object.definitionId, instanceId: ref.instanceId, materialId: material.id, slot: ref.slot, assetId: asset.id, sha256: info.sha256 }) } : {};
  return { ...summary(ref, info, { ...binding, revision: document.revision, slotFingerprint, kind: 'prop', name: `${document.name} · ${instance.name} · ${entry?.name || '默认外观'}`,
    locked: instance.locked, editable: !instance.locked && !hasAnimation, ...(hasAnimation ? { readOnlyReason: '场景实例正在使用动画；请在源素材中明确选择静态外观后再局部调整。' } : {}), inherited,
    placement: { ...instanceRect(instance, material), instanceScale: instance.scale, visualScale: object.visual.scale,
      flipH: Boolean(instance.flipH) !== Boolean(object.visual.flipH), flipV: Boolean(object.visual.flipV) },
    scope: 'single-instance', affectedInstanceIds: [instance.id], sharedInstanceCount, generation: asset.generation,
    source: { documentId: document.id, instanceId: instance.id, materialId: material.id, definitionId: object.definitionId, assetId: asset.id, name: asset.name, slot: ref.slot, index: ref.index }, viewPath: document.viewPath }), bytes: source.buffer };
}
async function sceneLayerTarget(root, manifest, ref, selectedDocument) {
  const document = selectedDocument || (await getDocument(root, manifest, { documentId: ref.documentId })).document;
  if (document.kind !== 'scene') throw failure('指定文档不是场景。');
  const selected = document.content.map?.layers.find(layer => layer.id === ref.layerId);
  if (!selected) throw failure('场景地图层不存在。', 404, 'IMAGE_TARGET_NOT_FOUND');
  const image = await inspectSceneImageSource(root, document.content, ref.layerId);
  const info = await pixels(image.bytes, { width: selected.width, height: selected.height });
  const { bytes: _bytes, ...mapping } = image;
  const slotFingerprint = digest({ layerId: selected.id, sourceSha256: image.sourceEntry?.sha256 || hash(document.content.map.source) });
  return { ...summary(ref, info, { ...mapping, revision: document.revision, slotFingerprint, kind: 'background', name: `${document.name} · ${selected.name}`, locked: selected.locked || image.locked,
    placement: { x: document.content.map.origin.x + document.content.map.offset.x, y: document.content.map.origin.y + document.content.map.offset.y,
      width: selected.width, height: selected.height, flipH: false, flipV: false },
    editable: !selected.locked && image.editable, scope: 'scene-snapshot-layer', affectedInstanceIds: [],
    source: { documentId: document.id, layerId: selected.id, name: selected.name }, viewPath: document.viewPath }), bytes: image.bytes };
}
async function splitPartTarget(root,manifest,ref,selectedDocument) {
  const document=selectedDocument || (await getDocument(root,manifest,{documentId:ref.documentId})).document;
  const split=document.content.mapSplit;
  const element=split?.elements.find(item=>item.id===ref.elementId);
  const part=element?.parts.find(item=>item.id===ref.partId);
  if (document.kind!=='scene' || !document.content.map || !part) throw failure('场景分层绘制片不存在。',404,'IMAGE_TARGET_NOT_FOUND');
  const full=Buffer.from(part.source.slice(part.source.indexOf(',')+1),'base64');
  const box=ref.window || {x:0,y:0,width:part.width,height:part.height};
  if (box.x+box.width>part.width || box.y+box.height>part.height) throw failure('局部窗口超出绘制片原图。');
  const tooLarge=box.width>3840 || box.height>3840 || box.width*box.height>8_294_400;
  if (tooLarge && ref.window) throw failure('请选择不超过 8,294,400 像素的局部窗口。');
  const bytes=ref.window ? await sharp(full,{limitInputPixels:64_000_000}).extract({left:box.x,top:box.y,width:box.width,height:box.height}).png().toBuffer() : full;
  let info;
  if (tooLarge && full.length>MAX_IMAGE_BYTES) {
    const raw=await sharp(full,{limitInputPixels:64_000_000}).toColourspace('srgb').ensureAlpha().raw().toBuffer();
    let hasTransparency=false;
    for(let i=3;i<raw.length;i+=4) if(raw[i]<255){hasTransparency=true;break;}
    info={width:box.width,height:box.height,sha256:hash(full),rgbaSha256:hash(raw),mimeType:'image/png',hasAlpha:true,hasTransparency};
  } else info=await pixels(bytes,{width:box.width,height:box.height});
  const reason=split.stale?'地图已替换，需先迁移分层。':tooLarge?'图层超过单次精修尺寸，请传入绘制片像素坐标 window。':null;
  const {origin,offset}=document.content.map;
  const slotFingerprint=digest({candidateId:split.candidateId,sourceHash:split.sourceHash,elementId:element.id,partId:part.id,
    mask:part.mask && hash(part.mask),partSha256:hash(full),window:ref.window});
  return {...summary(ref,info,{revision:document.revision,slotFingerprint,kind:element.kind==='object'?'prop':'background',
    name:`${document.name} · ${element.name} · ${part.id}`,scope:'scene-split-part',editable:!reason && !element.locked,locked:element.locked,
    ...(reason?{readOnlyReason:reason}:{}),placement:{x:origin.x+offset.x+element.x+part.x+box.x,y:origin.y+offset.y+element.y+part.y+box.y,width:box.width,height:box.height,flipH:false,flipV:false},
    source:{documentId:ref.documentId,candidateId:split.candidateId,elementId:element.id,partId:part.id,name:element.name,fullWidth:part.width,fullHeight:part.height},viewPath:document.viewPath}),bytes};
}

async function sceneTarget(root, manifest, ref) {
  if (ref.kind === 'scene-instance') return sceneInstanceTarget(root, manifest, ref);
  if (ref.kind === 'scene-split-part') return splitPartTarget(root, manifest, ref);
  return sceneLayerTarget(root, manifest, ref);
}

async function listMapTargets(root, manifest, scope, add, issues) {
  for (const record of await listMapProjectRecords(root, manifest, issues)) {
    if (scope.projectId && scope.projectId !== record.projectId) continue;
    try {
      const { bytes } = await readMapProject(root, manifest, record.projectId);
      const { draft } = await readMapProjectPackage(bytes);
      for (const tile of draft.snapshot.tiles) for (const imageLayer of Object.keys(tile.images)) add({ kind: 'map-layer', projectId: record.projectId, tileKey: tile.key, layer: imageLayer }, `${record.title} ${tile.key} ${imageLayer}`);
    } catch (error) { issues.push({ source: 'map-layer', id: record.projectId, message: error.message }); }
  }
}

function addDocumentRefs(document, add) {
  for (const element of document.content.mapSplit?.elements || []) for (const part of element.parts)
    add({kind:'scene-split-part',documentId:document.id,elementId:element.id,partId:part.id},`${document.name} ${element.name} ${part.id}`);
  for (const mapLayer of document.content.map?.layers || []) add({ kind: 'scene-layer', documentId: document.id, layerId: mapLayer.id }, `${document.name} ${mapLayer.name}`);
  for (const instance of document.content.instances) {
    const material = document.content.materials.find(material => material.id === instance.materialId), object = material?.project.objects[0];
    if (!object) continue;
    const base = { kind: 'scene-instance', documentId: document.id, instanceId: instance.id };
    if (object.visual.assetId) add({ ...base, slot: 'visual' }, `${document.name} ${instance.name} 默认外观`);
    const entries = object.behavior.kind === 'toggle' ? object.behavior.states : object.behavior.kind === 'sequence' ? object.behavior.entries : [];
    for (const [index, entry] of entries.entries()) if (entry.appearance.assetId || object.visual.assetId) add({ ...base, slot: object.behavior.kind === 'toggle' ? 'toggle-state' : 'sequence-entry', index }, `${document.name} ${instance.name} ${entry.name}`);
  }
}

async function adoptedMapTarget(root, manifest, ref, record, marker, fingerprint) {
  if (marker.fingerprint !== fingerprint || marker.targetId !== encodeImageTarget(ref)) throw failure('采用命令 ID 已用于不同的图片请求。', 409, 'COMMAND_ID_REUSED');
  const base = path.join(root, manifest.workspace.outputDirectory, record.id);
  const bytes = await confinedRead(root, base, path.resolve(root, marker.sourcePath), MAX_MAP_PROJECT_BYTES);
  if (hash(bytes) !== marker.projectSha256) throw failure('原地图采用版本已损坏。', 409, 'IMAGE_SOURCE_CHANGED');
  const target = await mapTarget(root, manifest, ref, { record: { ...record, revision: marker.revision, sha256: marker.projectSha256 }, bytes });
  return { target: publicTarget(target), revision: marker.revision, currentRevision: record.revision, replayed: true, adoption: { status: 'adopted', targetId: target.targetId, sourceTaskId: marker.sourceTaskId, sha256: marker.sha256, revision: marker.revision, commandId: marker.commandId, previewInvalidated: true } };
}

async function applyTarget(root, manifest, ref, parsed, candidate, candidateBytes, fingerprint) {
  if (ref.kind === 'scene-split-part') {
    const {document}=await getDocument(root,manifest,{documentId:ref.documentId,revision:parsed.expectedRevision});
    const source=await splitPartTarget(root,manifest,ref,document);
    checkSource(source,parsed,candidate);
    const content=document.content;
    const part=content.mapSplit.elements.find(el=>el.id===ref.elementId).parts.find(p=>p.id===ref.partId);
    let png=candidateBytes;
    if (ref.window) {
      const box=ref.window;
      const decode=buffer=>sharp(buffer,{limitInputPixels:64_000_000}).toColourspace('srgb').ensureAlpha().raw().toBuffer();
      const full=await decode(Buffer.from(part.source.split(',')[1],'base64')), replacement=await decode(png);
      for(let y=0;y<box.height;y++) replacement.copy(full,((box.y+y)*part.width+box.x)*4,y*box.width*4,(y+1)*box.width*4);
      png=await sharp(full,{raw:{width:part.width,height:part.height,channels:4}}).png().toBuffer();
    }
    part.source='data:image/png;base64,'+png.toString('base64');
    content.mapSplit.review='unverified';
    const result=await saveDocument(root,manifest,{documentId:ref.documentId,expectedRevision:parsed.expectedRevision,commandId:parsed.commandId,content},{respectLocks:true});
    const target=await splitPartTarget(root,manifest,ref,result.document);
    return {target:publicTarget(target),revision:result.document.revision,currentRevision:result.currentRevision,replayed:result.replayed,
      adoption:{status:'adopted',targetId:target.targetId,documentId:ref.documentId,elementId:ref.elementId,partId:ref.partId,scope:'scene-split-part',sourceTaskId:candidate.task.id,sha256:target.sha256,revision:target.revision,commandId:parsed.commandId}};
  }
  if (ref.kind === 'scene-instance' || ref.kind === 'scene-layer') {
    const { document } = await getDocument(root, manifest, { documentId: ref.documentId, revision: parsed.expectedRevision });
    const source = ref.kind === 'scene-instance' ? await sceneInstanceTarget(root, manifest, ref, document) : await sceneLayerTarget(root, manifest, ref, document);
    checkSource(source, parsed, candidate);
    let content, materialId, assetId;
    if (ref.kind === 'scene-instance') {
      const binding = sceneInstanceBinding(document, ref);
      content = structuredClone(document.content);
      const material = structuredClone(binding.material);
      materialId = `material_image_${digest({ targetId: parsed.targetId, commandId: parsed.commandId, candidate: parsed.candidate }).slice(0, 32)}`;
      material.id = materialId;
      assetId = `image_${hash(candidate.task.id).slice(0, 32)}`;
      const asset = { id: assetId, name: parsed.name || source.source.name, mime: 'image/png', source: `data:image/png;base64,${candidate.bytes.toString('base64')}`, generation: { sourceTaskId: candidate.task.id, sha256: candidate.info.sha256 } };
      const existing = material.project.assets.find(asset => asset.id === assetId);
      if (existing && (existing.source !== asset.source || existing.generation?.sourceTaskId !== candidate.task.id || existing.generation?.sha256 !== asset.generation.sha256)) throw failure('候选素材身份冲突。', 409, 'IMAGE_ASSET_ID_CONFLICT');
      if (!existing) material.project.assets.push(asset);
      const object = material.project.objects[0];
      if (ref.slot === 'visual') object.visual.assetId = assetId;
      else (ref.slot === 'toggle-state' ? object.behavior.states : object.behavior.entries)[ref.index].appearance.assetId = assetId;
      const collision = content.materials.find(existing => existing.id === materialId);
      if (collision && digest(collision) !== digest(material)) throw failure('派生素材身份冲突。', 409, 'IMAGE_MATERIAL_ID_CONFLICT');
      if (!collision) content.materials.push(material);
      content.instances.find(instance => instance.id === ref.instanceId).materialId = materialId;
    } else content = await replaceSceneImageSource(root, document.content, ref.layerId, { bytes: candidate.bytes, sha256: candidate.info.sha256, taskId: candidate.task.id, width: candidate.info.width, height: candidate.info.height, mimeType: 'image/png' });
    const result = await saveDocument(root, manifest, { documentId: ref.documentId, expectedRevision: parsed.expectedRevision, commandId: parsed.commandId, content }, { respectLocks: true });
    const target = ref.kind === 'scene-instance' ? await sceneInstanceTarget(root, manifest, ref, result.document) : await sceneLayerTarget(root, manifest, ref, result.document);
    return { target: publicTarget(target), revision: result.document.revision, currentRevision: result.currentRevision, replayed: result.replayed,
      adoption: { status: 'adopted', targetId: target.targetId, documentId: ref.documentId, sourceTaskId: candidate.task.id, sha256: target.sha256, revision: target.revision, commandId: parsed.commandId,
        scope: source.scope, affectedInstanceIds: source.affectedInstanceIds, ...(ref.kind === 'scene-instance' ? { instanceId: ref.instanceId, sourceMaterialId: source.source.materialId, materialId, assetId, sharedInstanceCount: source.sharedInstanceCount, slot: ref.slot, index: ref.index } : { layerId: ref.layerId, sourceEntry: target.sourceEntry }) } };
  }
  const source = await readMapProject(root, manifest, ref.projectId);
  const previous = source.record.imageAdoptions?.find(marker => marker.commandId === parsed.commandId);
  if (previous) return adoptedMapTarget(root, manifest, ref, source.record, previous, fingerprint);
  const target = await mapTarget(root, manifest, ref, source);
  checkSource(target, parsed, candidate);
  const { draft, images } = await readMapProjectPackage(source.bytes);
  const selected = draft.snapshot.tiles.find(tile => tile.key === ref.tileKey).images[ref.layer];
  const references = draft.snapshot.tiles.flatMap(tile => Object.values(tile.images));
  const zip = await JSZip.loadAsync(source.bytes);
  let imagePath = selected.path;
  if (references.filter(image => image.path === selected.path).length > 1) {
    let next = 0; while (zip.file(`images/${next}.bin`)) next++;
    imagePath = `images/${next}.bin`;
  }
  Object.assign(selected, { path: imagePath, name: parsed.name || selected.name, type: 'image/png', size: candidate.bytes.length, width: candidate.info.width, height: candidate.info.height, generation: { sourceTaskId: candidate.task.id, sha256: candidate.info.sha256 } });
  // Source image records and all geometry remain intact; this derived preview
  // belongs to the old version and must be rebuilt by the editor.
  zip.file(imagePath, candidate.bytes); zip.file('map-project.json', JSON.stringify(draft)); zip.remove('preview.png');
  for (const entry of Object.values(zip.files)) entry.date = new Date('1980-01-01T00:00:00Z');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  // Read back before commit, including provenance and untouched-image bytes.
  const checked = await readMapProjectPackage(bytes);
  for (const image of references.filter(image => image !== selected)) if (!Buffer.from(checked.images.get(image.path)).equals(Buffer.from(images.get(image.path)))) throw failure('未选中的地图源图片发生变化。');
  const marker = { commandId: parsed.commandId, fingerprint, targetId: parsed.targetId, tileKey: ref.tileKey, layer: ref.layer, sourceSha256: parsed.expectedSha256, sourceTaskId: candidate.task.id, sha256: candidate.info.sha256 };
  let record;
  try { record = await saveMapProject(root, manifest, ref.projectId, parsed.expectedRevision, bytes, { imageAdoption: marker }); }
  catch (error) {
    if (error.status !== 409) throw error;
    const current = await readMapProject(root, manifest, ref.projectId);
    const adopted = current.record.imageAdoptions?.find(entry => entry.commandId === parsed.commandId);
    if (adopted) return adoptedMapTarget(root, manifest, ref, current.record, adopted, fingerprint);
    throw error;
  }
  const adopted = await mapTarget(root, manifest, ref, { record, bytes });
  return { target: publicTarget(adopted), revision: record.revision, currentRevision: record.revision, replayed: false, adoption: { status: 'adopted', targetId: parsed.targetId, sourceTaskId: candidate.task.id, sha256: candidate.info.sha256, revision: record.revision, commandId: parsed.commandId, previewInvalidated: true, objectExtractionRequired: ['black', 'white'].includes(ref.layer) } };
}

export const mapImageTargetSource = {
  kinds: ['map-layer'], integerRevision: true, read: mapTarget, list: listMapTargets, apply: applyTarget,
};
export const sceneImageTargetSource = {
  kinds: ['scene-layer', 'scene-instance', 'scene-split-part'], documentKind: 'scene', integerRevision: true,
  read: sceneTarget, addDocumentRefs, apply: applyTarget,
};
