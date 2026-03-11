import * as THREE from "./vendor/three.module.js";

const ROAD_WIDTH = 12;
const ROAD_SEGMENT_LENGTH = 8;
const ROAD_SEGMENT_COUNT = 240;
const TRAFFIC_COUNT = 12;
const TRACK_SAMPLES = 1500;
const UP = new THREE.Vector3(0, 1, 0);

const dom = {
  canvas: document.querySelector("#game-canvas"),
  menuOverlay: document.querySelector("#menu-overlay"),
  finishOverlay: document.querySelector("#finish-overlay"),
  startBtn: document.querySelector("#start-btn"),
  restartBtn: document.querySelector("#restart-btn"),
  laps: document.querySelector("#laps-select"),
  power: document.querySelector("#power-select"),
  tc: document.querySelector("#tc-select"),
  brake: document.querySelector("#brake-select"),
  hud: document.querySelector("#hud"),
  statusBanner: document.querySelector("#status-banner"),
  finishTitle: document.querySelector("#finish-title"),
  finishSummary: document.querySelector("#finish-summary"),
  hudLap: document.querySelector("#hud-lap"),
  hudTime: document.querySelector("#hud-time"),
  hudBest: document.querySelector("#hud-best"),
  hudSector: document.querySelector("#hud-sector"),
  hudSpeed: document.querySelector("#hud-speed"),
  hudView: document.querySelector("#hud-view"),
  hudClean: document.querySelector("#hud-clean"),
  hudScore: document.querySelector("#hud-score"),
  hudSetup: document.querySelector("#hud-setup"),
};

const state = {
  mode: "menu",
  paused: false,
  cameraMode: 1,
  keys: new Set(),
  setup: {
    totalLaps: 3,
    powerMap: 1,
    tcLevel: 4,
    brakeBias: 0,
  },
  truck: {
    distance: 0,
    speed: 0,
    laneOffset: 0,
    laneVelocity: 0,
    topSpeedKmh: 0,
    collisions: 0,
  },
  race: {
    raceTime: 0,
    lap: 1,
    bestLap: Infinity,
    lastLap: 0,
    lapStartTime: 0,
    sectorStartTime: 0,
    nextSectorIndex: 0,
    nextSectorDistance: 0,
    bestSectors: [Infinity, Infinity, Infinity],
  },
  score: {
    cleanDrive: 100,
    gtPoints: 0,
    penalties: 0,
  },
};

const renderer = new THREE.WebGLRenderer({
  canvas: dom.canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x95c3e8);
scene.fog = new THREE.Fog(0x93c2e7, 170, 950);

const camera = new THREE.PerspectiveCamera(67, window.innerWidth / window.innerHeight, 0.1, 2600);
const cameraRig = {
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
};

const clock = new THREE.Clock();
const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();

setupLighting();
setupEnvironment();

const track = buildTrack(TRACK_SAMPLES);
const roadSegments = createRoadSegments();
const racingLine = createRacingLine(88);
const truck = createTruck();
scene.add(truck.group);
const traffic = createTraffic(TRAFFIC_COUNT);
const roadside = createRoadsideDecor(220);
scene.add(roadside);

bindEvents();
resetRaceState();
updateRoadMeshes(state.truck.distance);
updateTraffic(0, true);
updateTruckTransform(0);
updateRacingLine();
updateHud();

requestAnimationFrame(loop);

function setupLighting() {
  const hemi = new THREE.HemisphereLight(0xdff3ff, 0x4d6f4a, 1.05);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1cf, 1.15);
  sun.position.set(220, 280, -140);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -380;
  sun.shadow.camera.right = 380;
  sun.shadow.camera.top = 380;
  sun.shadow.camera.bottom = -380;
  scene.add(sun);
}

function setupEnvironment() {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1100, 120),
    new THREE.MeshStandardMaterial({ color: 0x5d8f58, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x6f8f74,
    roughness: 0.95,
    metalness: 0.02,
  });

  for (let i = 0; i < 38; i += 1) {
    const angle = (i / 38) * Math.PI * 2;
    const radius = 700 + Math.sin(i * 1.7) * 26;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(40 + (i % 4) * 18, 120 + (i % 6) * 14, 7), ringMaterial);
    mountain.position.set(Math.cos(angle) * radius, 58, Math.sin(angle) * radius);
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    scene.add(mountain);
  }
}

