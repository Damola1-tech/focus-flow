// The server job's behaviour. It never touches Supabase directly: everything goes through `store`, `mail` and `push`,
// so tests can run it with simple stand-ins.
import { dueReminders, dueNudges, planEvents } from './logic.js';

// months to load: around today, and back far enough to cover last week and last month for the reports
const monthsAround = (now) => [...new Set([-34, -7, -1, 0, 1].map((o) => new Date(now + o * 86400000).toISOString().slice(0, 7)))];

// Sends one message to one person by phone alert and/or email. Returns how many went out.
export async function deliver({ store, mail, push }, uid, settings, items, { forceEmail = false } = {}) {
  let sent = 0;
  const subs = await store.subs(uid);
  const wantEmail = !!(settings && settings.emailNotify) || forceEmail;
  const email = wantEmail && mail.enabled ? await store.userEmail(uid) : '';
  for (const it of items) {
    for (const s of subs) {
      try { await push.send(s.sub, { title: it.title, body: it.body, tag: it.key, force: !!it.force }); sent++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await store.dropSub(s.endpoint); }
    }
    if (email && (!it.emailed)) {
      try { await mail.send({ to: email, subject: `Focus Flow: ${it.title}`, text: `${it.body}\n\nOpen Focus Flow to see more.` }); sent++; }
      catch (e) { console.error('mail failed', String(e)); }
    }
  }
  return sent;
}

// Runs every minute.
export async function runCron(deps, now = Date.now()) {
  const { store } = deps;
  let total = 0;
  const cores = await store.cores(), tasksByUser = await store.tasksFor(monthsAround(now)), settingsOf = {};
  for (const c of cores) {
    settingsOf[c.uid] = (c.data && c.data.settings) || {};
    const mine = tasksByUser[c.uid] || [];
    const due = dueReminders({ core: c.data, tasks: mine, nowMs: now }).concat(dueNudges({ core: c.data, tasks: mine, nowMs: now }));
    const fresh = [];
    for (const it of due) if (await store.claim(`${c.uid}:${it.key}`)) fresh.push(it);
    if (fresh.length) total += await deliver(deps, c.uid, settingsOf[c.uid], fresh);
  }
  // shared plan news
  const rows = await store.recent(['plan_tasks', 'plan_members'], new Date(now - 11 * 60000).toISOString());
  if (rows.length) {
    const planIds = [...new Set(rows.map((r) => r.data && r.data.planId).filter(Boolean))];
    const planDocs = await store.getDocs(planIds.map((p) => `plans/${p}`));
    const plans = {}; for (const p of planIds) if (planDocs[`plans/${p}`]) plans[p] = planDocs[`plans/${p}`];
    const uids = new Set(); rows.forEach((r) => { const d = r.data || {}; [d.uid, d.assigneeId, d.createdBy, d.doneBy].forEach((u) => u && uids.add(u)); });
    Object.values(plans).forEach((p) => p.ownerId && uids.add(p.ownerId));
    const people = await store.getDocs([...uids].map((u) => `people/${u}`));
    const names = {}; for (const u of uids) names[u] = people[`people/${u}`] && people[`people/${u}`].name;
    for (const ev of planEvents({ rows, plans, names, nowMs: now })) {
      if (!ev.to || !(await store.claim(`${ev.to}:${ev.key}`))) continue;
      const st = settingsOf[ev.to] || (await store.getDocs([`data/users/${ev.to}/core`]))[`data/users/${ev.to}/core`]?.settings || {};
      total += await deliver(deps, ev.to, st, [ev], { forceEmail: !!ev.always });
    }
  }
  await store.cleanup(new Date(now - 3 * 86400000).toISOString());
  return { ok: true, sent: total };
}

// "Send a test alert" button.
export async function handleTest(deps, uid) {
  const core = await store_get(deps.store, `data/users/${uid}/core`);
  const sent = await deliver(deps, uid, (core && core.settings) || {}, [{ key: `test:${Date.now()}`, title: 'Focus Flow test', body: 'Alerts are working on this phone.', force: true }], { forceEmail: true });
  return { sent };
}
const store_get = async (store, path) => (await store.getDocs([path]))[path];

// Invite people to a plan by email. Only the plan's owner may do this.
export async function handleInvite(deps, uid, { planId, emails, siteUrl }, env = {}) {
  const { store, mail } = deps;
  const plan = await store_get(store, `plans/${planId}`);
  if (!plan || plan.ownerId !== uid) return { status: 403, body: { error: 'Only the owner of a plan can invite people.' } };
  const base = (env.SITE_URL || siteUrl || '').replace(/[?#].*$/, '');
  if (!/^https:\/\//.test(base)) return { status: 400, body: { error: 'No website address to put in the invitation. Set SITE_URL on the server.' } };
  const list = [...new Set((emails || []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^\S+@\S+\.\S+$/.test(e)))].slice(0, 10);
  if (!list.length) return { status: 400, body: { error: 'No valid email addresses.' } };
  if ((await store.inviteCount(uid, new Date(Date.now() - 86400000).toISOString())) + list.length > 30) return { status: 429, body: { error: 'Too many invitations today. Try again tomorrow.' } };
  const me = (await store_get(store, `people/${uid}`)) || {}, results = [];
  for (const email of list) {
    const other = await store.findUser(email);
    if (other === uid) { results.push({ email, status: 'self' }); continue; }
    if (other) {
      const created = await store.insertDocIfMissing(`plan_members/${planId}_${other}`, 'plan_members', { planId, uid: other, status: 'invited', at: Date.now() });
      results.push({ email, status: created ? 'added' : 'already' });   // the invitation email goes out with the next one-minute check
      continue;
    }
    if (!mail.enabled) { results.push({ email, status: 'failed', reason: 'email is not set up on the server' }); continue; }
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    await store.createInvite({ token, email, planId, inviter: uid });
    try {
      await mail.send({ to: email, subject: `${me.name || 'Someone'} invited you to Focus Flow`,
        text: `${me.name || 'Someone'} invited you to plan together on "${plan.title}" in Focus Flow.\n\nCreate your account here (this link is only for ${email} and works for 14 days):\n${base}?invite=${token}\n\nIf you do not know ${me.name || 'this person'}, ignore this email.` });
      results.push({ email, status: 'emailed' });
    } catch (e) { await store.revokeInvite(token); results.push({ email, status: 'failed', reason: String(e).slice(0, 120) }); }
  }
  return { status: 200, body: { results } };
}

// Delete a whole account: their documents, plans they own, their place in other plans, and the sign-in.
export async function handleDelete(deps, uid) {
  const { store } = deps;
  const owned = await store.plansOwnedBy(uid);
  for (const pid of owned) {
    await store.deleteDocs(await store.paths('plan_tasks', pid));
    await store.deleteDocs(await store.paths('plan_members', pid));
    await store.deleteDocs([`plans/${pid}`]);
  }
  await store.deleteDocs(await store.memberPaths(uid));
  await store.deleteDocs(await store.personalPaths(uid));
  await store.deleteDocs([`people/${uid}`]);
  await store.deleteUser(uid);
  return { ok: true };
}
