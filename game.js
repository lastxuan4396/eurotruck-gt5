import * as THREE from "./vendor/three.module.js";

const ROAD_WIDTH = 12;
const ROAD_SEGMENT_LENGTH = 8;
const ROAD_SEGMENT_COUNT = 240;
const TRAFFIC_POOL_SIZE = 18;
const TRACK_SAMPLES = 1500;
const TREE_INSTANCE_COUNT = 280;
const LAMP_INSTANCE_COUNT = 64;
const UP = new THREE.Vector3(0, 1, 0);

const STORAGE_KEYS = {
  settings: "eurotruck_gt5_settings_v2",
  stats: "eurotruck_gt5_stats_v2",
  ghost: "eurotruck_gt5_ghost_v2",
};

const CAMERA_PRESETS = {
  1: { fov: 70, near: 0.03, posLerp: 0.26, lookLerp: 0.32 },
  2: { fov: 76, near: 0.05, posLerp: 0.22, lookLerp: 0.26 },
  3: { fov: 64, near: 0.2, posLerp: 0.12, lookLerp: 0.16 },
};

const MEDAL_ORDER = ["-", "B", "S", "G"];
const LIGHT_CYCLE = { green: 11, yellow: 2, red: 8, total: 21 };

const licenseDefinitions = {
  precision: {
    name: "A-1 精准刹停",
    desc: "40 秒内在刹停区内停下",
    timeLimit: 40,
  },
  slalom: {
    name: "A-2 蛇形控车",
    desc: "通过 4 个蛇形门",
    timeLimit: 48,
  },
  clean: {
    name: "A-3 清洁冲刺",
    desc: "35 秒内完成 Sector 1 且无碰撞",
    timeLimit: 35,
  },
};

const dailyDefinitions = [
  { id: "daily_clean_lap", text: "今日任务: 0 碰撞完成 1 圈", target: 1 },
  { id: "daily_top_speed", text: "今日任务: 最高速达到 98 km/h", target: 98 },
  { id: "daily_gt_points", text: "今日任务: 单局 GT Points 达到 520", target: 520 },
];

const dom = {
  canvas: document.querySelector("#game-canvas"),
  menuOverlay: document.querySelector("#menu-overlay"),
  finishOverlay: document.querySelector("#finish-overlay"),
  startBtn: document.querySelector("#start-btn"),
  restartBtn: document.querySelector("#restart-btn"),
  mode: document.querySelector("#mode-select"),
  license: document.querySelector("#license-select"),
  laps: document.querySelector("#laps-select"),
  cargo: document.querySelector("#cargo-select"),
  power: document.querySelector("#power-select"),
  tc: document.querySelector("#tc-select"),
  brake: document.querySelector("#brake-select"),
  daily: document.querySelector("#daily-challenge"),
  hud: document.querySelector("#hud"),
  statusBanner: document.querySelector("#status-banner"),
  finishTitle: document.querySelector("#finish-title"),
  finishSummary: document.querySelector("#finish-summary"),
  hudLap: document.querySelector("#hud-lap"),
  hudTime: document.querySelector("#hud-time"),
  hudBest: document.querySelector("#hud-best"),
  hudSector: document.querySelector("#hud-sector"),
  hudMedals: document.querySelector("#hud-medals"),
  hudSpeed: document.querySelector("#hud-speed"),
  hudView: document.querySelector("#hud-view"),
  hudAssists: document.querySelector("#hud-assists"),
  hudClean: document.querySelector("#hud-clean"),
  hudScore: document.querySelector("#hud-score"),
  hudSetup: document.querySelector("#hud-setup"),
  hudRule: document.querySelector("#hud-rule"),
};

const persistedSettings = loadStorage(STORAGE_KEYS.settings, {});
const persistedStats = loadStorage(STORAGE_KEYS.stats, {
  bestLap: Infinity,
  bestSectors: [Infinity, Infinity, Infinity],
  bestSectorMedals: ["-", "-", "-"],
  licenseMedals: {},
  dailyDone: {},
});
const persistedGhost = loadStorage(STORAGE_KEYS.ghost, null);

const state = {
  mode: "menu",
  paused: false,
  cameraMode: 1,
  keys: new Set(),
  setup: {
    runMode: "race",
    licenseType: "precision",
    totalLaps: 3,
    powerMap: 1,
    tcLevel: 4,
    brakeBias: 0,
    cargoLoad: 0.55,
  },
  truck: {
    distance: 0,
    speed: 0,
    laneOffset: 0,
    laneVelocity: 0,
    topSpeedKmh: 0,
    collisions: 0,
    wheelSlip: 0,
    steerInput: 0,
    lateralG: 0,
  },
  race: {
    raceTime: 0,
    lap: 1,
    bestLap: Number.isFinite(persistedStats.bestLap) ? persistedStats.bestLap : Infinity,
    lastLap: 0,
    lapStartTime: 0,
    lapStartDistance: 0,
    sectorStartTime: 0,
    nextSectorIndex: 0,
    nextSectorDistance: 0,
    bestSectors: [...persistedStats.bestSectors],
    sectorMedals: ["-", "-", "-"],
    bestSectorMedals: [...persistedStats.bestSectorMedals],
    sectorTargets: [16.5, 17.2, 17.8],
  },
  score: {
    cleanDrive: 100,
    gtPoints: 0,
    penalties: 0,
    rulePenalties: 0,
  },
  assists: {
    absActive: false,
    tcsActive: false,
  },
  rules: {
    currentLimit: 80,
    overLimitTime: 0,
    redLightViolations: 0,
    lastTrafficLightState: "green",
  },
  ghost: {
    recording: [],
    bestRun: isValidGhost(persistedGhost) ? persistedGhost : null,
    lapTimer: 0,
    enabled: true,
  },
  license: {
    active: false,
    type: "precision",
    timeLimit: 40,
    success: false,
    failed: false,
    message: "",
    nextGate: 0,
    stopDone: false,
    gates: [],
    stopZone: { start: 0, end: 0 },
  },
  daily: {
    ...buildDailyChallenge(),
    completed: false,
    progress: 0,
  },
  performance: {
    trafficLodDistance: 170,
  },
  meta: {
    worldTime: 0,
    frame: 0,
  },
};

state.daily.completed = Boolean(persistedStats.dailyDone?.[state.daily.dateKey]?.includes(state.daily.id));

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
scene.fog = new THREE.Fog(0x93c2e7, 170, 980);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 2600);
const cameraRig = {
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
};

const clock = new THREE.Clock();
const tempMatrix = new THREE.Matrix4();
const tempQuat = new THREE.Quaternion();
const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const dummyObject = new THREE.Object3D();

