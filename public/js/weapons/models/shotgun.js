import { Assembly, alignZ, box, blob, extrude, latheZ, rodZ, tubeZ, knurlBand } from '../geometry.js';
import { addPin, addScrew, addSlingLoop, triggerPart } from '../parts.js';

/**
 * The pump shotgun: a Remington 870 tactical pattern.
 *
 * What makes it read as an 870 and not a carbine with a fat barrel:
 *   - a TALL, slab-sided steel receiver (59 mm deep, 32 mm wide) with a
 *     rounded top, the ejection port high on the right and the loading port
 *     open underneath, ahead of the trigger guard;
 *   - a thin, plain barrel with a bead at the muzzle and NOTHING on top of it;
 *   - the magazine tube running parallel under the barrel almost to the
 *     muzzle, held by the barrel ring and a clamp, ending in a knurled cap;
 *   - the pump forend riding the magazine tube, with flared ends and grip
 *     ribs, connected back into the receiver by two exposed action bars;
 *   - a synthetic stock with a semi-pistol grip, a straight comb with real
 *     drop and a thick recoil pad;
 *   - a side-saddle of red shells on the left of the receiver.
 *
 * REAL DIMENSIONS (870 Police / Tactical, 18.5" barrel):
 *   overall length     ~980 mm       modelled ~958
 *   barrel              470 mm       modelled 470 (breech face to crown)
 *   receiver            ~215 mm long, 59 mm tall, 32 mm wide
 *   12 ga 2 3/4" shell  70 mm long, 20.6 mm hull, 22.5 mm rim
 *
 * Layout (weapon-local metres, origin at the thumb web on the wrist, bore -Z):
 *   bore axis        y = +0.060
 *   receiver         z = +0.010 .. -0.205,  y = +0.020 .. +0.079
 *   breech face      z = -0.130
 *   forend (rest)    z = -0.290 .. -0.485   (travels +85 mm to cycle)
 *   muzzle crown     z = -0.600
 *   butt pad         z = +0.363
 */
