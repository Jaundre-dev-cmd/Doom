// Weapon surface materials for this project.
//
// The upstream weapon models were authored against a heavy GPU-baked PBR
// texture system that this game does not ship. Instead, every weapon material
// here is a MeshStandardMaterial extended in the shader with:
//
//  - Curvature masks baked into each gun's geometry (masks.js): r = wear on
//    convex edges, g = grime in creases, b = extra ambient occlusion. Worn
//    edges show bare/brighter metal, crevices collect dirt, recesses darken.
//  - Procedural micro-surface, computed from object-space position so it needs
//    no UVs: parkerized/blued steel grain, hard-anodised aluminium, stippled
//    polymer, rubber, and real wood grain running down the length of the gun.

import * as THREE from 'three';
import { bakeMasks } from './masks.js';

// [colour, roughness, metalness, finish, wearColour]
const SURFACES = {
  alu: [0x2b2e33, 0.62, 0.35, 'anodised', 0x9aa0a6],
  alu_fine: [0x33363b, 0.5, 0.45, 'anodised', 0xa8adb2],
  steel: [0x34373b, 0.42, 0.9, 'steel', 0xb5b8bb],
  steel_soot: [0x1d1e20, 0.68, 0.7, 'steel', 0x6d6e70],
  steel_bright: [0x6a6e73, 0.26, 1, 'steel', 0xd0d3d6],
  steel_black: [0x17181b, 0.48, 0.75, 'steel', 0x8e9296],
  polymer: [0x1e1f21, 0.74, 0, 'polymer', 0x4a4c4f],
  polymer_tan: [0x8c7a58, 0.74, 0, 'polymer', 0xb8a682],
  wood: [0x6a3f22, 0.58, 0, 'wood', 0x9a6a40],
  rubber: [0x161718, 0.9, 0, 'rubber', 0x2c2d2f],
  brass: [0xb08a3e, 0.3, 1, 'steel', 0xe2c27a],
  copper: [0xa8653a, 0.32, 1, 'steel', 0xd99a6a],
  weather: [0x2a2b2e, 0.8, 0, 'polymer', 0x4a4b4e],
  macro: [0x2a2b2e, 0.7, 0, 'polymer', 0x4a4b4e],
  glove: [0x2f2a26, 0.85, 0, 'rubber', 0x46403a],
  glove_pad: [0x26221f, 0.85, 0, 'rubber', 0x3a342f],
  glove_seam: [0x1c1a18, 0.85, 0, 'rubber', 0x2c2826],
  sleeve: [0x3a4a3a, 0.8, 0, 'polymer', 0x55644f],
  // Extra keys used by this project's own models (shotgun, minigun, launcher).
  olive: [0x4a5232, 0.7, 0.1, 'anodised', 0x8d9470],
  red_hull: [0x8a1e17, 0.55, 0, 'polymer', 0xc0503f],
};

const FINISH_ID = { steel: 0, anodised: 1, polymer: 2, rubber: 3, wood: 4 };

const NOISE_GLSL = /* glsl */ `
  float owHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float owNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(owHash(i + vec3(0,0,0)), owHash(i + vec3(1,0,0)), f.x),
                   mix(owHash(i + vec3(0,1,0)), owHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(owHash(i + vec3(0,0,1)), owHash(i + vec3(1,0,1)), f.x),
                   mix(owHash(i + vec3(0,1,1)), owHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

export function createWeaponSurface(key) {
  const def = SURFACES[key] || [0x2a2b2e, 0.72, 0, 'polymer', 0x4a4b4e];
  const [color, roughness, metalness, finish, wear] = def;
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true });
  m.name = `weapon-${key}`;
  m.envMapIntensity = 0.9;
  const wearColor = new THREE.Color(wear);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.owFinish = { value: FINISH_ID[finish] ?? 2 };
    shader.uniforms.owWear = { value: wearColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 owObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nowObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 owObj;\nuniform float owFinish;\nuniform vec3 owWear;\n${NOISE_GLSL}`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        // vColor carries the baked masks, not a colour.
        float owWearM = clamp(vColor.r, 0.0, 1.0);
        float owGrime = clamp(vColor.g, 0.0, 1.0);
        float owAo = clamp(vColor.b, 0.0, 1.0);
        float owGrain = 0.5;
        float owRough = 0.0;
        if (owFinish < 0.5) {
          // Parkerized / blued steel: fine crystalline grain + faint mottling
          owGrain = owNoise(owObj * 900.0) * 0.6 + owNoise(owObj * 60.0) * 0.4;
          diffuseColor.rgb *= 0.86 + owGrain * 0.28;
          owRough = (owGrain - 0.5) * 0.18;
        } else if (owFinish < 1.5) {
          // Hard-anodised aluminium: matte with a soft cloudy grain
          owGrain = owNoise(owObj * 420.0) * 0.5 + owNoise(owObj * 35.0) * 0.5;
          diffuseColor.rgb *= 0.9 + owGrain * 0.2;
          owRough = (owGrain - 0.5) * 0.12;
        } else if (owFinish < 2.5) {
          // Stippled polymer
          owGrain = owNoise(owObj * 1400.0);
          diffuseColor.rgb *= 0.88 + owGrain * 0.22;
          owRough = (owGrain - 0.5) * 0.2;
        } else if (owFinish < 3.5) {
          owGrain = owNoise(owObj * 700.0);
          diffuseColor.rgb *= 0.92 + owGrain * 0.12;
        } else {
          // Wood: growth rings running down the stock/handguard (along z)
          float warp = owNoise(owObj * vec3(30.0, 30.0, 4.0)) * 2.5;
          float rings = sin((owObj.x * 260.0 + owObj.y * 190.0) + warp * 6.0) * 0.5 + 0.5;
          float fibre = owNoise(owObj * vec3(600.0, 600.0, 18.0));
          diffuseColor.rgb *= mix(0.62, 1.12, rings * 0.7 + fibre * 0.3);
          owRough = (fibre - 0.5) * 0.15;
        }
        // Wear: coating rubbed back to bright substrate on the edges
        diffuseColor.rgb = mix(diffuseColor.rgb, owWear, owWearM * 0.75);
        // Grime in the creases, ambient occlusion in the recesses
        diffuseColor.rgb *= (1.0 - owGrime * 0.35) * (1.0 - owAo * 0.55);
        `
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + owRough + owGrime * 0.2 - owWearM * 0.25, 0.08, 1.0);
        if (owFinish < 1.5) metalnessFactor = clamp(metalnessFactor + owWearM * 0.6, 0.0, 1.0);`
      );
  };
  // Materials with the same key share one compiled program.
  m.customProgramCacheKey = () => `weapon-surface-${finish}`;
  return m;
}

// Minimal stand-in for upstream's material library: build.js only needs
// `bakeMasks` to bake the curvature masks into each part's geometry.
export const WEAPON_SURFACE_LIBRARY = { bakeMasks };
