export const FALLBACK_SITE_SETTINGS = Object.freeze({
  shellWidth: 1200,
  sectionGap: 24,
  surfaceRadius: 32,
  mediaFit: "cover"
});

function toFiniteNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function normalizeUiSiteSettings(settings = {}, defaults = FALLBACK_SITE_SETTINGS) {
  const safeDefaults = {
    ...FALLBACK_SITE_SETTINGS,
    ...(defaults && typeof defaults === "object" ? defaults : {})
  };
  const source = settings && typeof settings === "object" ? settings : {};

  return {
    shellWidth: toFiniteNumber(source.shellWidth, safeDefaults.shellWidth),
    sectionGap: toFiniteNumber(source.sectionGap, safeDefaults.sectionGap),
    surfaceRadius: toFiniteNumber(source.surfaceRadius, safeDefaults.surfaceRadius),
    mediaFit: source.mediaFit === "contain" ? "contain" : safeDefaults.mediaFit || "cover"
  };
}