function buildTrack(samples) {
  const points = [];
  const tangents = [];
  const cumulative = [0];

  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples;
    const angle = u * Math.PI * 2;
    const radius = 230 + Math.sin(angle * 2.3) * 36 + Math.sin(angle * 5.2 + 0.8) * 22;

    points.push(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle * 3.4 + 0.7) * 2.4 + Math.sin(angle * 8.1) * 0.8,
        Math.sin(angle) * radius
      )
    );

    if (i > 0) {
      cumulative[i] = cumulative[i - 1] + points[i - 1].distanceTo(points[i]);
    }
  }

  for (let i = 0; i < samples; i += 1) {
    const prev = points[(i - 1 + samples) % samples];
    const next = points[i + 1];
    tangents.push(next.clone().sub(prev).normalize());
  }

  return {
    points,
    tangents,
    cumulative,
    samples,
    totalLength: cumulative[samples],
  };
}

function sampleTrackByDistance(distance) {
  const wrappedDistance = modulo(distance, track.totalLength);
  let low = 0;
  let high = track.samples;

  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (track.cumulative[mid] <= wrappedDistance) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const segmentLength = Math.max(0.00001, track.cumulative[low + 1] - track.cumulative[low]);
  const localT = (wrappedDistance - track.cumulative[low]) / segmentLength;

  const position = track.points[low].clone().lerp(track.points[low + 1], localT);
  const tangent = track.tangents[low]
    .clone()
    .lerp(track.tangents[(low + 1) % track.samples], localT)
    .normalize();

  const side = tempVecA.crossVectors(UP, tangent).clone();
  if (side.lengthSq() < 0.0001) {
    side.set(1, 0, 0);
  } else {
    side.normalize();
  }

  const up = tempVecB.crossVectors(tangent, side).clone().normalize();

  return {
    position,
    tangent,
    side,
    up,
    progress: wrappedDistance / track.totalLength,
    wrappedDistance,
  };
}

function createRoadSegments() {
  const root = new THREE.Group();
  scene.add(root);

  const asphaltGeom = new THREE.BoxGeometry(ROAD_WIDTH, 0.08, ROAD_SEGMENT_LENGTH * 1.04);
  const centerGeom = new THREE.BoxGeometry(0.24, 0.04, ROAD_SEGMENT_LENGTH * 0.56);
  const edgeGeom = new THREE.BoxGeometry(0.12, 0.04, ROAD_SEGMENT_LENGTH * 1.02);

  const asphaltDark = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.9, metalness: 0.06 });
  const asphaltLight = new THREE.MeshStandardMaterial({ color: 0x32353b, roughness: 0.88, metalness: 0.05 });
  const centerMat = new THREE.MeshBasicMaterial({ color: 0xf8e386 });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xf7fbff });

  const segments = [];

  for (let i = 0; i < ROAD_SEGMENT_COUNT; i += 1) {
    const segment = new THREE.Group();

    const asphalt = new THREE.Mesh(asphaltGeom, i % 2 === 0 ? asphaltDark : asphaltLight);
    asphalt.receiveShadow = true;
    segment.add(asphalt);

    if (i % 2 === 0) {
      const centerLine = new THREE.Mesh(centerGeom, centerMat);
      centerLine.position.set(0, 0.06, 0);
      segment.add(centerLine);
    }

    const leftEdge = new THREE.Mesh(edgeGeom, edgeMat);
    leftEdge.position.set(-ROAD_WIDTH / 2 + 0.2, 0.06, 0);
    segment.add(leftEdge);

    const rightEdge = new THREE.Mesh(edgeGeom, edgeMat);
    rightEdge.position.set(ROAD_WIDTH / 2 - 0.2, 0.06, 0);
    segment.add(rightEdge);

    root.add(segment);
    segments.push(segment);
  }

  return { root, segments };
}

function updateRoadMeshes(baseDistance) {
  for (let i = 0; i < ROAD_SEGMENT_COUNT; i += 1) {
    const relative = (i - ROAD_SEGMENT_COUNT * 0.25) * ROAD_SEGMENT_LENGTH;
    const frame = sampleTrackByDistance(baseDistance + relative);
    const segment = roadSegments.segments[i];

    segment.position.copy(frame.position).addScaledVector(frame.up, 0.06);
    tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
    segment.quaternion.setFromRotationMatrix(tempMatrix);
  }
}