setupLighting();
setupEnvironment();

const track = buildTrack(TRACK_SAMPLES);
const roadSegments = createRoadSegments();
const racingLine = createRacingLine(96);
const truck = createTruck();
scene.add(truck.group);
const ghostTruck = createGhostTruck();
scene.add(ghostTruck.group);
const traffic = createTrafficPool(TRAFFIC_POOL_SIZE);
const roadside = createRoadsideDecorInstanced(TREE_INSTANCE_COUNT, LAMP_INSTANCE_COUNT);
scene.add(roadside.root);
const roadRules = createRoadRulesObjects();
scene.add(roadRules.root);
const licenseMarkers = createLicenseMarkers();
scene.add(licenseMarkers.root);

applySettingsToControls();
updateDailyChallengeText();
bindEvents();
resetRaceState();
updateRoadMeshes(state.truck.distance);
updateTraffic(0, true);
updateRoadRules(0, true);
updateTruckTransform(0);
updateGhostTransform(0, true);
updateRacingLine();
updateHud();

requestAnimationFrame(loop);

function setupLighting() {
  const hemi = new THREE.HemisphereLight(0xdff3ff, 0x4d6f4a, 1.08);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1cf, 1.12);
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
    new THREE.CircleGeometry(1150, 140),
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
  const tangent = track.tangents[low].clone().lerp(track.tangents[(low + 1) % track.samples], localT).normalize();

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
    wrappedDistance,
    progress: wrappedDistance / track.totalLength,
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

  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.7, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x1f5ea5, roughness: 0.5, metalness: 0.3 })
  );
  hood.position.set(0, 1.75, 3.05);
  hood.castShadow = true;
  group.add(hood);

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

  const dash = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.42, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.9 })
  );
  dash.position.set(0, 2.0, 2.86);
  group.add(dash);

  const steeringWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.045, 10, 24),
    new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.82, metalness: 0.25 })
  );
  steeringWheel.position.set(-0.44, 1.9, 2.56);
  steeringWheel.rotation.set(0.8, 0, 0.3);
  group.add(steeringWheel);

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
      hood,
      cabin,
      windshield,
      trailer,
      dash,
      steeringWheel,
    },
  };
}

function createGhostTruck() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 1.0, 5.4),
    new THREE.MeshBasicMaterial({ color: 0x49d6f3, transparent: true, opacity: 0.36 })
  );
  body.position.y = 1.45;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 1.2, 1.8),
    new THREE.MeshBasicMaterial({ color: 0x7eeeff, transparent: true, opacity: 0.28 })
  );
  head.position.set(0, 2.05, 2.1);
  group.add(head);

  group.visible = false;
  return { group };
}

function createTrafficPool(count) {
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

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.65, 2),
      new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.9 })
    );
    roof.position.set(0, 1.78, 0.35);

    const mesh = new THREE.Group();
    mesh.add(body);
    mesh.add(roof);
    scene.add(mesh);

    vehicles.push({
      mesh,
      distance: Math.random() * track.totalLength,
      speed: 19 + Math.random() * 12,
      lane: Math.random() > 0.5 ? -2.6 : 2.6,
      targetLane: Math.random() > 0.5 ? -2.6 : 2.6,
      hitCooldown: 0,
      active: true,
    });
  }

  return vehicles;
}

function createRoadsideDecorInstanced(treeCount, lampCount) {
  const root = new THREE.Group();

  const trunkMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.28, 0.42, 2.7, 7),
    new THREE.MeshStandardMaterial({ color: 0x66492f, roughness: 1 }),
    treeCount
  );
  const crownMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1.58, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a7c41, roughness: 0.92 }),
    treeCount
  );

  trunkMesh.castShadow = true;
  crownMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  crownMesh.receiveShadow = true;

  for (let i = 0; i < treeCount; i += 1) {
    const randomDistance = (i / treeCount) * track.totalLength + Math.random() * 14;
    const sideSign = Math.random() > 0.5 ? -1 : 1;
    const extraOffset = 13 + Math.random() * 24;

    const frame = sampleTrackByDistance(randomDistance);
    const trunkPos = frame.position.clone().addScaledVector(frame.side, sideSign * extraOffset).addScaledVector(frame.up, 1.3);

    dummyObject.position.copy(trunkPos);
    dummyObject.scale.set(1, 1, 1);
    dummyObject.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummyObject.updateMatrix();
    trunkMesh.setMatrixAt(i, dummyObject.matrix);

    dummyObject.position.copy(trunkPos).addScaledVector(frame.up, 1.7);
    const scale = 1 + Math.random() * 0.36;
    dummyObject.scale.set(scale, scale, scale);
    dummyObject.rotation.set(0, 0, 0);
    dummyObject.updateMatrix();
    crownMesh.setMatrixAt(i, dummyObject.matrix);
  }

  trunkMesh.instanceMatrix.needsUpdate = true;
  crownMesh.instanceMatrix.needsUpdate = true;

  const lampPole = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x8494a0, roughness: 0.52, metalness: 0.62 }),
    lampCount
  );
  const lampHead = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.52, 0.26, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xede9c9, roughness: 0.35, emissive: 0x342f1f, emissiveIntensity: 0.3 }),
    lampCount
  );

  for (let i = 0; i < lampCount; i += 1) {
    const d = (i / lampCount) * track.totalLength + 4;
    const side = i % 2 === 0 ? -1 : 1;
    const frame = sampleTrackByDistance(d);

    const basePos = frame.position.clone().addScaledVector(frame.side, side * (ROAD_WIDTH * 0.5 + 2.2));

    dummyObject.position.copy(basePos).addScaledVector(frame.up, 2.2);
    tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
    dummyObject.quaternion.setFromRotationMatrix(tempMatrix);
    dummyObject.scale.set(1, 1, 1);
    dummyObject.updateMatrix();
    lampPole.setMatrixAt(i, dummyObject.matrix);

    dummyObject.position.copy(basePos)
      .addScaledVector(frame.up, 4.35)
      .addScaledVector(frame.side, -side * 0.3);
    dummyObject.quaternion.setFromRotationMatrix(tempMatrix);
    dummyObject.updateMatrix();
    lampHead.setMatrixAt(i, dummyObject.matrix);
  }

  lampPole.instanceMatrix.needsUpdate = true;
  lampHead.instanceMatrix.needsUpdate = true;

  root.add(trunkMesh, crownMesh, lampPole, lampHead);
  return { root, trunkMesh, crownMesh, lampPole, lampHead };
}

