import * as THREE from 'three';
import { 
    HumanoidConfig, 
    defaultHumanoidConfig, 
    GeometryAttachment, 
    HeadDefinition,
    TorsoDefinition,
    ArmDefinition,
    LegDefinition,
    WeaponDefinition,
    defaultHeadDefinition,
    defaultWeaponDefinition,
    defaultLegDefinition,
    defaultArmDefinition,
    defaultTorsoDefinition,
    defaultAttackDefinition,
    Attack
} from './types';
import worldConfigJson from './worldConfig.json';

export const ENTITY_HEIGHT = 1.8;
export const ENTITY_RADIUS = 0.3;

const textureLoader = new THREE.TextureLoader();
const materialCache: Map<string, THREE.MeshStandardMaterial> = new Map();
const TEXTURE_BASE_PATH = 'textures/'; // Assuming textures are in /src/textures/ or /public/textures/
                                     // Vite usually serves from public/ directly or handles src/ assets.
                                     // For /src/textures/, Vite needs to process them.
                                     // If you put them in a `public/textures` folder, paths would be `textures/file.jpg`

// Helper to create and attach a single piece of geometry
function createAndAttachGeometry(
    parentMesh: THREE.Object3D,
    attachment: GeometryAttachment,
    defaultMaterial: THREE.MeshStandardMaterial
): void {
    let geometry: THREE.BufferGeometry;
    const dims = attachment.dimensions;

    switch (attachment.type) {
        case 'box':
            geometry = new THREE.BoxGeometry(dims.x, dims.y, dims.z);
            break;
        case 'sphere':
            geometry = new THREE.SphereGeometry(dims.x, 16, 12); // dims.x as radius
            break;
        case 'cylinder':
            geometry = new THREE.CylinderGeometry(dims.x, dims.x, dims.y, 16); // dims.x radius, dims.y height
            break;
        case 'capsule':
            // Ensure radius (dims.x) is not greater than half the height (dims.y / 2) for a valid capsule
            const capsuleRadius = Math.min(dims.x, dims.y / 2 - 0.001); 
            const capsuleLength = Math.max(0.001, dims.y - 2 * capsuleRadius);
            geometry = new THREE.CapsuleGeometry(capsuleRadius, capsuleLength, 4, 8);
            break;
        default:
            console.warn(`Unknown geometry attachment type: ${attachment.type}`);
            return;
    }

    let attachmentMaterial = defaultMaterial;
    if (attachment.texture) {
        const texturePath = `${TEXTURE_BASE_PATH}${attachment.texture}`;
        if (materialCache.has(texturePath)) {
            attachmentMaterial = materialCache.get(texturePath)!;
        } else {
            try {
                const texture = textureLoader.load(texturePath);
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                attachmentMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    roughness: 0.8,
                    metalness: 0.1
                });
                materialCache.set(texturePath, attachmentMaterial);
            } catch (error) {
                console.error(`Failed to load attachment texture: ${texturePath}`, error);
                // Material remains defaultMaterial
            }
        }
    }

    const mesh = new THREE.Mesh(geometry, attachmentMaterial);
    mesh.position.set(attachment.position.x, attachment.position.y, attachment.position.z);

    if (attachment.rotation) {
        mesh.rotation.set(
            THREE.MathUtils.degToRad(attachment.rotation.x || 0),
            THREE.MathUtils.degToRad(attachment.rotation.y || 0),
            THREE.MathUtils.degToRad(attachment.rotation.z || 0)
        );
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parentMesh.add(mesh);
}

