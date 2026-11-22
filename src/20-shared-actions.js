/* ---------- shared plan actions ---------- */
function planAndTask(el) {
  var pl = planById(el.dataset.plan), st = pl && pl.tasks.filter(function (t) { return t.id === el.dataset.id; })[0];
  return { pl: pl, st: st };
}
Object.assign(A, {
  spNew: function () { openOverlay('spNew'); },
  spOpen: function (el) { U.view = 'shared'; U.plan = el.dataset.id; render(); window.scrollTo(0, 0); },
  spBack: function () { U.plan = null; render(); window.scrollTo(0, 0); },
  spAccept: function (el) {
    var pl = planById(el.dataset.id), m = pl && pl.members.filter(function (x) { return x.id === S.activeId; })[0];
    if (!m) return; m.status = 'joined'; m.at = Date.now(); save(); U.view = 'shared'; U.plan = pl.id; toast('You joined ' + pl.title); render(); window.scrollTo(0, 0);
  },
  spDecline: function (el) {
    var pl = planById(el.dataset.id); if (!pl) return;
    pl.members = pl.members.filter(function (m) { return m.id !== S.activeId; }); save(); toast('Invitation declined'); render();
  },
  spToggle: function (el) {
    var x = planAndTask(el); if (!x.st) return;
    var me = S.activeId; if (!(x.pl.ownerId === me || x.st.assigneeId === me || !x.st.assigneeId)) return;
    setSharedDone(x.pl, x.st, !x.st.done); render();
  },
  spAddMine: function (el) {
    var x = planAndTask(el); if (!x.st) return;
    var date = el.dataset.when === 'due' && x.st.due ? x.st.due : todayStr();
    if (addToMyDay(x.pl, x.st, date)) toast('Added to ' + (date === todayStr() ? 'today' : fmtDate(date, { day: 'numeric', month: 'short' }))); render();
  },
  spTaskNew: function (el) { openOverlay('spTask', { planId: el.dataset.plan }); },
  spDelTask: function (el) {
    var x = planAndTask(el); if (!x.st) return;
    if (!(x.pl.ownerId === S.activeId || x.st.createdBy === S.activeId)) return;
    x.pl.tasks = x.pl.tasks.filter(function (t) { return t.id !== x.st.id; }); unlinkShared(x.pl.id, x.st.id); save(); render();
  },
  spEditPlan: function (el) { openOverlay('spEdit', { planId: el.dataset.plan }); },
  spRemove: function (el) {
    var pl = planById(el.dataset.plan); if (!pl || pl.ownerId !== S.activeId || el.dataset.id === pl.ownerId) return;
    removeMember(pl, el.dataset.id); toast('Done'); renderOverlay(); render();
  },
  spLeave: function (el) { openOverlay('confirm', { text: 'Leave this plan? Tasks given to you become open for anyone.', yes: 'spLeaveYes', id: el.dataset.id }); },
  spLeaveYes: function (el) { var pl = planById(el.dataset.id); if (pl && pl.ownerId !== S.activeId) removeMember(pl, S.activeId); U.plan = null; closeOverlay(); },
  spDelPlan: function (el) { openOverlay('confirm', { text: 'Delete this plan for everyone in it? Personal copies of its tasks stay in each person\'s own list.', yes: 'spDelPlanYes', id: el.dataset.id }); },
  spDelPlanYes: function (el) {
    var pl = planById(el.dataset.id); if (!pl || pl.ownerId !== S.activeId) { closeOverlay(); return; }
    unlinkShared(pl.id); S.shared = S.shared.filter(function (p) { return p.id !== pl.id; }); save(); U.plan = null; closeOverlay();
  }
});
Object.assign(F, {
  spNew: function (f) {
    var title = val(f, 'spTitle').trim(); if (!title) return;
    var kind = val(f, 'spKind') || 'other', me = S.activeId, now = Date.now();
    var pl = { id: uid(), title: title, kind: kind, deadline: val(f, 'spDeadline') || '', ownerId: me, members: [{ id: me, status: 'joined', at: now }], tasks: [], createdAt: now };
    pressed(f, 'inv').forEach(function (pid) { pl.members.push({ id: pid, status: 'invited', at: now }); });
    if (checked(f, 'spStarters') && STARTERS[kind]) STARTERS[kind].forEach(function (t, i) { pl.tasks.push({ ord: now + i + 1, id: uid(), title: t, assigneeId: '', due: '', note: '', done: false, doneAt: null, doneBy: '', createdBy: me }); });
    if (!CL.on) quickPeople(val(f, 'spPeople'), pl);
    S.shared.push(pl); save(); U.view = 'shared'; U.plan = pl.id; toast(pl.members.length > 1 ? 'Plan created. Invitations sent' : 'Plan created'); closeOverlay();
  },
  spTask: function (f) {
    var pl = planById(f.dataset.plan), title = val(f, 'stTitle').trim(); if (!pl || !title) return;
    var who = val(f, 'stWho'); if (who && !isJoined(pl, who)) who = '';
    pl.tasks.push({ ord: Date.now(), id: uid(), title: title, assigneeId: who, due: val(f, 'stDue') || '', note: val(f, 'stNote').trim(), done: false, doneAt: null, doneBy: '', createdBy: S.activeId });
    save(); toast('Task added'); closeOverlay();
  },
  spEdit: function (f) {
    var pl = planById(f.dataset.plan); if (!pl || pl.ownerId !== S.activeId) return;
    pl.title = val(f, 'seTitle').trim() || pl.title; pl.deadline = val(f, 'seDeadline') || '';
    pressed(f, 'inv').forEach(function (pid) { if (!pl.members.some(function (m) { return m.id === pid; })) pl.members.push({ id: pid, status: 'invited', at: Date.now() }); });
    var added = CL.on ? 0 : quickPeople(val(f, 'sePeople'), pl), pr = pressed(f, 'inv').length;
    save(); toast(added || pr ? 'Invitation sent' : 'Plan saved'); closeOverlay();
  }
});

