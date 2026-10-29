// Procedural cloud layer drawn over the atmospheric sky.
//
// A full-screen-at-infinity dome (depth forced to the far plane, like the Sky
// addon, so it's behind everything regardless of camera far): each pixel
// projects its view ray onto a cloud plane high above, samples drifting fbm
// noise for coverage, and lights the result from the real sun direction —
// bright, slightly warm edges toward the sun, soft grey undersides away from
// it, thinning out toward the horizon.

import * as THREE from 'three';

export function makeCloudLayer(sunDir, { coverage = 0.48, opacity = 0.92, tint = 0xffffff } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir.clone().normalize() },
    uCoverage: { value: coverage },
    uOpacity: { value: opacity },
    uTint: { value: new THREE.Color(tint) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
        gl_Position.z = gl_Position.w; // at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform float uCoverage;
      uniform float uOpacity;
      uniform vec3 uTint;
      varying vec3 vDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 6; i++) {
          s += noise(p) * a;
          p = rot * p * 2.03 + 3.7;
          a *= 0.5;
        }
        return s;
      }

      void main() {
        vec3 dir = normalize(vDir);
        if (dir.y <= 0.0) discard;
        // Project onto a cloud plane; drift with the wind.
        vec2 uv = dir.xz / (dir.y + 0.08) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
        float n = fbm(uv);
        float detail = fbm(uv * 3.1 + 11.0);
        float density = smoothstep(uCoverage, uCoverage + 0.18, n * 0.85 + detail * 0.25);
        // Self-shadowing: sample toward the sun; thicker cloud there = darker.
        vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.08;
        float shadow = smoothstep(uCoverage, uCoverage + 0.35, fbm(uv + toSun) * 0.85 + detail * 0.25);
        float sunAmount = clamp(dot(dir, normalize(uSunDir)), 0.0, 1.0);
        vec3 lit = mix(vec3(0.62, 0.66, 0.72), vec3(1.0, 0.98, 0.95), 1.0 - shadow * 0.75);
        lit += vec3(1.0, 0.85, 0.6) * pow(sunAmount, 8.0) * (1.0 - density) * 0.9; // silver lining
        float horizon = smoothstep(0.02, 0.22, dir.y);
        gl_FragColor = vec4(lit * uTint, density * horizon * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), material);
  mesh.name = 'skydome';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.userData.noRaycast = true;
  mesh.userData.noBatch = true;
  return {
    mesh,
    update(dt) {
      uniforms.uTime.value += dt;
    },
  };
}
