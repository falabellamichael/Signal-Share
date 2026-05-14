export const DIRECT_MESSENGER_AI_ENABLED = false;

export function isDirectMessengerAiEnabled() {
  return DIRECT_MESSENGER_AI_ENABLED;
}

export function isDirectMessengerAiProfile(profile) {
  return Boolean(profile && profile.isAi);
}

