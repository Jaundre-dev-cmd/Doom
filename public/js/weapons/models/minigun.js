import { Assembly, box, blob, extrude, latheZ, rodZ, dome, ring } from '../geometry.js';
import {
  addForeGrip,
  addPistolGrip,
  addPin,
  addScrew,
  addRail,
  addSlingLoop,
  buildMiniReflex,
  triggerPart,
  cartridge,
} from '../parts.js';

/**
 * The chaingun — a man-portable six-barrel rotary gun in the M134 / XM556
 * "microgun" pattern.
 *
 * What makes it read as a rotary and not as a fat rifle:
 *   - SIX barrels on a 52 mm pitch circle round a central spindle, held by a
 *     mid clamp and a muzzle clamp with scalloped (hexafoil) outlines;
 *   - a cylindrical rotor housing the barrels disappear into, with the rotor
 *     face visible through the front bearing ring;
 *   - the drive motor slung along the lower right flank with a gearbox ahead
 *     of it, and the ejection chute under it throwing links/cases down-right;
 *   - a feeder/delinker on the left flank with a LIVE belt of 5.56 in M27
 *     links arcing up into it from an OD ammo can hung under the gun;
 *   - a carry handle on top with a rail and a red dot, a pistol grip with a
 *     trigger at the rear and a vertical grip on a fixed bearing collar ahead.
 *
 * Layout (metres, -Z downrange, origin = web of the thumb on the grip):
 *   housing      z +0.105 .. -0.165   r 50 mm on the bore axis
 *   barrels      z -0.140 .. -0.725   585 mm
 *   overall      0.835 m
 *
 * The rotating cluster (barrels, clamps, spindle, rotor face) is the moving
 * part `barrels`, built already in place about the axis (0, bore, z): spin it
 * about Z through `nodes.barrelAxis`.
 */