function createTruck() {
  const group = new THREE.Group();

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(2.55, 1.1, 7.2),
    new THREE.MeshStandardMaterial({ color: 0x114a8d, roughness: 0.55, metalness: 0.32 })
  );
  chassis.position.y = 1.25;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  group.add(chassis);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.8, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x2f8be2, roughness: 0.45, metalness: 0.25 })
  );
  cabin.position.set(0, 2.15, 2.1);
  cabin.castShadow = true;
  group.add(cabin);

  const windshield = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xbde7ff, transparent: true, opacity: 0.72 })
  );
  windshield.position.set(0, 2.3, 3.33);
  group.add(windshield);

  const trailer = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.2, 5.3),
    new THREE.MeshStandardMaterial({ color: 0xd4e6f5, roughness: 0.72, metalness: 0.12 })
  );
  trailer.position.set(0, 1.8, -3.3);
  trailer.castShadow = true;
  trailer.receiveShadow = true;
  group.add(trailer);

  const wheelGeom = new THREE.CylinderGeometry(0.48, 0.48, 0.36, 18);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.92, metalness: 0.1 });

  const wheelOffsets = [
    [-1.15, 0.62, 2.6],
    [1.15, 0.62, 2.6],
    [-1.15, 0.62, 0.8],
    [1.15, 0.62, 0.8],
    [-1.15, 0.62, -3.2],
    [1.15, 0.62, -3.2],
  ];

  const wheels = [];
  for (const [x, y, z] of wheelOffsets) {
    const wheel = new THREE.Mesh(wheelGeom, wheelMat);
    wheel.position.set(x, y, z);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    group.add(wheel);
    wheels.push(wheel);
  }

  return {
    group,
    wheels,
    parts: {
      chassis,
      cabin,
      windshield,
      trailer,
    },
  };
}

function createTraffic(count) {
  const vehicles = [];
  for (let i = 0; i < count; i += 1) {
    const hue = (i * 0.13) % 1;
    const color = new THREE.Color().setHSL(hue, 0.55, 0.46);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.9, 4.4),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.22 })
    );
    body.position.y = 1.08;
    body.castShadow = true;

    const car = new THREE.Group();
    car.add(body);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.65, 2),
      new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.9 })
    );
    roof.position.set(0, 1.78, 0.35);
    car.add(roof);

    scene.add(car);

    vehicles.push({
      mesh: car,
      distance: Math.random() * track.totalLength,
      speed: 20 + Math.random() * 10,
      lane: Math.random() > 0.5 ? -2.6 : 2.6,
      targetLane: Math.random() > 0.5 ? -2.6 : 2.6,
      hitCooldown: 0,
    });
  }
  return vehicles;
}

function createRoadsideDecor(count) {
  const root = new THREE.Group();

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x66492f, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a7c41, roughness: 0.92 });

  for (let i = 0; i < count; i += 1) {
    const randomDistance = (i / count) * track.totalLength + Math.random() * 12;
    const sideSign = Math.random() > 0.5 ? -1 : 1;
    const extraOffset = 13 + Math.random() * 21;

    const frame = sampleTrackByDistance(randomDistance);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 2.7, 7), trunkMat);
    trunk.castShadow = true;
    trunk.position.copy(frame.position)
      .addScaledVector(frame.side, sideSign * extraOffset)
      .addScaledVector(frame.up, 1.3);

    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1.6 + Math.random() * 0.6, 8, 8), leafMat);
    leaf.castShadow = true;
    leaf.position.copy(trunk.position).addScaledVector(frame.up, 1.7);

    root.add(trunk);
    root.add(leaf);
  }

  return root;
}

function createRacingLine(pointCount) {
  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
  });

  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  scene.add(line);

  return { line, geometry, positions, colors, pointCount };
}