function createRoadRulesObjects() {
  const root = new THREE.Group();
  const signs = [];
  const lights = [];

  const signSpecs = [
    { distance: 60, limit: 80 },
    { distance: 220, limit: 60 },
    { distance: 430, limit: 100 },
    { distance: 620, limit: 70 },
    { distance: 810, limit: 90 },
  ];

  for (const spec of signSpecs) {
    const frame = sampleTrackByDistance(spec.distance);
    const side = Math.random() > 0.5 ? -1 : 1;
    const sign = new THREE.Group();

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 2.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.6, metalness: 0.65 })
    );
    pole.position.y = 1.25;
    sign.add(pole);

    const plateColor = spec.limit <= 70 ? 0xffb6a8 : spec.limit >= 100 ? 0xa8ffce : 0xfff0ad;
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.54, 0.54, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: plateColor, roughness: 0.48, metalness: 0.1 })
    );
    plate.position.y = 2.52;
    plate.rotation.x = Math.PI / 2;
    sign.add(plate);

    sign.position.copy(frame.position).addScaledVector(frame.side, side * (ROAD_WIDTH * 0.5 + 2.8));
    sign.position.addScaledVector(frame.up, 0.04);
    tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
    sign.quaternion.setFromRotationMatrix(tempMatrix);

    root.add(sign);
    signs.push({
      mesh: sign,
      limit: spec.limit,
      distance: spec.distance,
      nextTriggerDistance: spec.distance,
    });
  }

  const lightSpecs = [
    { distance: 160, offset: 0 },
    { distance: 520, offset: 7 },
    { distance: 890, offset: 13 },
  ];

  for (const spec of lightSpecs) {
    const frame = sampleTrackByDistance(spec.distance);
    const side = Math.random() > 0.5 ? -1 : 1;

    const group = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 5.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x70767f, roughness: 0.55, metalness: 0.62 })
    );
    pole.position.y = 2.6;
    group.add(pole);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 1.4, 0.48),
      new THREE.MeshStandardMaterial({ color: 0x1d232a, roughness: 0.7 })
    );
    head.position.y = 4.65;
    group.add(head);

    const red = createLightBulb(0xff4a4a);
    red.position.set(0, 5.1, 0.3);
    const yellow = createLightBulb(0xffcc4a);
    yellow.position.set(0, 4.7, 0.3);
    const green = createLightBulb(0x59ff6c);
    green.position.set(0, 4.3, 0.3);

    group.add(red, yellow, green);

    group.position.copy(frame.position).addScaledVector(frame.side, side * (ROAD_WIDTH * 0.5 + 3.6));
    group.position.addScaledVector(frame.up, 0.04);
    tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
    group.quaternion.setFromRotationMatrix(tempMatrix);

    root.add(group);

    lights.push({
      group,
      bulbs: { red, yellow, green },
      distance: spec.distance,
      nextCrossDistance: spec.distance,
      offset: spec.offset,
      state: "green",
    });
  }

  return { root, signs, lights };
}

function createLightBulb(color) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.08,
      roughness: 0.3,
      metalness: 0.05,
    })
  );
}

function createLicenseMarkers() {
  const root = new THREE.Group();
  const gates = [];

  const gateGeom = new THREE.BoxGeometry(0.2, 2, 0.2);
  const gateMatGood = new THREE.MeshStandardMaterial({ color: 0x69f6aa, roughness: 0.4 });
  const gateMatWarn = new THREE.MeshStandardMaterial({ color: 0xffc36e, roughness: 0.4 });

  for (let i = 0; i < 4; i += 1) {
    const d = 90 + i * 52;
    const targetLane = i % 2 === 0 ? -2.8 : 2.8;

    const frame = sampleTrackByDistance(d);
    const center = frame.position.clone().addScaledVector(frame.side, targetLane);

    const leftPole = new THREE.Mesh(gateGeom, gateMatGood);
    leftPole.position.copy(center).addScaledVector(frame.side, -1.6).addScaledVector(frame.up, 1.0);

    const rightPole = new THREE.Mesh(gateGeom, gateMatWarn);
    rightPole.position.copy(center).addScaledVector(frame.side, 1.6).addScaledVector(frame.up, 1.0);

    root.add(leftPole, rightPole);
    gates.push({ distance: d, targetLane, leftPole, rightPole, passed: false });
  }

  const stopBox = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.08, 8),
    new THREE.MeshBasicMaterial({ color: 0x75d6ff, transparent: true, opacity: 0.35 })
  );
  const stopStart = 185;
  const stopEnd = stopStart + 8;
  const stopMid = (stopStart + stopEnd) * 0.5;
  const stopFrame = sampleTrackByDistance(stopMid);

  stopBox.position.copy(stopFrame.position).addScaledVector(stopFrame.up, 0.07);
  tempMatrix.makeBasis(stopFrame.side, stopFrame.up, stopFrame.tangent);
  stopBox.quaternion.setFromRotationMatrix(tempMatrix);
  root.add(stopBox);

  root.visible = false;
  return { root, gates, stopZone: { start: stopStart, end: stopEnd }, stopBox };
}

function createRacingLine(pointCount) {
  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });

  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  scene.add(line);

  return { line, geometry, positions, colors, pointCount };
}

function updateRacingLine() {
  if (state.mode === "menu" || state.mode === "finished") {
    racingLine.line.visible = false;
    return;
  }

  racingLine.line.visible = true;
  const speedKmh = state.truck.speed * 3.6;

  for (let i = 0; i < racingLine.pointCount; i += 1) {
    const lookDistance = state.truck.distance + 14 + i * 6;
    const frame = sampleTrackByDistance(lookDistance);

    const index = i * 3;
    const markerPosition = frame.position.clone().addScaledVector(frame.side, state.truck.laneOffset * 0.18).addScaledVector(frame.up, 0.22);

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
  if (speed < targetSpeed - 8) return new THREE.Color(0x4be37a);
  if (speed <= targetSpeed + 8) return new THREE.Color(0xf9d55e);
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

    if (key === "c") setCameraMode(state.cameraMode === 3 ? 1 : state.cameraMode + 1);
    if (key === "1" || key === "2" || key === "3") setCameraMode(Number(key));
    if (key === "escape" && isRunActive()) togglePause();
    if (key === "r" && isRunActive()) resetTruckToTrack();
    if (key === "f") toggleFullscreen();
  });

  window.addEventListener("keyup", (event) => {
    state.keys.delete(event.key.toLowerCase());
  });

  dom.mode.addEventListener("change", () => {
    saveSettingsFromControls();
    updateDailyChallengeText();
  });
  dom.license.addEventListener("change", saveSettingsFromControls);
  dom.laps.addEventListener("change", saveSettingsFromControls);
  dom.power.addEventListener("change", saveSettingsFromControls);
  dom.tc.addEventListener("change", saveSettingsFromControls);
  dom.brake.addEventListener("change", saveSettingsFromControls);
  dom.cargo.addEventListener("change", saveSettingsFromControls);

  dom.startBtn.addEventListener("click", startRaceFromMenu);
  dom.restartBtn.addEventListener("click", startRaceFromMenu);
}

