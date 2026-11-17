// An open-motion title may already name its subject. Keep it verbatim in that case.
export function motionTitle(characterName, actionName) {
  const character = String(characterName || '角色').trim();
  const action = String(actionName || '动作').trim();
  return character && action.includes(character) ? action : `${character} · ${action}`;
}
