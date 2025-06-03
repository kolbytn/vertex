import * as THREE from 'three';
import { 
    RoomConfig, 
    defaultRoomConfig, 
    defaultDoorConfig, 
    BoxConfig, 
    defaultBoxConfig
} from './types';
import worldConfigJson from './worldConfig.json';

const textureLoader = new THREE.TextureLoader();
const materialCache: Map<string, THREE.MeshStandardMaterial> = new Map();
const TEXTURE_BASE_PATH = 'textures/';
const TEXTURE_UNIT_SIZE = 3.0; // World units covered by one texture repeat

function getBaseMaterial(textureFile: string | undefined): THREE.MeshStandardMaterial {
    const cacheKey = textureFile || 'default_color_material_#royalblue'; // Ensure a unique key for default
    if (materialCache.has(cacheKey)) {
        return materialCache.get(cacheKey)!;
    }

    const matParams: THREE.MeshStandardMaterialParameters = {
        roughness: 0.8,
        metalness: 0.2,
    };

    if (textureFile) {
        const texturePath = `${TEXTURE_BASE_PATH}${textureFile}`;
        try {
            const texture = textureLoader.load(texturePath);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            // DO NOT set texture.repeat on the shared texture instance here
            matParams.map = texture;
            // console.log(`Loaded environment texture for base material: ${texturePath}`);
        } catch (error) {
            console.error(`Failed to load environment texture: ${texturePath}`, error);
            matParams.color = 0xaaaaaa; // Fallback color
        }
    } else {
        matParams.color = 0xaaaaaa; // Default color if no texture
    }
    const newMaterial = new THREE.MeshStandardMaterial(matParams);
    materialCache.set(cacheKey, newMaterial);
    return newMaterial;
}

function applyTilingToMaterial(
    baseMaterial: THREE.MeshStandardMaterial,
    boxWidth: number, 
    boxHeight: number,
    boxDepth: number 
): THREE.MeshStandardMaterial[] {
    const faceMaterials: THREE.MeshStandardMaterial[] = [];

    const dimensionsForFaces = [
        { uDim: boxDepth, vDim: boxHeight }, // Positive X (Right)
        { uDim: boxDepth, vDim: boxHeight }, // Negative X (Left)
        { uDim: boxWidth, vDim: boxDepth },  // Positive Y (Top)
        { uDim: boxWidth, vDim: boxDepth },  // Negative Y (Bottom)
        { uDim: boxWidth, vDim: boxHeight }, // Positive Z (Front)
        { uDim: boxWidth, vDim: boxHeight }  // Negative Z (Back)
    ];

    for (let i = 0; i < 6; i++) {
        const tiledMaterial = baseMaterial.clone();
        if (baseMaterial.map) {
            tiledMaterial.map = baseMaterial.map.clone();
            tiledMaterial.map.needsUpdate = true; 
            tiledMaterial.map.wrapS = THREE.RepeatWrapping;
            tiledMaterial.map.wrapT = THREE.RepeatWrapping;
            
            const { uDim, vDim } = dimensionsForFaces[i];
            const repeatX = Math.max(0.001, uDim / TEXTURE_UNIT_SIZE); 
            const repeatY = Math.max(0.001, vDim / TEXTURE_UNIT_SIZE);
            tiledMaterial.map.repeat.set(repeatX, repeatY);
        }
        faceMaterials.push(tiledMaterial);
    }
    return faceMaterials;
}