function applySettingsToControls() {
  if (persistedSettings.mode) dom.mode.value = persistedSettings.mode;
  if (persistedSettings.license) dom.license.value = persistedSettings.license;
  if (persistedSettings.laps) dom.laps.value = persistedSettings.laps;
  if (persistedSettings.power) dom.power.value = persistedSettings.power;
  if (persistedSettings.tc) dom.tc.value = persistedSettings.tc;
  if (persistedSettings.brake) dom.brake.value = persistedSettings.brake;
  if (persistedSettings.cargo) dom.cargo.value = persistedSettings.cargo;
}

function saveSettingsFromControls() {
  saveStorage(STORAGE_KEYS.settings, {
    mode: dom.mode.value,
    license: dom.license.value,
    laps: dom.laps.value,
    power: dom.power.value,
    tc: dom.tc.value,
    brake: dom.brake.value,
    cargo: dom.cargo.value,
  });
}

function startRaceFromMenu() {
  state.setup.runMode = dom.mode.value;
  state.setup.licenseType = dom.license.value;
  state.setup.totalLaps = Number(dom.laps.value);
  state.setup.powerMap = Number(dom.power.value);
  state.setup.tcLevel = Number(dom.tc.value);
  state.setup.brakeBias = Number(dom.brake.value);
  state.setup.cargoLoad = Number(dom.cargo.value);

  saveSettingsFromControls();

  dom.menuOverlay.classList.remove("visible");
  dom.finishOverlay.classList.remove("visible");
  dom.hud.classList.remove("hidden");

  state.mode = state.setup.runMode === "license" ? "license" : "racing";
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
  state.truck.wheelSlip = 0;
  state.truck.steerInput = 0;
  state.truck.lateralG = 0;

  state.race.raceTime = 0;
  state.race.lap = 1;
  state.race.lastLap = 0;
  state.race.lapStartTime = 0;
  state.race.lapStartDistance = 0;
  state.race.sectorStartTime = 0;
  state.race.nextSectorIndex = 0;
  state.race.nextSectorDistance = track.totalLength / 3;
  state.race.sectorMedals = ["-", "-", "-"];

  state.race.sectorTargets = buildSectorTargets();

  state.score.cleanDrive = 100;
  state.score.gtPoints = 0;
  state.score.penalties = 0;
  state.score.rulePenalties = 0;

  state.assists.absActive = false;
  state.assists.tcsActive = false;

  state.rules.currentLimit = 80;
  state.rules.overLimitTime = 0;
  state.rules.redLightViolations = 0;

  state.ghost.recording = [];
  state.ghost.lapTimer = 0;

  setupLicenseState();

  for (let i = 0; i < traffic.length; i += 1) {
    const v = traffic[i];
    v.distance = 30 + i * (track.totalLength / traffic.length) + Math.random() * 22;
    v.speed = 18 + Math.random() * 12;
    v.lane = Math.random() > 0.5 ? -2.6 : 2.6;
    v.targetLane = Math.random() > 0.5 ? -2.6 : 2.6;
    v.hitCooldown = 0;
    v.active = true;
    v.mesh.visible = true;
  }

  for (const sign of roadRules.signs) {
    sign.nextTriggerDistance = sign.distance;
  }
  for (const light of roadRules.lights) {
    light.nextCrossDistance = light.distance;
  }

  const frame = sampleTrackByDistance(0);
  const camStart = frame.position.clone().addScaledVector(frame.up, 4.5).addScaledVector(frame.tangent, -9);
  const camLook = frame.position.clone().addScaledVector(frame.tangent, 18).addScaledVector(frame.up, 1.4);
  cameraRig.pos.copy(camStart);
  cameraRig.look.copy(camLook);
  camera.position.copy(camStart);
  camera.lookAt(camLook);

  updateRoadMeshes(state.truck.distance);
  updateTruckTransform(0);
  updateGhostTransform(0, true);
  updateTraffic(0, true);
  updateRoadRules(0, true);
  updateRacingLine();
  updateHud();
}

function setupLicenseState() {
  state.license.active = state.mode === "license";
  state.license.type = state.setup.licenseType;
  state.license.timeLimit = licenseDefinitions[state.setup.licenseType].timeLimit;
  state.license.success = false;
  state.license.failed = false;
  state.license.message = licenseDefinitions[state.setup.licenseType].desc;
  state.license.nextGate = 0;
  state.license.stopDone = false;

  licenseMarkers.root.visible = state.license.active;
  for (const gate of licenseMarkers.gates) {
    gate.passed = false;
    gate.leftPole.material.color.setHex(0x69f6aa);
    gate.rightPole.material.color.setHex(0xffc36e);
  }

  state.license.gates = licenseMarkers.gates;
  state.license.stopZone = { ...licenseMarkers.stopZone };
}

