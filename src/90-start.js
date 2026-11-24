/* ---------- events and start ---------- */
document.addEventListener('click', function (e) {
  if (e.target.classList && e.target.classList.contains('ov')) { closeOverlay(); return; }
  var el = e.target.closest('[data-a]'); if (!el) return;
  var fn = A[el.dataset.a]; if (fn) fn(el, e);
});
document.addEventListener('submit', function (e) {
  var f = e.target.closest('form[data-f]'); if (!f) return;
  e.preventDefault(); var fn = F[f.dataset.f]; if (fn) fn(f);
});
document.addEventListener('input', function (e) { if (e.target.dataset && e.target.dataset.a === 'prog') A.prog(e.target); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && U.overlay && U.overlay.type !== 'focus') closeOverlay(); });
setInterval(function () { tick(); try { if (S.activeId && D()) remindTick(); } catch (e) { } }, 1000);
(async function boot() {
  if (typeof window.claude === 'undefined' && typeof sbCfg === 'function' && sbCfg()) { try { await sbBoot(); } catch (e) { } }
  var hasClaude = typeof window.claude !== 'undefined' && window.claude && typeof window.claude.use === 'function';
  if (hasClaude) { $('#app').innerHTML = '<div class="main" style="min-height:100%;justify-content:center;max-width:480px">' + heroBlock(true) + '<p class="center muted" role="status">Loading…</p></div>'; }
  var cloud = hasClaude ? await cloudInit() : false;
  await aiInit();
  if (!cloud) { CL.phase = 'ready'; Object.keys(S.data).forEach(function (k) { ensureData(S.data[k]); }); }
  if (S.activeId && D()) { ensureData(D()); maybeCheckin(); }
  try { var tzNow = Intl.DateTimeFormat().resolvedOptions().timeZone; if (D() && tzNow && D().settings.tz !== tzNow) { D().settings.tz = tzNow; save(); } } catch (e) { }
  applyTheme(); render();
})();
