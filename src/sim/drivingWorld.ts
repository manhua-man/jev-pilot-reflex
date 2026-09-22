import * as THREE from 'three';
import type {
  PerceptionFrame,
  ReflexDecision,
  ObstacleInfo,
  LaneIndex,
  VehicleTelemetry,
} from '../types';

export class DrivingWorld {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  // Road configuration
  public readonly laneWidth = 4.0;
  public readonly laneX: number[] = [-4.0, 0.0, 4.0]; // Lanes 0, 1, 2

  // Ego vehicle
  private egoMesh: THREE.Group;
  private egoWheels: THREE.Group[] = [];
  private egoTailLightBar!: THREE.Mesh;
  private egoHeadlightLeft!: THREE.SpotLight;
  private egoHeadlightRight!: THREE.SpotLight;
  private trajectoryRibbon!: THREE.Mesh;
  private trajectoryGeo!: THREE.PlaneGeometry;
  private trajectoryMat!: THREE.MeshBasicMaterial;

  public egoX: number = 0;
  public egoZ: number = 0;
  public egoSpeedKmh: number = 90;
  public egoTargetSpeedKmh: number = 100;
  public currentLane: LaneIndex = 1;
  public targetLane: LaneIndex = 1;

  // Traffic vehicles & obstacles
  private trafficVehicles: {
    id: string;
    mesh: THREE.Group;
    boundingWire: THREE.LineSegments;
    lane: LaneIndex;
    z: number;
    speedKmh: number;
    type: 'vehicle' | 'truck' | 'debris';
    color: string;
  }[] = [];

  // Scenery & road markers
  private roadStripes: THREE.Mesh[] = [];
  private roadGroup: THREE.Group;
  private lightPoles: THREE.Group[] = [];
  private speedParticles: THREE.Points;
  private particlePositions: Float32Array;

  // Audio synthesizer for FSD chimes
  private audioCtx: AudioContext | null = null;
  private lastAlertSoundTime = 0;

  // Camera modes
  private cameraMode: 'chase' | 'hood' | 'top' = 'chase';

  // Statistics
  public collisionCount: number = 0;
  public safetyBrakeTriggers: number = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene setup with deep cinematic atmospheric fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050811');
    this.scene.fog = new THREE.FogExp2('#050811', 0.007);

