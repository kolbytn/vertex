import * as THREE from 'three'; // Keep for potential future use with THREE.Object3D
import { EntityState, Attack, WeaponState } from './types'; // Assuming EntityState is in types.ts

interface ShotEvent {
    attackerId: string;
    targetId: string;
}

let combatDisplayElement: HTMLElement | null = null;
let pcAttackDisplayElement: HTMLElement | null = null; // For PC's best attack
let turnOrder: string[] = [];
let currentTurnIndex: number = 0;
let turnTimer: number = 0;
const TURN_DURATION = 1; // 1 second per turn

// Helper function to get the best attack
function getBestAttack(attackerState: EntityState, targetState: EntityState, distanceSq: number): Attack | null {
    if (!attackerState.weapon || !attackerState.weapon.attacks || attackerState.weapon.attacks.length === 0) {
        return null; // No weapon or no attacks defined
    }

    let bestAttack: Attack | null = null;
    let maxDamage = -1;

    for (const attack of attackerState.weapon.attacks) {
        if (distanceSq <= attack.range * attack.range) { // Check if within range
            if (attack.damage > maxDamage) {
                maxDamage = attack.damage;
                bestAttack = attack;
            }
        }
    }
    return bestAttack;
}

function updateCombatDisplay(combatantIds: string[], pcs: Map<string, EntityState>, npcs: Map<string, EntityState>): void {
    if (!combatDisplayElement) return;

    // Clear previous list items
    const list = combatDisplayElement.querySelector('ul');
    if (list) {
        list.innerHTML = ''; // Clear existing items
        combatantIds.forEach(id => {
            const entityState = pcs.get(id) || npcs.get(id);
            const hp = entityState ? entityState.hp : 'N/A';
            const listItem = document.createElement('li');
            listItem.textContent = `${id} (HP: ${hp})`;
            if (id === turnOrder[currentTurnIndex]) {
                listItem.style.fontWeight = 'bold';
                listItem.style.color = 'yellow';
            }
            list.appendChild(listItem);
        });
    }
}

export function startCombat(combatantIds: string[], pcs: Map<string, EntityState>, npcs: Map<string, EntityState>): void {
    console.log("Combat mode started with entities:", combatantIds);
    turnOrder = [...combatantIds].sort(() => Math.random() - 0.5); // Randomize turn order
    currentTurnIndex = 0;
    turnTimer = 0;

    // Remove previous display if it exists
    if (combatDisplayElement && combatDisplayElement.parentElement) {
        combatDisplayElement.remove();
    }
    if (pcAttackDisplayElement && pcAttackDisplayElement.parentElement) {
        pcAttackDisplayElement.remove();
    }

    // Create a new display element for general combat info
    combatDisplayElement = document.createElement('div');
    combatDisplayElement.style.position = 'fixed';
    combatDisplayElement.style.top = '10px';
    combatDisplayElement.style.right = '10px';
    combatDisplayElement.style.padding = '10px';
    combatDisplayElement.style.backgroundColor = 'rgba(200, 0, 0, 0.7)'; // Reddish for combat
    combatDisplayElement.style.color = 'white';
    combatDisplayElement.style.fontFamily = 'Arial, sans-serif';
    combatDisplayElement.style.borderRadius = '5px';
    combatDisplayElement.style.zIndex = '101'; // Ensure it's above other UI

    const title = document.createElement('h4');
    title.textContent = '--- COMBAT MODE ACTIVE ---';
    title.style.margin = '0 0 5px 0';
    combatDisplayElement.appendChild(title);

    const turnIndicator = document.createElement('p');
    turnIndicator.id = 'turn-indicator';
    turnIndicator.style.margin = '5px 0';
    combatDisplayElement.appendChild(turnIndicator);

    const list = document.createElement('ul');
    list.style.listStyleType = 'none';
    list.style.paddingLeft = '0';
    list.style.margin = '0';
    combatDisplayElement.appendChild(list); // Append the list here

    document.body.appendChild(combatDisplayElement);

    // Create a new display element for PC's best attack
    pcAttackDisplayElement = document.createElement('div');
    pcAttackDisplayElement.id = 'pc-attack-display';
    pcAttackDisplayElement.style.position = 'fixed';
    pcAttackDisplayElement.style.bottom = '20px';
    pcAttackDisplayElement.style.left = '50%';
    pcAttackDisplayElement.style.transform = 'translateX(-50%)';
    pcAttackDisplayElement.style.padding = '8px 15px';
    pcAttackDisplayElement.style.backgroundColor = 'rgba(0, 50, 100, 0.8)'; // Bluish
    pcAttackDisplayElement.style.color = 'white';
    pcAttackDisplayElement.style.fontFamily = 'Arial, sans-serif';
    pcAttackDisplayElement.style.fontSize = '14px';
    pcAttackDisplayElement.style.borderRadius = '5px';
    pcAttackDisplayElement.style.zIndex = '101';
    pcAttackDisplayElement.style.display = 'none'; // Initially hidden
    document.body.appendChild(pcAttackDisplayElement);

    updateCombatDisplay(turnOrder, pcs, npcs); // Initial display update
}