// Helper to create a detailed humanoid representation
function createHumanoidMesh(
    config: HumanoidConfig, 
    headDefs: HeadDefinition[],
    torsoDefs: TorsoDefinition[],
    armDefs: ArmDefinition[],
    legDefs: LegDefinition[],
    weaponDefs: WeaponDefinition[]
): THREE.Group {
    const { 
        position, texture,
        headDefinitionId, torsoDefinitionId,
        armDefinitionId, legDefinitionId,
        weaponDefinitionId
    } = config;

    let humanoidMaterial = new THREE.MeshStandardMaterial({
        color: 0xff0000, // Red color for entities for now
        roughness: 0.7,
        metalness: 0.1,
    });
    if (texture) {
        const texturePath = `${TEXTURE_BASE_PATH}${texture}`;
        if (materialCache.has(texturePath)) {
            humanoidMaterial = materialCache.get(texturePath)!;
        } else {
            try {
                const tex = textureLoader.load(texturePath);
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                humanoidMaterial = new THREE.MeshStandardMaterial({
                    map: tex,
                    roughness: 0.8,
                    metalness: 0.1 
                });
                materialCache.set(texturePath, humanoidMaterial);
                console.log(`Loaded and cached texture: ${texturePath}`);
            } catch (error) {
                console.error(`Failed to load texture: ${texturePath}`, error);
            }
        }
    }

    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    group.name = config.id;

    const headRadius = ENTITY_RADIUS * 0.8;
    const torsoHeight = ENTITY_HEIGHT * 0.45;
    const torsoWidth = ENTITY_RADIUS * 1.8;
    const torsoDepth = ENTITY_RADIUS * 1.2;
    const limbRadius = ENTITY_RADIUS * 0.35;
    const legHeight = ENTITY_HEIGHT * 0.45;
    const armLength = ENTITY_HEIGHT * 0.40;

    const torsoGeo = new THREE.BoxGeometry(torsoWidth, torsoHeight, torsoDepth);
    const torso = new THREE.Mesh(torsoGeo, humanoidMaterial);
    torso.position.y = legHeight + torsoHeight / 2;
    torso.castShadow = true;
    torso.receiveShadow = true;
    torso.name = "torso"; // Added name for attachment reference
    group.add(torso);

    const headGeo = new THREE.SphereGeometry(headRadius, 16, 12);
    const head = new THREE.Mesh(headGeo, humanoidMaterial);
    head.position.y = legHeight + torsoHeight + headRadius * 0.9;
    head.castShadow = true;
    head.receiveShadow = true;
    head.name = "head"; // Added name
    group.add(head);

    const legGeo = new THREE.CapsuleGeometry(limbRadius, legHeight - 2 * limbRadius, 6, 10);
    const leftLeg = new THREE.Mesh(legGeo, humanoidMaterial);
    leftLeg.position.set(-torsoWidth / 3, legHeight / 2, 0);
    leftLeg.castShadow = true;
    leftLeg.receiveShadow = true;
    leftLeg.name = "leftLeg";
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, humanoidMaterial);
    rightLeg.position.set(torsoWidth / 3, legHeight / 2, 0);
    rightLeg.castShadow = true;
    rightLeg.receiveShadow = true;
    rightLeg.name = "rightLeg";
    group.add(rightLeg);

    const armCapsuleLength = armLength - 2 * (limbRadius * 0.9);
    const armGeo = new THREE.CapsuleGeometry(limbRadius * 0.9, armCapsuleLength, 6, 10);
    const shoulderY = legHeight + torsoHeight * 0.85;
    const shoulderXOffset = torsoWidth / 2 + 0.1;

    const leftArm = new THREE.Mesh(armGeo, humanoidMaterial);
    leftArm.position.set(-shoulderXOffset, shoulderY - armCapsuleLength / 2, 0);
    leftArm.rotation.x = THREE.MathUtils.degToRad(200);
    leftArm.rotation.z = THREE.MathUtils.degToRad(15);
    leftArm.castShadow = true;
    leftArm.receiveShadow = true;
    leftArm.name = "leftArm";
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, humanoidMaterial);
    rightArm.position.set(shoulderXOffset, shoulderY - armCapsuleLength / 2, 0);
    rightArm.rotation.x = THREE.MathUtils.degToRad(200);
    rightArm.rotation.z = THREE.MathUtils.degToRad(-15);
    rightArm.castShadow = true;
    rightArm.receiveShadow = true;
    rightArm.name = "rightArm";
    group.add(rightArm);

    const weaponLength = .3
    const weaponGeo = new THREE.CapsuleGeometry(.05, .3, 6, 10);
    const weapon = new THREE.Mesh(weaponGeo, humanoidMaterial);
    weapon.rotation.x = THREE.MathUtils.degToRad(90);
    weapon.position.set(0, armCapsuleLength / 2 + .1, weaponLength / 2 + limbRadius);
    weapon.rotation.x = THREE.MathUtils.degToRad(70);
    weapon.castShadow = true;
    weapon.receiveShadow = true;
    weapon.name = "weapon";
    rightArm.add(weapon);

    // Process attachments using Definition IDs
    const headDefinition = headDefinitionId ? headDefs.find(def => def.id === headDefinitionId) : undefined;
    if (headDefinition) {
        headDefinition.geometry.forEach(att => createAndAttachGeometry(head, att, humanoidMaterial));
    }

    const torsoDefinition = torsoDefinitionId ? torsoDefs.find(def => def.id === torsoDefinitionId) : undefined;
    if (torsoDefinition) {
        torsoDefinition.geometry.forEach(att => createAndAttachGeometry(torso, att, humanoidMaterial));
    }

    const armDefinition = armDefinitionId ? armDefs.find(def => def.id === armDefinitionId) : undefined;
    if (armDefinition) {
        armDefinition.geometry.forEach(origAtt => {
            createAndAttachGeometry(leftArm, origAtt, humanoidMaterial);
            const mirroredAtt: GeometryAttachment = JSON.parse(JSON.stringify(origAtt));
            mirroredAtt.position.x *= -1;
            if (mirroredAtt.rotation) {
                mirroredAtt.rotation.y *= -1;
                mirroredAtt.rotation.z *= -1;
            } else {
                mirroredAtt.rotation = { x: 0, y: 0, z: 0 };
            }
            createAndAttachGeometry(rightArm, mirroredAtt, humanoidMaterial);
        });
    }

    const legDefinition = legDefinitionId ? legDefs.find(def => def.id === legDefinitionId) : undefined;
    if (legDefinition) {
        legDefinition.geometry.forEach(origAtt => {
            createAndAttachGeometry(leftLeg, origAtt, humanoidMaterial);
            const mirroredAtt: GeometryAttachment = JSON.parse(JSON.stringify(origAtt));
            mirroredAtt.position.x *= -1;
            if (mirroredAtt.rotation) {
                mirroredAtt.rotation.y *= -1;
                mirroredAtt.rotation.z *= -1;
            } else {
                mirroredAtt.rotation = { x: 0, y: 0, z: 0 };
            }
            createAndAttachGeometry(rightLeg, mirroredAtt, humanoidMaterial);
        });
    }

    // Process Gun Attachment
    const weaponDefinitionToUse = weaponDefinitionId ? weaponDefs.find(def => def.id === weaponDefinitionId) : undefined;
    if (weaponDefinitionToUse) {
        weaponDefinitionToUse.geometry.forEach(weaponAtt => {
            createAndAttachGeometry(weapon, weaponAtt, humanoidMaterial); 
        });
    }
    
    return group;
}