function updateRacingLine() {
  if (state.mode !== "racing") {
    racingLine.line.visible = false;
    return;
  }

  racingLine.line.visible = true;
  const speedKmh = state.truck.speed * 3.6;

  for (let i = 0; i < racingLine.pointCount; i += 1) {
    const lookDistance = state.truck.distance + 14 + i * 6;
    const frame = sampleTrackByDistance(lookDistance);

    const index = i * 3;
    const markerPosition = frame.position
      .clone()
      .addScaledVector(frame.side, state.truck.laneOffset * 0.2)
      .addScaledVector(frame.up, 0.22);

    racingLine.positions[index] = markerPosition.x;
    racingLine.positions[index + 1] = markerPosition.y;
    racingLine.positions[index + 2] = markerPosition.z;

    const previousTangent = sampleTrackByDistance(lookDistance - 8).tangent;
    const nextTangent = sampleTrackByDistance(lookDistance + 8).tangent;
    const curvature = previousTangent.angleTo(nextTangent);
    const targetSpeed = THREE.MathUtils.clamp(138 - curvature * 360, 58, 136);

    const color = getRacingLineColor(speedKmh, targetSpeed);
    racingLine.colors[index] = color.r;
    racingLine.colors[index + 1] = color.g;
    racingLine.colors[index + 2] = color.b;
  }

  racingLine.geometry.attributes.position.needsUpdate = true;
  racingLine.geometry.attributes.color.needsUpdate = true;
}

function getRacingLineColor(speed, targetSpeed) {
  if (speed < targetSpeed - 8) {
    return new THREE.Color(0x4be37a);
  }
  if (speed <= targetSpeed + 8) {
    return new THREE.Color(0xf9d55e);
  }
  return new THREE.Color(0xff5d5d);
}

function bindEvents() {
  window.addEventListener("resize", onResize);

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
      event.preventDefault();
    }

    state.keys.add(key);

    if (key === "c") {
      setCameraMode(state.cameraMode === 3 ? 1 : state.cameraMode + 1);
    }
    if (key === "1" || key === "2" || key === "3") {
      setCameraMode(Number(key));
    }
    if (key === "escape" && state.mode === "racing") {
      togglePause();
    }
    if (key === "r" && state.mode === "racing") {
      resetTruckToTrack();
    }
    if (key === "f") {
      toggleFullscreen();
    }
  });

  window.addEventListener("keyup", (event) => {
    state.keys.delete(event.key.toLowerCase());
  });

  dom.startBtn.addEventListener("click", startRaceFromMenu);
  dom.restartBtn.addEventListener("click", startRaceFromMenu);
}

function setCameraMode(mode) {
  state.cameraMode = THREE.MathUtils.clamp(mode, 1, 3);
  updateTruckVisibility();
  updateHud();
}

function startRaceFromMenu() {
  state.setup.totalLaps = Number(dom.laps.value);
  state.setup.powerMap = Number(dom.power.value);
  state.setup.tcLevel = Number(dom.tc.value);
  state.setup.brakeBias = Number(dom.brake.value);

  dom.menuOverlay.classList.remove("visible");
  dom.finishOverlay.classList.remove("visible");
  dom.hud.classList.remove("hidden");

  state.mode = "racing";
  state.paused = false;
  dom.statusBanner.classList.add("hidden");

  resetRaceState();
}

function resetRaceState() {
  state.truck.distance = 0;
  state.truck.speed = 0;
  state.truck.laneOffset = 0;
  state.truck.laneVelocity = 0;
  state.truck.topSpeedKmh = 0;
  state.truck.collisions = 0;

  state.race.raceTime = 0;
  state.race.lap = 1;
  state.race.bestLap = Infinity;
  state.race.lastLap = 0;
  state.race.lapStartTime = 0;
  state.race.sectorStartTime = 0;
  state.race.nextSectorIndex = 0;
  state.race.nextSectorDistance = track.totalLength / 3;
  state.race.bestSectors = [Infinity, Infinity, Infinity];

  state.score.cleanDrive = 100;
  state.score.gtPoints = 0;
  state.score.penalties = 0;

  for (let i = 0; i < traffic.length; i += 1) {
    const vehicle = traffic[i];
    vehicle.distance = 30 + i * (track.totalLength / TRAFFIC_COUNT) + Math.random() * 22;
    vehicle.speed = 19 + Math.random() * 11;
    vehicle.lane = Math.random() > 0.5 ? -2.6 : 2.6;
    vehicle.targetLane = Math.random() > 0.5 ? -2.6 : 2.6;
    vehicle.hitCooldown = 0;
  }

  const frame = sampleTrackByDistance(state.truck.distance);
  const initialCamPos = frame.position.clone().addScaledVector(frame.up, 6).addScaledVector(frame.tangent, -12);
  const initialCamLook = frame.position.clone().addScaledVector(frame.tangent, 16).addScaledVector(frame.up, 1.5);
  cameraRig.pos.copy(initialCamPos);
  cameraRig.look.copy(initialCamLook);
  camera.position.copy(initialCamPos);
  camera.lookAt(initialCamLook);

  updateRoadMeshes(state.truck.distance);
  updateTraffic(0, true);
  updateTruckTransform(0);
  updateRacingLine();
  updateHud();
}

