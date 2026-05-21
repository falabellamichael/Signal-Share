import { createAppUi as createCoreAppUi } from "./app-v3-ui-core.js?v=1.6";
import { normalizeUiSiteSettings } from "./app-v3-ui-settings.js?v=1.0";
import { createUiElementRegistry } from "./app-v3-ui-elements.js?v=1.0";

export function createAppUi(context = {}) {
  const normalizedContext = {
    ...context,
    createUiElementRegistry
  };

  const ui = createCoreAppUi(normalizedContext);
  const originalApplySiteSettings = ui?.applySiteSettings;

  if (typeof originalApplySiteSettings === "function") {
    ui.applySiteSettings = function applySafeSiteSettings(settings) {
      return originalApplySiteSettings(normalizeUiSiteSettings(settings, context.DEFAULT_SITE_SETTINGS));
    };
  }

  return ui;
}