function buildSectorTargets() {
  const loadFactor = THREE.MathUtils.lerp(0.96, 1.11, state.setup.cargoLoad);
  const powerFactor = THREE.MathUtils.clamp(1.14 - state.setup.powerMap * 0.2, 0.94, 1.12);
  return [16.5, 17.2, 17.8].map((s) => s * loadFactor * powerFactor);
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

  const maxSpeed = THREE.MathUtils.lerp(34, 41, state.setup.powerMap - 0.88);
  const cargoMassFactor = THREE.MathUtils.lerp(0.86, 0.66, state.setup.cargoLoad);
  const engineForce = 15.6 * state.setup.powerMap * cargoMassFactor;
  const baseBrakeForce = (24.5 + state.setup.brakeBias * 5.2) * THREE.MathUtils.lerp(1.06, 0.72, state.setup.cargoLoad);
  const drag = 0.016 + state.setup.cargoLoad * 0.01;

  const speedRatio = state.truck.speed / Math.max(maxSpeed, 0.1);
  const steerCurve = THREE.MathUtils.lerp(1.0, 0.52, speedRatio * speedRatio);
  const steerAuthority = THREE.MathUtils.lerp(7.5, 2.8, speedRatio) * steerCurve;

  const lateralLoad = Math.abs(state.truck.laneVelocity) * 0.5 + Math.abs(steerInput) * speedRatio;
  const tcAssist = state.setup.tcLevel / 6;
  const tcThreshold = THREE.MathUtils.lerp(0.35, 0.9, tcAssist);
  let tractionMultiplier = 1;
  state.assists.tcsActive = false;

  if (throttle > 0 && lateralLoad > tcThreshold) {
    const intervention = THREE.MathUtils.clamp((lateralLoad - tcThreshold) * 0.9, 0, 0.45);
    tractionMultiplier -= intervention;
    state.assists.tcsActive = tcAssist > 0;
  }

  const slipEstimate = braking * speedRatio * (1 + Math.abs(steerInput) * 0.45);
  state.truck.wheelSlip = THREE.MathUtils.lerp(state.truck.wheelSlip, slipEstimate, 0.25);

  let brakeForce = baseBrakeForce;
  state.assists.absActive = false;
  if (state.truck.wheelSlip > 0.62 && braking > 0 && state.truck.speed > 8) {
    const absPulse = 0.58 + Math.sin(state.meta.worldTime * 24) * 0.08;
    brakeForce *= absPulse;
    state.assists.absActive = true;
  }

  const acceleration =
    throttle * engineForce * THREE.MathUtils.clamp(tractionMultiplier, 0.52, 1) -
    braking * brakeForce -
    drag * state.truck.speed * state.truck.speed -
    1.2;

  state.truck.speed = THREE.MathUtils.clamp(state.truck.speed + acceleration * dt, 0, maxSpeed);

  state.truck.laneVelocity += steerInput * steerAuthority * dt;
  state.truck.laneVelocity *= 1 - (4.1 + speedRatio * 1.8) * dt;
  state.truck.laneOffset += state.truck.laneVelocity * dt;
  state.truck.steerInput = steerInput;
  state.truck.lateralG = Math.abs(state.truck.laneVelocity) * (0.6 + speedRatio * 0.8);

  const roadEdge = ROAD_WIDTH * 0.5 - 0.95;
  if (Math.abs(state.truck.laneOffset) > roadEdge) {
    state.score.cleanDrive = Math.max(0, state.score.cleanDrive - dt * 11);
    state.truck.speed *= 1 - dt * 0.9;
    state.truck.laneOffset = THREE.MathUtils.clamp(state.truck.laneOffset, -roadEdge - 1.4, roadEdge + 1.4);
  }

  if (steerInput !== 0 && state.truck.speed > maxSpeed * 0.58) {
    state.score.cleanDrive = Math.max(0, state.score.cleanDrive - dt * 2.2 * Math.abs(steerInput));
  }

  if (throttle > 0 && Math.abs(state.truck.laneOffset) < roadEdge - 0.3) {
    state.score.gtPoints += state.truck.speed * dt * 1.04;
  }

  if (state.truck.speed > state.truck.topSpeedKmh / 3.6) {
    state.truck.topSpeedKmh = state.truck.speed * 3.6;
  }

  state.score.cleanDrive = Math.min(100, state.score.cleanDrive + dt * 0.45);
  state.truck.distance += state.truck.speed * dt;
}

function updateTruckTransform(dt) {
  const frame = sampleTrackByDistance(state.truck.distance);

  truck.group.position.copy(frame.position).addScaledVector(frame.side, state.truck.laneOffset).addScaledVector(frame.up, 1.14);

  tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
  tempQuat.setFromRotationMatrix(tempMatrix);
  truck.group.quaternion.slerp(tempQuat, 0.26);

  const wheelSpin = state.truck.speed * dt / 0.48;
  for (const wheel of truck.wheels) wheel.rotation.x -= wheelSpin;
  truck.parts.steeringWheel.rotation.y = state.truck.steerInput * -0.45;

  updateTruckVisibility();
  updateCamera(frame);
}

function updateTruckVisibility() {
  if (state.cameraMode === 1) {
    truck.parts.chassis.visible = false;
    truck.parts.hood.visible = false;
    truck.parts.cabin.visible = false;
    truck.parts.windshield.visible = false;
    truck.parts.trailer.visible = false;
    truck.parts.dash.visible = false;
    truck.parts.steeringWheel.visible = true;
    for (const wheel of truck.wheels) wheel.visible = false;
    return;
  }

  if (state.cameraMode === 2) {
    truck.parts.chassis.visible = false;
    truck.parts.hood.visible = true;
    truck.parts.cabin.visible = false;
    truck.parts.windshield.visible = false;
    truck.parts.trailer.visible = false;
    truck.parts.dash.visible = false;
    truck.parts.steeringWheel.visible = false;
    for (const wheel of truck.wheels) wheel.visible = false;
    return;
  }

  truck.parts.chassis.visible = true;
  truck.parts.hood.visible = true;
  truck.parts.cabin.visible = true;
  truck.parts.windshield.visible = true;
  truck.parts.trailer.visible = true;
  truck.parts.dash.visible = false;
  truck.parts.steeringWheel.visible = false;
  for (const wheel of truck.wheels) wheel.visible = true;
}

function updateCamera(frame) {
  const target = getCameraTargets(frame);
  const cfg = CAMERA_PRESETS[state.cameraMode];

  cameraRig.pos.lerp(target.position, cfg.posLerp);
  cameraRig.look.lerp(target.lookAt, cfg.lookLerp);

  camera.position.copy(cameraRig.pos);
  camera.up.copy(frame.up);
  camera.lookAt(cameraRig.look);

  if (Math.abs(camera.fov - cfg.fov) > 0.05 || Math.abs(camera.near - cfg.near) > 0.001) {
    camera.fov = cfg.fov;
    camera.near = cfg.near;
    camera.updateProjectionMatrix();
  }
}

function getCameraTargets(frame) {
  const position = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  if (state.cameraMode === 1) {
    position.copy(truck.group.localToWorld(new THREE.Vector3(-0.38, 2.4, 2.7)));
    lookAt.copy(truck.group.localToWorld(new THREE.Vector3(-0.38, 2.16, 30)));
    return { position, lookAt };
  }

  if (state.cameraMode === 2) {
    position.copy(frame.position).addScaledVector(frame.up, 9.4).addScaledVector(frame.tangent, -8);
    lookAt.copy(frame.position).addScaledVector(frame.tangent, 20).addScaledVector(frame.up, 0.2);
    return { position, lookAt };
  }

  position.copy(truck.group.localToWorld(new THREE.Vector3(0, 5.8, -12.8)));
  lookAt.copy(frame.position).addScaledVector(frame.tangent, 18).addScaledVector(frame.up, 2.2);
  return { position, lookAt };
}

