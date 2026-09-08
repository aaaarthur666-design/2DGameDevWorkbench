import assert from "node:assert/strict";
import { PlaybackClock } from "../sprite_pipeline/static/animation_player_core.js";
const sample = (count, mode, steps) => {
  const clock = new PlaybackClock(count, 8, mode); clock.restart();
  const frames = [clock.index];
  for (let i = 0; i < steps; i++) frames.push(clock.advance(125));
  return {clock, frames};
};
assert.deepEqual(sample(4, "pingpong", 12).frames, [0,1,2,3,2,1,0,1,2,3,2,1,0]);
assert.deepEqual(sample(4, "loop", 8).frames, [0,1,2,3,0,1,2,3,0]);
const once = sample(4, "once", 3); assert.equal(once.clock.playing, true);
once.clock.advance(125); assert.equal(once.clock.playing, false); assert.equal(once.clock.index, 3);
once.clock.toggle(); assert.equal(once.clock.index, 0); assert.equal(once.clock.playing, true);
for (const mode of ["once", "loop", "pingpong"]) assert.deepEqual(sample(1, mode, 5).frames, [0,0,0,0,0,0]);
for (const count of [17,64]) {
  const {frames} = sample(count, "pingpong", 2 * (count - 1));
  assert.deepEqual(frames, [...Array(count).keys(), ...Array(count - 1).keys()].slice(0, count).concat([...Array(count-1).keys()].reverse()));
}
const clock = new PlaybackClock(17, 8, "loop"); clock.restart();
clock.advance(62.5); assert.equal(clock.index, 0);
clock.advance(62.5); assert.equal(clock.index, 1);
clock.toggle(); clock.advance(1000); assert.equal(clock.index, 1);
clock.setFps(4); clock.toggle(); clock.advance(125); assert.equal(clock.index, 1);
clock.advance(125); assert.equal(clock.index, 2);
clock.setFps(16); clock.advance(125); assert.equal(clock.index, 4);
clock.setFps(7.5); clock.restart(); for(let i=0;i<60;i++)clock.advance(1000/60);
assert.equal(clock.index, 7);
for(const fps of [0, -1, NaN, Infinity, 61, ""]) assert.throws(() => clock.setFps(fps));
console.log("animation-player-core: ok");
