import { Assembly, alignZ, box, blob, extrude, latheZ, rodZ, tubeZ, dome, ring, roundRect, knurlBand } from '../geometry.js';
import { addPistolGrip, addPin, addScrew, addSlingLoop, triggerPart } from '../parts.js';

/**
 * The rocket launcher — an RPG-7V with a PG-7V round loaded.
 *
 * What makes it read as an RPG-7 at a glance:
 *   - a long, thin, dark steel tube with a bare muzzle section and a big flared
 *     venturi / blast cone at the back;
 *   - TWO wooden heat-shield sleeves, fat against the thin tube, either side of
 *     the trigger group;
 *   - a pistol grip and trigger group hung well below the bore, a second grip
 *     forward, an exposed hammer behind the grip;
 *   - tall folding iron sights on top and the PGO-7 optic on a LEFT-side bracket;
 *   - the PG-7V: a long olive cone, the 85 mm body, a boat-tail and the thin
 *     sustainer motor disappearing into the muzzle with its folded fins.
 *
 * REAL DIMENSIONS (RPG-7V / PG-7V):
 *   launcher length      950 mm      modelled 951
 *   bore                  40 mm      modelled 41
 *   warhead diameter      85 mm      modelled 85
 *   warhead out of muzzle ~450 mm    modelled 450
 *
 * Layout (weapon-local metres, origin at the shooting hand's thumb web, bore
 * down -Z, venturi toward +Z):
 *   bore axis       y = +0.095
 *   muzzle          z = -0.570
 *   front shield    z = -0.362 .. -0.142
 *   trigger         z = -0.033
 *   rear shield     z = +0.045 .. +0.240
 *   venturi exit    z = +0.381
 *   warhead tip     z = -1.020
 */
