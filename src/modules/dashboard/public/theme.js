/**
 * ==============================================================================
 * APEX AEA — Mission Control: theme bootstrap
 * ==============================================================================
 * Runs before the stylesheet paints so the stored theme never flashes. The
 * default stays dark; the toggle in the top bar writes the same key.
 */

(() => {
  const KEY = 'apex-theme';
  let theme = 'dark';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    // storage can be unavailable in private contexts
  }
  document.documentElement.dataset.theme = theme;
})();