    // 2. Camera setup
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.1, 600);
    this.camera.position.set(0, 4.2, -10.5);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    // 4. Lighting: Ambient + Cyberpunk moonlit directional light
    const ambient = new THREE.AmbientLight('#1e293b', 0.85);
    this.scene.add(ambient);

    const moonLight = new THREE.DirectionalLight('#38bdf8', 1.0);
    moonLight.position.set(30, 50, -40);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.width = 1024;
    moonLight.shadow.mapSize.height = 1024;
    this.scene.add(moonLight);

    // 5. Build Cyber Highway & Scenery
    this.roadGroup = this.createCyberHighway();
    this.scene.add(this.roadGroup);

    // 6. Build Speed Streaks (Particles)
    const { points, positions } = this.createSpeedParticles();
    this.speedParticles = points;
    this.particlePositions = positions;
    this.scene.add(this.speedParticles);

    // 7. Build Ego Cyber Vehicle
    this.egoMesh = this.createCyberCarMesh('#00e5ff', true);
    this.scene.add(this.egoMesh);

    // 8. Build FSD Dynamic Trajectory Ribbon
    this.createTrajectoryRibbon();

    // 9. Spawn Initial Traffic
    this.spawnInitialTraffic();

    // 10. Resize listener
    window.addEventListener('resize', this.onResize);
  }

  private initAudio(): void {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
  }

  public playAlertChime(): void {
    const now = performance.now();
    if (now - this.lastAlertSoundTime < 600) return; // Debounce
    this.lastAlertSoundTime = now;

    try {
      this.initAudio();
      if (!this.audioCtx || this.audioCtx.state !== 'running') return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.18);

      gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.2);
    } catch {
      // Audio policies in browser may restrict autoplay until user gestures
    }
  }

  private createCyberHighway(): THREE.Group {
    const group = new THREE.Group();

    // High-contrast Asphalt Road
    const roadGeo = new THREE.PlaneGeometry(16, 650);
    const roadMat = new THREE.MeshStandardMaterial({
      color: '#0d111a',
      roughness: 0.35,
      metalness: 0.2,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    group.add(road);

    // Outer Glowing Shoulder Rails (Neon Blue Neon Ribbons)
    const railMat = new THREE.MeshStandardMaterial({
      color: '#00f0ff',
      emissive: '#0088cc',
      emissiveIntensity: 1.2,
      roughness: 0.1,
    });
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 650), railMat);
    leftRail.position.set(-8.1, 0.2, 0);
    group.add(leftRail);

    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 650), railMat);
    rightRail.position.set(8.1, 0.2, 0);
    group.add(rightRail);

    // Dashed Cyber Lane Dividers (with subtle emissive glow)
    const stripeGeo = new THREE.PlaneGeometry(0.16, 4.0);
    const stripeMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });

    for (let z = -280; z < 280; z += 9) {
      // Left lane divider (x = -2.0)
      const s1 = new THREE.Mesh(stripeGeo, stripeMat);
      s1.rotation.x = -Math.PI / 2;
      s1.position.set(-2.0, 0.015, z);
      group.add(s1);
      this.roadStripes.push(s1);

      // Right lane divider (x = +2.0)
      const s2 = new THREE.Mesh(stripeGeo, stripeMat);
      s2.rotation.x = -Math.PI / 2;
      s2.position.set(2.0, 0.015, z);
      group.add(s2);
      this.roadStripes.push(s2);
    }

    // Light poles / Street Gantries along the highway
    for (let z = -260; z < 260; z += 55) {
      const pole = this.createLightPole();
      pole.position.set(-9.2, 0, z);
      group.add(pole);
      this.lightPoles.push(pole);

      const rightPole = this.createLightPole(true);
      rightPole.position.set(9.2, 0, z + 27.5);
      group.add(rightPole);
      this.lightPoles.push(rightPole);
    }

    return group;
  }

  private createLightPole(flip = false): THREE.Group {
    const g = new THREE.Group();
    const mastMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.8, roughness: 0.2 });
    const lampMat = new THREE.MeshBasicMaterial({ color: '#fef08a' });

    // Vertical mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 8, 12), mastMat);
    mast.position.y = 4.0;
    g.add(mast);

    // Overhanging arm
    const armLength = 3.2;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, armLength, 8), mastMat);
    arm.rotation.z = (flip ? -1 : 1) * Math.PI / 3.5;
    arm.position.set((flip ? -1 : 1) * 1.3, 7.5, 0);
    g.add(arm);

    // Lamp head
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.8), lampMat);
    lamp.position.set((flip ? -1 : 1) * 2.4, 7.8, 0);
    g.add(lamp);

    // PointLight casting warm illumination on pavement
    const light = new THREE.PointLight('#fef08a', 0.6, 22, 1.8);
    light.position.set((flip ? -1 : 1) * 2.4, 7.5, 0);
    g.add(light);

    return g;
  }

  private createSpeedParticles(): { points: THREE.Points; positions: Float32Array } {
    const count = 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = Math.random() * 8 + 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 160;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: '#38bdf8',
      size: 0.35,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    return { points, positions };
  }

  private createCyberCarMesh(color: string, isEgo = false, isTruck = false): THREE.Group {
    const car = new THREE.Group();

    if (isTruck) {
      // Modern High-Tech Semi-Truck (Cyber Hauler)
      const cabMat = new THREE.MeshStandardMaterial({
        color: '#b91c1c',
        metalness: 0.6,
        roughness: 0.35,
      });
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3.4, 4.2), cabMat);
      cab.position.y = 1.7;
      cab.castShadow = true;
      car.add(cab);

      // Cyber Windshield
      const glassMat = new THREE.MeshStandardMaterial({
        color: '#020617',
        roughness: 0.1,
        metalness: 0.9,
      });
      const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.2, 1.0), glassMat);
      windshield.position.set(0, 2.2, 1.6);
      car.add(windshield);

      // Heavy Cargo Trailer
      const cargoMat = new THREE.MeshStandardMaterial({
        color: '#e2e8f0',
        metalness: 0.4,
        roughness: 0.4,
      });
      const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.8, 11), cargoMat);
      cargo.position.set(0, 2.1, 8.0);
      cargo.castShadow = true;
      car.add(cargo);

      // Tail lights
      const tail = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.2, 0.1),
        new THREE.MeshBasicMaterial({ color: '#ff0033' })
      );
      tail.position.set(0, 0.7, 13.5);
      car.add(tail);

      return car;
    }

    // Sleek Cyber Sedan / Coupe (Tesla Roadster / Cyberpunk inspired)
    // 1. Aerodynamic Chiseled Body (Beveled wedge profile)
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      metalness: isEgo ? 0.85 : 0.65,
      roughness: isEgo ? 0.18 : 0.3,
    });

    // Lower chassis base
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.5, 4.4), bodyMat);
    lowerBody.position.y = 0.42;
    lowerBody.castShadow = true;
    car.add(lowerBody);

    // Upper wedge nose and hood
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.35, 1.6), bodyMat);
    nose.position.set(0, 0.62, 1.3);
    nose.rotation.x = 0.08;
    car.add(nose);

    // Cockpit Fastback Glass Canopy
    const canopyMat = new THREE.MeshStandardMaterial({
      color: '#030712',
      metalness: 0.95,
      roughness: 0.05,
      transparent: true,
      opacity: 0.88,
    });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.58, 2.3), canopyMat);
    canopy.position.set(0, 0.98, -0.2);
    canopy.castShadow = true;
    car.add(canopy);

    // Front Neon DRL Light Bar (Ice Blue)
    const drlMat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
    const drl = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.1), drlMat);
    drl.position.set(0, 0.58, 2.2);
    car.add(drl);

    // Full-Width Rear LED Tail Light Bar
    const tailMat = new THREE.MeshStandardMaterial({
      color: '#ff0033',
      emissive: '#ff0033',
      emissiveIntensity: isEgo ? 1.0 : 0.6,
      roughness: 0.2,
    });
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.1), tailMat);
    tailBar.position.set(0, 0.65, -2.2);
    car.add(tailBar);

    if (isEgo) {
      this.egoTailLightBar = tailBar;

      // Realistic Twin Headlight Projector Cones (casting real light onto the road)
      this.egoHeadlightLeft = new THREE.SpotLight('#ffffff', 2.2, 45, Math.PI / 7, 0.4, 1.2);
      this.egoHeadlightLeft.position.set(-0.65, 0.6, 2.0);
      this.egoHeadlightLeft.target.position.set(-0.65, 0, 25);
      car.add(this.egoHeadlightLeft);
      car.add(this.egoHeadlightLeft.target);

      this.egoHeadlightRight = new THREE.SpotLight('#ffffff', 2.2, 45, Math.PI / 7, 0.4, 1.2);
      this.egoHeadlightRight.position.set(0.65, 0.6, 2.0);
      this.egoHeadlightRight.target.position.set(0.65, 0, 25);
      car.add(this.egoHeadlightRight);
      car.add(this.egoHeadlightRight.target);
    }

    // Four Cyber Wheels with Rims & Calipers
    const wheelPositions = [
      [-0.98, 0.35, 1.35],
      [0.98, 0.35, 1.35],
      [-0.98, 0.35, -1.35],
      [0.98, 0.35, -1.35],
    ];
    for (const [wx, wy, wz] of wheelPositions) {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(wx, wy, wz);

      const tireMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.9 });
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.26, 16), tireMat);
      tire.rotation.z = Math.PI / 2;
      wheelGroup.add(tire);

      const rimMat = new THREE.MeshStandardMaterial({
        color: isEgo ? '#00f0ff' : '#94a3b8',
        emissive: isEgo ? '#00e5ff' : '#000000',
        emissiveIntensity: isEgo ? 0.4 : 0,
        metalness: 0.9,
      });
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.27, 8), rimMat);
      rim.rotation.z = Math.PI / 2;
      wheelGroup.add(rim);

      car.add(wheelGroup);
      if (isEgo) this.egoWheels.push(wheelGroup);
    }

    return car;
  }

  private createTrajectoryRibbon(): void {
    // 35m long projected ribbon with 30 subdivisions
    this.trajectoryGeo = new THREE.PlaneGeometry(1.8, 35, 1, 30);
    this.trajectoryMat = new THREE.MeshBasicMaterial({
      color: '#00e5ff',
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.trajectoryRibbon = new THREE.Mesh(this.trajectoryGeo, this.trajectoryMat);
    this.trajectoryRibbon.rotation.x = -Math.PI / 2;
    this.trajectoryRibbon.position.set(0, 0.03, 17.5);
    this.scene.add(this.trajectoryRibbon);
  }

  private spawnInitialTraffic(): void {
    const trafficConfigs = [
      { id: 'v1', lane: 1 as LaneIndex, z: 42, speed: 76, type: 'vehicle' as const, color: '#f59e0b' },
      { id: 'v2', lane: 0 as LaneIndex, z: 68, speed: 108, type: 'vehicle' as const, color: '#ec4899' },
      { id: 'v3', lane: 2 as LaneIndex, z: 28, speed: 64, type: 'truck' as const, color: '#ef4444' },
      { id: 'v4', lane: 0 as LaneIndex, z: 125, speed: 96, type: 'vehicle' as const, color: '#8b5cf6' },
      { id: 'v5', lane: 1 as LaneIndex, z: 92, speed: 82, type: 'vehicle' as const, color: '#10b981' },
    ];

    for (const conf of trafficConfigs) {
      this.spawnTrafficCar(conf.id, conf.lane, conf.z, conf.speed, conf.type, conf.color);
    }
  }

  private spawnTrafficCar(
    id: string,
    lane: LaneIndex,
    z: number,
    speedKmh: number,
    type: 'vehicle' | 'truck' | 'debris',
    color: string
  ): void {
    const mesh = this.createCyberCarMesh(color, false, type === 'truck');
    mesh.position.set(this.laneX[lane], 0, z);
    this.scene.add(mesh);

    // Add Holographic FSD 3D Bounding Box
    const boxWidth = type === 'truck' ? 2.8 : 2.2;
    const boxHeight = type === 'truck' ? 3.9 : 1.5;
    const boxDepth = type === 'truck' ? 11.5 : 4.6;

    const wireGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth));
    const wireMat = new THREE.LineBasicMaterial({ color: '#10b981', transparent: true, opacity: 0.8 });
    const boundingWire = new THREE.LineSegments(wireGeo, wireMat);
    boundingWire.position.y = boxHeight / 2;
    mesh.add(boundingWire);

    this.trafficVehicles.push({
      id,
      mesh,
      boundingWire,
      lane,
      z,
      speedKmh,
      type,
      color,
    });
  }

  public triggerSuddenObstacle(): void {
    const zAhead = this.egoZ + 32;
    this.spawnTrafficCar(
      `hazard-${Date.now()}`,
      this.currentLane,
      zAhead,
      0, // Stalled!
      'truck',
      '#dc2626'
    );
  }

  public triggerCutIn(): void {
    const cutInLane = this.currentLane === 0 ? 1 : (this.currentLane - 1 as LaneIndex);
    const zAhead = this.egoZ + 20;

    const id = `cutin-${Date.now()}`;
    this.spawnTrafficCar(id, cutInLane, zAhead, Math.max(35, this.egoSpeedKmh - 25), 'vehicle', '#ea580c');

    const item = this.trafficVehicles.find(v => v.id === id);
    if (item) {
      setTimeout(() => {
        item.lane = this.currentLane;
      }, 400);
    }
  }

  public getPerceptionFrame(): PerceptionFrame {
    const egoSpeedMps = (this.egoSpeedKmh * 1000) / 3600;
    let leadObstacle: ObstacleInfo | null = null;
    let leftObstacle: ObstacleInfo | null = null;
    let rightObstacle: ObstacleInfo | null = null;
    let minTtc = Infinity;

    for (const v of this.trafficVehicles) {
      const relDist = v.z - this.egoZ;
      const vSpeedMps = (v.speedKmh * 1000) / 3600;
      const relSpeed = vSpeedMps - egoSpeedMps;

      let ttc = Infinity;
      if (relDist > 0 && relSpeed < -0.1) {
        ttc = relDist / Math.abs(relSpeed);
      }

      // Update Bounding Box Hologram Color based on Threat Level
      const wireMat = v.boundingWire.material as THREE.LineBasicMaterial;
      if (v.lane === this.currentLane && relDist > 0) {
        if (ttc < 1.6 || relDist < 16) {
          wireMat.color.set('#ef4444'); // Hazard Red
        } else if (ttc < 3.0 || relDist < 35) {
          wireMat.color.set('#f59e0b'); // Caution Yellow
        } else {
          wireMat.color.set('#10b981'); // Clear Green
        }
      } else {
        wireMat.color.set('#38bdf8'); // Peripheral Cyan
      }

      if (v.lane === this.currentLane && relDist > 0) {
        if (!leadObstacle || relDist < leadObstacle.relativeDistance) {
          leadObstacle = {
            id: v.id,
            type: v.type,
            laneIndex: v.lane,
            relativeDistance: Number(relDist.toFixed(1)),
            relativeSpeed: Number(relSpeed.toFixed(1)),
            ttc: Number(ttc.toFixed(2)),
          };
          if (ttc < minTtc) minTtc = ttc;
        }
      }

      if (v.lane === this.currentLane - 1 && relDist > -9 && relDist < 25) {
        leftObstacle = { id: v.id, type: v.type, laneIndex: v.lane, relativeDistance: relDist, relativeSpeed: relSpeed, ttc };
      }
      if (v.lane === this.currentLane + 1 && relDist > -9 && relDist < 25) {
        rightObstacle = { id: v.id, type: v.type, laneIndex: v.lane, relativeDistance: relDist, relativeSpeed: relSpeed, ttc };
      }
    }

    const egoTelemetry: VehicleTelemetry = {
      speedKmh: Number(this.egoSpeedKmh.toFixed(1)),
      speedMps: Number(egoSpeedMps.toFixed(2)),
      acceleration: 0,
      laneIndex: this.currentLane,
      laneOffset: Number(((this.egoX - this.laneX[this.currentLane]) / (this.laneWidth / 2)).toFixed(2)),
      x: Number(this.egoX.toFixed(2)),
      z: Number(this.egoZ.toFixed(2)),
    };

    return {
      ego: egoTelemetry,
      leadObstacle,
      leftObstacle,
      rightObstacle,
      minTtc: Number(minTtc.toFixed(2)),
      speedLimitKmh: 120,
      timestamp: Date.now(),
    };
  }

  public applyDecision(decision: ReflexDecision, dt: number): void {
    // 1. Throttle / Braking & Chassis Pitch
    if (decision.brake > 0) {
      const decel = 9.8 * decision.brake * 1.25;
      this.egoSpeedKmh = Math.max(0, this.egoSpeedKmh - (decel * 3.6 * dt));
      // Brake dive (chassis dips forward)
      this.egoMesh.rotation.x = THREE.MathUtils.lerp(this.egoMesh.rotation.x, 0.045 * decision.brake, 8 * dt);
    } else if (decision.throttle > 0) {
      const accel = 3.6 * decision.throttle;
      this.egoSpeedKmh = Math.min(130, this.egoSpeedKmh + (accel * 3.6 * dt));
      // Squat (chassis tilts slightly back)
      this.egoMesh.rotation.x = THREE.MathUtils.lerp(this.egoMesh.rotation.x, -0.02 * decision.throttle, 8 * dt);
    } else {
      this.egoMesh.rotation.x = THREE.MathUtils.lerp(this.egoMesh.rotation.x, 0, 6 * dt);
    }

    // Tail light illumination & brake flare
    const isHardBraking = decision.brake > 0.25;
    const tailMat = this.egoTailLightBar.material as THREE.MeshStandardMaterial;
    tailMat.emissiveIntensity = isHardBraking ? 3.8 : 0.8;

    if (decision.safetyGateIntervened) {
      this.safetyBrakeTriggers++;
      this.playAlertChime();
    }

    // 2. Lateral lane steering & chassis roll
    this.targetLane = decision.targetLaneIndex;
    const targetX = this.laneX[this.targetLane];
    const steerSpeed = decision.action === 'SWERVE_EVADE' ? 9.5 : 4.5;
    this.egoX = THREE.MathUtils.lerp(this.egoX, targetX, steerSpeed * dt);

    const lateralDelta = targetX - this.egoX;
    this.egoMesh.rotation.y = -lateralDelta * 0.1;
    this.egoMesh.rotation.z = lateralDelta * 0.05; // Body roll into turn

    // Wheel rotation
    const wheelRotDelta = (this.egoSpeedKmh * 1000 / 3600) * dt / 0.35;
    for (const w of this.egoWheels) {
      w.children[0].rotation.x += wheelRotDelta;
    }

    // 3. Update Projected FSD Trajectory Ribbon
    this.updateTrajectoryRibbon(decision, targetX);

    // 4. Advance longitudinal position
    const speedMps = (this.egoSpeedKmh * 1000) / 3600;
    this.egoZ += speedMps * dt;
    this.egoMesh.position.set(this.egoX, 0, this.egoZ);
  }

  private updateTrajectoryRibbon(decision: ReflexDecision, targetX: number): void {
    const posAttr = this.trajectoryGeo.attributes.position as THREE.BufferAttribute;
    const count = 31; // 30 segments -> 31 pairs of vertices

    // Color code ribbon based on state
    if (decision.action === 'EMERGENCY_BRAKE') {
      this.trajectoryMat.color.set('#ff0033');
      this.trajectoryMat.opacity = 0.85;
    } else if (decision.action === 'SWERVE_EVADE') {
      this.trajectoryMat.color.set('#f59e0b');
      this.trajectoryMat.opacity = 0.75;
    } else {
      this.trajectoryMat.color.set('#00e5ff');
      this.trajectoryMat.opacity = 0.55;
    }

    // Interpolate ribbon vertices along smooth curve from current egoX to targetX
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const lateral = THREE.MathUtils.lerp(this.egoX, targetX, t * t);
      const zLocal = t * 35; // 35m forward

      // Left vertex
      posAttr.setXY(i * 2, lateral - 0.9, zLocal);
      // Right vertex
      posAttr.setXY(i * 2 + 1, lateral + 0.9, zLocal);
    }
    posAttr.needsUpdate = true;
    this.trajectoryRibbon.position.set(0, 0.03, this.egoZ);
  }

  public step(dt: number): void {
    // 1. Update AI Traffic
    for (let i = this.trafficVehicles.length - 1; i >= 0; i--) {
      const v = this.trafficVehicles[i];
      const speedMps = (v.speedKmh * 1000) / 3600;
      v.z += speedMps * dt;

      const targetX = this.laneX[v.lane];
      v.mesh.position.x = THREE.MathUtils.lerp(v.mesh.position.x, targetX, 3.5 * dt);
      v.mesh.position.z = v.z;

      // Check collision
      const dx = Math.abs(v.mesh.position.x - this.egoX);
      const dz = Math.abs(v.z - this.egoZ);
      if (dx < 1.8 && dz < 4.0) {
        this.collisionCount++;
      }

      // Recycle cars that fall far behind
      if (v.z < this.egoZ - 80) {
        v.z = this.egoZ + Math.random() * 90 + 120;
        v.lane = Math.floor(Math.random() * 3) as LaneIndex;
        v.speedKmh = Math.floor(Math.random() * 30 + 75);
      }
    }

    // 2. Scroll Highway Ground & Streetlamps with Ego Car
    this.roadGroup.position.z = this.egoZ;

    // 3. Animate Speed Streaks (Particles rushing past)
    const speedRatio = this.egoSpeedKmh / 120;
    const pCount = this.particlePositions.length / 3;
    for (let i = 0; i < pCount; i++) {
      this.particlePositions[i * 3 + 2] -= (speedRatio * 85 + 20) * dt;
      if (this.particlePositions[i * 3 + 2] < -30) {
        this.particlePositions[i * 3 + 2] += 160;
        this.particlePositions[i * 3] = (Math.random() - 0.5) * 26 + this.egoX;
      }
    }
    this.speedParticles.geometry.attributes.position.needsUpdate = true;
    this.speedParticles.position.set(0, 0, this.egoZ);

    // 4. Update Camera View with Smooth Lag
    this.updateCamera(dt);

    // 5. Render
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(dt: number): void {
    if (this.cameraMode === 'chase') {
      const targetCamPos = new THREE.Vector3(this.egoX * 0.45, 4.0, this.egoZ - 10.0);
      this.camera.position.lerp(targetCamPos, 8.5 * dt);
      this.camera.lookAt(this.egoX * 0.65, 1.1, this.egoZ + 18);
    } else if (this.cameraMode === 'hood') {
      this.camera.position.set(this.egoX, 1.35, this.egoZ + 1.2);
      this.camera.lookAt(this.egoX, 1.1, this.egoZ + 45);
    } else if (this.cameraMode === 'top') {
      this.camera.position.set(0, 45, this.egoZ + 12);
      this.camera.lookAt(0, 0, this.egoZ + 28);
    }
  }

  public cycleCamera(): 'chase' | 'hood' | 'top' {
    const modes: ('chase' | 'hood' | 'top')[] = ['chase', 'hood', 'top'];
    const idx = (modes.indexOf(this.cameraMode) + 1) % modes.length;
    this.cameraMode = modes[idx];
    return this.cameraMode;
  }

  public reset(): void {
    this.egoX = 0;
    this.egoZ = 0;
    this.egoSpeedKmh = 90;
    this.currentLane = 1;
    this.targetLane = 1;
    this.collisionCount = 0;
    this.safetyBrakeTriggers = 0;

    for (const v of this.trafficVehicles) {
      this.scene.remove(v.mesh);
    }
    this.trafficVehicles = [];
    this.spawnInitialTraffic();
  }

  private onResize = (): void => {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    if (this.audioCtx) {
      this.audioCtx.close();
    }
  }
}