function resetTruckToTrack() {
  state.truck.speed *= 0.35;
  state.truck.laneOffset = 0;
  state.truck.laneVelocity = 0;
}

function updatePhysics(dt) {
  const throttle = state.keys.has("w") || state.keys.has("arrowup") ? 1 : 0;
  const braking = state.keys.has("s") || state.keys.has("arrowdown") ? 1 : 0;
  const left = state.keys.has("a") || state.keys.has("arrowleft") ? 1 : 0;
  const right = state.keys.has("d") || state.keys.has("arrowright") ? 1 : 0;
  const steerInput = right - left;

  const maxSpeed = 39 * state.setup.powerMap;
  const engineForce = 15 * state.setup.powerMap;
  const brakeForce = 23 + state.setup.brakeBias * 5;
  const drag = 0.018;

  const lateralStress = Math.abs(steerInput) * (state.truck.speed / Math.max(maxSpeed, 0.1));
  const tcAssist = state.setup.tcLevel / 6;
  const tractionLimiter = 1 - lateralStress * 0.35 * (1 - tcAssist * 0.85);

  const acceleration =
    throttle * engineForce * THREE.MathUtils.clamp(tractionLimiter, 0.55, 1) -
    braking * brakeForce -
    drag * state.truck.speed * state.truck.speed -
    1.4;

  state.truck.speed = THREE.MathUtils.clamp(state.truck.speed + acceleration * dt, 0, maxSpeed);

  const steerAuthority = THREE.MathUtils.lerp(6.2, 3.1, state.truck.speed / maxSpeed);
  state.truck.laneVelocity += steerInput * steerAuthority * dt;
  state.truck.laneVelocity *= 1 - 4.8 * dt;
  state.truck.laneOffset += state.truck.laneVelocity * dt;

  const roadEdge = ROAD_WIDTH * 0.5 - 0.95;
  if (Math.abs(state.truck.laneOffset) > roadEdge) {
    state.score.cleanDrive = Math.max(0, state.score.cleanDrive - dt * 12);
    state.truck.speed *= 1 - dt * 0.9;
    state.truck.laneOffset = THREE.MathUtils.clamp(state.truck.laneOffset, -roadEdge - 1.6, roadEdge + 1.6);
  }

  if (steerInput !== 0 && state.truck.speed > maxSpeed * 0.6) {
    state.score.cleanDrive = Math.max(0, state.score.cleanDrive - dt * 2.4 * Math.abs(steerInput));
  }

  if (throttle > 0 && Math.abs(state.truck.laneOffset) < roadEdge - 0.3) {
    state.score.gtPoints += state.truck.speed * dt * 0.95;
  }

  if (state.truck.speed > state.truck.topSpeedKmh / 3.6) {
    state.truck.topSpeedKmh = state.truck.speed * 3.6;
  }

  state.score.cleanDrive = Math.min(100, state.score.cleanDrive + dt * 0.5);

  state.truck.distance += state.truck.speed * dt;
}

function updateTruckTransform(dt) {
  const frame = sampleTrackByDistance(state.truck.distance);

  truck.group.position
    .copy(frame.position)
    .addScaledVector(frame.side, state.truck.laneOffset)
    .addScaledVector(frame.up, 1.14);

  tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
  tempQuat.setFromRotationMatrix(tempMatrix);
  truck.group.quaternion.slerp(tempQuat, 0.26);
  updateTruckVisibility();

  const wheelSpin = state.truck.speed * dt / 0.48;
  for (const wheel of truck.wheels) {
    wheel.rotation.x -= wheelSpin;
  }

  const targetCamera = getCameraTargets(frame);
  cameraRig.pos.lerp(targetCamera.position, 0.15);
  cameraRig.look.lerp(targetCamera.lookAt, 0.2);
  camera.position.copy(cameraRig.pos);
  camera.up.copy(frame.up);
  camera.lookAt(cameraRig.look);
}

