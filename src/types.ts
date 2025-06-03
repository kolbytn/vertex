import * as THREE from 'three';

// --- Common Basic Types ---
export interface Vector3Config {
    x: number;
    y: number;
    z: number;
}

export interface SizeConfig { // From environment/types
    x: number;
    y: number;
    z: number;
}

// --- Entity Related Types (from entities/types.ts) ---
export interface BaseEntityConfig {
    id: string;
    position: Vector3Config;
}

export interface GeometryAttachment {
    type: 'box' | 'sphere' | 'cylinder' | 'capsule';
    dimensions: Vector3Config; // For box: x,y,z are w,h,d. For sphere: x is radius. For cyl/cap: x radius, y height.
    position: Vector3Config;
    rotation?: Vector3Config; // Euler angles (degrees)
    texture?: string;
}

export interface BodyPartDefinition {
    id: string;
    geometry: GeometryAttachment[];
}

export interface HeadDefinition extends BodyPartDefinition {}

export const defaultHeadDefinition: HeadDefinition = {
    id: 'defaultHead',
    geometry: []
};

export interface HeadState extends HeadDefinition {
    quality: number;
}

export interface TorsoDefinition extends BodyPartDefinition {}

export const defaultTorsoDefinition: TorsoDefinition = {
    id: 'defaultTorso',
    geometry: []
};

export interface TorsoState extends TorsoDefinition {
    quality: number;
}

export interface ArmDefinition extends BodyPartDefinition {}

export const defaultArmDefinition: ArmDefinition = {
    id: 'defaultArm',
    geometry: []
};

export interface ArmState extends ArmDefinition {
    quality: number;
}

export interface LegDefinition extends BodyPartDefinition {}

export const defaultLegDefinition: LegDefinition = {
    id: 'defaultLeg',
    geometry: []
};

export interface LegState extends LegDefinition {
    quality: number;
}

export interface Attack {
    id: string;
    damage: number;
    range: number;
    stunChance: number;
    stunDuration: number;
    blastRadius: number;
    blastDamage: number;
    blastStunChance: number;
    blastStunDuration: number;
}

export const defaultAttackDefinition: Attack = {
    id: 'defaultAttack',
    damage: 10,
    range: 20,
    stunChance: 0,
    stunDuration: 1,
    blastRadius: 0,
    blastDamage: 5,
    blastStunChance: 0,
    blastStunDuration: 1,
}

export interface WeaponDefinition extends BodyPartDefinition {
    attacks: Attack[];
}

export interface WeaponState extends WeaponDefinition {
    quality: number;
}

export const defaultWeaponDefinition: WeaponDefinition = {
    id: 'defaultWeapon',
    geometry: [],
    attacks: [defaultAttackDefinition]
};

export interface HumanoidConfig extends BaseEntityConfig {
    texture?: string;
    headDefinitionId?: string;
    torsoDefinitionId?: string;
    armDefinitionId?: string;
    legDefinitionId?: string;
    weaponDefinitionId?: string; // Renamed from gunDefinitionId
}

export const defaultHumanoidConfig: HumanoidConfig = {
    id: 'defaultHumanoid',
    position: { x: 0, y: 0, z: 0 },
    texture: 'blue_metal_plate_diff_4k.jpg',
    headDefinitionId: undefined,
    torsoDefinitionId: undefined,
    armDefinitionId: undefined,
    legDefinitionId: undefined,
    weaponDefinitionId: undefined // Renamed from gunDefinitionId
};

export interface EntityState {
    id: string;
    isPC: boolean;
    position: THREE.Vector3;
    yaw: number;
    velocity: THREE.Vector3;
    isGrounded: boolean;
    isWalking: boolean;
    walkCycleTime: number;
    idleCycleTime: number;
    initialLeftArmRotation: { x: number, z: number };
    initialRightArmRotation: { x: number, z: number };
    hp: number;
    currentTargetId: string | null;
    head?: HeadState;
    torso?: TorsoState;
    arms?: ArmState;
    legs?: LegState;
    weapon?: WeaponState;
}

// --- Environment Related Types (from evnvironment/types.ts) ---
export interface DoorConfig {
    face: [number, number];
    width: number;
    height: number;
    offset: number; 
}
export const defaultDoorConfig: DoorConfig = {
    face: [1, 0],
    width: 1,
    height: 2.5,
    offset: 0
};

export interface BaseStructureConfig {
    type: 'room' | 'box' | 'wall'; // Added 'wall' based on environmentConfig.json
    id: string;
    center: Vector3Config;
    size: SizeConfig;
}

export interface RoomConfig extends BaseStructureConfig {
    type: 'room';
    thickness: number;
    door?: DoorConfig;
    // Renaming texture fields from environmentConfig for consistency
    wallTexture?: string;      // Was textureWall
    ceilingTexture?: string; // Was textureCeiling
}
export const defaultRoomConfig: RoomConfig = {
    id: 'defaultRoom',
    type: 'room',
    center: { x: 0, y: 0, z: 0 },
    size: { x: 10, y: 4, z: 10 }, 
    thickness: 0.2,
    door: defaultDoorConfig,
    wallTexture: 'red_brick_diff_4k.jpg',
    ceilingTexture: 'corrugated_iron_03_diff_4k.jpg'
};

export interface BoxConfig extends BaseStructureConfig { // For environment boxes
    type: 'box';
    angle: number; 
    texture?: string; // Made optional and matches HumanoidConfig texture naming
}
export const defaultBoxConfig: BoxConfig = {
    id: 'defaultBox',
    type: 'box',
    center: { x: 0, y: 0, z: 0 },
    size: { x: 10, y: 4, z: 10 },
    angle: 0,
    texture: 'rock_wall_13_diff_4k.jpg'
};

export type StructureConfig = RoomConfig | BoxConfig;