export function endCombat(): void {
    if (combatDisplayElement && combatDisplayElement.parentElement) {
        combatDisplayElement.remove();
    }
    combatDisplayElement = null;
    if (pcAttackDisplayElement && pcAttackDisplayElement.parentElement) {
        pcAttackDisplayElement.remove();
    }
    pcAttackDisplayElement = null;
    turnOrder = [];
    currentTurnIndex = 0;
    console.log("Combat mode ended.");
}

export function updateCombatLogic(
    delta: number,
    combatantIds: Set<string>,
    allHumanoidEntities: THREE.Object3D[],
    pcs: Map<string, EntityState>,
    npcs: Map<string, EntityState>
): { updatedCombatants: Set<string>, combatShouldEnd: boolean, defeatedNpcIds: string[], shotEvents: ShotEvent[] } {
    if (turnOrder.length === 0) {
        return { updatedCombatants: combatantIds, combatShouldEnd: true, defeatedNpcIds: [], shotEvents: [] };
    }

    turnTimer += delta;
    const defeatedNpcIdsThisTurn: string[] = [];
    const shotEventsThisTurn: ShotEvent[] = [];

    const currentTurnEntityId = turnOrder[currentTurnIndex];
    const attackerState = pcs.get(currentTurnEntityId) || npcs.get(currentTurnEntityId);

    if (attackerState && attackerState.hp <= 0) { // Current attacker is dead, skip turn
        turnTimer = TURN_DURATION; // Force next turn
    }

    if (turnTimer >= TURN_DURATION) {
        turnTimer = 0; // Reset timer for the next turn

        // Process current turn (attack)
        if (attackerState && attackerState.hp > 0 && !attackerState.isWalking) {
            const attackerIsPC = pcs.has(currentTurnEntityId);
            let targetId: string | null = null;

            if (attackerIsPC) {
                // PC targets their currentTargetId if valid, otherwise closest NPC
                if (attackerState.currentTargetId) {
                    const potentialTargetState = pcs.get(attackerState.currentTargetId) || npcs.get(attackerState.currentTargetId);
                    if (potentialTargetState && potentialTargetState.hp > 0 && combatantIds.has(attackerState.currentTargetId) && npcs.has(attackerState.currentTargetId)) {
                        targetId = attackerState.currentTargetId;
                    } else {
                        attackerState.currentTargetId = null; // Target is invalid, clear it
                    }
                }
                if (!targetId) { // If no valid current target, find closest NPC
                    let closestNpcState: EntityState | null = null;
                    let minDistanceSqToNpc = Infinity;
                    npcs.forEach((npcState, npcId) => {
                        if (combatantIds.has(npcId)) {
                            if (npcState && npcState.hp > 0) {
                                const distanceSq = attackerState.position.distanceToSquared(npcState.position);
                                if (distanceSq < minDistanceSqToNpc) {
                                    minDistanceSqToNpc = distanceSq;
                                    closestNpcState = npcState;
                                    targetId = npcId;
                                }
                            }
                        }
                    });
                }
            } else { // NPC logic: target closest PC
                let closestPcState: EntityState | null = null;
                let minDistanceSqToPc = Infinity;
                pcs.forEach((pcState, pcId) => {
                    if (combatantIds.has(pcId)) {
                        if (pcState && pcState.hp > 0) {
                            const distanceSq = attackerState.position.distanceToSquared(pcState.position);
                            if (distanceSq < minDistanceSqToPc) {
                                minDistanceSqToPc = distanceSq;
                                closestPcState = pcState;
                                targetId = pcId;
                            }
                        }
                    }
                });
            }

            if (targetId) {
                const targetState = pcs.get(targetId) || npcs.get(targetId);
                if (targetState) {
                    const distanceSq = attackerState.position.distanceToSquared(targetState.position);
                    console.log(attackerState);
                    const bestAttack = getBestAttack(attackerState, targetState, distanceSq);
                    
                    let damage = bestAttack?.damage ?? 1; // Default damage if no suitable attack

                    targetState.hp -= damage;
                    console.log(`${currentTurnEntityId} attacked ${targetId} with ${bestAttack ? bestAttack.id : 'default attack'} for ${damage} damage. ${targetId} HP: ${targetState.hp}`);
                    shotEventsThisTurn.push({ attackerId: currentTurnEntityId, targetId: targetId }); // Add shot event

                    if (targetState.hp <= 0) {
                        targetState.hp = 0; // Prevent negative HP
                        console.log(`${targetId} has been defeated!`);
                        if (npcs.has(targetId)) {
                            defeatedNpcIdsThisTurn.push(targetId);
                            combatantIds.delete(targetId); // Remove defeated NPC from combatants

                            const indexInTurnOrder = turnOrder.indexOf(targetId);
                            if (indexInTurnOrder > -1) {
                                turnOrder.splice(indexInTurnOrder, 1);
                                // Adjust currentTurnIndex if the removed entity was at or before the current turn index
                                // This ensures the next turn calculation is correct.
                                if (indexInTurnOrder <= currentTurnIndex) {
                                    currentTurnIndex--;
                                }
                            }
                        }
                        // PCs with 0 HP will have their turns skipped by the check at the start of turn processing.
                        // They remain in combatantIds and turnOrder unless explicitly removed by other logic.
                    }
                }
            }
        } else if (attackerState && attackerState.isWalking) {
            console.log(`${currentTurnEntityId}'s turn skipped (moving).`);
        }

        // Advance to the next turn
        currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;

        // Check for combat end conditions
        const alivePcs = Array.from(pcs.entries()).filter(([id, state]) => combatantIds.has(id) && state.hp > 0);
        const aliveNpcs = Array.from(npcs.entries()).filter(([id, state]) => combatantIds.has(id) && state.hp > 0);

        if (alivePcs.length === 0 || aliveNpcs.length === 0) {
            console.log("Combat ended. All PCs or NPCs defeated.");
            // If combat ends, all NPCs currently at 0 HP should be reported as defeated
            npcs.forEach((npcState, npcId) => {
                if (npcState && npcState.hp <= 0 && !defeatedNpcIdsThisTurn.includes(npcId)) {
                    defeatedNpcIdsThisTurn.push(npcId);
                }
            });
            return { updatedCombatants: combatantIds, combatShouldEnd: true, defeatedNpcIds: defeatedNpcIdsThisTurn, shotEvents: [] };
        }
    }
    
    // Update UI display (including turn indicator and health)
    if (combatDisplayElement) {
        const turnIndicator = combatDisplayElement.querySelector('#turn-indicator');
        if (turnIndicator) {
            turnIndicator.textContent = `Turn: ${turnOrder[currentTurnIndex]}`;
        }
        updateCombatDisplay(turnOrder, pcs, npcs);
    }

    // Update PC's best attack display for the "currently controlled" PC
    if (pcAttackDisplayElement) {
        let controlledPcId: string | null = null;
        let controlledPcState: EntityState | null = null;

        // Assumption: The "currently controlled PC" is the first one found in the pcs map
        // that is active in combat. This might need adjustment for multi-PC control.
        for (const [id, state] of pcs) {
            if (combatantIds.has(id) && state.hp > 0) {
                controlledPcId = id;
                controlledPcState = state;
                break; // Found an active PC to consider as controlled
            }
        }

        if (controlledPcId && controlledPcState) {
            let bestAttackForDisplay: Attack | null = null;
            let targetForDisplay: EntityState | null = null;
            let targetIdForDisplay: string | null = null;

            // Determine a target for the controlled PC to display attack info against
            // Priority 1: Current target if valid
            if (controlledPcState.currentTargetId) {
                const potentialTarget = npcs.get(controlledPcState.currentTargetId);
                if (potentialTarget && potentialTarget.hp > 0 && combatantIds.has(controlledPcState.currentTargetId)) {
                    targetForDisplay = potentialTarget;
                    targetIdForDisplay = controlledPcState.currentTargetId;
                }
            }

            // Priority 2: Closest NPC if no valid current target
            if (!targetForDisplay) {
                let minDistanceSqToNpc = Infinity;
                npcs.forEach((npcState, npcId) => {
                    if (combatantIds.has(npcId) && npcState.hp > 0) {
                        const distanceSq = controlledPcState!.position.distanceToSquared(npcState.position);
                        if (distanceSq < minDistanceSqToNpc) {
                            minDistanceSqToNpc = distanceSq;
                            targetForDisplay = npcState;
                            targetIdForDisplay = npcId;
                        }
                    }
                });
            }

            const displayTextPrefix = `PC ${controlledPcId}: `;
            if (targetIdForDisplay && targetForDisplay) {
                const distanceSqToTarget = controlledPcState.position.distanceToSquared(targetForDisplay.position);
                bestAttackForDisplay = getBestAttack(controlledPcState, targetForDisplay, distanceSqToTarget);

                if (bestAttackForDisplay) {
                    pcAttackDisplayElement.textContent = `${displayTextPrefix}Attack ${bestAttackForDisplay.id} (Dmg ${bestAttackForDisplay.damage}, Rng ${bestAttackForDisplay.range}) vs ${targetIdForDisplay}`;
                } else {
                    pcAttackDisplayElement.textContent = `${displayTextPrefix}Target ${targetIdForDisplay} (No attack in range)`;
                }
            } else {
                pcAttackDisplayElement.textContent = `${displayTextPrefix}No valid targets`;
            }
            pcAttackDisplayElement.style.display = 'block';
        } else {
            // No active controlled PC, or combat might not be suitable for this display
            pcAttackDisplayElement.textContent = 'No active player character.';
            pcAttackDisplayElement.style.display = 'none'; // Hide if no controlled PC
        }
    }

    // NPCs face their target (can be run every frame or just on their turn)
    combatantIds.forEach(combatantId => {
        const combatantEntity = allHumanoidEntities.find(e => e.name === combatantId);
        const combatantState = pcs.get(combatantId) || npcs.get(combatantId);

        if (!combatantEntity || !combatantState || combatantState.hp <= 0) return;

        if (npcs.has(combatantId)) { // This is an NPC
            let nearestPcState: EntityState | null = null;
            let minDistanceSq = Infinity;

            pcs.forEach((pcState, pcId) => {
                if (pcState && pcState.hp > 0 && combatantIds.has(pcId)) { // Target live PCs in combat
                    const distanceSq = combatantState.position.distanceToSquared(pcState.position);
                    if (distanceSq < minDistanceSq) {
                        minDistanceSq = distanceSq;
                        nearestPcState = pcState;
                    }
                }
            });

            if (nearestPcState) {
                const targetPosition = (nearestPcState as EntityState).position; // Explicit cast
                const direction = new THREE.Vector3().subVectors(targetPosition, combatantState.position);
                const yaw = Math.atan2(direction.x, direction.z) + Math.PI; // Revert to original for NPCs to face target directly
                
                combatantState.yaw = yaw; 
                combatantEntity.rotation.y = yaw; 
            }
        }
    });
    return { updatedCombatants: combatantIds, combatShouldEnd: false, defeatedNpcIds: defeatedNpcIdsThisTurn, shotEvents: shotEventsThisTurn };
}