function createRoomFromConfig(
    config: RoomConfig, 
    scene: THREE.Scene
): THREE.Mesh[] {
    const roomMeshes: THREE.Mesh[] = [];
    const { center, size, thickness, door, wallTexture, ceilingTexture } = config;

    const baseWallMaterial = getBaseMaterial(wallTexture);
    const baseCeilingMaterial = getBaseMaterial(ceilingTexture);

    const roomCenter = new THREE.Vector3(center.x, center.y, center.z);
    const roomSize = new THREE.Vector3(size.x, size.y, size.z);

    const wallPositionsInfo = [
        { name: 'front', dx: 0, dz: 1, lenDim: 'x', posOffset: roomSize.z / 2 + thickness / 2 },
        { name: 'back',  dx: 0, dz: -1, lenDim: 'x', posOffset: -(roomSize.z / 2 + thickness / 2) },
        { name: 'left',  dx: -1, dz: 0, lenDim: 'z', posOffset: -(roomSize.x / 2 + thickness / 2) },
        { name: 'right', dx: 1, dz: 0, lenDim: 'z', posOffset: roomSize.x / 2 + thickness / 2 }
    ];

    for (const wallInfo of wallPositionsInfo) {
        const wallBaseY = roomCenter.y + roomSize.y / 2;
        let wallLength = wallInfo.lenDim === 'x' ? roomSize.x : roomSize.z;
        if (wallInfo.lenDim === 'x') wallLength += thickness * 2; // Walls along Z extend to cover X-aligned walls

        let currentWallMeshes: THREE.Mesh[] = [];

        if (door && door.face[0] === wallInfo.dx && door.face[1] === wallInfo.dz) {
            const doorPos = roomCenter.clone();
            if (wallInfo.dx === 0) doorPos.z += wallInfo.posOffset; // front/back
            else doorPos.x += wallInfo.posOffset; // left/right

            const mainDim = wallInfo.lenDim === 'x' ? roomSize.x : roomSize.z;
            const part1Length = (mainDim - door.width) / 2;
            const part2Length = part1Length;
            const lintelHeight = roomSize.y - door.height;

            if (part1Length > 0) {
                const geo = wallInfo.dx === 0 ? 
                    new THREE.BoxGeometry(part1Length, roomSize.y, thickness) :
                    new THREE.BoxGeometry(thickness, roomSize.y, part1Length);
                const faceMaterials = wallInfo.dx === 0 ?
                    applyTilingToMaterial(baseWallMaterial, part1Length, roomSize.y, thickness) :
                    applyTilingToMaterial(baseWallMaterial, thickness, roomSize.y, part1Length);
                const mesh = new THREE.Mesh(geo, faceMaterials);
                const offsetAmount = door.width / 2 + part1Length / 2; // Distance from wall's center axis to segment's center axis
                mesh.position.set(
                    wallInfo.dx === 0 ? (roomCenter.x - offsetAmount + door.offset) : doorPos.x,
                    wallBaseY,
                    wallInfo.dz === 0 ? (roomCenter.z - offsetAmount + door.offset) : doorPos.z
                );
                currentWallMeshes.push(mesh);
            }
            if (part2Length > 0) {
                const geo = wallInfo.dx === 0 ?
                    new THREE.BoxGeometry(part2Length, roomSize.y, thickness) :
                    new THREE.BoxGeometry(thickness, roomSize.y, part2Length);
                const faceMaterials = wallInfo.dx === 0 ?
                    applyTilingToMaterial(baseWallMaterial, part2Length, roomSize.y, thickness) :
                    applyTilingToMaterial(baseWallMaterial, thickness, roomSize.y, part2Length);
                const mesh = new THREE.Mesh(geo, faceMaterials);
                const offsetAmount = door.width / 2 + part2Length / 2; // Distance from wall's center axis to segment's center axis
                mesh.position.set(
                    wallInfo.dx === 0 ? (roomCenter.x + offsetAmount + door.offset) : doorPos.x,
                    wallBaseY,
                    wallInfo.dz === 0 ? (roomCenter.z + offsetAmount + door.offset) : doorPos.z
                );
                currentWallMeshes.push(mesh);
            }
            if (lintelHeight > 0) {
                const geo = wallInfo.dx === 0 ? 
                    new THREE.BoxGeometry(door.width, lintelHeight, thickness) : // Lintel length is door.width
                    new THREE.BoxGeometry(thickness, lintelHeight, door.width) ; // Lintel length is door.width
                const faceMaterials = wallInfo.dx === 0 ?
                    applyTilingToMaterial(baseWallMaterial, door.width, lintelHeight, thickness) :
                    applyTilingToMaterial(baseWallMaterial, thickness, lintelHeight, door.width);
                const mesh = new THREE.Mesh(geo, faceMaterials);
                mesh.position.set(
                    wallInfo.dx === 0 ? (roomCenter.x + door.offset) : doorPos.x, // Centered over door opening using door.offset
                    roomCenter.y + door.height + lintelHeight / 2,
                    wallInfo.dz === 0 ? (roomCenter.z + door.offset) : doorPos.z // Centered over door opening using door.offset
                );
                currentWallMeshes.push(mesh);
            }
        } else {
            // Solid wall
            const geo = wallInfo.lenDim === 'x' ? 
                new THREE.BoxGeometry(wallLength, roomSize.y, thickness) : 
                new THREE.BoxGeometry(thickness, roomSize.y, wallLength);
            const faceMaterials = wallInfo.lenDim === 'x' ?
                applyTilingToMaterial(baseWallMaterial, wallLength, roomSize.y, thickness) :
                applyTilingToMaterial(baseWallMaterial, thickness, roomSize.y, wallLength);
            const mesh = new THREE.Mesh(geo, faceMaterials);
            mesh.position.set(
                roomCenter.x + (wallInfo.dx * (wallInfo.lenDim === 'z' ? roomSize.x / 2 + thickness / 2 : 0)),
                wallBaseY,
                roomCenter.z + (wallInfo.dz * (wallInfo.lenDim === 'x' ? roomSize.z / 2 + thickness / 2 : 0))
            );

            currentWallMeshes.push(mesh);
        }
        currentWallMeshes.forEach(m => {
            m.castShadow = true; m.receiveShadow = true; m.name = `${config.id}_${wallInfo.name}_part`;
            scene.add(m); roomMeshes.push(m);
        });
    }

    // Ceiling
    const ceilingWidth = roomSize.x + thickness * 2;
    const ceilingDepth = roomSize.z + thickness * 2;
    const ceilingGeo = new THREE.BoxGeometry(ceilingWidth, thickness, ceilingDepth);
    const tiledCeilingMaterials = applyTilingToMaterial(baseCeilingMaterial, ceilingWidth, thickness, ceilingDepth);
    const ceiling = new THREE.Mesh(ceilingGeo, tiledCeilingMaterials);
    ceiling.position.set(roomCenter.x, roomCenter.y + roomSize.y + thickness / 2, roomCenter.z);
    ceiling.castShadow = true; ceiling.receiveShadow = true; ceiling.name = `${config.id}_Ceiling`;
    scene.add(ceiling);
    roomMeshes.push(ceiling);

    return roomMeshes;
}

