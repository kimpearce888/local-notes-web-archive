// Pre-paint theme resolution: avoids a light flash on dark systems by
// aligning data-theme with the saved preference before first render.
// The settings-backed value arrives with the store (T-015); until
// then the system preference is the truthful default (FR-SET-01).
// External file (not inline) so the manifest CSP `script-src 'self'`
// admits it — inline scripts are blocked by our own policy.
(function () {
  try {
    var saved = localStorage.getItem('lnwa-theme-preference');
    var theme =
      saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_error) {
    /* storage unavailable — keep the system default */
  }
})();