export function buildLauncher() {
  const body = new Assembly('rpg7');
  const bore = 0.095;
  const zM = -0.57; // muzzle face
  const rBore = 0.0205;
  const rFront = 0.0245; // bare front tube
  const rMid = 0.0285; // chamber section round the trigger group
  const rRear = 0.026;
  const zExit = 0.381; // venturi exit plane
  const T = { y: bore };

  // ---- launch tube ------------------------------------------------------------
  const tube = latheZ(
    [
      [zM + 0.002, rBore],
      [zM, rBore + 0.0015],
      [zM, 0.0262],
      [zM + 0.002, 0.0268],
      [zM + 0.018, 0.0268],
      [zM + 0.021, rFront],
      [-0.362, rFront],
      [-0.30, rFront + 0.0004],
      [-0.15, rMid - 0.001],
      [-0.142, rMid],
      [0.038, rMid],
      [0.044, rRear],
      [0.238, rRear],
      [0.238, rBore],
      [zM + 0.002, rBore],
    ],
    40
  );
  body.add(tube, 'steel_black', T);
  tube.dispose();
  // Bore liner a few cm in: the inside of the tube goes dark, not lit steel.
  const liner = tubeZ(rBore - 0.0003, rBore - 0.0009, 0.12, 32, 0.0002);
  body.add(liner, 'cavity', { y: bore, z: zM + 0.062 });
  liner.dispose();
  // A muzzle reinforcing ring and a couple of seams along the bare section.
  for (const z of [-0.47, -0.395]) {
    const band = latheZ([[z - 0.004, rFront], [z - 0.003, rFront + 0.0009], [z + 0.003, rFront + 0.0009], [z + 0.004, rFront]], 40);
    body.add(band, 'steel', T);
    band.dispose();
  }

  // ---- wooden heat shields ----------------------------------------------------
  const shield = (z0, z1, r, rIn) => {
    const g = latheZ(
      [
        [z0, rIn],
        [z0, r - 0.004],
        [z0 + 0.003, r - 0.0012],
        [z0 + 0.012, r],
        [(z0 + z1) / 2, r + 0.0008],
        [z1 - 0.012, r],
        [z1 - 0.003, r - 0.0012],
        [z1, r - 0.004],
        [z1, rIn],
      ],
      44
    );
    body.add(g, 'wood', T);
    g.dispose();
  };
  const fz0 = -0.362;
  const fz1 = -0.142;
  const rz0 = 0.045;
  const rz1 = 0.240;
  const rWood = 0.0355;
  shield(fz0, fz1, rWood, rFront);
  shield(rz0, rz1, rWood + 0.0015, rRear);

  // Steel retaining bands at the shield ends, each with a clamp lug and screw.
  const bandAt = (z, r, w, lugSide = -1) => {
    const g = latheZ(
      [
        [z - w / 2, 0.0235],
        [z - w / 2, r + 0.0008],
        [z - w / 2 + 0.001, r + 0.0018],
        [z + w / 2 - 0.001, r + 0.0018],
        [z + w / 2, r + 0.0008],
        [z + w / 2, 0.0235],
      ],
      44
    );
    body.add(g, 'steel_black', T);
    g.dispose();
    // clamp lug, under the tube and off to one side
    const a = lugSide * 2.5;
    const lx = Math.sin(a) * (r + 0.0035);
    const ly = bore + Math.cos(a) * (r + 0.0035);
    const lug = box(0.009, 0.007, w * 0.9, 0.0012, 1);
    body.add(lug, 'steel_black', { x: lx, y: ly, z, rz: -a });
    lug.dispose();
    const scr = latheZ([[0, 0], [0, 0.0022], [0.0015, 0.0022], [0.0025, 0.0012], [0.0025, 0]], 10);
    const d = [Math.sin(a), Math.cos(a), 0];
    body.add(scr, 'steel', {
      x: lx + d[0] * 0.0035,
      y: ly + d[1] * 0.0035,
      z,
      ...alignZ(d[0], d[1], 0),
    });
    // slot across the head
    const slot = box(0.0042, 0.0006, 0.0006, 0.0001, 1);
    body.add(slot, 'cavity', { x: lx + d[0] * 0.006, y: ly + d[1] * 0.006, z, rz: -a });
    slot.dispose();
    scr.dispose();
  };
  bandAt(fz0 + 0.005, rWood, 0.012, -1);
  bandAt(fz1 - 0.005, rWood, 0.012, 1);
  bandAt(rz0 + 0.005, rWood + 0.0015, 0.012, 1);
  bandAt(rz1 - 0.005, rWood + 0.0015, 0.012, -1);

  // ---- venturi / blast cone ---------------------------------------------------
  const venturi = latheZ(
    [
      [0.232, rRear - 0.001],
      [0.234, 0.0305],
      [0.236, 0.0315],
      [0.256, 0.0315],
      [0.259, 0.0285],
      [0.268, 0.0262],
      [0.282, 0.0262],
      [0.295, 0.0285],
      [0.35, 0.040],
      [0.372, 0.0455],
      [0.374, 0.0478],
      [0.38, 0.0478],
      [zExit, 0.0468],
      [zExit, 0.0442],
    ],
    48
  );
  body.add(venturi, 'steel_black', T);
  venturi.dispose();
  // Venturi interior, authored rear-to-front so its faces point inward.
  const throat = latheZ(
    [
      [zExit, 0.0442],
      [0.377, 0.0435],
      [0.31, 0.022],
      [0.292, 0.0158],
      [0.282, 0.0158],
      [0.276, 0.0],
    ],
    48
  );
  body.add(throat, 'cavity', T);
  throat.dispose();
  // Joint ring between the tube and the venturi, with its four screws.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const s = latheZ([[0, 0], [0, 0.0018], [0.0012, 0.0016], [0.0016, 0]], 8);
    body.add(s, 'steel', {
      x: Math.cos(a) * 0.0313,
      y: bore + Math.sin(a) * 0.0313,
      z: 0.246,
      ...alignZ(Math.cos(a), Math.sin(a), 0),
    });
    s.dispose();
  }

  // ---- trigger group ----------------------------------------------------------
  // Side profile (z, y) of the firing-mechanism housing, extruded across X.
  const housingTop = bore - rMid + 0.004;
  const housing = extrude(
    [
      [-0.088, housingTop],
      [0.036, housingTop],
      [0.036, 0.052],
      [0.026, 0.036],
      [0.018, 0.026],
      [-0.012, 0.026],
      [-0.06, 0.028],
      [-0.076, 0.036],
      [-0.088, 0.05],
    ],
    0.024,
    { bevel: 0.0018, bevelSegments: 2 }
  );
  housing.rotateY(-Math.PI / 2); // outline-X -> +Z, extrusion across X
  body.add(housing, 'steel_black', {});
  housing.dispose();
  // Saddle that wraps the tube over the housing.
  const saddle = latheZ([[-0.092, rMid - 0.001], [-0.09, rMid + 0.0025], [0.038, rMid + 0.0025], [0.04, rMid - 0.001]], 40, Math.PI * 0.62, Math.PI * 0.76);
  body.add(saddle, 'steel_black', T);
  saddle.dispose();
  // Pins through the housing.
  addPin(body, 'steel', 0, 0.044, -0.064, 0.0019, 0.027);
  addPin(body, 'steel', 0, 0.041, -0.022, 0.0019, 0.027);
  addPin(body, 'steel', 0, 0.05, 0.024, 0.0019, 0.027);

  // Trigger guard: a stamped loop ahead of the grip.
  const guard = extrude(
    [
      [-0.064, 0.03],
      [-0.068, 0.004],
      [-0.06, -0.006],
      [-0.016, -0.006],
      [-0.008, 0.004],
      [-0.006, 0.03],
    ],
    0.011,
    {
      bevel: 0.0008,
      holes: [
        [
          [-0.058, 0.029],
          [-0.012, 0.029],
          [-0.012, 0.006],
          [-0.017, -0.0015],
          [-0.057, -0.0015],
          [-0.061, 0.006],
        ],
      ],
    }
  );
  guard.rotateY(-Math.PI / 2);
  body.add(guard, 'steel_black', {});
  guard.dispose();

  // Pistol grip (bakelite).
  addPistolGrip(body, 'polymer', 'polymer', { y: 0.029, z: 0.008, angle: 0.24, len: 0.104, w: 0.03 });

  // Exposed hammer behind the housing, spur raked back for the thumb.
  const hammer = extrude(
    [
      [0.0, 0.0],
      [0.006, 0.0],
      [0.012, 0.016],
      [0.022, 0.024],
      [0.023, 0.029],
      [0.016, 0.029],
      [0.004, 0.019],
      [-0.002, 0.006],
    ],
    0.009,
    { bevel: 0.0008 }
  );
  hammer.rotateY(-Math.PI / 2);
  body.add(hammer, 'steel', { y: 0.03, z: 0.03 });
  hammer.dispose();
  // spur serrations
  for (let i = 0; i < 4; i++) {
    const g = box(0.0095, 0.0012, 0.0016, 0.0003, 1);
    body.add(g, 'steel', { y: 0.03 + 0.0285, z: 0.03 + 0.016 + i * 0.0022 });
    g.dispose();
  }
  addPin(body, 'steel_bright', 0, 0.033, 0.033, 0.0016, 0.026);

  // Cross-bolt safety above the grip, button proud on both sides.
  const safety = rodZ(0.0035, 0.0035, 0.032, 16, 0.0008);
  body.add(safety, 'steel_bright', { y: 0.036, z: -0.004, ry: Math.PI / 2 });
  safety.dispose();
  const safetyRing = ring(0.0042, 0.0007, 16, 6);
  body.addMirrored(safetyRing, 'steel_black', { x: 0.0125, y: 0.036, z: -0.004, ry: Math.PI / 2 });
  safetyRing.dispose();

  // ---- front grip -------------------------------------------------------------
  const fgZ = -0.205;
  // Clamp ring round the forward shield with a drop block under it.
  const clamp = latheZ(
    [
      [fgZ - 0.013, rWood - 0.002],
      [fgZ - 0.013, rWood + 0.0015],
      [fgZ - 0.012, rWood + 0.0028],
      [fgZ + 0.012, rWood + 0.0028],
      [fgZ + 0.013, rWood + 0.0015],
      [fgZ + 0.013, rWood - 0.002],
    ],
    44
  );
  body.add(clamp, 'steel_black', T);
  clamp.dispose();
  const drop = extrude(
    [
      [-0.016, bore - rWood + 0.004],
      [0.016, bore - rWood + 0.004],
      [0.016, 0.04],
      [0.012, 0.036],
      [-0.019, 0.036],
      [-0.02, 0.046],
    ],
    0.02,
    { bevel: 0.0014, bevelSegments: 2 }
  );
  drop.rotateY(-Math.PI / 2);
  body.add(drop, 'steel_black', { z: fgZ });
  drop.dispose();
  addScrew(body, 'steel', 0.0102, 0.05, fgZ, 0.0024, 'x', 0.006);
  addScrew(body, 'steel', -0.0102, 0.05, fgZ, 0.0024, 'x', 0.006);
  addPistolGrip(body, 'polymer', 'polymer', { y: 0.04, z: fgZ + 0.001, angle: 0.12, len: 0.098, w: 0.029 });

  // ---- iron sights ------------------------------------------------------------
  const ironY = bore + 0.066;
  // Front sight: clamp collar near the muzzle, hinge block, folding post with ears.
  const fsZ = zM + 0.045;
  const fsCollar = latheZ([[fsZ - 0.012, rFront - 0.001], [fsZ - 0.012, rFront + 0.0025], [fsZ + 0.012, rFront + 0.0025], [fsZ + 0.012, rFront - 0.001]], 40);
  body.add(fsCollar, 'steel_black', T);
  fsCollar.dispose();
  const fsBase = box(0.016, 0.01, 0.022, 0.0015, 1);
  body.add(fsBase, 'steel_black', { y: bore + rFront + 0.006, z: fsZ });
  fsBase.dispose();
  addPin(body, 'steel', 0, bore + rFront + 0.008, fsZ + 0.006, 0.0016, 0.019);
  const fsLeaf = extrude(
    [
      [-0.006, 0],
      [0.006, 0],
      [0.006, 0.026],
      [0.0024, 0.03],
      [0.0012, 0.03],
      [0.0012, 0.0386],
      [-0.0012, 0.0386],
      [-0.0012, 0.03],
      [-0.0024, 0.03],
      [-0.006, 0.026],
    ],
    0.0032,
    { bevel: 0.0004 }
  );
  body.add(fsLeaf, 'steel_black', { y: bore + rFront + 0.0085, z: fsZ + 0.006 });
  fsLeaf.dispose();
  // protective ears either side of the post
  const ear = box(0.0022, 0.03, 0.007, 0.0006, 1);
  body.addMirrored(ear, 'steel_black', { x: 0.0072, y: bore + rFront + 0.024, z: fsZ + 0.006 });
  ear.dispose();

  // Rear sight: leaf on a base block above the trigger group, notch on top.
  const rsZ = -0.078;
  const rsBase = box(0.02, 0.012, 0.03, 0.0016, 1);
  body.add(rsBase, 'steel_black', { y: bore + rMid + 0.004, z: rsZ });
  rsBase.dispose();
  addPin(body, 'steel', 0, bore + rMid + 0.007, rsZ + 0.01, 0.0017, 0.023);
  const rsLeaf = extrude(
    [
      [-0.008, 0],
      [0.008, 0],
      [0.007, 0.03],
      [0.007, 0.0345],
      [0.0016, 0.0345],
      [0.0011, 0.031],
      [-0.0011, 0.031],
      [-0.0016, 0.0345],
      [-0.007, 0.0345],
      [-0.007, 0.03],
    ],
    0.003,
    { bevel: 0.0004, holes: [[[-0.0035, 0.008], [0.0035, 0.008], [0.0035, 0.024], [-0.0035, 0.024]]] }
  );
  body.add(rsLeaf, 'steel_black', { y: bore + rMid + 0.009, z: rsZ + 0.01 });
  rsLeaf.dispose();
  // range slider on the leaf
  const slider = box(0.019, 0.005, 0.006, 0.0008, 1);
  body.add(slider, 'steel', { y: bore + rMid + 0.024, z: rsZ + 0.01 });
  slider.dispose();

  // ---- PGO-7 optic on the left-side bracket ----------------------------------
  const ox = -0.066;
  const oy = bore + 0.03;
  const oz0 = -0.12; // objective
  const oz1 = 0.03; // eyepiece face
  // Dovetail bracket welded to the tube's left flank.
  const bracket = box(0.008, 0.03, 0.09, 0.0012, 1);
  body.add(bracket, 'steel_black', { x: -rMid - 0.002, y: bore + 0.004, z: -0.05 });
  bracket.dispose();
  const rail = box(0.006, 0.012, 0.086, 0.0008, 1);
  body.add(rail, 'steel', { x: -rMid - 0.008, y: bore + 0.012, z: -0.05 });
  rail.dispose();
  for (const z of [-0.082, -0.05, -0.018]) addScrew(body, 'steel', -rMid - 0.006, bore - 0.004, z, 0.0022, 'x', 0.004);
  // Mount: clamp shoe on the rail, arm out and up to the sight body.
  const shoe = box(0.016, 0.022, 0.06, 0.0018, 2);
  body.add(shoe, 'steel_black', { x: -rMid - 0.017, y: bore + 0.014, z: -0.05 });
  shoe.dispose();
  const arm = extrude(
    [
      [-0.004, 0],
      [0.012, 0],
      [0.03, 0.022],
      [0.03, 0.03],
      [0.018, 0.03],
      [-0.004, 0.012],
    ],
    0.05,
    { bevel: 0.0015, bevelSegments: 2 }
  );
  // outline X -> -X (outboard), Y up, depth along Z
  body.add(arm, 'steel_black', { x: -rMid - 0.02, y: bore + 0.008, z: -0.05, ry: Math.PI });
  arm.dispose();
  // Clamp lever and its knurled nut on the outboard face of the shoe.
  const lever = box(0.004, 0.006, 0.04, 0.0015, 2);
  body.add(lever, 'steel_bright', { x: -rMid - 0.027, y: bore + 0.006, z: -0.036, rx: 0.15 });
  lever.dispose();
  const nut = rodZ(0.0055, 0.0055, 0.005, 16, 0.0006);
  body.add(nut, 'steel', { x: -rMid - 0.028, y: bore + 0.012, z: -0.064, ry: Math.PI / 2 });
  nut.dispose();
  // Sight body: rounded block with the prism hump on top.
  const optBody = blob(0.036, 0.042, 0.092, 0.008, 3);
  body.add(optBody, 'steel_black', { x: ox, y: oy - 0.002, z: -0.045 });
  optBody.dispose();
  const hump = blob(0.03, 0.02, 0.05, 0.007, 3);
  body.add(hump, 'steel_black', { x: ox, y: oy + 0.02, z: -0.028 });
  hump.dispose();
  // Objective tube with sunshade, and its lens.
  const obj = latheZ(
    [
      [oz0 + 0.002, 0.0135],
      [oz0, 0.0145],
      [oz0, 0.0175],
      [oz0 + 0.002, 0.0182],
      [oz0 + 0.026, 0.0182],
      [oz0 + 0.03, 0.0165],
      [oz0 + 0.06, 0.0165],
      [oz0 + 0.06, 0.0],
    ],
    36
  );
  body.add(obj, 'steel_black', { x: ox, y: oy });
  obj.dispose();
  const objIn = latheZ([[oz0 + 0.002, 0.0135], [oz0 + 0.014, 0.0135], [oz0 + 0.014, 0.0]], 36);
  body.add(objIn, 'cavity', { x: ox, y: oy });
  objIn.dispose();
  const lens = dome(0.0134, 24, 0.18);
  body.add(lens, 'glass', { x: ox, y: oy, z: oz0 + 0.0125, ry: Math.PI });
  lens.dispose();
  // Eyepiece and the big rubber eyecup.
  const eye = latheZ(
    [
      [-0.005, 0.0],
      [-0.005, 0.0125],
      [0.012, 0.0125],
      [0.014, 0.011],
      [oz1 - 0.004, 0.011],
      [oz1 - 0.004, 0.0],
    ],
    32
  );
  body.add(eye, 'steel_black', { x: ox, y: oy });
  eye.dispose();
  const cupZ = oz1 - 0.006;
  const cup = latheZ(
    [
      [cupZ, 0.0105],
      [cupZ, 0.0135],
      [cupZ + 0.02, 0.016],
      [cupZ + 0.036, 0.0205],
      [cupZ + 0.04, 0.0205],
      [cupZ + 0.041, 0.0185],
      [cupZ + 0.03, 0.0155],
      [cupZ + 0.006, 0.0095],
    ],
    32
  );
  body.add(cup, 'rubber', { x: ox, y: oy });
  cup.dispose();
  const eyeLens = dome(0.0095, 20, 0.15);
  body.add(eyeLens, 'glass', { x: ox, y: oy, z: cupZ + 0.006 });
  eyeLens.dispose();
  // Elevation turret on top and the illumination drum on the outboard flank.
  const turret = rodZ(0.0085, 0.0085, 0.012, 24, 0.001);
  body.add(turret, 'steel_black', { x: ox, y: oy + 0.032, z: -0.05, rx: -Math.PI / 2 });
  turret.dispose();
  const kn = knurlBand(0.0086, 0.008, 26, 0.00035, 2);
  body.add(kn, 'steel_black', { x: ox, y: oy + 0.032, z: -0.05, rx: -Math.PI / 2 });
  kn.dispose();
  const drum = rodZ(0.0095, 0.0095, 0.011, 24, 0.001);
  body.add(drum, 'steel_black', { x: ox - 0.023, y: oy - 0.002, z: -0.06, ry: Math.PI / 2 });
  drum.dispose();
  const cap = rodZ(0.006, 0.006, 0.006, 16, 0.001);
  body.add(cap, 'steel', { x: ox - 0.023, y: oy - 0.006, z: -0.022, ry: Math.PI / 2 });
  cap.dispose();
  for (const z of [-0.078, -0.012]) addScrew(body, 'steel', ox - 0.018, oy - 0.014, z, 0.0018, 'x', 0.004);

  // ---- sling swivels ----------------------------------------------------------
  const swivel = (z, r) => {
    const stud = box(0.006, 0.008, 0.01, 0.001, 1);
    body.add(stud, 'steel_black', { x: -r - 0.003, y: bore - 0.006, z, rz: 0.4 });
    stud.dispose();
    addSlingLoop(body, 'steel', -r - 0.007, bore - 0.014, z, 0.009, { ry: Math.PI / 2 });
  };
  swivel(fz0 + 0.004, rWood + 0.0018);
  swivel(rz1 - 0.004, rWood + 0.0033);

  // ---- PG-7V round (moving: hidden after firing) -----------------------------
  const warhead = new Assembly('rpg7-warhead');
  const zt = zM - 0.45; // nose tip
  const zCone0 = zt + 0.026;
  const zCone1 = zt + 0.236;
  const zCyl1 = zt + 0.272;
  const zTail = zt + 0.318;
  const rW = 0.0425;
  // Piezo nose fuse: small probe, then the ogive cap.
  const fuse = latheZ(
    [
      [zt, 0],
      [zt, 0.0032],
      [zt + 0.002, 0.0045],
      [zt + 0.011, 0.0055],
      [zt + 0.013, 0.0085],
      [zt + 0.016, 0.0098],
      [zt + 0.024, 0.0108],
      [zCone0, 0.0112],
      [zCone0, 0],
    ],
    28
  );
  warhead.add(fuse, 'steel', T);
  fuse.dispose();
  const prof = [[zCone0, 0.0],[zCone0, 0.0118]];
  const N = 10;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    // nearly straight cone, a touch convex toward the shoulder
    const r = 0.0118 + (rW - 0.0118) * (t + 0.035 * Math.sin(Math.PI * t));
    prof.push([zCone0 + (zCone1 - zCone0) * t, Math.min(rW, r)]);
  }
  prof.push(
    [zCone1 + 0.004, rW],
    [zCyl1 - 0.004, rW],
    [zCyl1, rW - 0.0012],
    [zCyl1 + 0.008, rW - 0.0045],
    [zCyl1 + 0.022, 0.033],
    [zTail - 0.008, 0.0235],
    [zTail, 0.0215],
    [zTail, 0.0]
  );
  const cone = latheZ(prof, 48);
  warhead.add(cone, 'olive', T);
  cone.dispose();
  // Seam band where the cone meets the body.
  const seam = latheZ([[zCone1 - 0.002, rW - 0.0002], [zCone1, rW + 0.0006], [zCone1 + 0.004, rW + 0.0006], [zCone1 + 0.006, rW - 0.0002]], 48);
  warhead.add(seam, 'steel_black', T);
  seam.dispose();
  // Sustainer motor: nozzle ring then the thin body into the tube.
  const zMot = zTail;
  const motor = latheZ(
    [
      [zMot - 0.002, 0.0],
      [zMot - 0.002, 0.0212],
      [zMot + 0.022, 0.0212],
      [zMot + 0.025, 0.0192],
      [zM - 0.07, 0.0192],
      [zM - 0.066, 0.0184],
      [zM + 0.05, 0.0184],
      [zM + 0.05, 0.0],
    ],
    36
  );
  warhead.add(motor, 'steel_black', T);
  motor.dispose();
  // Six angled sustainer nozzles round the ring.
  const noz = latheZ([[0, 0.0026], [0.004, 0.0034], [0.004, 0.0], [0.0005, 0.0], [0.0005, 0.0018], [0, 0.0018]], 10);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const d = [Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.89];
    warhead.add(noz, 'steel_soot', {
      x: Math.cos(a) * 0.0198,
      y: bore + Math.sin(a) * 0.0198,
      z: zMot + 0.011,
      ...alignZ(-d[0], -d[1], -d[2]),
    });
  }
  noz.dispose();
  // Folded stabiliser fins, lying flat on the motor, vanishing into the bore.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = box(0.011, 0.0014, 0.085, 0.0004, 1);
    warhead.add(fin, 'steel', {
      x: Math.cos(a) * 0.0191,
      y: bore + Math.sin(a) * 0.0191,
      z: zM + 0.012,
      rz: a - Math.PI / 2,
    });
    fin.dispose();
  }
  // Fin hinge collar just ahead of the muzzle.
  const collar = latheZ([[zM - 0.034, 0.0184], [zM - 0.033, 0.0199], [zM - 0.028, 0.0199], [zM - 0.027, 0.0184]], 36);
  warhead.add(collar, 'steel', T);
  collar.dispose();

  // ---- trigger ----------------------------------------------------------------
  const trigger = new Assembly('rpg7-trigger');
  const trg = triggerPart('steel_bright');
  trigger.add(trg.geo, 'steel_bright', {});
  trg.geo.dispose();

  const sightZ = cupZ + 0.04; // rear rim of the eyecup
  return {
    id: 'rocket',
    label: 'RPG-7',
    fxClass: 'launcher',
    body,
    moving: { warhead, trigger },
    nodes: {
      muzzle: [0, bore, zM],
      chamber: [0, bore, -0.03],
      eject: [0, bore, zExit],
      ejectDir: [0, 0, 1],
      backblast: [0, bore, zExit],
      // The PGO-7 line (left of the tube); ironSight is the centre-line irons.
      sight: [ox, oy, sightZ],
      sightAxis: [0, 0, -1],
      ironSight: [0, ironY, rsZ + 0.01],
      gripR: {
        pos: [0.0245, 0.016, 0.02],
        finger: [0.05, -0.6, -0.798],
        back: [1, 0.03, 0.04],
      },
      gripL: {
        pos: [-0.0245, 0.026, fgZ + 0.012],
        finger: [-0.05, -0.62, -0.783],
        back: [-1, 0.03, 0.04],
      },
      triggerPivot: { pos: [0, 0.025, -0.034], rot: [0, 0, 0] },
      triggerPull: -0.28,
    },
  };
}
