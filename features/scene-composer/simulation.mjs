import { InteractionSimulation } from '../interactable-editor/simulator.mjs';
import { instanceOrigin, materialFor } from './model.mjs';

export function createSceneSimulation(scene) {
  const instances = scene.instances.filter((i) => i.included);
  const definitions = instances.map((i) => {
    const o = structuredClone(materialFor(scene, i).project.objects[0]);
    for (const shape of [o.detection.shape, o.pointer, o.solid.shape]) {
      shape.offset.x *= i.scale * (i.flipH ? -1 : 1);
      shape.offset.y *= i.scale;
      shape.width *= i.scale;
      shape.height *= i.scale;
      shape.radius *= i.scale;
    }
    o.visual.zIndex = scene.order.length - scene.order.indexOf(i.id);
    return o;
  });
  const sim = new InteractionSimulation(definitions);
  sim.objects.forEach((o, n) => {
    o.id = instances[n].id;
    Object.assign(o, instanceOrigin(instances[n]));
  });
  return sim;
}