function updateGhostTransform(dt, instant = false) {
  if (!state.ghost.enabled || !state.ghost.bestRun || state.mode !== "racing") {
    ghostTruck.group.visible = false;
    return;
  }

  const run = state.ghost.bestRun;
  if (!run.samples || run.samples.length < 2 || !Number.isFinite(run.lapTime)) {
    ghostTruck.group.visible = false;
    return;
  }

  if (!instant) {
    state.ghost.lapTimer += dt;
  }

  const ghostTime = modulo(state.ghost.lapTimer, run.lapTime);
  const sample = sampleGhostAtTime(run.samples, ghostTime);
  const ghostDistance = state.race.lapStartDistance + sample.distance;
  const frame = sampleTrackByDistance(ghostDistance);

  ghostTruck.group.position.copy(frame.position).addScaledVector(frame.side, sample.lane).addScaledVector(frame.up, 1.14);
  tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
  ghostTruck.group.quaternion.setFromRotationMatrix(tempMatrix);
  ghostTruck.group.visible = true;
}

function sampleGhostAtTime(samples, t) {
  let low = 0;
  let high = samples.length - 1;

  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid].t <= t) low = mid;
    else high = mid;
  }

  const a = samples[low];
  const b = samples[high] ?? a;
  const duration = Math.max(0.0001, b.t - a.t);
  const alpha = THREE.MathUtils.clamp((t - a.t) / duration, 0, 1);

  return {
    distance: THREE.MathUtils.lerp(a.d, b.d, alpha),
    lane: THREE.MathUtils.lerp(a.l, b.l, alpha),
  };
}

function updateTraffic(dt, instant = false) {
  const nearDistance = state.performance.trafficLodDistance;

  for (const vehicle of traffic) {
    if (!instant) {
      vehicle.distance += vehicle.speed * dt;

      if (Math.random() < 0.002) vehicle.targetLane = vehicle.targetLane < 0 ? 2.6 : -2.6;
      vehicle.lane = THREE.MathUtils.lerp(vehicle.lane, vehicle.targetLane, dt * 1.05);
      vehicle.hitCooldown = Math.max(0, vehicle.hitCooldown - dt);
    }

    const distanceDelta = shortestLoopDistance(vehicle.distance - state.truck.distance, track.totalLength);

    if (Math.abs(distanceDelta) > nearDistance * 1.9) {
      vehicle.mesh.visible = false;
      continue;
    }

    const skipFarFrame = Math.abs(distanceDelta) > nearDistance && state.meta.frame % 2 === 0;
    if (skipFarFrame && !instant) {
      vehicle.mesh.visible = true;
      continue;
    }

    const frame = sampleTrackByDistance(vehicle.distance);
    vehicle.mesh.position.copy(frame.position).addScaledVector(frame.side, vehicle.lane).addScaledVector(frame.up, 0.8);
    tempMatrix.makeBasis(frame.side, frame.up, frame.tangent);
    vehicle.mesh.quaternion.setFromRotationMatrix(tempMatrix);
    vehicle.mesh.visible = true;

    if (isRunActive() && vehicle.hitCooldown <= 0) {
      const laneDelta = Math.abs(vehicle.lane - state.truck.laneOffset);
      if (Math.abs(distanceDelta) < 5.6 && laneDelta < 2.1) {
        vehicle.hitCooldown = 1.1;
        state.truck.speed *= 0.55;
        state.truck.collisions += 1;
        state.score.cleanDrive = Math.max(0, state.score.cleanDrive - 14);
        state.score.penalties += 45;
      }
    }
  }
}

function updateRoadRules(dt, instant = false) {
  if (!isRunActive()) return;

  const speedKmh = state.truck.speed * 3.6;

  for (const sign of roadRules.signs) {
    if (state.truck.distance >= sign.nextTriggerDistance) {
      state.rules.currentLimit = sign.limit;
      sign.nextTriggerDistance += track.totalLength;
    }
  }

  if (speedKmh > state.rules.currentLimit + 6) {
    state.rules.overLimitTime += dt;
  } else {
    state.rules.overLimitTime = Math.max(0, state.rules.overLimitTime - dt * 1.8);
  }

  if (state.rules.overLimitTime > 2.4) {
    state.rules.overLimitTime = 1.2;
    state.score.penalties += 28;
    state.score.rulePenalties += 1;
    state.score.cleanDrive = Math.max(0, state.score.cleanDrive - 3.5);
  }

  for (const light of roadRules.lights) {
    const lightState = resolveLightState(state.meta.worldTime + light.offset);
    light.state = lightState;

    light.bulbs.red.material.emissiveIntensity = lightState === "red" ? 1.6 : 0.08;
    light.bulbs.yellow.material.emissiveIntensity = lightState === "yellow" ? 1.4 : 0.08;
    light.bulbs.green.material.emissiveIntensity = lightState === "green" ? 1.6 : 0.08;

    if (state.truck.distance >= light.nextCrossDistance) {
      if (lightState === "red" && state.truck.speed > 2.0) {
        state.rules.redLightViolations += 1;
        state.score.penalties += 70;
        state.score.rulePenalties += 2;
        state.score.cleanDrive = Math.max(0, state.score.cleanDrive - 10);
      }
      light.nextCrossDistance += track.totalLength;
    }
  }

  if (!instant) {
    state.rules.lastTrafficLightState = roadRules.lights[0]?.state ?? "green";
  }
}

function resolveLightState(t) {
  const local = modulo(t, LIGHT_CYCLE.total);
  if (local < LIGHT_CYCLE.green) return "green";
  if (local < LIGHT_CYCLE.green + LIGHT_CYCLE.yellow) return "yellow";
  return "red";
}

function updateTiming(dt) {
  state.race.raceTime += dt;

  if (state.mode !== "racing") return;

  while (state.truck.distance >= state.race.nextSectorDistance) {
    const sectorIndex = state.race.nextSectorIndex;
    const sectorTime = state.race.raceTime - state.race.sectorStartTime;

    state.race.bestSectors[sectorIndex] = Math.min(state.race.bestSectors[sectorIndex], sectorTime);
    const medal = getSectorMedal(sectorTime, state.race.sectorTargets[sectorIndex]);
    state.race.sectorMedals[sectorIndex] = betterMedal(state.race.sectorMedals[sectorIndex], medal);
    state.race.bestSectorMedals[sectorIndex] = betterMedal(state.race.bestSectorMedals[sectorIndex], medal);

    state.race.sectorStartTime = state.race.raceTime;
    state.race.nextSectorIndex += 1;
    state.race.nextSectorDistance += track.totalLength / 3;

    if (state.race.nextSectorIndex > 2) {
      const lapTime = state.race.raceTime - state.race.lapStartTime;
      finalizeLap(lapTime);
      if (state.mode !== "racing") return;
    }
  }
}

