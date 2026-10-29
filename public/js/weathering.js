// World-space weathering for every static building surface.
//
// The buildings are built from flat-coloured boxes, which is the main reason
// they read as "low-poly". This patches each MeshStandardMaterial in the
// built world with a shader that adds, in world space (no UVs needed):
//   - mottled grime and staining at two scales, plus fine surface grain
//   - vertical rain streaks running down walls
//   - dirt splash darkening and browning toward the ground
//   - (optionally) moss/algae on upward-facing surfaces in the forest
//   - matching roughness variation, so the sheen breaks up too
// Applied once per material; materials that already customise their shader
// (ground, foliage, grass, rocks, logs...) are left alone.

import * as THREE from 'three';

const NOISE = /* glsl */ `
  float wHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float wNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float wFbm(vec3 p) {
    return wNoise(p) * 0.5 + wNoise(p * 2.1 + 7.3) * 0.3 + wNoise(p * 4.3 + 1.9) * 0.2;
  }
`;

function patch(material, { moss }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wMoss = { value: moss ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 wPos;\nvarying vec3 wNrm;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        wPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        wNrm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 wPos;\nvarying vec3 wNrm;\nuniform float wMoss;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 wn = normalize(wNrm);
        float wall = 1.0 - abs(wn.y);
        float mottle = wFbm(wPos * 0.35);
        float stain = wFbm(wPos * 1.7 + 4.0);
        float grain = wNoise(wPos * 23.0);
        diffuseColor.rgb *= 0.78 + mottle * 0.32 + (grain - 0.5) * 0.08;
        diffuseColor.rgb *= 1.0 - smoothstep(0.55, 0.9, stain) * 0.22;
        // Rain streaks: long vertical runs on walls, heavier under edges.
        float streak = wNoise(vec3((wPos.x + wPos.z) * 7.0, wPos.y * 0.18, 0.0));
        streak = smoothstep(0.55, 0.95, streak) * wall;
        diffuseColor.rgb *= 1.0 - streak * 0.28;
        // Ground splash: darker, browner bottom ~1.2 m of walls.
        float splash = (1.0 - smoothstep(0.0, 1.3 + mottle * 0.6, wPos.y)) * wall;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.55, 0.45), splash * 0.75);
        // Moss / algae on upward faces and the damp base, in the forest.
        float mossAmt = wMoss * (smoothstep(0.55, 0.95, wn.y) * smoothstep(0.45, 0.75, mottle) + splash * 0.35 * stain);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.09), clamp(mossAmt, 0.0, 0.85));
        float wRough = (mottle - 0.5) * 0.25 + streak * 0.12 + mossAmt * 0.2;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + wRough, 0.05, 1.0);`
      );
  };
  material.customProgramCacheKey = () => `weathered-${moss ? 1 : 0}`;
  material.needsUpdate = true;
}

export function applyWeathering(scene, { moss = false } = {}) {
  const done = new Set();
  scene.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || obj.isSkinnedMesh) return;
    if (obj.name === 'ground' || obj.name === 'skydome') return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || done.has(m) || !m.isMeshStandardMaterial || m.userData.noWeathering) continue;
      done.add(m);
      if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) continue; // already custom
      if (m.transparent || m.emissive.getHex() !== 0) continue; // glass, lamps, signs
      patch(m, { moss });
    }
  });
  return done.size;
}