export function buildDefConfigs(
    headDefs: any[],
    torsoDefs: any[],
    armDefs: any[],
    legDefs: any[],
    weaponDefs: any[]
): {
    headDefs: HeadDefinition[];
    torsoDefs: TorsoDefinition[];
    armDefs: ArmDefinition[];
    legDefs: LegDefinition[];
    weaponDefs: WeaponDefinition[];
} {
    return { 
        headDefs: headDefs.map(def => ({...defaultHeadDefinition, ...def})),
        torsoDefs: torsoDefs.map(def => ({...defaultTorsoDefinition, ...def})), 
        armDefs: armDefs.map(def => ({...defaultArmDefinition, ...def})), 
        legDefs: legDefs.map(def => ({...defaultLegDefinition, ...def})), 
        weaponDefs: weaponDefs.map(def => {
            const weaponDef = {...defaultWeaponDefinition, ...def};
            if (def.attacks) {
                weaponDef.attacks = def.attacks.map((attack: Attack) => ({...defaultAttackDefinition, ...attack}));
            }
            return weaponDef;
        }) 
    };
}

export function setupHumanoidEntities(
    scene: THREE.Scene
): THREE.Object3D[] { 
    const worldConf = worldConfigJson;
    const allEntities: THREE.Object3D[] = [];

    const { headDefs, torsoDefs, armDefs, legDefs, weaponDefs } = buildDefConfigs(
        worldConf.headDefinitions || [],
        worldConf.torsoDefinitions || [],
        worldConf.armDefinitions || [],
        worldConf.legDefinitions || [],
        worldConf.weaponDefinitions || []
    );

    // Process player-controllable entities (PCs)
    if (worldConf.pcs) {
        worldConf.pcs.forEach(entityConfig => {
            const completeConfig = { ...defaultHumanoidConfig, ...entityConfig };
            const entityMesh = createHumanoidMesh(
                completeConfig,
                headDefs, torsoDefs, armDefs, legDefs, weaponDefs
            );
            scene.add(entityMesh);
            allEntities.push(entityMesh);
            // Initialize AABB for the entity
            const worldAABB = new THREE.Box3().setFromObject(entityMesh);
            entityMesh.userData.worldAABB = worldAABB;
        });
    }

    // Process non-player-controllable entities (NPCs)
    if (worldConf.npcs) {
        worldConf.npcs.forEach(entityConfig => {
            const completeConfig = { ...defaultHumanoidConfig, ...entityConfig };
            const entityMesh = createHumanoidMesh(
                completeConfig,
                headDefs, torsoDefs, armDefs, legDefs, weaponDefs
            );
            scene.add(entityMesh);
            allEntities.push(entityMesh);
            // Initialize AABB for the entity
            const worldAABB = new THREE.Box3().setFromObject(entityMesh);
            entityMesh.userData.worldAABB = worldAABB;
        });
    }

    console.log(`setupHumanoidEntities: Created ${allEntities.length} total humanoid entities.`);
    return allEntities;
} 