function finalizeLap(lapTime) {
  state.race.lastLap = lapTime;

  if (lapTime < state.race.bestLap) {
    state.race.bestLap = lapTime;
    saveBestGhostRun(lapTime);
  }

  if (state.daily.id === "daily_clean_lap" && state.truck.collisions === 0) {
    completeDailyChallenge();
  }

  state.race.lap += 1;
  state.race.lapStartTime = state.race.raceTime;
  state.race.lapStartDistance = state.truck.distance;
  state.race.sectorStartTime = state.race.raceTime;
  state.race.nextSectorIndex = 0;

  state.ghost.recording = [];
  state.ghost.lapTimer = 0;

  if (state.race.lap > state.setup.totalLaps) {
    finishRace();
    return;
  }
}

function getSectorMedal(sectorTime, target) {
  if (sectorTime <= target * 0.92) return "G";
  if (sectorTime <= target * 1.0) return "S";
  if (sectorTime <= target * 1.12) return "B";
  return "-";
}

function betterMedal(a, b) {
  return MEDAL_ORDER.indexOf(b) > MEDAL_ORDER.indexOf(a) ? b : a;
}

function updateLicenseChallenge() {
  if (!state.license.active || state.mode !== "license") return;

  const elapsed = state.race.raceTime;
  if (elapsed > state.license.timeLimit) {
    state.license.failed = true;
    state.license.message = "超时";
    finishRace();
    return;
  }

  const lapDistance = state.truck.distance - state.race.lapStartDistance;

  if (state.license.type === "precision") {
    const inZone = lapDistance >= state.license.stopZone.start && lapDistance <= state.license.stopZone.end;
    if (inZone && state.truck.speed * 3.6 < 4.2) {
      state.license.success = true;
      state.license.message = "精准刹停成功";
      finishRace();
      return;
    }
    if (lapDistance > state.license.stopZone.end + 18) {
      state.license.failed = true;
      state.license.message = "刹停区通过过快";
      finishRace();
      return;
    }
    return;
  }

  if (state.license.type === "slalom") {
    const gate = state.license.gates[state.license.nextGate];
    if (!gate) {
      state.license.success = true;
      state.license.message = "蛇形门全部通过";
      finishRace();
      return;
    }

    if (lapDistance >= gate.distance) {
      const laneError = Math.abs(state.truck.laneOffset - gate.targetLane);
      if (laneError < 1.7) {
        gate.passed = true;
        gate.leftPole.material.color.setHex(0x66ff8a);
        gate.rightPole.material.color.setHex(0x66ff8a);
        state.license.nextGate += 1;
      } else if (lapDistance > gate.distance + 8) {
        state.license.failed = true;
        state.license.message = "未通过蛇形门";
        finishRace();
      }
    }
    return;
  }

  if (state.license.type === "clean") {
    if (state.truck.collisions > 0 || state.score.rulePenalties > 0) {
      state.license.failed = true;
      state.license.message = "出现碰撞或违规";
      finishRace();
      return;
    }

    if (lapDistance >= track.totalLength / 3) {
      state.license.success = true;
      state.license.message = "清洁冲刺完成";
      finishRace();
    }
  }
}

function saveBestGhostRun(lapTime) {
  if (!state.ghost.recording.length) return;

  const samples = state.ghost.recording.map((point) => ({ t: point.t, d: point.d, l: point.l }));
  const payload = { lapTime, samples };

  state.ghost.bestRun = payload;
  saveStorage(STORAGE_KEYS.ghost, payload);
}

function updateGhostRecording() {
  if (state.mode !== "racing") return;

  state.ghost.recording.push({
    t: state.ghost.lapTimer,
    d: state.truck.distance - state.race.lapStartDistance,
    l: state.truck.laneOffset,
  });

  if (state.ghost.recording.length > 1800) {
    state.ghost.recording.shift();
  }
}

function finishRace() {
  const wasLicense = state.mode === "license";

  state.mode = "finished";
  state.paused = false;
  dom.hud.classList.add("hidden");
  dom.finishOverlay.classList.add("visible");

  persistStats();

  if (wasLicense) {
    const medal = computeLicenseMedal();
    dom.finishTitle.textContent = `${licenseDefinitions[state.license.type].name} | ${medal}`;
    dom.finishSummary.textContent = state.license.success
      ? `${state.license.message} | Time ${formatTime(state.race.raceTime)} | Rule Penalty ${state.score.rulePenalties}`
      : `失败: ${state.license.message} | Time ${formatTime(state.race.raceTime)}`;

    persistedStats.licenseMedals[state.license.type] = betterMedal(persistedStats.licenseMedals[state.license.type] ?? "-", medal);
    persistStats();
    return;
  }

  const grade = computeGtGrade();
  const clean = Math.round(state.score.cleanDrive);
  const bestLapText = Number.isFinite(state.race.bestLap) ? formatTime(state.race.bestLap) : "--:--.---";

  dom.finishTitle.textContent = `GT Rating ${grade}`;
  dom.finishSummary.textContent = `Best Lap ${bestLapText} | Clean ${clean} | Collisions ${state.truck.collisions} | Rule ${state.score.rulePenalties} | Top ${Math.round(state.truck.topSpeedKmh)} km/h`;
}

function computeGtGrade() {
  const clean = state.score.cleanDrive;
  const collisions = state.truck.collisions;
  const rule = state.score.rulePenalties;

  if (clean >= 93 && collisions === 0 && rule === 0) return "S";
  if (clean >= 82 && collisions <= 1 && rule <= 1) return "A";
  if (clean >= 66) return "B";
  return "C";
}

function computeLicenseMedal() {
  if (!state.license.success) return "-";

  const t = state.race.raceTime;
  const limit = state.license.timeLimit;

  if (t <= limit * 0.72 && state.score.rulePenalties === 0) return "G";
  if (t <= limit * 0.86) return "S";
  return "B";
}

function persistStats() {
  persistedStats.bestLap = state.race.bestLap;
  persistedStats.bestSectors = [...state.race.bestSectors];
  persistedStats.bestSectorMedals = [...state.race.bestSectorMedals];

  saveStorage(STORAGE_KEYS.stats, persistedStats);
}

