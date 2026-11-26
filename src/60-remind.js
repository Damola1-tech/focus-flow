/* ---------- reminders that work while the page is open ---------- */
var AUDIO = null;
function audioCtx() {
  try { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; if (!AUDIO) AUDIO = new C(); if (AUDIO.state === 'suspended') AUDIO.resume(); return AUDIO; } catch (e) { return null; }
}
/* browsers only allow sound after a tap, so unlock on the first one */
['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, function () { audioCtx(); }, { passive: true }); });
function chime(force) {
  var d = D(); if (!force && d && d.settings.sound === false) return;
  var ctx = audioCtx(); if (!ctx) return;
  try {
    [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(function (n) {
      var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + n[1];
      o.type = 'sine'; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.55);
    });
  } catch (e) { }
  try { if (force || !d || d.settings.vibrate !== false) navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { }
}
function inQuiet(s) {
  var n = nowMin(), a = toMin(s.quietFrom || '22:00'), b = toMin(s.quietTo || '07:00');
  return a === b ? false : (a < b ? (n >= a && n < b) : (n >= a || n < b));
}
function remindTick() {
  var d = D(); if (!d) return;
  try { var tz0 = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz0 && d.settings.tz !== tz0) { d.settings.tz = tz0; save(); } } catch (e) { }
  var s = d.settings, date = todayStr(), nm = nowMin(); d.sn = d.sn || {};
  if (d.snDay !== date) { d.sn = {}; d.snDay = date; save(); }
  if (U.flow === 'checkin') return;
  var quiet = inQuiet(s);
  if (s.remindStart > 0) {
    tasks().forEach(function (t) {
      if (t.date !== date || t.status !== 'todo' || !t.time) return;
      var st = toMin(t.time), key = 's' + t.id + t.time, late = 'l' + key;
      if (!d.sn[key] && nm >= st - s.remindStart && nm < st) { d.sn[key] = 1; save(); notify('Starting soon: ' + t.title + ' at ' + fmtTime12(t.time) + '.'); }
      else if (!quiet && !d.sn[late] && nm >= st + 10 && nm < st + 45 && !(d.active && d.active.taskId === t.id)) { d.sn[late] = 1; save(); notify(t.title + ' was planned for ' + fmtTime12(t.time) + '. Start it now, or move it?'); }
    });
  }
  if (!quiet && s.checkinEvery > 0 && nm >= 480) {
    var slot = Math.floor(nm / s.checkinEvery), key = 'c' + slot;
    if (!d.sn[key] && nm - slot * s.checkinEvery < 5) {
      d.sn[key] = 1;
      var a = d.active, t = a && taskById(a.taskId), nxt = nextTask();
      if (a && t) { save(); notify('Check-in: how is "' + t.title + '" going? ' + fmtDur(Math.max(1, activeElapsed(a) / 60)) + ' so far.'); }
      else if (nxt) { save(); notify('Check-in: next on your list is "' + nxt.title + '". Ready to start?'); }
      else save();
    }
  }
}
/* make notify() keep a short list for the Reminders banner and tab title */
(function () {
  var base = notify;
  notify = function (text) {
    U.alerts = (U.alerts || []).concat([{ text: text, at: Date.now() }]).slice(-5);
    try { document.title = '(' + U.alerts.length + ') Focus Flow'; } catch (e) { }
    base(text); chime();
    if (U.view === 'home' && !U.overlay && !U.flow) { try { render(); } catch (e) { } }
  };
})();
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); U.installPrompt = e; if (U.view === 'settings') render(); });
