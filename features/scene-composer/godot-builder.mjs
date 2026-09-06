import JSZip from 'jszip';
import sharp from 'sharp';
import { buildGodotPackage } from '../interactable-editor/godot-builder.mjs';
import { instanceOrigin, validateScene } from './model.mjs';
import { createScenePackage } from './package.mjs';

const quote = (value) => JSON.stringify(value);
const vec = (p) => `Vector2(${p.x}, ${p.y})`;

/** Local web exporter. Uses the existing interaction kit, never an Agent operation. */
export async function buildSceneGodotPackage(input, { repositoryRoot } = {}) {
  const scene = validateScene(input);
  if (!scene.map?.layers.some((l) => l.included))
    throw new Error('请先添加至少一个参与导出的地图层。');
  const zip = new JSZip();
  const root = `scenes/${scene.id}`;
  const instances = scene.instances.filter((i) => i.included);
  const used = scene.materials.filter((m) =>
    instances.some((i) => i.materialId === m.id),
  );
  const paths = new Map();
  for (const m of used) {
    // Namespaced kits isolate definitions, assets and runtime class references across scenes.
    const pack = await buildGodotPackage(
      { project: m.project },
      { repositoryRoot, exportId: m.id },
    );
    const original = await JSZip.loadAsync(pack.bytes);
    const prefix = `${root}/objects/${m.id}`;
    for (const [name, entry] of Object.entries(original.files)) {
      if (
        entry.dir ||
        name.includes('/runtime/') ||
        name.includes('/sources/') ||
        name.includes('/packages/')
      )
        continue;
      const dest = name.replace('addons/workbench_interaction', prefix);
      if (/\.(tscn|tres|gd)$/.test(name)) {
        let text = await entry.async('string');
        text = text.replace(
          /res:\/\/addons\/workbench_interaction\/(?!runtime\/v1\/)/g,
          `res://${prefix}/`,
        );
        zip.file(dest, text);
      } else zip.file(dest, await entry.async('uint8array'));
    }
    // Runtime scripts use global class names: include one shared copy, never duplicate class_name.
    for (const [name, entry] of Object.entries(original.files))
      if (!entry.dir && name.includes('/runtime/'))
        zip.file(name, await entry.async('uint8array'));
    paths.set(
      m.id,
      pack.metadata.objects[0].scene.replace(
        'res://addons/workbench_interaction',
        `res://${prefix}`,
      ),
    );
  }
  // An empty scene can still carry the runtime and be extended later.
  if (!used.length) {
    const { createProject } =
      await import('../interactable-editor/contract.mjs');
    const pack = await buildGodotPackage(
      { project: createProject() },
      { repositoryRoot },
    );
    const original = await JSZip.loadAsync(pack.bytes);
    for (const [name, entry] of Object.entries(original.files))
      if (!entry.dir && name.includes('/runtime/'))
        zip.file(name, await entry.async('uint8array'));
  }
  const ext = [
    '[ext_resource type="PackedScene" path="res://addons/workbench_interaction/runtime/v1/interaction_runtime_2d.tscn" id="runtime"]',
  ];
  for (const [materialId, resource] of paths)
    ext.push(
      `[ext_resource type="PackedScene" path=${quote(resource)} id=${quote(materialId)}]`,
    );
  for (const layer of scene.map.layers.filter((l) => l.included)) {
    if (!layer.source.startsWith('data:image/png;base64,'))
      throw new Error('地图层必须是内嵌 PNG。');
    const bytes = Buffer.from(layer.source.split(',')[1], 'base64');
    const info = await sharp(bytes, {
      limitInputPixels: 64_000_000,
    }).metadata();
    if (
      info.format !== 'png' ||
      info.width !== layer.width ||
      info.height !== layer.height
    )
      throw new Error('地图层尺寸与场景清单不一致。');
    zip.file(`${root}/map/${layer.id}.png`, bytes);
    ext.push(
      `[ext_resource type="Texture2D" path="res://${root}/map/${layer.id}.png" id="${layer.id}"]`,
    );
  }
  const actorRank = scene.order.length - scene.order.indexOf('actor');
  const nodes = [
    '[node name="Scene" type="Node2D"]',
    '[node name="InteractionRuntime" parent="." instance=ExtResource("runtime")]',
    `scene_key = ${quote(scene.id)}`,
  ];
  // All drawable roots are siblings. Relative template z values are overridden once here.
  for (const [rank, id] of scene.order.entries()) {
    const z = scene.order.length - rank;
    if (id === 'actor') {
      nodes.push(
        '[node name="ActorSlot" type="Node2D" parent="."]',
        `z_index = ${z}`,
      );
      continue;
    }
    const layer = scene.map.layers.find((l) => l.id === id);
    if (layer?.included)
      nodes.push(
        `[node name="${id}" type="Sprite2D" parent="."]`,
        `texture = ExtResource("${id}")`,
        'centered = false',
        'texture_filter = 1',
        `z_index = ${z}`,
        `position = ${vec({ x: scene.map.origin.x + scene.map.offset.x, y: scene.map.origin.y + scene.map.offset.y })}`,
      );
    const i = instances.find((item) => item.id === id);
    if (i)
      nodes.push(
        `[node name="${i.id}" parent="." instance=ExtResource("${i.materialId}")]`,
        `instance_id = ${quote(i.id)}`,
        `position = ${vec(instanceOrigin(i))}`,
        `scale = Vector2(${i.scale * (i.flipH ? -1 : 1)}, ${i.scale})`,
        `z_index = ${z}`,
      );
  }
  nodes.push(
    '[node name="MapCollisions" type="StaticBody2D" parent="."]',
    `position = ${vec(scene.map.offset)}`,
  );
  scene.map.collisions.forEach((points, i) =>
    nodes.push(
      `[node name="Collision_${i}" type="CollisionPolygon2D" parent="MapCollisions"]`,
      `polygon = PackedVector2Array(${points.flatMap((p) => [p.x, p.y]).join(', ')})`,
    ),
  );
  zip.file(
    `${root}/scene.tscn`,
    `[gd_scene load_steps=${ext.length + 1} format=3]\n\n${ext.join('\n')}\n\n${nodes.join('\n')}\n`,
  );
  zip.file(`${root}/scene-source.zip`, await createScenePackage(scene));
  zip.file(
    `${root}/scene-manifest.json`,
    JSON.stringify(
      {
        format: 'workbench-scene-godot',
        version: 1,
        sceneId: scene.id,
        name: scene.name,
        scene: `res://${root}/scene.tscn`,
        actorZIndex: actorRank,
        instances: instances.map((i) => ({
          instanceId: i.id,
          name: i.name,
          materialId: i.materialId,
        })),
      },
      null,
      2,
    ),
  );
  zip.file(
    `${root}/INSTALL.md`,
    `# ${scene.name}\n\n将包解压到 Godot 4.6.x 项目根目录，打开 res://${root}/scene.tscn。地图、交互物和碰撞已摆放完成。\n\n人物放在 ActorSlot 下，保持人物相对 Z 为 0；或使用 Z=${actorRank}。靠近交互的物理节点加入 interaction_actor group，默认碰撞层为 1（请与物件的 detection mask 对应）。默认按 E，点击物件沿用其配置。ActorSlot 只是挂接点，没有附带人物。\n\n各物件保留独立节点和 instance_id；移动、改名时保留此 ID。拾取、开关等通过物件信号接入游戏；没有自动背包或剧情逻辑。\n\nscene-source.zip 可在场景组装中重新打开。隐藏的编辑辅助内容不影响导出，取消“参与导出”的节点不会输出。没有 project.godot，不覆盖项目配置。\n\n重新导出会更新 scenes/${scene.id}/ 内的生成资源。自定义脚本放在外层场景或独立文件中。所有场景共用 addons/workbench_interaction/runtime/v1/，导入时保持同一运行时版本；不要重复放置交互运行时。\n`,
  );
  return {
    bytes: await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    }),
    scenePath: `res://${root}/scene.tscn`,
  };
}