function updateHud() {
  const lapTime = state.race.raceTime - state.race.lapStartTime;
  const bestLapText = Number.isFinite(state.race.bestLap) ? formatTime(state.race.bestLap) : "--:--.---";

  const limitText = `Limit ${state.rules.currentLimit}`;
  const lightText = `Light ${state.rules.lastTrafficLightState.toUpperCase()}`;

  dom.hudLap.textContent = `LAP ${Math.min(state.race.lap, state.setup.totalLaps)} / ${state.setup.totalLaps}`;
  dom.hudTime.textContent = `TIME ${formatTime(lapTime)}`;
  dom.hudBest.textContent = `BEST ${bestLapText}`;

  if (state.mode === "license") {
    const remain = Math.max(0, state.license.timeLimit - state.race.raceTime);
    dom.hudSector.textContent = `${licenseDefinitions[state.license.type].name} | ${remain.toFixed(1)}s`;
  } else {
    dom.hudSector.textContent = `SECTOR ${state.race.nextSectorIndex + 1}`;
  }

  dom.hudMedals.textContent = `MEDALS ${state.race.sectorMedals.join(" ")}`;
  dom.hudSpeed.textContent = Math.round(state.truck.speed * 3.6).toString();
  dom.hudView.textContent = `VIEW ${state.cameraMode}`;
  dom.hudAssists.textContent = `ABS ${state.assists.absActive ? "ON" : "OFF"} | TCS ${state.assists.tcsActive ? "ON" : "OFF"}`;
  dom.hudClean.textContent = `Clean Drive ${Math.round(state.score.cleanDrive)}`;
  dom.hudScore.textContent = `GT Points ${Math.max(0, Math.round(state.score.gtPoints - state.score.penalties))}`;
  dom.hudSetup.textContent = `TCS ${state.setup.tcLevel} | ${state.setup.powerMap >= 1.1 ? "RACE" : state.setup.powerMap >= 1 ? "SPORT" : "ECO"}`;
  dom.hudRule.textContent = `${limitText} | ${lightText}`;
}

function updateDailyChallengeText() {
  const suffix = state.daily.completed ? " (已完成)" : "";
  dom.daily.textContent = state.daily.text + suffix;
}

function updateDailyProgress() {
  if (state.daily.completed || state.mode === "license") return;

  if (state.daily.id === "daily_top_speed") {
    state.daily.progress = Math.max(state.daily.progress, state.truck.topSpeedKmh);
    if (state.daily.progress >= state.daily.target) completeDailyChallenge();
    return;
  }

  if (state.daily.id === "daily_gt_points") {
    state.daily.progress = Math.max(state.daily.progress, Math.max(0, state.score.gtPoints - state.score.penalties));
    if (state.daily.progress >= state.daily.target) completeDailyChallenge();
  }
}

function completeDailyChallenge() {
  if (state.daily.completed) return;
  state.daily.completed = true;
  state.score.gtPoints += 180;

  if (!persistedStats.dailyDone[state.daily.dateKey]) {
    persistedStats.dailyDone[state.daily.dateKey] = [];
  }
  if (!persistedStats.dailyDone[state.daily.dateKey].includes(state.daily.id)) {
    persistedStats.dailyDone[state.daily.dateKey].push(state.daily.id);
  }

  saveStorage(STORAGE_KEYS.stats, persistedStats);
  updateDailyChallengeText();
}

function setCameraMode(mode) {
  state.cameraMode = THREE.MathUtils.clamp(mode, 1, 3);
  updateTruckVisibility();
  updateHud();
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
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function step(dt) {
  state.meta.frame += 1;
  state.meta.worldTime += dt;

  if (isRunActive() && !state.paused) {
    updatePhysics(dt);
    state.ghost.lapTimer += dt;
    updateGhostRecording();
    updateTiming(dt);
    updateLicenseChallenge();
    updateRoadRules(dt);
    updateDailyProgress();
  }

  updateRoadMeshes(state.truck.distance);
  updateTraffic(dt);
  updateTruckTransform(dt);
  updateGhostTransform(dt);
  updateRacingLine();
  updateHud();
}

window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  const dt = (ms / 1000) / steps;
  for (let i = 0; i < steps; i += 1) {
    step(dt);
  }
  renderer.render(scene, camera);
};

window.render_game_to_text = () => {
  const nearbyTraffic = traffic
    .map((v) => ({
      distanceAhead: Number(shortestLoopDistance(v.distance - state.truck.distance, track.totalLength).toFixed(1)),
      laneOffset: Number(v.lane.toFixed(1)),
      speedKmh: Math.round(v.speed * 3.6),
      visible: v.mesh.visible,
    }))
    .filter((v) => Math.abs(v.distanceAhead) < 50)
    .slice(0, 5);

  return JSON.stringify({
    coordinateSystem: "distance_m increases along track loop; laneOffset_m positive to driver's right",
    mode: state.mode,
    paused: state.paused,
    cameraMode: state.cameraMode,
    lap: {
      current: Math.min(state.race.lap, state.setup.totalLaps),
      total: state.setup.totalLaps,
      sector: state.race.nextSectorIndex + 1,
      medals: state.race.sectorMedals,
    },
    truck: {
      speedKmh: Number((state.truck.speed * 3.6).toFixed(1)),
      distanceM: Number(state.truck.distance.toFixed(1)),
      laneOffsetM: Number(state.truck.laneOffset.toFixed(2)),
      collisions: state.truck.collisions,
      wheelSlip: Number(state.truck.wheelSlip.toFixed(2)),
    },
    assists: {
      abs: state.assists.absActive,
      tcs: state.assists.tcsActive,
    },
    rules: {
      speedLimit: state.rules.currentLimit,
      redLightViolations: state.rules.redLightViolations,
      rulePenaltyCount: state.score.rulePenalties,
    },
    gt: {
      cleanDrive: Math.round(state.score.cleanDrive),
      points: Math.max(0, Math.round(state.score.gtPoints - state.score.penalties)),
      topSpeedKmh: Math.round(state.truck.topSpeedKmh),
    },
    license: {
      active: state.license.active,
      type: state.license.type,
      message: state.license.message,
      success: state.license.success,
      failed: state.license.failed,
      gateProgress: state.license.nextGate,
    },
    daily: {
      id: state.daily.id,
      completed: state.daily.completed,
      progress: Math.round(state.daily.progress),
      target: state.daily.target,
    },
    ghost: {
      hasBestRun: Boolean(state.ghost.bestRun),
      visible: ghostTruck.group.visible,
    },
    traffic: nearbyTraffic,
  });
};

function buildDailyChallenge() {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const hash = [...dateKey].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const challenge = dailyDefinitions[hash % dailyDefinitions.length];

  return {
    dateKey,
    id: challenge.id,
    text: challenge.text,
    target: challenge.target,
  };
}

function loadStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota issues
  }
}

function isValidGhost(payload) {
  return Boolean(payload && Number.isFinite(payload.lapTime) && Array.isArray(payload.samples) && payload.samples.length > 2);
}

function isRunActive() {
  return state.mode === "racing" || state.mode === "license";
}

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
  if (wrapped > length / 2) wrapped -= length;
  return wrapped;
}