function createBoxFromConfig(
    config: BoxConfig, 
    scene: THREE.Scene
): THREE.Mesh[] {
    const { center, size, angle, texture } = config;
    const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
    
    const baseBoxMaterial = getBaseMaterial(texture);
    const tiledBoxMaterials = applyTilingToMaterial(baseBoxMaterial, size.x, size.y, size.z);
        
    const boxMesh = new THREE.Mesh(boxGeo, tiledBoxMaterials);
    boxMesh.position.set(center.x, center.y, center.z);
    boxMesh.rotation.y = angle;
    boxMesh.castShadow = true; boxMesh.receiveShadow = true; boxMesh.name = config.id;
    scene.add(boxMesh);
    return [boxMesh];
}

export function setupStaticEnvironment(
    scene: THREE.Scene
): THREE.Mesh[] {
    const staticCollidables: THREE.Mesh[] = [];
    const configData = worldConfigJson;
    
    configData.structures.forEach(structConfig => {
        let newMeshes: THREE.Mesh[] = [];
        if (structConfig.type === 'room') {
            const completeConfig = { ...defaultRoomConfig, ...structConfig, door: { ...defaultDoorConfig, ...structConfig.door } };
            newMeshes = createRoomFromConfig(completeConfig as RoomConfig, scene);
        } else if (structConfig.type === 'box') {
            const completeConfig = { ...defaultBoxConfig, ...structConfig };
            newMeshes = createBoxFromConfig(completeConfig as BoxConfig, scene);
        }
        staticCollidables.push(...newMeshes);
    });

    staticCollidables.forEach(collidable => {
        if (!collidable.geometry.boundingBox) { // Ensure boundingBox is calculated if not already
             collidable.geometry.computeBoundingBox();
        }
        collidable.updateMatrixWorld(true);
        collidable.userData.worldAABB = new THREE.Box3().setFromObject(collidable);
    });

    console.log(`Created ${staticCollidables.length} static collidable component meshes from JSON config.`);
    return staticCollidables;
} 