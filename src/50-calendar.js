/* ---------- Calendar: month and week, shifts, trips, plan deadlines ---------- */
function calSel() { return U.calSel || todayStr(); }
function dayInfo(date) {
  var L = tasks().filter(function (t) { return t.date === date && t.status !== 'cancelled'; });
  var open = L.filter(function (t) { return t.status !== 'done'; }).length;
  var sh = shiftFor(date), trip = travelOn(date);
  var dl = myPlans().filter(function (pl) { return pl.deadline === date; });
  return { n: L.length, open: open, done: L.length - open, shift: sh, trip: trip, deadlines: dl, off: !sh && D().settings.hasShift && !trip };
}
function dayLabel(date, i) {
  var bits = [fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })];
  if (i.n) bits.push(i.n + ' task' + (i.n === 1 ? '' : 's') + (i.done ? ', ' + i.done + ' done' : ''));
  if (i.shift) bits.push('work shift'); if (i.trip) bits.push('travelling to ' + i.trip.place);
  i.deadlines.forEach(function (p) { bits.push('plan due: ' + p.title); });
  return bits.join(', ');
}
function monthGrid(first) {
  var y = first.getFullYear(), m = first.getMonth(), today = todayStr(), sel = calSel();
  var start = weekStart(ymd(first)), end = addDays(weekStart(ymd(new Date(y, m + 1, 0))), 6), out = '', dt = start;
  out += '<div class="calhead" aria-hidden="true">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (n) { return '<span>' + n + '</span>'; }).join('') + '</div><div class="calgrid">';
  while (dt <= end) {
    var i = dayInfo(dt), inM = parseYmd(dt).getMonth() === m;
    var cls = 'calcell' + (inM ? '' : ' out') + (dt === today ? ' today' : '') + (dt === sel ? ' sel' : '') + (i.trip ? ' trip' : '');
    var marks = '';
    if (i.shift) marks += '<i class="mk sh" title="Work shift"></i>';
    if (i.deadlines.length) marks += '<i class="mk dl" title="Plan due"></i>';
    out += '<button class="' + cls + '" data-a="calPick" data-date="' + dt + '" aria-label="' + esc(dayLabel(dt, i)) + '"' + (dt === sel ? ' aria-current="date"' : '') + '><b>' + parseYmd(dt).getDate() + '</b>' +
      '<span class="cnt">' + (i.n ? (i.open ? '<span class="open">' + i.open + '</span>' : '') + (i.done ? '<span class="dn">' + i.done + '</span>' : '') : '') + '</span>' +
      '<span class="mks">' + (i.trip ? ic('plane', 12) : '') + marks + '</span></button>';
    dt = addDays(dt, 1);
  }
  return out + '</div>';
}
function agendaFor(date, opts) {
  opts = opts || {};
  var i = dayInfo(date), d = D(), list = tasks().filter(function (t) { return t.date === date && t.status !== 'cancelled'; }).sort(byTime);
  var chips = '';
  if (i.trip) chips += '<span class="pill acc">' + ic('plane', 12) + ' Travel: ' + esc(i.trip.place) + '</span> ';
  if (i.shift) chips += '<span class="pill">Shift ' + fmtTime12(fromMin(i.shift.a)) + ' to ' + fmtTime12(fromMin(Math.min(i.shift.b, 1439))) + '</span> ';
  else if (i.off) chips += '<span class="pill ok">Day off</span> ';
  var ov = d.settings.shiftOverrides && d.settings.shiftOverrides[date]; if (ov) chips += '<span class="pill warn">Changed for this day</span> ';
  i.deadlines.forEach(function (pl) { chips += '<span class="pill warn">Due: ' + esc(pl.title) + '</span> '; });
  var isToday = date === todayStr(), open = list.some(function (t) { return t.status === 'todo'; });
  var acts = '<div class="acts"><button class="btn sm primary" data-a="newTask" data-date="' + date + '">' + ic('plus', 16) + ' Add task</button>' +
    (open && date >= todayStr() ? '<button class="btn sm" data-a="plan" data-date="' + date + '">Plan this day</button>' : '') +
    '<button class="btn sm" data-a="shiftDay" data-date="' + date + '">Change shift</button><button class="btn sm" data-a="tripNew" data-date="' + date + '">' + ic('plane', 14) + ' Travel</button></div>';
  return '<section class="card" aria-label="' + esc(fmtDate(date)) + '"><div class="row between"><h2>' + (isToday ? 'Today' : fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })) + '</h2>' + (isToday ? '<span class="small muted">' + fmtDate(date, { day: 'numeric', month: 'long' }) + '</span>' : '') + '</div>' +
    (chips ? '<div class="row" style="gap:6px">' + chips + '</div>' : '') +
    (list.length ? '<div>' + list.map(function (t) { return taskRow(t); }).join('') + '</div>' : '<p class="muted small">Nothing planned.</p>') + (opts.noActs ? '' : acts) + '</section>';
}
function viewCalendar() {
  var mode = U.calMode || 'month', off = U.calOff || 0, today = new Date(), sel = calSel();
  var first = new Date(today.getFullYear(), today.getMonth() + off, 1);
  var head = '<div class="head"><h1>Calendar</h1><div class="seg" style="min-width:180px"><button data-a="calMode" data-val="month" aria-pressed="' + (mode === 'month') + '">Month</button><button data-a="calMode" data-val="week" aria-pressed="' + (mode === 'week') + '">Week</button></div></div>';
  var body = '';
  if (mode === 'month') {
    body = '<section class="card"><div class="row between"><button class="btn sm" data-a="calNav" data-n="-1" aria-label="Previous month">Previous</button><b>' + first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + '</b><button class="btn sm" data-a="calNav" data-n="1" aria-label="Next month">Next</button></div>' + monthGrid(first) +
      '<div class="row small muted" style="gap:14px"><span><i class="mk sh"></i> Work shift</span><span><i class="mk dl"></i> Plan due</span><span>' + ic('plane', 12) + ' Travel</span><span><span class="open">3</span> open <span class="dn">2</span> done</span></div></section>' + agendaFor(sel);
  } else {
    var ws = weekStart(sel);
    body = '<section class="card"><div class="row between"><button class="btn sm" data-a="calNav" data-n="-1" aria-label="Previous week">Previous</button><b>' + fmtDate(ws, { day: 'numeric', month: 'short' }) + ' to ' + fmtDate(addDays(ws, 6), { day: 'numeric', month: 'short' }) + '</b><button class="btn sm" data-a="calNav" data-n="1" aria-label="Next week">Next</button></div></section>';
    for (var k = 0; k < 7; k++) body += agendaFor(addDays(ws, k), { noActs: false });
  }
  return head + (U.calJump ? '' : '') + '<div class="row"><button class="btn sm" data-a="calToday">Go to today</button></div>' + body;
}
OV.shiftDay = function (p) {
  var d = D(), date = p.date, ov = d.settings.shiftOverrides[date], cur = shiftFor(date), mode = ov ? (ov.off ? 'off' : 'custom') : 'usual';
  return sheet('Change shift', '<h2>Shift on ' + esc(fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })) + '</h2><form data-f="shiftDay" data-date="' + date + '" class="stack">' +
    '<div class="seg" data-single>' + segBtn('Usual', mode === 'usual', 'shmode', 'usual') + segBtn('Day off', mode === 'off', 'shmode', 'off') + segBtn('Different hours', mode === 'custom', 'shmode', 'custom') + '</div>' +
    '<div class="row"><div class="field grow"><label for="sdA">Starts</label><input id="sdA" type="time" value="' + esc(ov && !ov.off ? ov.a : (cur ? fromMin(cur.a) : '08:00')) + '"></div><div class="field grow"><label for="sdB">Ends</label><input id="sdB" type="time" value="' + esc(ov && !ov.off ? ov.b : (cur ? fromMin(Math.min(cur.b, 1439)) : '18:00')) + '"></div></div>' +
    '<span class="small muted">This changes only this one day. Your usual pattern is in Settings.</span>' +
    '<div class="acts"><button class="btn primary" type="submit">Save</button><button type="button" class="btn" data-a="back">Cancel</button></div></form>');
};
OV.trip = function (p) {
  return sheet('Travel', '<h2>Travel mode</h2><p class="small muted">Plans stay lighter and your shift is not planned while you are away.</p><form data-f="travel" class="stack">' +
    '<div class="field"><label for="trPlace">Where are you going?</label><input id="trPlace" type="text" required placeholder="e.g. Abuja"></div>' +
    '<div class="row"><div class="field grow"><label for="trFrom">From</label><input id="trFrom" type="date" required value="' + esc(p.date) + '"></div><div class="field grow"><label for="trTo">To</label><input id="trTo" type="date" required value="' + esc(addDays(p.date, 3)) + '"></div></div>' +
    '<div class="field"><label for="trMax">Most hours of tasks a day</label><select id="trMax">' + [2, 3, 4, 6].map(function (h) { return '<option value="' + h + '"' + (h === 4 ? ' selected' : '') + '>' + h + ' hours</option>'; }).join('') + '</select></div>' +
    '<label class="check"><input id="trKeep" type="checkbox"> I still work my shifts while away</label>' +
    '<div class="acts"><button class="btn primary" type="submit">Add trip</button><button type="button" class="btn" data-a="back">Cancel</button></div></form>');
};
function travelBanners() {
  var date = todayStr(), t = travelOn(date), out = '';
  if (t) out += '<section class="card soft"><b>Travel mode: ' + esc(t.place) + '</b><span class="small">Until ' + esc(fmtDate(t.to, { weekday: 'short', day: 'numeric', month: 'short' })) + '. Plans stay light, up to ' + (t.maxHours || 4) + ' hours of tasks a day' + (t.keepShift ? '' : ', and your shift is not planned') + '.</span></section>';
  else {
    var nx = (D().travel || []).filter(function (x) { return x.from > date && x.from <= addDays(date, 3); }).sort(function (a, b) { return a.from < b.from ? -1 : 1; })[0];
    if (nx) out += '<section class="card soft"><b>Trip to ' + esc(nx.place) + ' starts ' + esc(fmtDate(nx.from, { weekday: 'long', day: 'numeric', month: 'short' })) + '</b><span class="small">Tasks planned for those days may be too many for travel mode.</span><div class="acts"><button class="btn sm" data-a="calGo" data-date="' + nx.from + '">Look at those days</button></div></section>';
  }
  return out;
}
function alertBanner() {
  var L = U.alerts || []; if (!L.length) return '';
  return '<section class="card warn" role="status"><div class="row between"><b>Reminders</b><button class="btn sm ghost" data-a="dismissAlerts">Dismiss</button></div>' + L.slice(-3).reverse().map(function (a) { return '<span class="small">' + esc(clockHM(a.at)) + '  ' + esc(a.text) + '</span>'; }).join('') + '</section>';
}
Object.assign(A, {
  calMode: function (el) { U.calMode = el.dataset.val; render(); },
  calNav: function (el) {
    var n = +el.dataset.n;
    if ((U.calMode || 'month') === 'month') { U.calOff = (U.calOff || 0) + n; var t = new Date(); var f = new Date(t.getFullYear(), t.getMonth() + U.calOff, 1); U.calSel = ymd(f); }
    else { U.calSel = addDays(calSel(), 7 * n); }
    render();
  },
  calToday: function () { U.calOff = 0; U.calSel = todayStr(); render(); },
  calPick: function (el) { U.calSel = el.dataset.date; var t = new Date(), s = parseYmd(U.calSel); U.calOff = (s.getFullYear() - t.getFullYear()) * 12 + s.getMonth() - t.getMonth(); render(); },
  calGo: function (el) { U.view = 'calendar'; A.calPick(el); window.scrollTo(0, 0); },
  shiftDay: function (el) { openOverlay('shiftDay', { date: el.dataset.date }); },
  tripNew: function (el) { openOverlay('trip', { date: el.dataset.date }); },
  dismissAlerts: function () { U.alerts = []; document.title = 'Focus Flow'; render(); }
});
Object.assign(F, {
  shiftDay: function (f) {
    var date = f.dataset.date, m = pressed(f, 'shmode')[0] || 'usual', s = D().settings; s.shiftOverrides = s.shiftOverrides || {};
    if (m === 'usual') delete s.shiftOverrides[date];
    else if (m === 'off') s.shiftOverrides[date] = { off: true };
    else s.shiftOverrides[date] = { off: false, a: val(f, 'sdA') || '08:00', b: val(f, 'sdB') || '18:00' };
    var cut = addDays(todayStr(), -60); Object.keys(s.shiftOverrides).forEach(function (k) { if (k < cut) delete s.shiftOverrides[k]; });
    save(); toast('Shift updated'); closeOverlay();
  }
});
