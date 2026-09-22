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
  private egoTailLights: THREE.Mesh[] = [];
  public egoX: number = 0;
  public egoZ: number = 0;
  public egoSpeedKmh: number = 0;
  public egoTargetSpeedKmh: number = 100;
  public currentLane: LaneIndex = 1;
  public targetLane: LaneIndex = 1;

  // Traffic vehicles & obstacles
  private trafficVehicles: {
    id: string;
    mesh: THREE.Group;
    lane: LaneIndex;
    z: number;
    speedKmh: number;
    type: 'vehicle' | 'truck' | 'debris';
  }[] = [];

  // Scenery & road markers
  private roadStripes: THREE.Mesh[] = [];
  private roadGroup: THREE.Group;

  // Camera modes
  private cameraMode: 'chase' | 'hood' | 'top' = 'chase';

  // Statistics
  public collisionCount: number = 0;
  public safetyBrakeTriggers: number = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0e17');
    this.scene.fog = new THREE.FogExp2('#0a0e17', 0.008);

    // 2. Camera setup
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 500);
    this.camera.position.set(0, 5, -12);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.6);
    this.scene.add(ambientLight);

    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(25, 45, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    this.scene.add(sun);

    // 5. Build Highway & Ego Car
    this.roadGroup = this.createHighway();
    this.scene.add(this.roadGroup);

    this.egoMesh = this.createCarMesh('#00e5ff');
    this.scene.add(this.egoMesh);

    // 6. Spawn initial traffic flow
    this.spawnInitialTraffic();

    // Resize listener
    window.addEventListener('resize', this.onResize);
  }

  private createHighway(): THREE.Group {
    const group = new THREE.Group();

    // Asphalt surface
    const roadGeo = new THREE.PlaneGeometry(16, 600);
    const roadMat = new THREE.MeshStandardMaterial({ color: '#1a1f2c', roughness: 0.8 });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.y = -0.02;
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // Guard rails
    const railMat = new THREE.MeshStandardMaterial({ color: '#4a5568', metalness: 0.8, roughness: 0.3 });
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 600), railMat);
    leftRail.position.set(-8.2, 0.4, 0);
    group.add(leftRail);

    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 600), railMat);
    rightRail.position.set(8.2, 0.4, 0);
    group.add(rightRail);

    // Dashed lane dividers
    const stripeGeo = new THREE.PlaneGeometry(0.2, 4);
    const stripeMat = new THREE.MeshBasicMaterial({ color: '#e2e8f0' });

    for (let z = -250; z < 250; z += 9) {
      // Lane divider 1 (between lane 0 and 1: x = -2)
      const s1 = new THREE.Mesh(stripeGeo, stripeMat);
      s1.rotation.x = -Math.PI / 2;
      s1.position.set(-2, 0.01, z);
      group.add(s1);
      this.roadStripes.push(s1);

      // Lane divider 2 (between lane 1 and 2: x = 2)
      const s2 = new THREE.Mesh(stripeGeo, stripeMat);
      s2.rotation.x = -Math.PI / 2;
      s2.position.set(2, 0.01, z);
      group.add(s2);
      this.roadStripes.push(s2);
    }

    return group;
  }

  private createCarMesh(color: string, isTruck: boolean = false): THREE.Group {
    const car = new THREE.Group();

    if (isTruck) {
      // Big semi-truck
      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 3.2, 4),
        new THREE.MeshStandardMaterial({ color: '#e53e3e', metalness: 0.4, roughness: 0.5 })
      );
      cab.position.y = 1.6;
      cab.castShadow = true;
      car.add(cab);

      const cargo = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 3.8, 10),
        new THREE.MeshStandardMaterial({ color: '#edf2f7', roughness: 0.7 })
      );
      cargo.position.set(0, 2.0, 7.5);
      cargo.castShadow = true;
      car.add(cargo);
      return car;
    }

    // Modern aerodynamic sedan
    const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 4.4), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    car.add(body);

    // Cabin / Windshield
    const cabinMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.1, metalness: 0.9 });
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.65, 2.3), cabinMat);
    cabin.position.set(0, 1.15, -0.2);
    cabin.castShadow = true;
    car.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.9 });
    const wheelPositions = [
      [-1.0, 0.35, 1.4],
      [1.0, 0.35, 1.4],
      [-1.0, 0.35, -1.4],
      [1.0, 0.35, -1.4],
    ];
    for (const [wx, wy, wz] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, wy, wz);
      car.add(wheel);
    }

    // Tail lights (red LED strip)
    const tailLightMat = new THREE.MeshStandardMaterial({
      color: '#ff2222',
      emissive: '#ff0000',
      emissiveIntensity: 0.4,
    });
    const leftTail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), tailLightMat.clone());
    leftTail.position.set(-0.75, 0.65, -2.2);
    car.add(leftTail);

    const rightTail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), tailLightMat.clone());
    rightTail.position.set(0.75, 0.65, -2.2);
    car.add(rightTail);

    if (color === '#00e5ff') {
      this.egoTailLights = [leftTail, rightTail];
    }

    return car;
  }

  private spawnInitialTraffic(): void {
    const trafficConfigs = [
      { id: 'v1', lane: 1 as LaneIndex, z: 40, speed: 75, type: 'vehicle' as const, color: '#f59e0b' },
      { id: 'v2', lane: 0 as LaneIndex, z: 65, speed: 110, type: 'vehicle' as const, color: '#ec4899' },
      { id: 'v3', lane: 2 as LaneIndex, z: 25, speed: 65, type: 'truck' as const, color: '#ef4444' },
      { id: 'v4', lane: 0 as LaneIndex, z: 120, speed: 95, type: 'vehicle' as const, color: '#8b5cf6' },
      { id: 'v5', lane: 1 as LaneIndex, z: 90, speed: 80, type: 'vehicle' as const, color: '#10b981' },
    ];

    for (const conf of trafficConfigs) {
      const mesh = this.createCarMesh(conf.color, conf.type === 'truck');
      mesh.position.set(this.laneX[conf.lane], 0, conf.z);
      this.scene.add(mesh);
      this.trafficVehicles.push({
        id: conf.id,
        mesh,
        lane: conf.lane,
        z: conf.z,
        speedKmh: conf.speed,
        type: conf.type,
      });
    }
  }

  /**
   * Spawns a sudden emergency obstacle right in front of the ego vehicle to test the Safety Brake.
   */
  public triggerSuddenObstacle(): void {
    // Spawn a stationary obstacle 30m ahead in current ego lane!
    const zAhead = this.egoZ + 32;
    const mesh = this.createCarMesh('#dc2626', true); // Stalled Red Truck
    mesh.position.set(this.laneX[this.currentLane], 0, zAhead);
    this.scene.add(mesh);

    this.trafficVehicles.unshift({
      id: `hazard-${Date.now()}`,
      mesh,
      lane: this.currentLane,
      z: zAhead,
      speedKmh: 0, // Stopped dead!
      type: 'debris',
    });
  }

  /**
   * Spawns a vehicle that aggressively cuts into ego's lane from an adjacent lane.
   */
  public triggerCutIn(): void {
    const cutInLane = this.currentLane === 0 ? 1 : (this.currentLane - 1 as LaneIndex);
    const zAhead = this.egoZ + 18;
    const mesh = this.createCarMesh('#ea580c', false);
    mesh.position.set(this.laneX[cutInLane], 0, zAhead);
    this.scene.add(mesh);

    const item = {
      id: `cutin-${Date.now()}`,
      mesh,
      lane: cutInLane,
      z: zAhead,
      speedKmh: Math.max(40, this.egoSpeedKmh - 25), // Aggressive deceleration
      type: 'vehicle' as const,
    };
    this.trafficVehicles.unshift(item);

    // Animate lateral slide into ego lane after 300ms
    setTimeout(() => {
      item.lane = this.currentLane;
    }, 400);
  }

  /**
   * Extracts perception frame for the Jev Reflex Engine.
   */
  public getPerceptionFrame(): PerceptionFrame {
    const egoSpeedMps = (this.egoSpeedKmh * 1000) / 3600;
    let leadObstacle: ObstacleInfo | null = null;
    let leftObstacle: ObstacleInfo | null = null;
    let rightObstacle: ObstacleInfo | null = null;
    let minTtc = Infinity;

    for (const v of this.trafficVehicles) {
      const relDist = v.z - this.egoZ;
      const vSpeedMps = (v.speedKmh * 1000) / 3600;
      const relSpeed = vSpeedMps - egoSpeedMps; // Negative if we are closing in

      // Calculate TTC
      let ttc = Infinity;
      if (relDist > 0 && relSpeed < -0.1) {
        ttc = relDist / Math.abs(relSpeed);
      }

      // Check current lane lead vehicle
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

      // Check side lane obstacles within blind spot (-8m to +25m)
      if (v.lane === this.currentLane - 1 && relDist > -8 && relDist < 25) {
        leftObstacle = {
          id: v.id,
          type: v.type,
          laneIndex: v.lane,
          relativeDistance: relDist,
          relativeSpeed: relSpeed,
          ttc,
        };
      }
      if (v.lane === this.currentLane + 1 && relDist > -8 && relDist < 25) {
        rightObstacle = {
          id: v.id,
          type: v.type,
          laneIndex: v.lane,
          relativeDistance: relDist,
          relativeSpeed: relSpeed,
          ttc,
        };
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

  /**
   * Applies the reflex decision to vehicle physics and kinematics.
   */
  public applyDecision(decision: ReflexDecision, dt: number): void {
    // 1. Throttle / Braking dynamics
    if (decision.brake > 0) {
      const decel = 9.8 * decision.brake * 1.2; // Max ~1.2g emergency deceleration
      this.egoSpeedKmh = Math.max(0, this.egoSpeedKmh - (decel * 3.6 * dt));
    } else if (decision.throttle > 0) {
      const accel = 3.5 * decision.throttle; // Max ~0.35g comfortable acceleration
      this.egoSpeedKmh = Math.min(130, this.egoSpeedKmh + (accel * 3.6 * dt));
    }

    // Tail light illumination
    const isHardBraking = decision.brake > 0.3;
    for (const light of this.egoTailLights) {
      const mat = light.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = isHardBraking ? 2.5 : 0.4;
    }

    if (decision.safetyGateIntervened) {
      this.safetyBrakeTriggers++;
    }

    // 2. Lateral lane steering
    this.targetLane = decision.targetLaneIndex;
    const targetX = this.laneX[this.targetLane];
    const steerSpeed = decision.action === 'SWERVE_EVADE' ? 9.0 : 4.5;
    this.egoX = THREE.MathUtils.lerp(this.egoX, targetX, steerSpeed * dt);

    // 3. Advance longitudinal position
    const speedMps = (this.egoSpeedKmh * 1000) / 3600;
    this.egoZ += speedMps * dt;
    this.egoMesh.position.set(this.egoX, 0, this.egoZ);

    // Slight chassis roll during steering
    const lateralDelta = targetX - this.egoX;
    this.egoMesh.rotation.y = -lateralDelta * 0.08;
    this.egoMesh.rotation.z = lateralDelta * 0.04;
  }

  /**
   * Step the simulation forward.
   */
  public step(dt: number): void {
    // Update AI traffic vehicles
    for (let i = this.trafficVehicles.length - 1; i >= 0; i--) {
      const v = this.trafficVehicles[i];
      const speedMps = (v.speedKmh * 1000) / 3600;
      v.z += speedMps * dt;

      // Smooth lateral position to target lane
      const targetX = this.laneX[v.lane];
      v.mesh.position.x = THREE.MathUtils.lerp(v.mesh.position.x, targetX, 3.5 * dt);
      v.mesh.position.z = v.z;

      // Collision detection with ego car
      const dx = Math.abs(v.mesh.position.x - this.egoX);
      const dz = Math.abs(v.z - this.egoZ);
      if (dx < 1.8 && dz < 3.8) {
        this.collisionCount++;
      }

      // Recycle vehicles that fall far behind (e.g. 80m behind)
      if (v.z < this.egoZ - 80) {
        v.z = this.egoZ + Math.random() * 100 + 120;
        v.lane = Math.floor(Math.random() * 3) as LaneIndex;
        v.speedKmh = Math.floor(Math.random() * 35 + 75);
      }
    }

    // Scroll road surface & stripes with ego vehicle
    this.roadGroup.position.z = this.egoZ;

    // Update Camera position
    this.updateCamera(dt);

    // Render frame
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(dt: number): void {
    if (this.cameraMode === 'chase') {
      const targetCamPos = new THREE.Vector3(this.egoX * 0.4, 4.2, this.egoZ - 9.5);
      this.camera.position.lerp(targetCamPos, 8.0 * dt);
      this.camera.lookAt(this.egoX * 0.6, 1.2, this.egoZ + 15);
    } else if (this.cameraMode === 'hood') {
      this.camera.position.set(this.egoX, 1.35, this.egoZ + 1.2);
      this.camera.lookAt(this.egoX, 1.2, this.egoZ + 40);
    } else if (this.cameraMode === 'top') {
      this.camera.position.set(0, 42, this.egoZ + 10);
      this.camera.lookAt(0, 0, this.egoZ + 25);
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

    // Clear dynamic hazard obstacles
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
  }
}
