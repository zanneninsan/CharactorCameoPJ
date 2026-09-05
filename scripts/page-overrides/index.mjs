import { createEriseVoogaPageOverride } from "./erise-vooga.mjs";

const overrideFactories = new Map([
  ["erise-vooga", createEriseVoogaPageOverride]
]);

export function resolveCharacterPageOverride(character, helpers) {
  const createOverride = overrideFactories.get(character.id);
  return createOverride ? createOverride({ character, ...helpers }) : {};
}