function updateTruckVisibility() {
  if (state.cameraMode === 1) {
    truck.parts.chassis.visible = false;
    truck.parts.cabin.visible = false;
    truck.parts.windshield.visible = false;
    truck.parts.trailer.visible = false;
    for (const wheel of truck.wheels) wheel.visible = false;
    return;
  }

  if (state.cameraMode === 2) {
    truck.parts.chassis.visible = false;
    truck.parts.cabin.visible = false;
    truck.parts.windshield.visible = false;
    truck.parts.trailer.visible = false;
    for (const wheel of truck.wheels) wheel.visible = false;
    return;
  }

  truck.parts.chassis.visible = true;
  truck.parts.cabin.visible = true;
  truck.parts.windshield.visible = true;
  truck.parts.trailer.visible = true;
  for (const wheel of truck.wheels) wheel.visible = true;
}

function getCameraTargets(frame) {
  const position = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  if (state.cameraMode === 1) {
    position.copy(truck.group.localToWorld(new THREE.Vector3(0, 2.35, 3.1)));
    lookAt.copy(truck.group.localToWorld(new THREE.Vector3(0, 2.1, 34)));
    return { position, lookAt };
  }

  if (state.cameraMode === 2) {
    position.copy(frame.position).addScaledVector(frame.up, 6.3).addScaledVector(frame.tangent, -3);
    lookAt.copy(frame.position).addScaledVector(frame.tangent, 26).addScaledVector(frame.up, 0.6);
    return { position, lookAt };
  }

  position.copy(truck.group.localToWorld(new THREE.Vector3(0, 5.9, -12.8)));
  lookAt.copy(frame.position).addScaledVector(frame.tangent, 18).addScaledVector(frame.up, 2.3);
  return { position, lookAt };
}

function updateTraffic(dt, instant = false) {
  for (const vehicle of traffic) {
    if (!instant) {
      vehicle.distance += vehicle.speed * dt;

      if (Math.random() < 0.002) {
        vehicle.targetLane = vehicle.targetLane < 0 ? 2.6 : -2.6;
      }
      vehicle.lane = THREE.MathUtils.lerp(vehicle.lane, vehicle.targetLane, dt * 1.1);
      vehicle.hitCooldown = Math.max(0, vehicle.hitCooldown - dt);
    }

    const frame = sampleTrackByDistance(vehicle.distance);
    vehicle.mesh.position
      .copy(frame.position)
      .addScaledVector(frame.side, vehicle.lane)
      .addScaledVector(frame.up, 0.8);

    tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
    vehicle.mesh.quaternion.setFromRotationMatrix(tempMatrix);

    if (state.mode === "racing" && !state.paused && vehicle.hitCooldown <= 0) {
      const distanceDelta = shortestLoopDistance(vehicle.distance - state.truck.distance, track.totalLength);
      const laneDelta = Math.abs(vehicle.lane - state.truck.laneOffset);

      if (Math.abs(distanceDelta) < 5.6 && laneDelta < 2.1) {
        vehicle.hitCooldown = 1.1;
        state.truck.speed *= 0.55;
        state.truck.collisions += 1;
        state.score.cleanDrive = Math.max(0, state.score.cleanDrive - 14);
        state.score.penalties += 35;
      }
    }
  }
}

function updateTiming(dt) {
  state.race.raceTime += dt;

  while (state.truck.distance >= state.race.nextSectorDistance) {
    const sectorIndex = state.race.nextSectorIndex;
    const sectorTime = state.race.raceTime - state.race.sectorStartTime;
    state.race.bestSectors[sectorIndex] = Math.min(state.race.bestSectors[sectorIndex], sectorTime);

    state.race.sectorStartTime = state.race.raceTime;
    state.race.nextSectorIndex += 1;
    state.race.nextSectorDistance += track.totalLength / 3;

    if (state.race.nextSectorIndex > 2) {
      const lapTime = state.race.raceTime - state.race.lapStartTime;
      state.race.lastLap = lapTime;
      state.race.bestLap = Math.min(state.race.bestLap, lapTime);
      state.race.lap += 1;
      state.race.lapStartTime = state.race.raceTime;
      state.race.sectorStartTime = state.race.raceTime;
      state.race.nextSectorIndex = 0;

      if (state.race.lap > state.setup.totalLaps) {
        finishRace();
        return;
      }
    }
  }
}

