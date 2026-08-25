function role(instanceId, definitionId, ownerId) {
  return { instanceId, definitionId, kind: "character", ownerId, faceDown: false };
}

export function fixedAutoScenario({
  phase = "play",
  currentPlayerId = "p1",
  ownerBodyId = "body_combo_001",
  ownerRoles = [],
  opponentRoles = [],
  handDeck = [],
} = {}) {
  const owner = {
    id: "p1",
    nickname: "房主",
    body: { definitionId: ownerBodyId },
    bodyState: { flipped: false },
    hand: [],
    characterSlots: ownerRoles.map((id, index) => role(`owner-role-${index}`, id, "p1")),
    markers: [],
  };
  const opponent = {
    id: "p2",
    nickname: "对手",
    hand: [],
    characterSlots: opponentRoles.map((id, index) => role(`opponent-role-${index}`, id, "p2")),
    markers: [],
  };
  const state = {
    phase,
    turnNumber: 1,
    currentPlayerId,
    handDeck: handDeck.map((definitionId, index) => ({ instanceId: `fixed-hand-${index}`, definitionId, kind: "hand" })),
    handDiscard: [],
    stack: [],
    turnModifiers: [],
  };
  return { owner, opponent, state };
}
