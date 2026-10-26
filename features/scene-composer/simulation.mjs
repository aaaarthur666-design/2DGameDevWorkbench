import { InteractionSimulation, stateAppearance } from '../interactable-editor/simulator.mjs';
import { instanceOrigin, materialFor, validateScene } from './model.mjs';
import { LINK_EVENTS, MAX_LINK_ACTIONS } from './links.mjs';

export function createSceneSimulation(scene) {
  return new SceneSimulation(scene);
}

export class SceneSimulation extends InteractionSimulation {
  constructor(input) {
    const scene = validateScene(input);
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
    super(definitions);
    this.links = structuredClone(scene.links);
    this.eventQueue = [];
    this.eventLog = [];
    this.eventCount = 0;
    this.linkDiagnostics = [];
    this.linkAttempts = 0;
    this.operationDepth = 0;
    this.dispatching = false;
    this.suppressLinks = false;
    this.initialEnabled = new Map();
    this.objects.forEach((o, n) => {
      o.id = instances[n].id;
      Object.assign(o, instanceOrigin(instances[n]));
      o.visibleOverride = null;
      this.initialEnabled.set(o.id, o.definition.activation.enabled);
      Object.defineProperties(o, {
        enabled: { enumerable: true, get: () => o.definition.activation.enabled },
        visible: { enumerable: true, get: () => this.getLinkState(o.id).visible },
      });
    });
  }
  getLinkState(instanceId) {
    const instance = this.objects.find(value => value.id === instanceId);
    if (!instance) return null;
    const appearance = stateAppearance(instance.definition, instance.state);
    const completedHidden = instance.state.completed && instance.definition.completion !== 'remain';
    return { ...instance.state, enabled: instance.definition.activation.enabled, visible: Boolean((instance.visibleOverride ?? appearance.visible ?? instance.definition.visual.visible) && !completedHidden), solidEnabled: Boolean((appearance.solidEnabled ?? instance.definition.solid.enabled) && !completedHidden) };
  }
  emit(name, instance, extra = {}) {
    super.emit(name, instance, extra);
    const event = this.events[0];
    this.eventCount++;
    if (this.eventLog.length < 1000) this.eventLog.push(structuredClone(event));
    if (!this.suppressLinks && LINK_EVENTS.includes(name)) this.eventQueue.push(structuredClone(event));
    if (!this.suppressLinks && name === 'interaction_finished') this.emit('state_changed', instance, { result: this.getLinkState(instance.id), reason: 'interaction' });
    return event;
  }
  runInput(method, args) {
    this.operationDepth++;
    try { return InteractionSimulation.prototype[method].apply(this, args); }
    finally {
      this.operationDepth--;
      if (this.operationDepth === 0 && !this.suppressLinks) this.flushLinks();
    }
  }
  tick(delta) { return this.runInput('tick', [delta]); }
  press() { return this.runInput('press', []); }
  click(x, y) { return this.runInput('click', [x, y]); }
  request(instance, source = false) { return this.runInput('request', [instance, source]); }
  advanceText() { return this.runInput('advanceText', []); }
  finishAudio() { return this.runInput('finishAudio', []); }
  cancel() { return this.runInput('cancel', []); }
  moveActor(x, y) { return this.runInput('moveActor', [x, y]); }
  flushLinks() {
    if (this.dispatching || this.active || this.suppressLinks) return;
    this.dispatching = true;
    let attempts = 0;
    try {
      while (this.eventQueue.length) {
        const event = this.eventQueue.shift();
        const source = this.objects.find(instance => instance.id === event.instanceId);
        if (!source) continue;
        for (const link of this.links.filter(link => link.enabled && link.sourceInstanceId === event.instanceId && link.event === event.name)) {
          const target = this.objects.find(instance => instance.id === link.targetInstanceId);
          const value = link.value === 'source_toggle' ? event.result.toggleState : link.value;
          const metadata = { linkId: link.id, sourceInstanceId: link.sourceInstanceId, targetInstanceId: link.targetInstanceId, action: link.action, value };
          if (attempts >= MAX_LINK_ACTIONS) {
            const diagnostic = { code: 'LINK_ACTION_LIMIT', message: `联动单次输入最多执行 ${MAX_LINK_ACTIONS} 个动作，剩余队列已停止。`, ...metadata };
            this.linkDiagnostics.push(diagnostic);
            this.emit('link_error', source, { ...metadata, reason: 'action_limit' });
            this.eventQueue = [];
            return;
          }
          attempts++; this.linkAttempts++;
          if (!target || (target.state.completed && target.definition.completion === 'free')) {
            this.emit('link_skipped', source, { ...metadata, reason: 'target_unavailable' });
            continue;
          }
          const before = this.getLinkState(target.id);
          if (link.action === 'set_toggle') {
            target.state.toggleState = value;
            this.restoreAppearance(target);
          } else if (link.action === 'set_enabled') {
            target.definition.activation.enabled = value;
            if (!value) {
              target.pending = false;
              target.inRange = false;
              if (this.focus === target) { this.focus = null; this.restoreAppearance(target); this.emit('focus_exited', target); }
            }
          } else if (link.action === 'set_visible') target.visibleOverride = value;
          const after = this.getLinkState(target.id);
          const changed = before.toggleState !== after.toggleState || before.enabled !== after.enabled || before.visible !== after.visible;
          this.emit('link_applied', source, { ...metadata, changed, targetState: after });
          if (changed) this.emit('state_changed', target, { result: after, reason: 'link', linkId: link.id });
        }
      }
    } finally { this.dispatching = false; }
  }
  restore(states) {
    this.suppressLinks = true;
    try {
      for (const instance of this.objects) { instance.visibleOverride = null; instance.definition.activation.enabled = this.initialEnabled.get(instance.id); }
      InteractionSimulation.prototype.restore.call(this, states);
      this.eventQueue = [];
    } finally { this.suppressLinks = false; }
  }
  reset() {
    this.suppressLinks = true;
    try { InteractionSimulation.prototype.reset.call(this); }
    finally { this.suppressLinks = false; this.eventQueue = []; this.eventLog = []; this.eventCount = 0; this.linkDiagnostics = []; this.linkAttempts = 0; }
  }
}