// Remove or comment out the old updateCombatantBehavior function
/*
export function updateCombatantBehavior(
    combatantIds: Set<string>,
    allHumanoidEntities: THREE.Object3D[],
    entityStates: Map<string, EntityState>,
    pcIds: string[]
): void {
    if (pcIds.length === 0) return; // No PCs to target

    combatantIds.forEach(combatantId => {
        const combatantEntity = allHumanoidEntities.find(e => e.name === combatantId);
        const combatantState = entityStates.get(combatantId);

        if (!combatantEntity || !combatantState) return;

        // Check if this combatant is an NPC (not in pcIds)
        if (!pcIds.includes(combatantId)) { // This is an NPC
            let nearestPcState: EntityState | null = null;
            let minDistanceSq = Infinity;

            pcIds.forEach(pcId => {
                // Ensure the PC is also in combat for targeting, or target any PC if desired
                // For now, let's assume NPCs in combat target any PC, even if that PC isn't in the current combatant list (though they likely would be)
                const pcEntityState = entityStates.get(pcId);
                if (pcEntityState) {
                    const distanceSq = combatantState.position.distanceToSquared(pcEntityState.position);
                    if (distanceSq < minDistanceSq) {
                        minDistanceSq = distanceSq;
                        nearestPcState = pcEntityState;
                    }
                }
            });

            if (nearestPcState) {
                const targetPosition = (nearestPcState as EntityState).position; // Assign to a new const
                if (targetPosition) { // Additional check though logically covered by nearestPcState
                    const direction = new THREE.Vector3().subVectors(targetPosition, combatantState.position);
                    const yaw = Math.atan2(direction.x, direction.z) + Math.PI; // Corrected yaw
                    
                    combatantState.yaw = yaw; 
                    combatantEntity.rotation.y = yaw; 
                }
            }
        }
    });
} 
*/ 