function finishRace() {
  state.mode = "finished";
  state.paused = false;

  dom.hud.classList.add("hidden");
  dom.finishOverlay.classList.add("visible");

  const grade = computeGtGrade();
  const clean = Math.round(state.score.cleanDrive);
  const bestLapText = Number.isFinite(state.race.bestLap) ? formatTime(state.race.bestLap) : "--:--.---";

  dom.finishTitle.textContent = `GT Rating ${grade}`;
  dom.finishSummary.textContent = `Best Lap ${bestLapText} | Clean Drive ${clean} | Collisions ${state.truck.collisions} | Top ${Math.round(state.truck.topSpeedKmh)} km/h`;
}

function computeGtGrade() {
  const clean = state.score.cleanDrive;
  const collisions = state.truck.collisions;

  if (clean >= 92 && collisions === 0) return "S";
  if (clean >= 82 && collisions <= 1) return "A";
  if (clean >= 68) return "B";
  return "C";
}

function updateHud() {
  const raceTime = state.race.raceTime - state.race.lapStartTime;
  const bestLapText = Number.isFinite(state.race.bestLap) ? formatTime(state.race.bestLap) : "--:--.---";

  dom.hudLap.textContent = `LAP ${Math.min(state.race.lap, state.setup.totalLaps)} / ${state.setup.totalLaps}`;
  dom.hudTime.textContent = `TIME ${formatTime(raceTime)}`;
  dom.hudBest.textContent = `BEST ${bestLapText}`;
  dom.hudSector.textContent = `SECTOR ${state.race.nextSectorIndex + 1}`;
  dom.hudSpeed.textContent = Math.round(state.truck.speed * 3.6).toString();
  dom.hudView.textContent = `VIEW ${state.cameraMode}`;
  dom.hudClean.textContent = `Clean Drive ${Math.round(state.score.cleanDrive)}`;
  dom.hudScore.textContent = `GT Points ${Math.max(0, Math.round(state.score.gtPoints - state.score.penalties))}`;
  dom.hudSetup.textContent = `TCS ${state.setup.tcLevel} | ${state.setup.powerMap >= 1.1 ? "RACE" : state.setup.powerMap >= 1 ? "SPORT" : "ECO"}`;
}

function togglePause() {
  state.paused = !state.paused;
  dom.statusBanner.classList.toggle("hidden", !state.paused);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);

  step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function step(dt) {
  if (state.mode === "racing" && !state.paused) {
    updatePhysics(dt);
    updateTiming(dt);
  }

  updateRoadMeshes(state.truck.distance);
  updateTraffic(dt);
  updateTruckTransform(dt);
  updateRacingLine();
  updateHud();
}

window.advanceTime = (ms) => {
  const stepCount = Math.max(1, Math.round(ms / (1000 / 60)));
  const dt = (ms / 1000) / stepCount;
  for (let i = 0; i < stepCount; i += 1) {
    step(dt);
  }
  renderer.render(scene, camera);
};

window.render_game_to_text = () => {
  const nearbyTraffic = traffic
    .map((vehicle) => ({
      distanceAhead: Number(shortestLoopDistance(vehicle.distance - state.truck.distance, track.totalLength).toFixed(1)),
      laneOffset: Number(vehicle.lane.toFixed(1)),
      speedKmh: Math.round(vehicle.speed * 3.6),
    }))
    .filter((entry) => Math.abs(entry.distanceAhead) < 40)
    .slice(0, 4);

  return JSON.stringify({
    coordinateSystem: "distance_m increases along track loop; laneOffset_m positive to driver's right",
    mode: state.mode,
    paused: state.paused,
    cameraMode: state.cameraMode,
    lap: {
      current: Math.min(state.race.lap, state.setup.totalLaps),
      total: state.setup.totalLaps,
      sector: state.race.nextSectorIndex + 1,
    },
    truck: {
      speedKmh: Number((state.truck.speed * 3.6).toFixed(1)),
      distanceM: Number(state.truck.distance.toFixed(1)),
      laneOffsetM: Number(state.truck.laneOffset.toFixed(2)),
      collisions: state.truck.collisions,
    },
    gt: {
      cleanDrive: Math.round(state.score.cleanDrive),
      points: Math.max(0, Math.round(state.score.gtPoints - state.score.penalties)),
      topSpeedKmh: Math.round(state.truck.topSpeedKmh),
    },
    traffic: nearbyTraffic,
  });
};

function formatTime(timeSeconds) {
  const totalMs = Math.max(0, Math.floor(timeSeconds * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function shortestLoopDistance(delta, length) {
  let wrapped = modulo(delta, length);
  if (wrapped > length / 2) {
    wrapped -= length;
  }
  return wrapped;
}
