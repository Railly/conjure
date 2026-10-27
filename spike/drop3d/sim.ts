// Spike V1: the same cutouts in 3D, as alpha-cut UV cards on the ground, and a tileable material on a box.
import { createChecksum } from "dotframe/src/checksum";
import { dsin } from "dotframe/src/detmath";
import { createWorld, spawn, type World } from "dotframe/src/ecs";
import type { MeshData } from "dotframe/src/gltf";
import type { Texture } from "dotframe/src/gpu";
import { vec3 } from "dotframe/src/math";
import { createRenderer, type Environment } from "dotframe/src/render";
import { box } from "dotframe/src/shapes";
import { defineSim, type SimPlatform, type SimRun } from "dotframe/src/sim";

const WINDOW = { width: 960, height: 540, title: "drop3d" };
const CARDS = ["fox", "tree", "rock"];

// Unit card in the XY plane, bottom edge at y = 0, facing +Z.
function card(): MeshData {
  return {
    positions: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

const pngSize = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset);
  return { w: v.getUint32(16), h: v.getUint32(20) };
};

export default defineSim({
  players: 1,
  window: WINDOW,
  clear: { r: 0.62, g: 0.8, b: 0.9 },
  options: {},
  neutral: 0,
  encode: () => 0,
  random: () => 0,
  create: (platform: SimPlatform): SimRun => {
    let frame = 0;
    const renderer = createRenderer(platform.gpu);
    const world: World = createWorld();
    const cardEntities: number[] = [];
    let crate = -1;
    const env: Environment = {
      ambient: vec3(0.55, 0.6, 0.68),
      sun: { direction: vec3(0.4, 1, 0.6), color: vec3(1, 0.95, 0.85), shadows: 20 },
    };
    const ready = (async () => {
      const bytes = await Promise.all([...CARDS, "crate-material"].map((n) => platform.load(`assets/${n}.png`)));
      const tex: (Texture | undefined)[] = [];
      // The material repeats over the box, so it loads with mipmaps (a repeating sampler); the cards do not.
      for (let i = 0; i < bytes.length; i++) tex.push(platform.image ? await platform.image(bytes[i], true, i === CARDS.length) : undefined);
      const ground = spawn(world);
      world.transforms.set(ground, { position: vec3(0, -0.05, 0), rotation: vec3(0, 0, 0), scale: vec3(14, 0.1, 10) });
      world.meshes.set(ground, { mesh: renderer.addMesh(box()), color: vec3(0.42, 0.56, 0.31) });
      const cardMesh = renderer.addMesh(card());
      CARDS.forEach((_, i) => {
        const { w, h } = pngSize(bytes[i]);
        const height = 1.6;
        const e = spawn(world);
        world.transforms.set(e, { position: vec3(-3.2 + i * 2.2, 0, 0), rotation: vec3(0, 0, 0), scale: vec3((height * w) / h, height, 1) });
        world.meshes.set(e, { mesh: cardMesh, color: vec3(1, 1, 1), texture: tex[i], alphaCutoff: 0.5 });
        cardEntities.push(e);
      });
      crate = spawn(world);
      world.transforms.set(crate, { position: vec3(3.4, 0.6, 0.4), rotation: vec3(0, 0.5, 0), scale: vec3(1.2, 1.2, 1.2) });
      world.meshes.set(crate, { mesh: renderer.addMesh(box()), color: vec3(1, 1, 1), texture: tex[3], tile: 1.2 });
    })();
    const pose = () => {
      cardEntities.forEach((e, i) => {
        const t = world.transforms.get(e);
        if (t) t.rotation = vec3(0, 0.35 * dsin(frame / 40 + i), 0);
      });
      const c = world.transforms.get(crate);
      if (c) c.rotation = vec3(0, frame / 90, 0);
    };
    return {
      ready,
      start: () => {
        frame = 0;
      },
      step: () => {
        frame++;
      },
      checksum: () => createChecksum().add(frame).value(),
      state: () => ({ frame, cards: cardEntities.length, crate: crate >= 0 }),
      over: () => false,
      save: () => frame,
      restore: (s) => {
        frame = s as number;
      },
      inspect: () => ({ frame }),
      render: (draw) => {
        pose();
        draw.scene(renderer.draws(world, { eye: vec3(0, 2.4, 7.5), target: vec3(0, 0.8, 0), fovY: 0.8 }, env));
      },
    };
  },
});
