import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { setupStaticEnvironment } from './environment.ts'; // Import the new module
import { setupHumanoidEntities, ENTITY_HEIGHT, ENTITY_RADIUS, buildDefConfigs } from './entities.ts'; // Import the new entity setup function
import { EntityState, defaultHeadDefinition, defaultTorsoDefinition, defaultArmDefinition, defaultLegDefinition, defaultWeaponDefinition, HumanoidConfig } from './types.ts'; // Updated path
import worldConfigData from './worldConfig.json'; // Import the JSON configuration
import { startCombat, endCombat, updateCombatLogic } from './combat.ts'; // Import combat functions

const COMPANION_FOLLOW_DISTANCE = 5.0;
const COMPANION_STOP_FOLLOW_DISTANCE = 4.0; // slightly less to create hysteresis
const COMPANION_FOLLOW_SPEED = 5.0;
const PC_SPEED = 5.0;
const COMBAT_DISTANCE = 15.0;

interface ActiveBullet {
    mesh: THREE.Mesh;
    targetPosition: THREE.Vector3;
    velocity: THREE.Vector3;
    lifeTime: number;
}

class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: PointerLockControls;
  private moveForward: boolean = false;
  private moveBackward: boolean = false;
  private moveLeft: boolean = false;
  private moveRight: boolean = false;
  private canJump: boolean = false; // For spacebar (up) / general jump intention
  private moveDown: boolean = false; // For shift (down) in free camera
  private prevTime: number = performance.now();
  private chunks: Map<string, THREE.Mesh> = new Map();
  private chunkSize: number = 32;
  private renderDistance: number = 3;
  private lastChunkX: number = NaN;
  private lastChunkZ: number = NaN;
  private readonly playerEyeHeight: number = 1.6;
  private staticCollidables: THREE.Object3D[] = [];
  private entityMeshes: THREE.Object3D[] = []; // Changed to Object3D[]
  private controlledTargetId: string | 'camera' = 'camera'; // Default to camera control
  private pcs: Map<string, EntityState> = new Map();
  private npcs: Map<string, EntityState> = new Map();
  private numToPc: Map<number, string> = new Map();
  private playerControlListElement: HTMLElement | null = null;
  private isInCombat: boolean = false;
  private combatants: Set<string> = new Set();
  private activeBullets: ActiveBullet[] = []; // For bullet animations
  private raycaster: THREE.Raycaster; // For click targeting
  private mouse: THREE.Vector2; // For click targeting
  private crosshairElement: HTMLElement | null = null; // For crosshair
  private highlightedTargetObject: THREE.Object3D | null = null; 
  private originalTargetMaterials: Map<string, THREE.Material | THREE.Material[]> = new Map(); 

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.Fog(0x000000, this.chunkSize * 1.5, this.chunkSize * (this.renderDistance + 1));

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    document.body.appendChild(this.renderer.domElement);

    this.controls = new PointerLockControls(this.camera, document.body);
    this.controls.getObject().position.y = this.playerEyeHeight;
    this.scene.add(this.controls.getObject());

    document.addEventListener('click', () => { this.controls.lock(); });

    // Raycaster setup for click targeting
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    document.addEventListener('mousedown', (event) => this.onDocumentMouseDown(event), false);

    const ambientLight = new THREE.AmbientLight(0x888888);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(this.chunkSize, this.chunkSize * 2, this.chunkSize / 2);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = this.chunkSize * (this.renderDistance + 2);
    this.scene.add(directionalLight);

    // Call the function from the new module
    this.staticCollidables = setupStaticEnvironment(this.scene);

    // Setup entities
    this.entityMeshes = setupHumanoidEntities(this.scene);
    this.staticCollidables.push(...this.entityMeshes); // Add entities to collidables for player interaction

    const { headDefs, torsoDefs, armDefs, legDefs, weaponDefs } = buildDefConfigs(
        worldConfigData.headDefinitions,
        worldConfigData.torsoDefinitions,
        worldConfigData.armDefinitions,
        worldConfigData.legDefinitions,
        worldConfigData.weaponDefinitions
    );

    // Initialize entity states
    this.entityMeshes.forEach(entity => {
      const pcConfig = worldConfigData.pcs.find(pc => pc.id === entity.name) as HumanoidConfig;
      const npcConfig = worldConfigData.npcs.find(npc => npc.id === entity.name) as HumanoidConfig;
      if (entity.name && (pcConfig || npcConfig)) { 
        const leftArm = entity.getObjectByName("leftArm") as THREE.Mesh;
        const rightArm = entity.getObjectByName("rightArm") as THREE.Mesh;

        let initialLeftArmRot = { x: 0, z: 0 };
        let initialRightArmRot = { x: 0, z: 0 };

        if (leftArm) {
          initialLeftArmRot = { x: leftArm.rotation.x, z: leftArm.rotation.z };
        }
        if (rightArm) {
          initialRightArmRot = { x: rightArm.rotation.x, z: rightArm.rotation.z };
        }
        const entityConfig = pcConfig || npcConfig;
        const initialState: EntityState = {
          id: entity.name,
          isPC: !!pcConfig,
          position: entity.position.clone(),
          yaw: entity.rotation.y,
          velocity: new THREE.Vector3(0, 0, 0),
          isGrounded: true, 
          isWalking: false,
          walkCycleTime: 0,
          idleCycleTime: Math.random() * Math.PI * 2, 
          initialLeftArmRotation: initialLeftArmRot,
          initialRightArmRotation: initialRightArmRot,
          hp: 100, // Initialize HP to 100
          currentTargetId: null, // Initialize target to null
          head: {
            ...defaultHeadDefinition,
            ...headDefs.find(def => def.id === entityConfig?.headDefinitionId),
            quality: 100
          },
          torso: {
            ...defaultTorsoDefinition,
            ...torsoDefs.find(def => def.id === entityConfig?.torsoDefinitionId),
            quality: 100
          },
          arms: {
            ...defaultArmDefinition,
            ...armDefs.find(def => def.id === entityConfig?.armDefinitionId),
            quality: 100
          },
          legs: {
            ...defaultLegDefinition,
            ...legDefs.find(def => def.id === entityConfig?.legDefinitionId),
            quality: 100
          },
          weapon: {
            ...defaultWeaponDefinition,
            ...weaponDefs.find(def => def.id === entityConfig?.weaponDefinitionId),
            quality: 100
          }
        };
        if (pcConfig) {
          this.pcs.set(entity.name, initialState);
          this.numToPc.set(this.pcs.size, entity.name);
          console.log(`Game constructor: Added PC ${entity.name} to pcs map.`);
        } else {
          this.npcs.set(entity.name, initialState);
        }
      }
    });

    console.log("Game constructor: Initialized with structures from environment module.");
    console.log(`Game constructor: Added ${this.entityMeshes.length} humanoid entities to staticCollidables.`);
    console.log(`Game constructor: Initialized states for ${this.pcs.size + this.npcs.size} entities.`);
    this.setupEventListeners();
    this.createPlayerControlListUI(); // New method to setup UI
    this.updateChunks();
    this.animate();
    window.addEventListener('resize', () => this.onWindowResize(), false);
    document.getElementById('loading')?.remove();
    this.createCrosshairUI(); // Create crosshair
  }

  private getChunkKey(x: number, z: number): string {
    return `${x},${z}`;
  }

  private generateChunk(chunkX: number, chunkZ: number): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 1, 1);
    const gridCellWorldSize = 1;
    const canvas = document.createElement('canvas');
    const pixelsPerWorldUnit = 16;
    const textureResolution = Math.min(512, this.chunkSize * pixelsPerWorldUnit);
    canvas.width = textureResolution;
    canvas.height = textureResolution;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#cccccc';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#888888';
    context.lineWidth = Math.max(1, textureResolution / (this.chunkSize / gridCellWorldSize) / 8);
    const linesPerChunkDimension = this.chunkSize / gridCellWorldSize;
    const step = textureResolution / linesPerChunkDimension;
    for (let i = 0; i <= textureResolution; i += step) {
      context.beginPath(); context.moveTo(i, 0); context.lineTo(i, textureResolution); context.stroke();
      context.beginPath(); context.moveTo(0, i); context.lineTo(textureResolution, i); context.stroke();
    }
    const gridTexture = new THREE.CanvasTexture(canvas);
    gridTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const material = new THREE.MeshStandardMaterial({
      map: gridTexture, side: THREE.DoubleSide, roughness: 0.9, metalness: 0.1
    });
    const chunk = new THREE.Mesh(geometry, material);
    chunk.rotation.x = -Math.PI / 2;
    chunk.position.set(chunkX * this.chunkSize, 0, chunkZ * this.chunkSize);
    chunk.receiveShadow = true;
    return chunk;
  }

  private updateChunks(): void {
    const cameraObject = this.controls.getObject();
    const cameraWorldPos = new THREE.Vector3();
    cameraObject.getWorldPosition(cameraWorldPos);
    const currentChunkX = Math.floor(cameraWorldPos.x / this.chunkSize);
    const currentChunkZ = Math.floor(cameraWorldPos.z / this.chunkSize);
    if (currentChunkX !== this.lastChunkX || currentChunkZ !== this.lastChunkZ || isNaN(this.lastChunkX)) {
      const newChunksToLoad = new Set<string>();
      for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
        for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
          newChunksToLoad.add(this.getChunkKey(currentChunkX + x, currentChunkZ + z));
        }
      }
      this.chunks.forEach((chunk, key) => {
        if (!newChunksToLoad.has(key)) {
          this.scene.remove(chunk);
          (chunk.material as THREE.MeshStandardMaterial).map?.dispose();
          (chunk.material as THREE.Material).dispose();
          chunk.geometry.dispose();
          this.chunks.delete(key);
        }
      });
      newChunksToLoad.forEach(key => {
        if (!this.chunks.has(key)) {
          const [x, z] = key.split(',').map(Number);
          const chunk = this.generateChunk(x, z);
          this.chunks.set(key, chunk);
          this.scene.add(chunk);
        }
      });
      this.lastChunkX = currentChunkX;
      this.lastChunkZ = currentChunkZ;
    }
  }

  private createPlayerControlListUI(): void {
    if (this.playerControlListElement && this.playerControlListElement.parentElement) {
        this.playerControlListElement.remove();
    }

    const newListElement = document.createElement('div');
    newListElement.style.position = 'fixed';
    newListElement.style.bottom = '10px';
    newListElement.style.left = '10px';
    newListElement.style.padding = '10px';
    newListElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    newListElement.style.color = 'white';
    newListElement.style.fontFamily = 'Arial, sans-serif';
    newListElement.style.borderRadius = '5px';
    newListElement.style.zIndex = '100';

    const title = document.createElement('p');
    title.textContent = 'Controls:';
    title.style.margin = '0 0 5px 0';
    newListElement.appendChild(title);
    
    const freecamItem = document.createElement('p');
    const isFreecamActive = this.controlledTargetId === 'camera';
    freecamItem.textContent = isFreecamActive ? '-> `: Freecam' : '`: Freecam';
    freecamItem.style.margin = '2px 0';
    freecamItem.style.cursor = 'pointer';
    if (isFreecamActive) {
        freecamItem.style.fontWeight = 'bold';
    }
    freecamItem.addEventListener('click', () => {
      this.controlledTargetId = 'camera';
      this.createPlayerControlListUI(); // Refresh UI
    });
    newListElement.appendChild(freecamItem);

    this.pcs.forEach((pc, pcId) => {
        if (!pcId) return;
        const listItem = document.createElement('p');
        const isPcActive = this.controlledTargetId === pcId;
        const num = Array.from(this.numToPc.entries()).find(([_, value]) => value === pcId)?.[0];
        listItem.textContent = isPcActive ? `-> ${num}: Control ${pc.id}` : `${num}: Control ${pc.id}`;
        listItem.style.margin = '2px 0';
        listItem.style.cursor = 'pointer';
        if (isPcActive) {
            listItem.style.fontWeight = 'bold';
        }
        listItem.addEventListener('click', () => {
            this.controlledTargetId = pc.id;
            console.log(`Control switched to: ${this.controlledTargetId}`);
            this.createPlayerControlListUI(); // Refresh UI
        });
        newListElement.appendChild(listItem);
    });
    document.body.appendChild(newListElement);
    this.playerControlListElement = newListElement; // Assign to the class member after successful creation and append
  }

  private setupEventListeners(): void {
    document.addEventListener('keydown', (event) => {
      switch (event.code) {
        case 'ArrowUp': case 'KeyW': this.moveForward = true; break;
        case 'ArrowDown': case 'KeyS': this.moveBackward = true; break;
        case 'ArrowLeft': case 'KeyA': this.moveLeft = true; break;
        case 'ArrowRight': case 'KeyD': this.moveRight = true; break;
        case 'Space': 
          this.canJump = true; 
          break;
        case 'ShiftLeft': case 'ShiftRight': 
          this.moveDown = true;
          break;
        case 'Backquote':
          this.resetMovementAndAnimationState(this.controlledTargetId);
          this.controlledTargetId = 'camera';
          console.log(`Control switched to: camera (free look)`);
          this.createPlayerControlListUI(); // Refresh UI
          break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
          const pcIndex = parseInt(event.code.substring(5)); 
          if (pcIndex <= this.pcs.size && this.numToPc.get(pcIndex)) {
            const newTargetId = this.numToPc.get(pcIndex)!;
            if (this.controlledTargetId !== newTargetId) {
                this.resetMovementAndAnimationState(this.controlledTargetId);
                this.clearTargetHighlight(); // Clear highlight when switching PC
                this.controlledTargetId = newTargetId;
                console.log(`Control switched to: ${this.controlledTargetId}`);

                // Orient camera to the new PC's facing direction
                const newPcEntityState = this.pcs.get(newTargetId);
                if (newPcEntityState) {
                    const pcYaw = newPcEntityState.yaw;
                    const cameraPitch = 0; // Look straight ahead (level)
                    const cameraRoll = 0;

                    // Create an Euler angle for the camera's new orientation.
                    // 'YXZ' order means yaw is applied first, then pitch.
                    const targetCameraEuler = new THREE.Euler(cameraPitch, pcYaw, cameraRoll, 'YXZ');
                    this.camera.quaternion.setFromEuler(targetCameraEuler);

                    // PointerLockControls will use this new camera quaternion as its starting point
                    // for subsequent mouse movements.
                }
                this.createPlayerControlListUI(); // Refresh UI
            }
          }
          break;
      }
    });
    document.addEventListener('keyup', (event) => {
      switch (event.code) {
        case 'ArrowUp': case 'KeyW': this.moveForward = false; break;
        case 'ArrowDown': case 'KeyS': this.moveBackward = false; break;
        case 'ArrowLeft': case 'KeyA': this.moveLeft = false; break;
        case 'ArrowRight': case 'KeyD': this.moveRight = false; break;
        case 'Space': this.canJump = false; break;
        case 'ShiftLeft': case 'ShiftRight': 
          this.moveDown = false;
          break;
      }
    });
  }

  private resetMovementAndAnimationState(entityIdToReset: string | 'camera'): void {
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    // this.canJump = false; // Optional: Reset jump intention too, though Space keyup handles it.
    // this.moveDown = false; // Optional: Reset moveDown too, though Shift keyup handles it.

    if (entityIdToReset !== 'camera') {
        const entityState = this.pcs.get(entityIdToReset);
        if (entityState) {
            entityState.isWalking = false;
            // We might also want to reset velocity if the entity should stop immediately
            // entityState.velocity.set(0, entityState.velocity.y, 0); // Keep vertical velocity for gravity/jump
            entityState.velocity.x = 0; // Stop horizontal movement
            entityState.velocity.z = 0; // Stop horizontal movement
            // Vertical velocity (entityState.velocity.y) and isGrounded state remain as they were.
            // Gravity and ground collision for non-controlled entities will handle falling.
        }
    }
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private updateFreeCameraMovement(delta: number): void {
    const speed = 10.0;
    const cameraObject = this.controls.getObject(); // This is the camera's parent group from PointerLockControls

    const inputBasedDirection = new THREE.Vector3(
      Number(this.moveRight) - Number(this.moveLeft),
      0,
      Number(this.moveForward) - Number(this.moveBackward)
    );
    inputBasedDirection.normalize(); // Ensure consistent speed

    if (inputBasedDirection.lengthSq() > 0) { // Only move if there's input
        // Get camera's world direction (where it's looking)
        const cameraWorldDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraWorldDirection); // Use this.camera directly for view direction

        const forwardMove = cameraWorldDirection.clone().multiplyScalar(inputBasedDirection.z * speed * delta);
        
        // For right/left movement, get the right vector relative to camera's orientation
        const rightVector = new THREE.Vector3();
        rightVector.crossVectors(this.camera.up, cameraWorldDirection).normalize(); // Camera's local right, then normalize
        // Corrected: cross world up with camera forward to get a world-aligned right vector for XZ plane movement.
        // Or rather, for free camera, use its own local right.
        const cameraLocalRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);

        const rightMove = cameraLocalRight.multiplyScalar(inputBasedDirection.x * speed * delta);

        cameraObject.position.add(forwardMove);
        cameraObject.position.add(rightMove);
    }
    // Optional: Add vertical movement for free camera if desired (e.g. Q/E keys or Space/Shift)
    if (this.canJump) { // Using 'canJump' as a generic up signal for now
        cameraObject.position.y += speed * delta;
    }
    if (this.moveDown) { // Move down with Shift
        cameraObject.position.y -= speed * delta;
    }
  }

  private updateMovement(delta: number, entityId: string): void { // Now takes entityId
    const entityState = this.pcs.get(entityId);
    const entityObject = this.entityMeshes.find(e => e.name === entityId);

    if (!entityState || !entityObject) {
      console.warn(`Attempted to update movement for unknown entityId: ${entityId}`);
      return;
    }

    const originalPosition = entityState.position.clone(); 
    // Orientation of the entity will be controlled by mouse look when an entity is possessed
    // For now, we use the camera's orientation for movement direction
    // but apply mouse look directly to the entity's orientation (quaternion).

    // Apply mouse look to entity orientation
    const cameraObject = this.controls.getObject();
    const cameraEuler = new THREE.Euler().setFromQuaternion(cameraObject.quaternion, 'YXZ');
    entityState.yaw = cameraEuler.y;

    // Physics properties from entity state or config
    let entityIsOnGround = entityState.isGrounded;
    let entityVerticalVelocity = entityState.velocity.y;
    const gravity = 30.0;
    const jumpStrength = 10.0;

    const inputBasedDirection = new THREE.Vector3(
      Number(this.moveRight) - Number(this.moveLeft),
      0,
      Number(this.moveForward) - Number(this.moveBackward)
    );
    inputBasedDirection.normalize();

    // Update walking state
    if (inputBasedDirection.lengthSq() > 0.01 && entityIsOnGround) {
        entityState.isWalking = true;
    } else {
        entityState.isWalking = false;
    }

    // Movement direction based on entity's current orientation (controlled by mouse)
    const forwardMoveVector = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), entityState.yaw);
    forwardMoveVector.y = 0;
    forwardMoveVector.normalize();

    const rightMoveVector = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), entityState.yaw);
    rightMoveVector.y = 0;
    rightMoveVector.normalize();
    
    let intendedMove = new THREE.Vector3();
    if (inputBasedDirection.z !== 0) {
      intendedMove.add(forwardMoveVector.clone().multiplyScalar(inputBasedDirection.z * PC_SPEED * delta));
    }
    if (inputBasedDirection.x !== 0) {
      intendedMove.add(rightMoveVector.clone().multiplyScalar(inputBasedDirection.x * PC_SPEED * delta));
    }

    const playerAABB = new THREE.Box3();
    // For horizontal collision, AABB center Y should be entity's feet + half of its collision height
    const playerBodyCenterY = entityState.position.y + ENTITY_HEIGHT / 2;
    const horizontalCollisionEpsilon = 0.01;
    
    entityState.position.x += intendedMove.x;
    playerAABB.setFromCenterAndSize(
        new THREE.Vector3(entityState.position.x, playerBodyCenterY + horizontalCollisionEpsilon, originalPosition.z),
        new THREE.Vector3(ENTITY_RADIUS * 2, ENTITY_HEIGHT, ENTITY_RADIUS * 2) // Use ENTITY_HEIGHT for AABB height
    );
    for (const collidable of this.staticCollidables) {
      if (collidable.name !== entityId && collidable.userData.worldAABB.intersectsBox(playerAABB)) { // Don't collide with self
        entityState.position.x = originalPosition.x;
        break;
      }
    }

    entityState.position.z += intendedMove.z;
    playerAABB.setFromCenterAndSize(
        new THREE.Vector3(entityState.position.x, playerBodyCenterY + horizontalCollisionEpsilon, entityState.position.z),
        new THREE.Vector3(ENTITY_RADIUS * 2, ENTITY_HEIGHT, ENTITY_RADIUS * 2) // Use ENTITY_HEIGHT for AABB height
    );
    for (const collidable of this.staticCollidables) {
      if (collidable.name !== entityId && collidable.userData.worldAABB.intersectsBox(playerAABB)) { // Don't collide with self
        entityState.position.z = originalPosition.z;
        break;
      }
    }

    // Jump logic
    if (this.canJump && entityIsOnGround) {
        entityVerticalVelocity = jumpStrength;
        entityIsOnGround = false;
        this.canJump = false; // Consume jump input
    }

    // Vertical movement and ground/object collision
    let newEntityIsOnGround = false;
    let newEntityYPosition = entityState.position.y;
    let currentFrameVerticalVelocity = entityVerticalVelocity;

    let stoodOnStaticObject = false;
    if (entityIsOnGround || currentFrameVerticalVelocity <= 0) {
        const playerFeetAABBForGroundCheck = new THREE.Box3();
        // Center the ground check AABB slightly below the entity's current feet position
        const groundCheckAABBCenterY = entityState.position.y - 0.05; // For a box of height 0.1
        playerFeetAABBForGroundCheck.setFromCenterAndSize(
            new THREE.Vector3(entityState.position.x, groundCheckAABBCenterY, entityState.position.z),
            new THREE.Vector3(ENTITY_RADIUS * 2, 0.1, ENTITY_RADIUS * 2)
        );
        for (const collidable of this.staticCollidables) {
            if (collidable.name !== entityId && collidable.userData.worldAABB.intersectsBox(playerFeetAABBForGroundCheck)) {
                const entityCurrentFeetY = originalPosition.y; // originalPosition.y is already the feet Y
                const objectTopY = collidable.userData.worldAABB.max.y;
                if (entityCurrentFeetY >= objectTopY - 0.2 && (entityCurrentFeetY + (currentFrameVerticalVelocity * delta)) < objectTopY + 0.1 ) {
                    newEntityYPosition = objectTopY; // Land directly on the object's surface
                    newEntityIsOnGround = true;
                    currentFrameVerticalVelocity = 0;
                    stoodOnStaticObject = true;
                    break;
                }
            }
        }
    }

    let intendedVerticalDelta = 0;
    if (!stoodOnStaticObject) {
        if (!entityIsOnGround || currentFrameVerticalVelocity !== 0) {
            currentFrameVerticalVelocity -= gravity * delta;
        }
        intendedVerticalDelta = currentFrameVerticalVelocity * delta;
        newEntityYPosition = entityState.position.y + intendedVerticalDelta;

        const entityBaseYAtNewPos = newEntityYPosition; // newEntityYPosition is already the feet Y
        if (entityBaseYAtNewPos <= 0) {
            newEntityYPosition = 0; // Land directly on the terrain surface
            currentFrameVerticalVelocity = 0;
            newEntityIsOnGround = true;
        } else {
            newEntityIsOnGround = false;
        }
    } else {
        intendedVerticalDelta = newEntityYPosition - entityState.position.y;
    }
    
    // Ceiling Collision (Head)
    if (entityVerticalVelocity > 0 && intendedVerticalDelta > -0.001) {
        const playerHeadAABB = new THREE.Box3();
        // Head AABB min Y is newEntityYPosition (feet) + ENTITY_HEIGHT - some small value (or just use top of collision AABB)
        // For simplicity, let's check from feet up to feet + collision height
        playerHeadAABB.min.set(entityState.position.x - ENTITY_RADIUS, newEntityYPosition, entityState.position.z - ENTITY_RADIUS);
        playerHeadAABB.max.set(entityState.position.x + ENTITY_RADIUS, newEntityYPosition + ENTITY_HEIGHT, entityState.position.z + ENTITY_RADIUS);
        for (const collidable of this.staticCollidables) {
            if (collidable.name !== entityId && collidable.userData.worldAABB.intersectsBox(playerHeadAABB)) {
                 // Check if the collision is with a ceiling part
                 if (newEntityYPosition + ENTITY_HEIGHT > collidable.userData.worldAABB.min.y && // Entity top is below ceiling bottom
                     collidable.userData.worldAABB.min.y > originalPosition.y + ENTITY_HEIGHT * 0.5 ) { // Ceiling is above mid-point of entity
                    newEntityYPosition = collidable.userData.worldAABB.min.y - ENTITY_HEIGHT - 0.01; // Place feet so head is below ceiling
                    currentFrameVerticalVelocity = 0;
                    break;
                }
            }
        }
    }

    entityState.position.y = newEntityYPosition;
    entityState.velocity.y = currentFrameVerticalVelocity;
    entityState.isGrounded = newEntityIsOnGround;

    // Update the Three.js object
    entityObject.position.copy(entityState.position);
    entityObject.rotation.y = entityState.yaw; // This correctly updates the visual rotation based on yaw
    // AABB of entity needs to be updated if it moves or rotates significantly
    entityObject.userData.worldAABB.setFromObject(entityObject); 
  }

  private updateEntityAnimations(delta: number): void {
    [...this.pcs.entries(), ...this.npcs.entries()].forEach(([entityId, state]) => {
      const entityObject = this.entityMeshes.find(e => e.name === entityId);
      if (!entityObject) return;

      const leftLeg = entityObject.getObjectByName("leftLeg") as THREE.Mesh;
      const rightLeg = entityObject.getObjectByName("rightLeg") as THREE.Mesh;
      const leftArm = entityObject.getObjectByName("leftArm") as THREE.Mesh;
      const rightArm = entityObject.getObjectByName("rightArm") as THREE.Mesh;

      if (!leftLeg || !rightLeg || !leftArm || !rightArm) return;

      if (state.isWalking) {
        state.walkCycleTime += delta * 8; 
        const legWalkAmplitude = THREE.MathUtils.degToRad(30); 
        const armWalkAmplitude = THREE.MathUtils.degToRad(15); // Slightly more pronounced swing for clarity

        leftLeg.rotation.x = Math.sin(state.walkCycleTime) * legWalkAmplitude;
        rightLeg.rotation.x = Math.cos(state.walkCycleTime + Math.PI / 2) * legWalkAmplitude; 
        
        // Walking arm swing: subtract offset to bring arm more forward from its backward resting pitch
        leftArm.rotation.x = state.initialLeftArmRotation.x - Math.cos(state.walkCycleTime + Math.PI / 2) * armWalkAmplitude; 
        rightArm.rotation.x = state.initialRightArmRotation.x - Math.sin(state.walkCycleTime) * armWalkAmplitude; 

        // Lerp Z rotation of arms back to their initial Z rotation
        leftArm.rotation.z = THREE.MathUtils.lerp(leftArm.rotation.z, state.initialLeftArmRotation.z, delta * 10);
        rightArm.rotation.z = THREE.MathUtils.lerp(rightArm.rotation.z, state.initialRightArmRotation.z, delta * 10);

        state.idleCycleTime = 0; 

      } else {
        // Idle Animation
        state.idleCycleTime += delta * 2.0; 
        const idleArmAmplitudeZ = THREE.MathUtils.degToRad(4); 
        const idleArmAmplitudeX = THREE.MathUtils.degToRad(5); // Slightly more noticeable idle X movement

        // Lerp legs to neutral quickly
        leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, 0, delta * 10);
        rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, 0, delta * 10);

        // Apply idle animation additively to initial arm rotations
        // Subtle sway on Z axis
        leftArm.rotation.z = state.initialLeftArmRotation.z + Math.sin(state.idleCycleTime) * idleArmAmplitudeZ;
        rightArm.rotation.z = state.initialRightArmRotation.z - Math.sin(state.idleCycleTime) * idleArmAmplitudeZ; 
        
        // Subtle movement on X axis: subtract offset to bring arm more forward
        leftArm.rotation.x = state.initialLeftArmRotation.x - Math.sin(state.idleCycleTime * 0.5 + Math.PI / 4) * idleArmAmplitudeX;
        rightArm.rotation.x = state.initialRightArmRotation.x - Math.cos(state.idleCycleTime * 0.5) * idleArmAmplitudeX; 

        state.walkCycleTime = 0; 
      }
    });
  }

  private updateNonControlledEntityPhysics(entityId: string, delta: number): void {
    const entityState = this.pcs.get(entityId) || this.npcs.get(entityId);
    const entityObject = this.entityMeshes.find(e => e.name === entityId);

    if (!entityState || !entityObject) {
      // console.warn(`Attempted to update physics for unknown non-controlled entityId: ${entityId}`);
      return;
    }

    // Only apply gravity and ground collision if the entity is not currently controlled
    // and not actively participating in combat (as combat logic might dictate position/state)
    if (this.controlledTargetId === entityId || this.combatants.has(entityId)) {
        return;
    }

    let entityIsOnGround = entityState.isGrounded;
    let entityVerticalVelocity = entityState.velocity.y;
    const gravity = 30.0;

    // Apply gravity if not on ground or if vertical velocity is present
    if (!entityIsOnGround || entityVerticalVelocity !== 0) {
        entityVerticalVelocity -= gravity * delta;
    }

    let newEntityYPosition = entityState.position.y + entityVerticalVelocity * delta;
    let newEntityIsOnGround = false;

    // Ground Collision Check (Simplified from updateMovement)
    const playerFeetAABBForGroundCheck = new THREE.Box3();
    const groundCheckAABBCenterY = newEntityYPosition - 0.05; // Check slightly below new potential feet position
    playerFeetAABBForGroundCheck.setFromCenterAndSize(
        new THREE.Vector3(entityState.position.x, groundCheckAABBCenterY, entityState.position.z),
        new THREE.Vector3(ENTITY_RADIUS * 2, 0.1, ENTITY_RADIUS * 2)
    );

    let stoodOnStaticObject = false;
    for (const collidable of this.staticCollidables) {
        if (collidable.name !== entityId && collidable.userData.worldAABB && collidable.userData.worldAABB.intersectsBox(playerFeetAABBForGroundCheck)) {
            const objectTopY = collidable.userData.worldAABB.max.y;
            // Check if the entity is landing on top of this collidable
            if (entityState.position.y >= objectTopY - 0.1 && newEntityYPosition <= objectTopY + 0.05) { // Looser check for landing
                newEntityYPosition = objectTopY;
                newEntityIsOnGround = true;
                entityVerticalVelocity = 0;
                stoodOnStaticObject = true;
                break;
            }
        }
    }
    
    // Terrain collision (if not stood on an object)
    if (!stoodOnStaticObject && newEntityYPosition <= 0) {
        newEntityYPosition = 0;
        newEntityIsOnGround = true;
        entityVerticalVelocity = 0;
    }


    // Ceiling Collision (Simplified - prevent going through ceiling if falling upwards somehow or pushed)
    // This is a basic check; more robust ceiling logic might be needed if entities can be launched upwards.
    if (entityVerticalVelocity > 0) {
        const playerHeadAABB = new THREE.Box3();
        playerHeadAABB.min.set(entityState.position.x - ENTITY_RADIUS, newEntityYPosition, entityState.position.z - ENTITY_RADIUS);
        playerHeadAABB.max.set(entityState.position.x + ENTITY_RADIUS, newEntityYPosition + ENTITY_HEIGHT, entityState.position.z + ENTITY_RADIUS);
        for (const collidable of this.staticCollidables) {
            if (collidable.name !== entityId && collidable.userData.worldAABB && collidable.userData.worldAABB.intersectsBox(playerHeadAABB)) {
                 if (newEntityYPosition + ENTITY_HEIGHT > collidable.userData.worldAABB.min.y &&
                     collidable.userData.worldAABB.min.y > entityState.position.y + ENTITY_HEIGHT * 0.5 ) {
                    newEntityYPosition = collidable.userData.worldAABB.min.y - ENTITY_HEIGHT - 0.01;
                    entityVerticalVelocity = 0; // Stop upward movement
                    break;
                }
            }
        }
    }


    entityState.position.y = newEntityYPosition;
    entityState.velocity.y = entityVerticalVelocity;
    entityState.isGrounded = newEntityIsOnGround;

    // Update the Three.js object's position
    entityObject.position.y = entityState.position.y;
    // AABB update might be needed if other systems rely on it for these non-controlled entities.
    // For now, just position sync. If complex interactions are needed, ensure AABB is also updated.
    // entityObject.userData.worldAABB.setFromObject(entityObject);
  }

  private checkCombatEngagement(): void {
    if (this.isInCombat) return; // Don't check if already in combat

    let engagedPC: EntityState | null = null;
    let engagedNPC: EntityState | null = null;

    for (const pcState of this.pcs.values()) {
        if (!pcState) continue;

        for (const npcState of this.npcs.values()) {
            if (!npcState) continue;

            const distance = pcState.position.distanceTo(npcState.position);
            if (distance < COMBAT_DISTANCE) {
                engagedPC = pcState;
                engagedNPC = npcState;
                break;
            }
        }
        if (engagedPC) break;
    }

    if (engagedPC && engagedNPC) {
        this.isInCombat = true;
        this.combatants.clear();

        // Reset movement flags for player input, as combat starts
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;

        // 1. Add all PCs to combat and ensure their walking animation is reset
        this.pcs.forEach((pcState, pcId) => {
            if (pcId) {
                this.combatants.add(pcId);
                if (pcState) {
                    pcState.isWalking = false; // Stop walking animation
                }
            }
        });

        // 2. Add the initially engaged NPC to combat
        this.combatants.add(engagedNPC.id); 

        // 3. Add any other NPC that is within COMBAT_DISTANCE of the initially engaged NPC
        const engagedNPCState = this.npcs.get(engagedNPC.id);
        if (engagedNPCState) {
            const allOtherNPCs = this.entityMeshes.filter(entity => {
                const isNPC = !!this.npcs.get(entity.name);
                return isNPC && entity.name !== engagedNPC!.id; // Ensure it's an NPC and not the already added one
            });

            allOtherNPCs.forEach(otherNPC => {
                const otherNPCState = this.npcs.get(otherNPC.name);
                if (otherNPCState) {
                    const distanceToEngagedNPC = otherNPCState.position.distanceTo(engagedNPCState.position);
                    if (distanceToEngagedNPC < COMBAT_DISTANCE) {
                        this.combatants.add(otherNPC.name);
                    }
                }
            });
        }
        
        startCombat(Array.from(this.combatants), this.pcs, this.npcs);
    }
  }

  private updateCompanionPCMovement(delta: number): void {
    if (this.controlledTargetId === 'camera' || !this.pcs.has(this.controlledTargetId)) {
        // No controlled PC or controlled PC state not found
        return;
    }

    const controlledPCState = this.pcs.get(this.controlledTargetId);
    if (!controlledPCState) return; // Should be caught by the has() check but good for safety

    const controlledPCObject = this.entityMeshes.find(e => e.name === this.controlledTargetId);
    if (!controlledPCObject) return;

    this.pcs.forEach(pcConfig => {
        if (!pcConfig.id || pcConfig.id === this.controlledTargetId) {
            // Skip if no ID, or if it's the currently controlled PC
            return;
        }

        if (this.combatants.has(pcConfig.id)) {
            // Skip PCs currently in combat
            return;
        }

        const companionState = this.pcs.get(pcConfig.id);
        const companionObject = this.entityMeshes.find(e => e.name === pcConfig.id);

        if (!companionState || !companionObject) {
            return; // Companion state or object not found
        }

        const distanceToLeader = companionState.position.distanceTo(controlledPCState.position);

        // Hysteresis logic for following
        if (companionState.isWalking) {
            // If already walking, check if we should stop
            if (distanceToLeader < COMPANION_STOP_FOLLOW_DISTANCE) {
                companionState.isWalking = false;
            } else {
                // Still walking: continue moving towards the leader
                const directionToLeader = new THREE.Vector3()
                    .subVectors(controlledPCState.position, companionState.position)
                    .normalize();

                const targetYaw = Math.atan2(directionToLeader.x, directionToLeader.z) + Math.PI;
                companionState.yaw = targetYaw;
                companionObject.rotation.y = targetYaw;

                const moveStep = directionToLeader.multiplyScalar(COMPANION_FOLLOW_SPEED * delta);
                companionState.position.add(moveStep);
                companionObject.position.copy(companionState.position);
            }
        } else {
            // If not walking, check if we should start
            if (distanceToLeader > COMPANION_FOLLOW_DISTANCE) {
                companionState.isWalking = true;
                // Start moving (same logic as above, could be refactored into a function if preferred)
                const directionToLeader = new THREE.Vector3()
                    .subVectors(controlledPCState.position, companionState.position)
                    .normalize();

                const targetYaw = Math.atan2(directionToLeader.x, directionToLeader.z) + Math.PI;
                companionState.yaw = targetYaw;
                companionObject.rotation.y = targetYaw;

                const moveStep = directionToLeader.multiplyScalar(COMPANION_FOLLOW_SPEED * delta);
                companionState.position.add(moveStep);
                companionObject.position.copy(companionState.position);
            }
        }
    });
  }

  private spawnBullet(attackerId: string, targetId: string): void {
    const attackerObject = this.entityMeshes.find(e => e.name === attackerId);
    const targetObject = this.entityMeshes.find(e => e.name === targetId);
    const attackerState = this.pcs.get(attackerId) || this.npcs.get(attackerId);

    if (!attackerObject || !targetObject || !attackerState) {
        console.warn("Could not spawn bullet: attacker or target not found.");
        return;
    }

    const bulletRadius = 0.05;
    const bulletLength = 0.3;
    const bulletGeometry = new THREE.CapsuleGeometry(bulletRadius, bulletLength, 4, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 }); // Bright yellow
    const bulletMesh = new THREE.Mesh(bulletGeometry, bulletMaterial);

    // Initial position: slightly in front of the attacker's center, raised
    const startPosition = attackerObject.position.clone().add(new THREE.Vector3(0, ENTITY_HEIGHT * 0.75, 0));
    
    // Orient bullet based on attacker's yaw (direction they are facing)
    const forwardVector = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), attackerState.yaw);
    startPosition.add(forwardVector.multiplyScalar(ENTITY_RADIUS + bulletLength)); // Start just outside attacker

    bulletMesh.position.copy(startPosition);

    // Target position: center of the target entity
    const targetPosition = targetObject.position.clone().add(new THREE.Vector3(0, ENTITY_HEIGHT / 2, 0));

    const direction = new THREE.Vector3().subVectors(targetPosition, startPosition).normalize();
    const bulletSpeed = 50.0; // Adjust as needed

    // Align capsule to direction
    const DUMMY_ORIGIN_FOR_LOOKAT = new THREE.Vector3(0,0,0);
    bulletMesh.up.set(0,1,0); // ensure consistent up vector before lookAt
    bulletMesh.lookAt(DUMMY_ORIGIN_FOR_LOOKAT.copy(startPosition).add(direction)); // lookAt target relative to current bullet position
    bulletMesh.rotateX(Math.PI / 2); // Capsules are typically Y-up, rotate to align with Z-forward

    this.scene.add(bulletMesh);
    this.activeBullets.push({
        mesh: bulletMesh,
        targetPosition: targetPosition.clone(),
        velocity: direction.multiplyScalar(bulletSpeed),
        lifeTime: 2.0 // Max lifetime in seconds
    });
  }

  private updateBullets(delta: number): void {
    for (let i = this.activeBullets.length - 1; i >= 0; i--) {
        const bullet = this.activeBullets[i];
        bullet.mesh.position.add(bullet.velocity.clone().multiplyScalar(delta));
        bullet.lifeTime -= delta;

        // Check for proximity to target or lifetime expiry
        const distanceToTarget = bullet.mesh.position.distanceTo(bullet.targetPosition);
        if (distanceToTarget < 0.5 || bullet.lifeTime <= 0) { // 0.5 is arbitrary hit radius
            this.scene.remove(bullet.mesh);
            bullet.mesh.geometry.dispose();
            (bullet.mesh.material as THREE.Material).dispose();
            this.activeBullets.splice(i, 1);
        }
    }
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    const time = performance.now();
    const delta = (time - this.prevTime) / 1000;

    if (this.controls.isLocked) {
      if (this.controlledTargetId === 'camera') {
        this.updateFreeCameraMovement(delta);
      } else if (this.pcs.has(this.controlledTargetId)) {
        this.updateMovement(delta, this.controlledTargetId);
        
        const targetState = this.pcs.get(this.controlledTargetId);
        
        if (targetState) {
            // Camera Position Update (follows the entity)
            const cameraYOffset = 2.2; 
            const cameraZOffset = 2.4;   
            const cameraXOffset = 0.3;
            const cameraPositionOffset = new THREE.Vector3(cameraXOffset, cameraYOffset, cameraZOffset);
            const worldOffset = cameraPositionOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), targetState.yaw);
            const cameraTargetPosition = targetState.position.clone().add(worldOffset);
            this.controls.getObject().position.lerp(cameraTargetPosition, 0.2); 
        }
      }
      this.updateChunks();
      this.updateEntityAnimations(delta); // Call entity animation update
      this.checkCombatEngagement(); // Check for combat engagement
      this.updateCompanionPCMovement(delta); // Call new method for companion PC movement
      this.updateBullets(delta); // Update bullet animations

      // Update physics for non-controlled, non-combat entities
      this.entityMeshes.forEach(entity => {
        if (entity.name && entity.name !== this.controlledTargetId && !this.combatants.has(entity.name)) {
          this.updateNonControlledEntityPhysics(entity.name, delta);
        }
      });

      if (this.isInCombat) {
        const combatResult = updateCombatLogic(
          delta, 
          this.combatants, 
          this.entityMeshes, 
          this.pcs, 
          this.npcs
        );

        this.combatants = combatResult.updatedCombatants;
        if (combatResult.shotEvents && combatResult.shotEvents.length > 0) {
            combatResult.shotEvents.forEach(shot => {
                this.spawnBullet(shot.attackerId, shot.targetId);
            });
        }
        
        if (combatResult.combatShouldEnd) {
            this.isInCombat = false;
            endCombat();
            // Potentially reset combatant states here if needed, e.g., isWalking = false for all former combatants
            this.combatants.forEach(id => {
                const entityState = this.pcs.get(id) || this.npcs.get(id);
                if (entityState) {
                    entityState.isWalking = false; // Ensure walking animation stops
                }
            });
            this.combatants.clear();
        }

        // Handle defeated NPCs from this turn/combat end
        if (combatResult.defeatedNpcIds && combatResult.defeatedNpcIds.length > 0) {
            combatResult.defeatedNpcIds.forEach(npcId => {
                const npcToRemove = this.entityMeshes.find(e => e.name === npcId);
                if (npcToRemove) {
                    if (this.highlightedTargetObject === npcToRemove) {
                        this.clearTargetHighlight(); // Clear highlight if target is removed
                    }
                    this.scene.remove(npcToRemove);
                    // Remove from entityMeshes array
                    this.entityMeshes = this.entityMeshes.filter(e => e.name !== npcId);
                    // Remove from entityStates map
                    this.npcs.delete(npcId);
                    // Remove from staticCollidables array
                    this.staticCollidables = this.staticCollidables.filter(c => c.name !== npcId);
                    // Remove from combatants set if present (should be already handled by combat logic, but good for safety)
                    this.combatants.delete(npcId);
                    // Update worldConfig.json representation if necessary (outside scope of this change)
                    console.log(`NPC ${npcId} removed from the game.`);
                }
            });
            // After removing NPCs, update the turn order in combat.ts if combat is ongoing
            // This is a bit tricky as turnOrder is internal to combat.ts
            // A cleaner way might be for combat.ts to manage its turnOrder internally when entities are removed.
            // For now, if combat didn't end, we might need to re-evaluate or restart combat if a combatant was removed.
            // However, startCombat is already robust to the list of combatants provided.
            // If combat is still ongoing, and a combatant was removed, the current turn logic in combat.ts
            // already skips dead entities, so it should self-correct.
        }
      }
    }
    this.prevTime = time;
    this.renderer.render(this.scene, this.camera);
  }

  private onDocumentMouseDown(event: MouseEvent): void {
    console.log("onDocumentMouseDown triggered"); // Log 1: Event fired

    if (!this.controls.isLocked || this.controlledTargetId === 'camera') {
        console.log(`Targeting check skipped: isLocked: ${this.controls.isLocked}, controlledTargetId: ${this.controlledTargetId}`); // Log 2
        return; // Only allow targeting if a PC is controlled and pointer is locked
    }
    console.log(`Targeting check active: isLocked: ${this.controls.isLocked}, controlledTargetId: ${this.controlledTargetId}`); // Log 2a

    this.mouse.x = 0; // Center of the screen
    this.mouse.y = 0; // Center of the screen
    this.raycaster.setFromCamera(this.mouse, this.camera); 

    const intersects = this.raycaster.intersectObjects(this.entityMeshes, true); 
    console.log(`Raycaster intersections: ${intersects.length}`); // Log 3

    const controlledPCState = this.pcs.get(this.controlledTargetId);
    if (!controlledPCState) {
        console.warn("Controlled PC state not found during targeting attempt.");
        return;
    }

    if (intersects.length > 0) {
        console.log("Intersected objects:", intersects.map(i => ({ name: i.object.name, parentName: i.object.parent?.name, distance: i.distance }))); // Log 4
        let clickedEntity: THREE.Object3D | null = null;
        // Find the root humanoid object from the intersection
        for (const intersect of intersects) {
            let currentObject = intersect.object;
            let potentialEntityRoot = null;

            // Traverse up to find the Object3D that is directly in this.entityMeshes
            while (currentObject) {
                if (this.entityMeshes.includes(currentObject)) {
                    potentialEntityRoot = currentObject;
                    break; // Found the root humanoid entity
                }
                if (!currentObject.parent || currentObject.parent === this.scene) {
                    break; // Reached the scene or no parent, stop traversal
                }
                currentObject = currentObject.parent;
            }
            
            if (potentialEntityRoot) {
                clickedEntity = potentialEntityRoot;
                break; // Found a valid entity, no need to check other intersections
            }
        }

        if (clickedEntity && clickedEntity.name) {
            const targetId = clickedEntity.name;
            console.log(`Clicked entity identified: ${targetId}`); // Log 5a
            const targetIsNPC = this.npcs.has(targetId);
            console.log(`Target is NPC: ${targetIsNPC}`); // Log 5b

            if (targetIsNPC && targetId !== this.controlledTargetId) {
                controlledPCState.currentTargetId = targetId;
                console.log(`${this.controlledTargetId} is now targeting ${targetId}`);
                const targetObject = this.entityMeshes.find(e => e.name === targetId);
                if (targetObject) {
                    this.setTargetHighlight(targetObject);
                }
            } else if (targetId === this.controlledTargetId) {
                controlledPCState.currentTargetId = null;
                this.clearTargetHighlight();
                console.log(`${this.controlledTargetId} cleared target (clicked self).`);
            } else {
                 controlledPCState.currentTargetId = null;
                 this.clearTargetHighlight();
                 console.log(`${this.controlledTargetId} cleared target (clicked non-NPC or invalid).`);
            }
        } else {
            controlledPCState.currentTargetId = null;
            this.clearTargetHighlight();
            console.log(`${this.controlledTargetId} cleared target (clicked entity with no name or no entity found after traversal).`);
        }
    } else {
        controlledPCState.currentTargetId = null;
        this.clearTargetHighlight();
        console.log(`${this.controlledTargetId} cleared target (clicked empty space - no intersections).`);
    }
  }

  private createCrosshairUI(): void {
    this.crosshairElement = document.createElement('div');
    this.crosshairElement.style.position = 'fixed';
    this.crosshairElement.style.left = '50%';
    this.crosshairElement.style.top = '50%';
    this.crosshairElement.style.transform = 'translate(-50%, -50%)';
    this.crosshairElement.style.width = '20px';
    this.crosshairElement.style.height = '20px';
    this.crosshairElement.style.border = '2px solid white';
    this.crosshairElement.style.borderRadius = '50%'; // Circular crosshair
    this.crosshairElement.style.pointerEvents = 'none'; // Allow clicks to pass through
    this.crosshairElement.style.display = 'none'; // Initially hidden
    this.crosshairElement.style.zIndex = '1000'; // Ensure it's on top
    document.body.appendChild(this.crosshairElement);

    this.controls.addEventListener('lock', () => {
        if (this.crosshairElement) this.crosshairElement.style.display = 'block';
    });

    this.controls.addEventListener('unlock', () => {
        if (this.crosshairElement) this.crosshairElement.style.display = 'none';
    });
  }

  private setTargetHighlight(targetObject: THREE.Object3D): void {
    if (this.highlightedTargetObject === targetObject) return; // Already highlighted

    this.clearTargetHighlight(); // Clear previous highlight first

    this.highlightedTargetObject = targetObject;
    this.originalTargetMaterials.clear();

    targetObject.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
            // Store original material(s)
            this.originalTargetMaterials.set(child.uuid, child.material);

            const highlightMaterial = (Array.isArray(child.material) ? child.material[0] : child.material).clone();
            (highlightMaterial as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffcc00); // Yellowish highlight
            (highlightMaterial as THREE.MeshStandardMaterial).emissiveIntensity = 0.7;
            child.material = highlightMaterial;
        }
    });
  }

  private clearTargetHighlight(): void {
    if (this.highlightedTargetObject) {
        this.highlightedTargetObject.traverse((child) => {
            if (child instanceof THREE.Mesh && this.originalTargetMaterials.has(child.uuid)) {
                child.material = this.originalTargetMaterials.get(child.uuid)!;
            }
        });
        this.originalTargetMaterials.clear();
        this.highlightedTargetObject = null;
    }
  }
}

new Game(); 