export function buildShotgun() {
  const bore = 0.060;
  const recHalfW = 0.016;
  const recTop = bore + 0.019;
  const recBot = bore - 0.040;
  const zRecRear = 0.010;
  const zRecFront = -0.205;
  const zBreech = -0.130;
  const zMuzzle = zBreech - 0.470;
  const rBarrel = 0.0105;
  const rBore = 0.0091;
  const rMag = 0.0115;
  const magY = bore - rBarrel - rMag - 0.0012;
  const zMagEnd = -0.572;
  const pumpZ0 = -0.290; // forend rear face at rest
  const pumpZ1 = -0.485; // forend front face
  const pumpTravel = 0.085;
  const portZ = -0.102;

  const body = new Assembly('shotgun-body');

  // ---- receiver ------------------------------------------------------------
  /**
   * Cross-section in XY, extruded along the bore. Flat flanks with a 0.6 mm
   * machining step 18 mm under the bore (the 870's lower receiver is relieved
   * where the trigger plate seats), and a crowned top so the sight line along
   * it catches one soft highlight instead of a hard flat.
   */
  const rw = recHalfW;
  const rwLo = recHalfW - 0.0006;
  const yStep = bore - 0.018;
  const yFlank = bore + 0.011; // where the flank turns into the crown
  /**
   * THE EJECTION PORT IS A REAL NOTCH in the section, run the full length of
   * the receiver and then filled back in fore and aft of the port. A cavity box
   * glued on the outside would put the bolt either proud of the skin (a bright
   * slab sliding down the outside of the action when it cycles) or buried
   * inside a solid. With the notch the bolt sits 1.5 mm under the skin, reads
   * through the opening, and runs back inside the filled-in rear on a stroke.
   * The fillers' own chamfers leave a fine line round the port: the cut edge.
   */
  const portY0 = bore - 0.014;
  const portY1 = bore + 0.007;
  const notchX = rw - 0.007;
  const recSection = [];
  recSection.push(
    [rwLo - 0.002, recBot],
    [rwLo, recBot + 0.002],
    [rwLo, yStep - 0.0006],
    [rw, yStep],
    [rw, portY0],
    [notchX, portY0],
    [notchX, portY1],
    [rw, portY1],
    [rw, yFlank]
  );
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    // superellipse-ish crown from the right flank over to the left
    const c = Math.cos(a);
    const s = Math.sin(a);
    recSection.push([rw * c, yFlank + (recTop - 0.0012 - yFlank) * Math.pow(s, 0.7)]);
  }
  recSection.push([-rw, yFlank], [-rw, yStep], [-rwLo, yStep - 0.0006], [-rwLo, recBot + 0.002], [-rwLo + 0.002, recBot]);
  const recLen = zRecRear - zRecFront;
  const recBevel = 0.0012;
  const rec = extrude(recSection, recLen, { bevel: recBevel, bevelSegments: 2 });
  body.add(rec, 'steel_black', { z: (zRecRear + zRecFront) / 2 });
  rec.dispose();
  // Built surfaces (the bevel grows the outline outward / shrinks the notch).
  const skin = rw + recBevel;
  const nX = notchX + recBevel;
  const nY0 = portY0 + recBevel;
  const nY1 = portY1 - recBevel;
  const portLen = 0.072;
  const portFront = portZ - portLen / 2;
  const portRear = portZ + portLen / 2;
  for (const [z0, z1] of [[zRecFront + 0.0004, portFront], [portRear, zRecRear - 0.0004]]) {
    const fill = box(skin - nX + 0.0004, nY1 - nY0, z1 - z0, 0.0003, 1);
    body.add(fill, 'steel_black', { x: (skin + nX - 0.0004) / 2, y: (nY0 + nY1) / 2, z: (z0 + z1) / 2 });
    fill.dispose();
  }
  // Dark back wall of the port: the chamber mouth ahead of the bolt.
  const portBack = box(0.0006, nY1 - nY0, portLen, 0.0001, 1);
  body.add(portBack, 'cavity', { x: nX + 0.0002, y: (nY0 + nY1) / 2, z: portZ });
  portBack.dispose();

  // Loading port underneath, ahead of the trigger guard, with the shell
  // carrier (elevator) lying in its rear half.
  const lport = box(0.023, 0.011, 0.112, 0.0012, 1);
  body.add(lport, 'cavity', { y: recBot + 0.0041, z: -0.142 });
  lport.dispose();
  const carrier = box(0.017, 0.0022, 0.070, 0.0006, 1);
  body.add(carrier, 'steel', { y: recBot - 0.0007, z: -0.118 });
  carrier.dispose();
  const carrierSlot = box(0.004, 0.0008, 0.046, 0.0002, 1);
  body.add(carrierSlot, 'cavity', { y: recBot - 0.0017, z: -0.112 });
  carrierSlot.dispose();
  // Magazine tube mouth visible in the front of the port, with the follower.
  const follower = rodZ(rMag - 0.0015, rMag - 0.0015, 0.004, 16);
  body.add(follower, 'polymer', { y: magY, z: zRecFront + 0.010 });
  follower.dispose();

  // Trigger plate pins, through both flanks.
  for (const z of [-0.070, -0.004]) addPin(body, 'steel', 0, recBot + 0.010, z, 0.0021, 2 * (rwLo + recBevel) + 0.0004);

  // Receiver front face: barrel shoulder ring.
  const shoulder = latheZ([[0, 0.0098], [0, 0.0128], [0.004, 0.0132], [0.014, 0.0132], [0.014, 0.0098]], 24);
  body.add(shoulder, 'steel_black', { y: bore, z: zRecFront - 0.014 });
  shoulder.dispose();

  // ---- barrel --------------------------------------------------------------
  /**
   * One lathe: a slight taper from the receiver to the crown, a thin wall
   * (12 ga is an 18.4 mm bore — the muzzle reads as a big dark hole, which is
   * the single strongest "shotgun" cue head-on) and a rounded crown.
   */
  const bLen = zRecFront - 0.012 - zMuzzle;
  const barrel = latheZ(
    [
      [0.0010, rBore],
      [0, rBore + 0.0006],
      [0, rBarrel - 0.0006],
      [0.0008, rBarrel],
      [bLen * 0.6, rBarrel + 0.0004],
      [bLen, rBarrel + 0.0012],
      [bLen, rBore],
      [0.0010, rBore],
    ],
    28
  );
  body.add(barrel, 'steel_black', { y: bore, z: zMuzzle });
  barrel.dispose();
  const boreLiner = tubeZ(rBore - 0.0001, rBore - 0.0010, 0.12, 20, 0.0002);
  body.add(boreLiner, 'cavity', { y: bore, z: zMuzzle + 0.062 });
  boreLiner.dispose();
  const boreCap = rodZ(rBore - 0.0005, rBore - 0.0005, 0.002, 16);
  body.add(boreCap, 'cavity', { y: bore, z: zMuzzle + 0.12 });
  boreCap.dispose();

  // Front sight: a short ramp brazed to the barrel with a brass bead on top.
  // Bead top on the receiver's top line, so the eye looks straight down it.
  const zBead = zMuzzle + 0.012;
  const ramp = extrude(
    [
      [-0.006, 0],
      [0.008, 0],
      [0.004, 0.0064],
      [-0.004, 0.0064],
    ],
    0.004,
    { bevel: 0.0004 }
  );
  ramp.rotateY(-Math.PI / 2);
  body.add(ramp, 'steel_black', { y: bore + rBarrel - 0.0012, z: zBead });
  ramp.dispose();
  const beadR = 0.0021;
  const beadY = recTop - beadR;
  const bead = latheZ([[-beadR, 0], [-beadR * 0.7, beadR * 0.72], [0, beadR], [beadR * 0.7, beadR * 0.72], [beadR, 0]], 12);
  body.add(bead, 'brass', { y: beadY, z: zBead });
  bead.dispose();

  // ---- magazine tube -------------------------------------------------------
  const magLen = zRecFront - zMagEnd;
  const magTube = rodZ(rMag, rMag, magLen, 22, 0.0004);
  body.add(magTube, 'steel_black', { y: magY, z: (zRecFront + zMagEnd) / 2 });
  magTube.dispose();
  // Extension coupling, where the factory cap used to screw on.
  const coupling = latheZ([[0, rMag], [0.001, rMag + 0.0012], [0.013, rMag + 0.0012], [0.014, rMag]], 22);
  body.add(coupling, 'steel', { y: magY, z: -0.528 });
  coupling.dispose();

  // Barrel ring: soldered under the barrel, the magazine tube passes through.
  const zRing = -0.503;
  const ringBand = tubeZ(rMag + 0.0022, rMag - 0.0002, 0.016, 22, 0.0005);
  body.add(ringBand, 'steel_black', { y: magY, z: zRing });
  ringBand.dispose();
  const ringWeb = box(0.012, bore - magY, 0.016, 0.0008, 1);
  body.add(ringWeb, 'steel_black', { y: (bore + magY) / 2, z: zRing });
  ringWeb.dispose();

  // Barrel clamp near the muzzle: two bands joined by a web, cross screw,
  // and a sling loop off the left.
  const zClamp = -0.556;
  const clampB = tubeZ(rBarrel + 0.0032, rBarrel + 0.0002, 0.014, 22, 0.0005);
  body.add(clampB, 'polymer', { y: bore, z: zClamp });
  clampB.dispose();
  const clampM = tubeZ(rMag + 0.0032, rMag + 0.0001, 0.014, 22, 0.0005);
  body.add(clampM, 'polymer', { y: magY, z: zClamp });
  clampM.dispose();
  const clampWeb = box(0.020, bore - magY, 0.014, 0.0015, 2);
  body.add(clampWeb, 'polymer', { y: (bore + magY) / 2, z: zClamp });
  clampWeb.dispose();
  addScrew(body, 'steel', 0.0102, (bore + magY) / 2, zClamp, 0.0028, 'x', 0.006);
  addScrew(body, 'steel', -0.0102, (bore + magY) / 2, zClamp, 0.0028, 'x', 0.006);
  addSlingLoop(body, 'steel', -0.016, magY - 0.006, zClamp, 0.009, { ry: Math.PI / 2 });

  // Magazine cap: knurled, with a sling stud on its nose.
  const cap = latheZ(
    [
      [0, 0],
      [0, rMag + 0.0014],
      [0.0015, rMag + 0.0022],
      [0.018, rMag + 0.0022],
      [0.022, rMag + 0.0004],
      [0.024, rMag - 0.003],
      [0.024, 0],
    ],
    22
  );
  body.add(cap, 'steel_black', { y: magY, z: zMagEnd, ry: Math.PI });
  cap.dispose();
  const capKnurl = knurlBand(rMag + 0.0022, 0.013, 28, 0.00035, 3);
  body.add(capKnurl, 'steel_black', { y: magY, z: zMagEnd - 0.010 });
  capKnurl.dispose();

  // ---- trigger guard + controls -------------------------------------------
  /**
   * The 870's trigger plate hangs out of the receiver bottom as the guard.
   * Side outline in (z, y), turned so outline-X runs along +Z and the 12 mm
   * extrusion lands across the weapon, with the finger opening a real hole.
   */
  const arc = (cz, cy, r, a0, a1, n) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  };
  const gFront = [-0.064, recBot - 0.011];
  const gRear = [-0.003, recBot - 0.013];
  const guard = extrude(
    [
      [-0.083, recBot + 0.004],
      ...arc(gFront[0], gFront[1], 0.0185, Math.PI, Math.PI * 1.5, 7),
      ...arc(gRear[0], gRear[1], 0.0165, Math.PI * 1.5, Math.PI * 2, 7),
      [0.0135, recBot + 0.004],
    ],
    0.012,
    {
      bevel: 0.0012,
      bevelSegments: 2,
      holes: [
        [
          [-0.0765, recBot - 0.002],
          ...arc(gFront[0], gFront[1], 0.0125, Math.PI, Math.PI * 1.5, 6),
          ...arc(gRear[0], gRear[1], 0.0105, Math.PI * 1.5, Math.PI * 2, 6),
          [0.0075, recBot - 0.002],
        ],
      ],
    }
  );
  guard.rotateY(-Math.PI / 2);
  body.add(guard, 'polymer', {});
  guard.dispose();
  // Trigger plate seated in the receiver's underside, behind the loading port.
  const plate = box(0.0262, 0.003, 0.096, 0.0008, 1);
  body.add(plate, 'polymer', { y: recBot - 0.0016, z: -0.036 });
  plate.dispose();

  // Cross-bolt safety, through the rear of the guard; red band on the left.
  const safety = rodZ(0.0034, 0.0034, 0.0172, 14, 0.0006);
  body.add(safety, 'steel_black', { y: recBot - 0.0065, z: 0.0105, ry: Math.PI / 2 });
  safety.dispose();
  const redBand = tubeZ(0.0036, 0.0030, 0.0018, 14, 0.0002);
  body.add(redBand, 'red_hull', { x: -0.0068, y: recBot - 0.0065, z: 0.0105, ry: Math.PI / 2 });
  redBand.dispose();

  // Action-bar lock (slide release), on the left just behind the guard's
  // front bow.
  const release = extrude(
    [
      [-0.004, 0.003],
      [0.006, 0.003],
      [0.006, -0.002],
      [0.002, -0.006],
      [-0.004, -0.004],
    ],
    0.0024,
    { bevel: 0.0005 }
  );
  release.rotateY(-Math.PI / 2);
  body.add(release, 'steel_black', { x: -0.0074, y: recBot - 0.003, z: -0.086 });
  release.dispose();

  // ---- stock ---------------------------------------------------------------
  /**
   * Synthetic stock with a semi-pistol grip. Side outline as two monotone
   * chains (bottom front-to-back, top back-to-front) so it cannot self-cross.
   * The 4.5 mm bevel grows the outline outward, so the numbers below are 4.5
   * mm inside the finished surface: the top front lands at 0.0765, flush
   * under the receiver's crown, and the comb drops ~25 mm under the sight line.
   */
  const sb = 0.007;
  const stockHalf = 0.012;
  const stock = extrude(
    [
      // bottom, front to back
      [0.012, recBot + sb + 0.002],
      [0.020, 0.006],
      [0.025, -0.020],
      [0.032, -0.044],
      [0.042, -0.064],
      [0.074, -0.068],
      [0.088, -0.050],
      [0.104, -0.026],
      [0.130, -0.010],
      [0.170, -0.020],
      [0.334, -0.092],
      // top, back to front
      [0.334, 0.016],
      [0.200, 0.030],
      [0.100, 0.040],
      [0.050, 0.046],
      [0.028, 0.060],
      [0.012, recTop - sb - 0.003],
    ],
    stockHalf * 2,
    { bevel: sb, bevelSegments: 4, curveSegments: 4 }
  );
  stock.rotateY(-Math.PI / 2);
  body.add(stock, 'polymer', {});
  stock.dispose();

  // Overmoulded grip panels on the pistol grip.
  const gripPanel = extrude(
    [
      [0.030, -0.006],
      [0.048, -0.010],
      [0.074, -0.044],
      [0.074, -0.064],
      [0.046, -0.064],
      [0.034, -0.040],
    ],
    0.0016,
    { bevel: 0.0007, bevelSegments: 1 }
  );
  gripPanel.rotateY(-Math.PI / 2);
  for (const sx of [-1, 1]) body.add(gripPanel, 'rubber', { x: sx * (stockHalf + sb - 0.0004) });
  gripPanel.dispose();

  // Recoil pad, with a hard black spacer between it and the stock.
  const yHeel = 0.016 + sb;
  const yToe = -0.092 - sb;
  const padH = yHeel - yToe;
  const spacer = box(0.0385, padH + 0.001, 0.004, 0.0012, 1);
  body.add(spacer, 'steel_black', { y: (yHeel + yToe) / 2, z: 0.334 + sb + 0.002 });
  spacer.dispose();
  const pad = blob(0.041, padH + 0.002, 0.022, 0.006, 3);
  body.add(pad, 'rubber', { y: (yHeel + yToe) / 2, z: 0.334 + sb + 0.015 });
  pad.dispose();
  // Moulded vent slots on the pad flanks.
  for (let i = 0; i < 4; i++) {
    const slot = box(0.002, 0.018, 0.010, 0.0008, 1);
    for (const sx of [-1, 1]) {
      body.add(slot, 'cavity', { x: sx * 0.0198, y: yToe + 0.024 + i * 0.026, z: 0.334 + sb + 0.016 });
    }
    slot.dispose();
  }

  // Rear sling stud + swivel on the belly ahead of the toe.
  const zStud = 0.288;
  const bellyY = -0.020 + ((zStud - 0.170) / (0.334 - 0.170)) * (-0.092 + 0.020) - sb;
  const stud = latheZ([[0, 0], [0, 0.0045], [0.007, 0.0040], [0.0075, 0]], 12);
  body.add(stud, 'steel_black', { y: bellyY + 0.002, z: zStud, ...alignZ(0, -1, 0) });
  stud.dispose();
  addSlingLoop(body, 'steel', 0, bellyY - 0.011, zStud, 0.007, { ry: Math.PI / 2 });


  // ---- side-saddle -----------------------------------------------------------
  /**
   * Six-shell carrier on the LEFT of the receiver: an aluminium plate on the
   * trigger-plate pins with a polymer clip block, shells brass-up, standing
   * below the receiver's belly the way a real Mesa saddle hangs them.
   */
  const ssZ0 = -0.188;
  const ssPitch = 0.0232;
  const ssN = 6;
  const ssLen = ssPitch * ssN + 0.006;
  const ssCz = ssZ0 + (ssPitch * (ssN - 1)) / 2;
  const ssPlate = box(0.003, 0.040, ssLen, 0.0008, 1);
  body.add(ssPlate, 'alu', { x: -skin - 0.0012, y: bore - 0.012, z: ssCz });
  ssPlate.dispose();
  const xShell = -skin - 0.0026 - 0.0112;
  const clip = box(0.026, 0.011, ssLen, 0.0018, 2);
  for (const y of [bore + 0.006, bore - 0.022]) body.add(clip, 'polymer', { x: xShell + 0.0005, y, z: ssCz });
  clip.dispose();
  const hull = latheZ(
    [
      [0, 0],
      [0, 0.0098],
      [0.001, 0.0102],
      [0.054, 0.0102],
      [0.0548, 0.0094],
      [0.0548, 0],
    ],
    14
  );
  const head = latheZ(
    [
      [0, 0],
      [0, 0.0108],
      [0.0012, 0.0113],
      [0.0018, 0.0113],
      [0.0024, 0.0104],
      [0.016, 0.0104],
      [0.016, 0],
    ],
    14
  );
  const primer = rodZ(0.0028, 0.0028, 0.0006, 10, 0.0001);
  const up = alignZ(0, 1, 0);
  const down = alignZ(0, -1, 0);
  const yHead = bore + 0.016; // top of the brass
  for (let i = 0; i < ssN; i++) {
    const z = ssZ0 + i * ssPitch;
    // head authored from its face (z=0) down into the hull
    body.add(head, 'brass', { x: xShell, y: yHead, z, ...down });
    body.add(hull, 'red_hull', { x: xShell, y: yHead - 0.0155, z, ...down });
    body.add(primer, 'copper', { x: xShell, y: yHead + 0.0001, z, ...up });
  }
  hull.dispose();
  head.dispose();
  primer.dispose();

  // ---- moving: pump --------------------------------------------------------
  const pump = new Assembly('shotgun-pump');
  /**
   * Forend cross-section around the magazine tube, with a channel on top that
   * cradles the barrel's lower half. Authored about the tube axis so the ribs
   * and flared ends can be the same outline scaled outward.
   */
  const forendRight = [
    [0.0118, 0.0102],
    [0.0124, 0.0182],
    [0.0138, 0.0204],
  ];
  // Superellipse flank and belly (n = 2.6): full, rounded, not a box.
  for (let i = 0; i <= 10; i++) {
    const t = ((55 - (145 * i) / 10) * Math.PI) / 180;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const p = 2 / 2.6;
    forendRight.push([
      i === 10 ? 0 : 0.0236 * Math.sign(c) * Math.pow(Math.abs(c), p),
      -0.002 + 0.0236 * Math.sign(sn) * Math.pow(Math.abs(sn), p),
    ]);
  }
  const forendPts = [...forendRight, ...forendRight.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
  const scaled = (k, ky = k, yc = -0.004) => forendPts.map(([x, y]) => [x * k, yc + (y - yc) * ky]);
  const fLen = pumpZ0 - pumpZ1;
  const fCore = extrude(forendPts, fLen, { bevel: 0.0015, bevelSegments: 2 });
  pump.add(fCore, 'polymer', { y: magY, z: (pumpZ0 + pumpZ1) / 2 });
  fCore.dispose();
  // Flared hand-stops at both ends.
  const flare = extrude(scaled(1.11, 1.09), 0.012, { bevel: 0.0022, bevelSegments: 2 });
  pump.add(flare, 'polymer', { y: magY, z: pumpZ0 - 0.007 });
  pump.add(flare, 'polymer', { y: magY, z: pumpZ1 + 0.008 });
  flare.dispose();
  // Grip ribs across the middle.
  const rib = extrude(scaled(1.065, 1.05), 0.0075, { bevel: 0.0014, bevelSegments: 2 });
  const nRibs = 9;
  const ribZ0 = pumpZ0 - 0.034;
  const ribPitch = (fLen - 0.068) / (nRibs - 1);
  for (let i = 0; i < nRibs; i++) pump.add(rib, 'polymer', { y: magY, z: ribZ0 - i * ribPitch });
  rib.dispose();
  // Forend tube collar at the rear and retaining nut at the front.
  const collar = tubeZ(rMag + 0.0018, rMag + 0.0002, 0.010, 22, 0.0004);
  pump.add(collar, 'steel_black', { y: magY, z: pumpZ0 + 0.001 });
  collar.dispose();
  const nut = latheZ([[0, rMag + 0.0002], [0, rMag + 0.0034], [0.005, rMag + 0.0034], [0.006, rMag + 0.0002]], 12);
  pump.add(nut, 'steel', { y: magY, z: pumpZ1 - 0.006 });
  nut.dispose();
  // Twin action bars back into the receiver, either side of the tube.
  const barLen = pumpZ0 - zRecFront + 0.030;
  const bar = box(0.0024, 0.0070, barLen, 0.0005, 1);
  for (const sx of [-1, 1]) {
    pump.add(bar, 'steel', { x: sx * (rMag + 0.0010), y: magY + 0.0045, z: pumpZ0 - barLen / 2 + 0.035 });
  }
  bar.dispose();

  // ---- moving: bolt (seen through the ejection port) ------------------------
  const bolt = new Assembly('shotgun-bolt');
  // Sits in the notch, 1.5 mm under the skin, a 2 mm dark gap above and below.
  const boltH = nY1 - nY0 - 0.004;
  const boltW = skin - 0.0015 - nX;
  const boltSlab = box(boltW, boltH, 0.046, 0.0008, 2);
  bolt.add(boltSlab, 'steel_bright', { x: nX + boltW / 2, y: (nY0 + nY1) / 2, z: portZ + 0.011 });
  boltSlab.dispose();
  // Extractor claw at the bolt's front end.
  const extractor = box(0.0016, 0.006, 0.012, 0.0004, 1);
  bolt.add(extractor, 'steel', { x: nX + boltW + 0.0004, y: (nY0 + nY1) / 2 + 0.003, z: portZ - 0.008 });
  extractor.dispose();
  const boltLine = box(0.0008, 0.0010, 0.034, 0.0002, 1);
  bolt.add(boltLine, 'cavity', { x: nX + boltW + 0.0001, y: (nY0 + nY1) / 2 - 0.003, z: portZ + 0.018 });
  boltLine.dispose();

  // ---- moving: trigger -------------------------------------------------------
  const trigger = new Assembly('shotgun-trigger');
  const trg = triggerPart('steel_black');
  trigger.add(trg.geo, 'steel_black', {});
  trg.geo.dispose();

  const pumpMidZ = (pumpZ0 + pumpZ1) / 2;
  return {
    id: 'shotgun',
    label: 'M870 Tactical',
    fxClass: 'shotgun',
    body,
    moving: { pump, bolt, trigger },
    nodes: {
      muzzle: [0, bore, zMuzzle],
      chamber: [0, bore, zBreech],
      eject: [skin + 0.008, (nY0 + nY1) / 2, portZ],
      ejectDir: [0.9, 0.38, 0.2],
      sight: [0, recTop, zBead],
      sightAxis: [0, 0, -1],
      ironSight: [0, recTop, zRecRear - 0.004],
      gripR: {
        pos: [0.0251, 0.040, 0.112],
        finger: [0.05, -0.6, -0.798],
        back: [1, 0.03, 0.04],
      },
      // Support hand under the pump, wrapping up the far side.
      gripL: {
        pos: [-0.1, magY - 0.002, pumpMidZ + 0.025],
        finger: [0.8977, -0.3267, -0.2955],
        back: [-0.2784, -0.7648, 0.581],
      },
      handguard: { axis: [0, magY, 0], dir: [0, 0, 1], r: 0.026, z0: pumpZ0, z1: pumpZ1 },
      pumpRest: { pos: [0, 0, 0], rot: [0, 0, 0] },
      pumpTravel: [0, 0, pumpTravel],
      boltRest: { pos: [0, 0, 0], rot: [0, 0, 0] },
      boltTravel: [0, 0, pumpTravel],
      triggerPivot: { pos: [0, recBot + 0.0015, -0.038], rot: [0, 0, 0] },
      triggerPull: -0.28,
    },
    shell: { caseLen: 0.070, rimR: 0.0113 },
  };
}