export function buildMinigun() {
  const bore = 0.085;
  const rHouse = 0.05;
  const zHR = 0.105; // housing rear
  const zHF = -0.165; // housing front face
  const zMuzzle = -0.725;
  const pitchR = 0.026; // barrel pitch-circle radius
  const rBarrel = 0.0082;
  const rBore = 0.0028;
  const nBarrels = 6;
  const barrelAng = (k) => (k / nBarrels) * Math.PI * 2 + Math.PI / 2;

  const body = new Assembly('chaingun-body');

  /* ---- rotor housing ---------------------------------------------------- */
  // Authored in world z (lathe axis = weapon Z), front to rear.
  const housing = latheZ(
    [
      [-0.125, 0],
      [-0.125, 0.0365],
      [zHF, 0.0365],
      [zHF, 0.044],
      [zHF + 0.003, 0.0475],
      [zHF + 0.006, 0.0475],
      [zHF + 0.0075, 0.0505],
      [-0.138, 0.0505],
      [-0.137, 0.0525],
      [-0.128, 0.0525],
      [-0.127, rHouse],
      [-0.06, rHouse],
      [-0.059, rHouse + 0.0015],
      [-0.052, rHouse + 0.0015],
      [-0.051, rHouse],
      [0.06, rHouse],
      [0.061, rHouse + 0.0015],
      [0.068, rHouse + 0.0015],
      [0.069, rHouse],
      [0.082, rHouse],
      [0.09, 0.049],
      [0.099, 0.0465],
      [zHR - 0.002, 0.0455],
      [zHR, 0.042],
      [zHR, 0],
    ],
    40
  );
  body.add(housing, 'alu', { y: bore });
  housing.dispose();
  // Rear cap boss + a knurled arming knob on the axis.
  const capBoss = latheZ([[0, 0], [0, 0.011], [0.008, 0.011], [0.012, 0.008], [0.012, 0]], 18);
  body.add(capBoss, 'steel_black', { y: bore, z: zHR });
  capBoss.dispose();

  // Ring of screws round the front bearing ring and the rear cap.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const r = 0.0415;
    addScrew(body, 'steel', Math.cos(a) * r, bore + Math.sin(a) * r, zHF - 0.0002, 0.0021, 'z', 0.006);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = 0.034;
    const g = latheZ([[0, 0], [0, 0.0024], [0.0018, 0.0022], [0.0024, 0]], 8);
    // dome-ish screw head on the sloped rear cap
    const x = Math.cos(a) * r;
    const y = bore + Math.sin(a) * r;
    body.add(g, 'steel', { x, y, z: zHR - 0.0005 });
    g.dispose();
  }

  // Top mounting plate for the carry handle (a flat machined on the crown).
  const topPlate = box(0.03, 0.008, 0.15, 0.0015, 2);
  body.add(topPlate, 'alu', { y: bore + rHouse - 0.001, z: -0.065 });
  topPlate.dispose();

  // Data plate on the left flank, with four rivets.
  const plate = box(0.0015, 0.024, 0.05, 0.0005, 1);
  body.add(plate, 'alu_fine', { x: -rHouse - 0.0002, y: bore + 0.018, z: 0.03, rz: -0.36 });
  plate.dispose();
  for (const dz of [-0.022, 0.022]) {
    for (const dy of [-0.009, 0.009]) {
      const yy = bore + 0.018 + dy;
      const xx = -Math.sqrt(Math.max(0, rHouse * rHouse - (yy - bore) * (yy - bore))) - 0.0012;
      const riv = dome(0.0012, 8, 0.5);
      body.add(riv, 'steel', { x: xx, y: yy, z: 0.03 + dz, ry: -Math.PI / 2 });
      riv.dispose();
    }
  }

  /* ---- lower frame, trigger guard, pistol grip -------------------------- */
  const lower = blob(0.036, 0.032, 0.12, 0.004, 2);
  body.add(lower, 'alu', { y: 0.047, z: 0.012 });
  lower.dispose();
  // Trigger guard: side-plane outline, rolled so the extrusion runs across.
  const guardOuter = [
    [-0.028, 0],
    [0.03, 0],
    [0.032, -0.006],
    [0.028, -0.0225],
    [0.018, -0.0275],
    [-0.02, -0.0275],
    [-0.028, -0.021],
  ];
  const guardInner = [
    [-0.0225, -0.003],
    [0.0245, -0.003],
    [0.0255, -0.008],
    [0.022, -0.0205],
    [0.015, -0.0235],
    [-0.0165, -0.0235],
    [-0.0225, -0.019],
  ];
  const guard = extrude(guardOuter, 0.017, { bevel: 0.0011, bevelSegments: 2, holes: [guardInner] });
  guard.rotateY(Math.PI / 2); // outline-X -> -Z (forward), extrusion -> across
  body.add(guard, 'alu', { y: 0.034, z: -0.012 });
  guard.dispose();
  const gripBoss = box(0.03, 0.012, 0.03, 0.0012, 2);
  body.add(gripBoss, 'alu', { y: 0.026, z: 0.022, rx: -0.15 });
  gripBoss.dispose();
  addPistolGrip(body, 'polymer', 'rubber', { y: 0.019, z: 0.015, angle: 0.3, len: 0.105, w: 0.031 });
  addPin(body, 'steel', 0, 0.042, 0.042, 0.0024, 0.038);
  addPin(body, 'steel', 0, 0.042, -0.036, 0.0024, 0.038);
  // Safety / fire-enable rocker on the left of the lower, above the thumb.
  const rocker = blob(0.006, 0.01, 0.02, 0.002, 2);
  body.add(rocker, 'polymer', { x: -0.0195, y: 0.054, z: 0.02 });
  rocker.dispose();

  /* ---- drive motor + gearbox (lower right) ------------------------------ */
  const mX = 0.053;
  const mY = bore - 0.024;
  const motorProf = [[-0.07, 0]];
  motorProf.push([-0.07, 0.019], [-0.068, 0.021]);
  for (let i = 0; i < 7; i++) {
    const z0 = -0.054 + i * 0.015;
    motorProf.push([z0, 0.021], [z0 + 0.001, 0.0235], [z0 + 0.005, 0.0235], [z0 + 0.006, 0.021]);
  }
  motorProf.push([0.054, 0.021], [0.062, 0.02], [0.07, 0.016], [0.074, 0.008], [0.075, 0]);
  const motor = latheZ(motorProf, 24);
  body.add(motor, 'steel_black', { x: mX, y: mY });
  motor.dispose();
  // Saddle bolting the motor to the housing.
  const saddle = box(0.02, 0.03, 0.11, 0.002, 2);
  body.add(saddle, 'alu', { x: 0.04, y: mY + 0.004, z: 0.0, rz: 0.4 });
  saddle.dispose();
  // Power connector on the motor's rear dome.
  const conn = rodZ(0.0075, 0.0075, 0.016, 14);
  body.add(conn, 'steel', { x: mX, y: mY, z: 0.08 });
  conn.dispose();
  const knurlCap = latheZ([[0, 0], [0, 0.0085], [0.006, 0.0085], [0.007, 0.006], [0.007, 0]], 14);
  body.add(knurlCap, 'alu_fine', { x: mX, y: mY, z: 0.084 });
  knurlCap.dispose();
  // Gearbox ahead of the motor.
  const gearbox = blob(0.04, 0.05, 0.042, 0.004, 2);
  body.add(gearbox, 'alu', { x: 0.045, y: mY + 0.003, z: -0.09 });
  gearbox.dispose();
  for (const [dy, dz] of [[0.018, -0.075], [0.018, -0.105], [-0.016, -0.075], [-0.016, -0.105]]) {
    addScrew(body, 'steel', 0.0655, mY + 0.003 + dy, dz, 0.0022, 'x', 0.006);
  }

  /* ---- ejection chute (bottom right, throws down-right) ----------------- */
  const ejA = [0.042, bore - 0.046];
  const ejDir = [0.8, -0.6];
  const ejLen = 0.034;
  const ejRz = Math.atan2(ejDir[0], -ejDir[1]);
  const chute = box(0.026, ejLen, 0.036, 0.002, 2);
  body.add(chute, 'steel_black', {
    x: ejA[0] + (ejDir[0] * ejLen) / 2,
    y: ejA[1] + (ejDir[1] * ejLen) / 2,
    z: -0.138,
    rz: ejRz,
  });
  chute.dispose();
  const chuteMouth = box(0.02, 0.006, 0.03, 0.001, 1);
  body.add(chuteMouth, 'cavity', {
    x: ejA[0] + ejDir[0] * (ejLen - 0.0025),
    y: ejA[1] + ejDir[1] * (ejLen - 0.0025),
    z: -0.138,
    rz: ejRz,
  });
  chuteMouth.dispose();
  const ejectPt = [ejA[0] + ejDir[0] * ejLen, ejA[1] + ejDir[1] * ejLen, -0.138];

  /* ---- feeder / delinker (left flank) ----------------------------------- */
  const fX = -0.064;
  const fY = bore + 0.003;
  const fZ = -0.1;
  const feeder = blob(0.04, 0.056, 0.088, 0.004, 2);
  body.add(feeder, 'alu', { x: fX, y: fY, z: fZ });
  feeder.dispose();
  // Feed throat: the belt enters through the feeder's lower face.
  const throat = box(0.026, 0.004, 0.072, 0.001, 1);
  body.add(throat, 'cavity', { x: fX - 0.002, y: fY - 0.0275, z: fZ });
  throat.dispose();
  // Sprocket cover boss + cover latch on the outer face.
  const sprocket = latheZ([[0, 0], [0, 0.017], [0.003, 0.017], [0.006, 0.013], [0.006, 0]], 24);
  body.add(sprocket, 'steel_black', { x: fX - 0.02, y: fY + 0.004, z: fZ, ry: -Math.PI / 2 });
  sprocket.dispose();
  addScrew(body, 'steel', fX - 0.0262, fY + 0.004, fZ, 0.003, 'x', 0.004);
  const latch = box(0.006, 0.012, 0.02, 0.0015, 2);
  body.add(latch, 'steel', { x: fX - 0.021, y: fY + 0.02, z: fZ + 0.03 });
  latch.dispose();

  /* ---- carry handle, rail, red dot ------------------------------------- */
  const postY0 = bore + rHouse;
  const barY = postY0 + 0.022;
  for (const pz of [-0.008, -0.122]) {
    const post = blob(0.022, 0.026, 0.018, 0.003, 2);
    body.add(post, 'alu', { y: postY0 + 0.011, z: pz });
    post.dispose();
  }
  const bar = blob(0.026, 0.012, 0.15, 0.003, 2);
  body.add(bar, 'alu', { y: barY + 0.006, z: -0.065 });
  bar.dispose();
  const railTop = barY + 0.012 + 0.0074;
  addRail(body, 'alu', -0.135, 0.005, railTop);
  // Low mount clamped to the rail, carrying an RMR-pattern reflex.
  const mountZ = -0.04;
  const mount = box(0.03, 0.009, 0.052, 0.0015, 2);
  body.add(mount, 'alu', { y: railTop + 0.0035, z: mountZ });
  mount.dispose();
  const mountJaw = box(0.006, 0.012, 0.04, 0.0012, 1);
  body.add(mountJaw, 'alu', { x: 0.0135, y: railTop - 0.002, z: mountZ });
  mountJaw.dispose();
  addScrew(body, 'steel', 0.0168, railTop - 0.002, mountZ - 0.01, 0.0026, 'x', 0.006);
  addScrew(body, 'steel', 0.0168, railTop - 0.002, mountZ + 0.01, 0.0026, 'x', 0.006);
  const optic = buildMiniReflex(body, {
    w: 0.0246,
    h: 0.021,
    len: 0.0455,
    y: railTop + 0.008,
    z: mountZ,
    matBody: 'alu_fine',
  });
  const opticY = optic.center[1];

  /* ---- ammo can + mount ------------------------------------------------- */
  const can = { x: 0.0, w: 0.07, h: 0.105, z0: -0.062, z1: -0.192, top: 0.025 };
  const canD = can.z0 - can.z1;
  const canZ = (can.z0 + can.z1) / 2;
  const canY = can.top - can.h / 2;
  const canBody = box(can.w, can.h, canD, 0.003, 2);
  body.add(canBody, 'olive', { x: can.x, y: canY, z: canZ });
  canBody.dispose();
  const lid = box(can.w + 0.004, 0.012, canD + 0.004, 0.002, 2);
  body.add(lid, 'olive', { x: can.x, y: can.top - 0.004, z: canZ });
  lid.dispose();
  // Pressed stiffening ribs on both long faces and the ends.
  const rib = box(0.003, 0.006, canD - 0.02, 0.0012, 1);
  for (const sx of [-1, 1]) {
    for (const dy of [-0.02, -0.06]) {
      body.add(rib, 'olive', { x: can.x + sx * (can.w / 2 + 0.0008), y: can.top + dy, z: canZ });
    }
  }
  rib.dispose();
  // Lid latch (front) and hinge (rear).
  const canLatch = box(0.03, 0.03, 0.006, 0.0015, 2);
  body.add(canLatch, 'olive', { x: can.x, y: can.top - 0.016, z: can.z1 - 0.003 });
  canLatch.dispose();
  const hinge = rodZ(0.0035, 0.0035, can.w - 0.01, 10);
  body.add(hinge, 'steel_black', { x: can.x, y: can.top - 0.004, z: can.z0 + 0.002, ry: Math.PI / 2 });
  hinge.dispose();
  // Folding wire handle on the right face.
  // Folding strap handle lying flat on the right face, on two pivot lugs.
  const strap = box(0.003, 0.009, 0.07, 0.001, 1);
  body.add(strap, 'steel_black', { x: can.x + can.w / 2 + 0.0035, y: can.top - 0.04, z: canZ });
  strap.dispose();
  const lug = box(0.005, 0.012, 0.008, 0.0012, 1);
  for (const dz of [-0.04, 0.04]) body.add(lug, 'olive', { x: can.x + can.w / 2 + 0.002, y: can.top - 0.036, z: canZ + dz });
  lug.dispose();
  // Belt mouth cut in the top of the left face.
  const mouth = box(0.004, 0.018, 0.07, 0.001, 1);
  body.add(mouth, 'cavity', { x: can.x - can.w / 2 - 0.0005, y: can.top - 0.02, z: -0.1 });
  mouth.dispose();
  // Mount bracket: can lid to the housing's lower frame.
  const bracket = box(0.03, 0.016, 0.1, 0.002, 2);
  body.add(bracket, 'steel_black', { y: can.top + 0.008, z: -0.11 });
  bracket.dispose();
  for (const bz of [-0.075, -0.145]) {
    addScrew(body, 'steel', 0.0152, can.top + 0.008, bz, 0.0024, 'x', 0.006);
  }

  /* ---- linked belt: can mouth -> feeder throat -------------------------- */
  // Quadratic bezier in the XY plane; rounds lie along Z, bullets forward.
  const P0 = [can.x - can.w / 2 + 0.006, can.top - 0.018];
  const P1 = [-0.14, -0.03];
  const P2 = [fX - 0.002, fY - 0.026];
  const bez = (t) => [
    (1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0],
    (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1],
  ];
  const samples = [];
  let acc = 0;
  let prev = bez(0);
  samples.push({ t: 0, s: 0, p: prev });
  for (let i = 1; i <= 200; i++) {
    const p = bez(i / 200);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    samples.push({ t: i / 200, s: acc, p });
    prev = p;
  }
  const beltLen = acc;
  const pitch = 0.0118;
  const at = (s) => {
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].s >= s) {
        const a = samples[i - 1];
        const b = samples[i];
        const f = (s - a.s) / Math.max(1e-9, b.s - a.s);
        return [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f];
      }
    }
    return samples[samples.length - 1].p;
  };
  const caseLen = 0.0446;
  const rimR = 0.00495;
  const rnd = cartridge(caseLen, rimR, 0.019);
  const zHead = fZ + 0.032; // case head; tip at zHead - 0.0636
  const linkLoop = ring(rimR + 0.0009, 0.0008, 10, 3);
  const pts = [];
  for (let s = 0.004; s < beltLen - 0.002; s += pitch) pts.push(at(s));
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    body.add(rnd.brass, 'brass', { x, y, z: zHead, ry: Math.PI });
    body.add(rnd.bullet, 'copper', { x, y, z: zHead, ry: Math.PI });
    body.add(linkLoop, 'steel_black', { x, y, z: zHead - 0.007 });
    body.add(linkLoop, 'steel_black', { x, y, z: zHead - 0.027 });
    if (i + 1 < pts.length) {
      const [nx, ny] = pts[i + 1];
      const dx = nx - x;
      const dy = ny - y;
      const L = Math.hypot(dx, dy);
      // connecting tab between neighbouring loops, on the outside of the curve
      const ox = -dy / L;
      const oy = dx / L;
      const off = rimR + 0.0012;
      const tab = box(0.0018, L, 0.006, 0.0004, 1);
      for (const tz of [zHead - 0.007, zHead - 0.027]) {
        body.add(tab, 'steel_black', {
          x: (x + nx) / 2 + ox * off,
          y: (y + ny) / 2 + oy * off,
          z: tz + (i % 2 ? 0.0035 : -0.0035),
          rz: Math.atan2(-dx, dy),
        });
      }
      tab.dispose();
    }
  }
  rnd.brass.dispose();
  rnd.bullet.dispose();
  linkLoop.dispose();

  /* ---- front bearing collar, beam, vertical grip ------------------------ */
  const zCollar = -0.255;
  const collar = latheZ(
    [
      [zCollar - 0.012, 0.0395],
      [zCollar - 0.012, 0.045],
      [zCollar - 0.01, 0.047],
      [zCollar + 0.01, 0.047],
      [zCollar + 0.012, 0.045],
      [zCollar + 0.012, 0.0395],
      [zCollar - 0.012, 0.0395],
    ],
    36
  );
  body.add(collar, 'alu', { y: bore });
  collar.dispose();
  const beamZ0 = zHF + 0.012;
  const beamZ1 = zCollar - 0.006;
  const beam = box(0.022, 0.012, beamZ0 - beamZ1, 0.002, 2);
  body.add(beam, 'alu', { y: bore - 0.047, z: (beamZ0 + beamZ1) / 2 });
  beam.dispose();
  const gripMount = box(0.026, 0.012, 0.03, 0.002, 2);
  body.add(gripMount, 'alu', { y: bore - 0.054, z: zCollar });
  gripMount.dispose();
  const fgTop = bore - 0.058;
  addForeGrip(body, 'polymer', 'rubber', { y: fgTop, z: zCollar + 0.002, angle: 0.12, len: 0.085 });
  addSlingLoop(body, 'steel_black', -0.049, bore, zCollar, 0.008, { ry: Math.PI / 2 });
  addSlingLoop(body, 'steel_black', -0.03, bore - 0.03, zHR - 0.01, 0.007, { ry: Math.PI / 2 });

  /* ======================================================================= */
  /*  moving: the rotating barrel cluster                                   */
  /* ======================================================================= */
  const barrels = new Assembly('chaingun-barrels');
  // Rotor face visible inside the front bearing ring.
  const rotor = latheZ(
    [
      [zHF - 0.008, 0],
      [zHF - 0.008, 0.032],
      [zHF - 0.006, 0.0345],
      [-0.128, 0.0345],
      [-0.128, 0],
    ],
    36
  );
  barrels.add(rotor, 'steel_black', { y: bore });
  rotor.dispose();
  // Central spindle with its retaining nut ahead of the muzzle clamp.
  const spindle = rodZ(0.0075, 0.0075, Math.abs(zMuzzle + 0.006 - (zHF - 0.008)), 16);
  barrels.add(spindle, 'steel', { y: bore, z: (zMuzzle + 0.006 + zHF - 0.008) / 2 });
  spindle.dispose();
  const nut = latheZ([[0, 0], [0, 0.0105], [0.001, 0.011], [0.009, 0.011], [0.01, 0.0105], [0.01, 0]], 6);
  barrels.add(nut, 'steel', { y: bore, z: zMuzzle - 0.002, rz: Math.PI / 6 });
  nut.dispose();
  const nutBore = rodZ(0.0035, 0.0035, 0.002, 10);
  barrels.add(nutBore, 'cavity', { y: bore, z: zMuzzle - 0.0022 });
  nutBore.dispose();

  // Barrels: thicker chamber end, gentle taper, crowned muzzle.
  const zBr = -0.13;
  const barrelGeo = latheZ(
    [
      [zMuzzle, rBore],
      [zMuzzle, rBarrel - 0.0012],
      [zMuzzle + 0.0012, rBarrel - 0.0004],
      [zMuzzle + 0.03, rBarrel - 0.0004],
      [zMuzzle + 0.032, rBarrel],
      [-0.36, rBarrel + 0.0004],
      [-0.2, rBarrel + 0.0012],
      [-0.185, rBarrel + 0.0016],
      [zBr, rBarrel + 0.0016],
      [zBr, 0],
    ],
    18
  );
  const boreGeo = rodZ(rBore, rBore, 0.03, 10);
  for (let k = 0; k < nBarrels; k++) {
    const a = barrelAng(k);
    const x = Math.cos(a) * pitchR;
    const y = bore + Math.sin(a) * pitchR;
    barrels.add(barrelGeo, 'steel_soot', { x, y });
    barrels.add(boreGeo, 'cavity', { x, y, z: zMuzzle + 0.0153 });
  }
  barrelGeo.dispose();
  boreGeo.dispose();

  // Hexafoil clamps: lobes round each barrel, scallops between.
  const clampOutline = (rMid, amp) => {
    const out = [];
    const N = 48;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      const r = rMid + amp * Math.cos(nBarrels * (t - Math.PI / 2));
      out.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
    return out;
  };
  const clamps = [
    { z: -0.43, d: 0.016, rMid: 0.0345, amp: 0.004 },
    { z: -0.688, d: 0.022, rMid: 0.0355, amp: 0.0045 },
  ];
  for (const c of clamps) {
    const g = extrude(clampOutline(c.rMid, c.amp), c.d, { bevel: 0.0012, bevelSegments: 1 });
    barrels.add(g, 'steel_black', { y: bore, z: c.z });
    g.dispose();
    // clamp bolts between the barrels on the muzzle clamp's front face
    if (c.z > -0.6) continue;
    for (let k = 0; k < nBarrels; k++) {
      const a = barrelAng(k) + Math.PI / nBarrels;
      addScrew(barrels, 'steel', Math.cos(a) * 0.024, bore + Math.sin(a) * 0.024, c.z - c.d / 2 - 0.0002, 0.0024, 'z', 0.006);
    }
  }
  // Rear barrel locking ring just ahead of the housing.
  const lockRing = extrude(clampOutline(0.0335, 0.0035), 0.01, { bevel: 0.001, bevelSegments: 1 });
  barrels.add(lockRing, 'steel_black', { y: bore, z: zHF - 0.014 });
  lockRing.dispose();

  /* ---- trigger -------------------------------------------------------- */
  const trigger = new Assembly('chaingun-trigger');
  const trg = triggerPart('steel');
  trigger.add(trg.geo, 'steel', {});
  trg.geo.dispose();

  const ej = Math.hypot(0.75, -0.6, 0.15);
  return {
    id: 'chaingun',
    label: 'XM556 Microgun',
    fxClass: 'lmg',
    body,
    moving: { barrels, trigger },
    nodes: {
      muzzle: [0, bore, zMuzzle],
      chamber: [0, bore, -0.14],
      eject: ejectPt,
      ejectDir: [0.75 / ej, -0.6 / ej, 0.15 / ej],
      sight: [0, opticY, optic.lensZ],
      sightAxis: [0, 0, -1],
      ironSight: [0, opticY, optic.lensZ],
      gripR: {
        pos: [0.0251, 0.044, 0.1223],
        finger: [0.05, -0.6, -0.798],
        back: [1, 0.03, 0.04],
      },
      // Support hand on the vertical grip under the bearing collar.
      gripL: {
        pos: [-0.056, fgTop - 0.03, zCollar + 0.057],
        finger: [0.45, 0.05, -0.89],
        back: [-0.88, -0.05, -0.45],
      },
      triggerPivot: { pos: [0, 0.0305, -0.0055], rot: [0, 0, 0] },
      triggerPull: -0.3,
      barrelAxis: [0, bore, 0],
      opticGlass: optic,
    },
    shell: { caseLen, rimR },
  };
}
