import { dueReminders, dueNudges, localNow, inQuiet, fmt12 } from '../supabase/functions/focusflow/logic.js';
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x))); if (!c) fails++; };
// 08:00 in Lagos (UTC+1) on 24 Nov 2026 is 07:00 UTC
const at = (h, m) => Date.UTC(2026, 10, 24, h - 1, m);
const core = (o = {}) => ({ settings: { tz: 'Africa/Lagos', remindStart: 10, quietFrom: '22:00', quietTo: '07:00', ...o }, reminders: [], active: null });
const task = (o = {}) => ({ id: 't1', title: 'Write report', date: '2026-11-24', time: '09:00', status: 'todo', ...o });
ok('l1 local time uses the person\'s zone', JSON.stringify(localNow(Date.UTC(2026, 10, 24, 7, 30), 'Africa/Lagos')) === '{"date":"2026-11-24","min":510}', localNow(Date.UTC(2026, 10, 24, 7, 30), 'Africa/Lagos'));
ok('l2 midnight rolls the date in that zone', localNow(Date.UTC(2026, 10, 24, 23, 30), 'Africa/Lagos').date === '2026-11-25');
ok('l3 nothing 30 minutes before', dueReminders({ core: core(), tasks: [task()], nowMs: at(8, 30) }).length === 0);
let r = dueReminders({ core: core(), tasks: [task()], nowMs: at(8, 51) });
ok('l4 starting-soon inside the 10 minute window', r.length === 1 && r[0].title === 'Starting soon' && /9:00 AM/.test(r[0].body), r);
ok('l5 remindStart 0 switches it off', dueReminders({ core: core({ remindStart: 0 }), tasks: [task()], nowMs: at(8, 51) }).length === 0);
r = dueReminders({ core: core(), tasks: [task()], nowMs: at(9, 15) });
ok('l6 late nudge 10 to 45 min after', r.length === 1 && r[0].key.startsWith('l:'), r);
ok('l7 no late nudge if that task is running', dueReminders({ core: { ...core(), active: { taskId: 't1' } }, tasks: [task()], nowMs: at(9, 15) }).length === 0);
ok('l8 done tasks are skipped', dueReminders({ core: core(), tasks: [task({ status: 'done' })], nowMs: at(8, 55) }).length === 0);
ok('l9 other days are skipped', dueReminders({ core: core(), tasks: [task({ date: '2026-11-25' })], nowMs: at(8, 55) }).length === 0);
ok('l10 quiet hours still let a start time the person chose through', dueReminders({ core: core({ quietFrom: '08:00', quietTo: '10:00' }), tasks: [task()], nowMs: at(8, 55) }).length === 1);
ok('l10b quiet hours hold back the late nag', dueReminders({ core: core({ quietFrom: '08:00', quietTo: '10:00' }), tasks: [task()], nowMs: at(9, 15) }).length === 0);
ok('l10c a pause reminder arrives during quiet hours', dueReminders({ core: { ...core({ quietFrom: '08:00', quietTo: '10:00' }), reminders: [{ id: 'q1', at: at(8, 58), text: 'back?', fired: false }] }, tasks: [], nowMs: at(9, 0) }).length === 1);
ok('l11 quiet hours across midnight', inQuiet({ quietFrom: '22:00', quietTo: '07:00' }, 23 * 60) && inQuiet({ quietFrom: '22:00', quietTo: '07:00' }, 6 * 60) && !inQuiet({ quietFrom: '22:00', quietTo: '07:00' }, 12 * 60));
const k1 = dueReminders({ core: core(), tasks: [task()], nowMs: at(8, 51) })[0].key, k2 = dueReminders({ core: core(), tasks: [task()], nowMs: at(8, 58) })[0].key;
ok('l12 same task gives the same key all window (so it is sent once)', k1 === k2, [k1, k2]);
r = dueReminders({ core: { ...core(), reminders: [{ id: 'r1', at: at(8, 0), text: 'Ready to get back to Reading?', fired: false }] }, tasks: [], nowMs: at(8, 2) });
ok('l13 saved return reminder is sent', r.length === 1 && r[0].body.includes('get back'), r);
ok('l14 a reminder the app already showed is still sent to the phone (recent)', dueReminders({ core: { ...core(), reminders: [{ id: 'r1', at: at(8, 0), text: 'x', fired: true }] }, tasks: [], nowMs: at(8, 2) }).length === 1);
ok('l14b but not an old shown one', dueReminders({ core: { ...core(), reminders: [{ id: 'r1', at: at(8, 0), text: 'x', fired: true }] }, tasks: [], nowMs: at(8, 30) }).length === 0);
ok('l15 12-hour format', fmt12('00:05') === '12:05 AM' && fmt12('13:30') === '1:30 PM' && fmt12('12:00') === '12:00 PM');
ok('l16 bad time zone does not crash', Array.isArray(dueReminders({ core: core({ tz: 'Nope/Zone' }), tasks: [task()], nowMs: at(8, 51) })));

// ---- nudges: morning, evening, weekly (Sunday), monthly (1st) ----
const atD = (y, mo, d, h, m) => Date.UTC(y, mo - 1, d, h - 1, m);   // local Lagos time
const T = (id, date, status = 'todo', time = '') => ({ id, title: id, date, time, status });
let n = dueNudges({ core: core(), tasks: [T('a', '2026-11-24', 'todo', '09:30'), T('b', '2026-11-24')], nowMs: atD(2026, 11, 24, 8, 3) });
ok('n1 morning message at 08:00 window with count and first time', n.length === 1 && n[0].key === 'n:am:2026-11-24' && /2 tasks/.test(n[0].body) && /9:30 AM/.test(n[0].body), n);
ok('n2 not before the window', dueNudges({ core: core(), tasks: [], nowMs: atD(2026, 11, 24, 7, 59) }).length === 0);
ok('n3 not after the 10 minute window', dueNudges({ core: core(), tasks: [], nowMs: atD(2026, 11, 24, 8, 11) }).length === 0);
ok('n4 morning can be switched off', dueNudges({ core: core({ morningAt: '' }), tasks: [], nowMs: atD(2026, 11, 24, 8, 3) }).length === 0);
ok('n5 empty day still nudges', /Nothing is planned/.test(dueNudges({ core: core(), tasks: [], nowMs: atD(2026, 11, 24, 8, 3) })[0].body));
n = dueNudges({ core: core(), tasks: [T('a', '2026-11-24', 'done'), T('b', '2026-11-24', 'todo'), T('c', '2026-11-24', 'cancelled'), T('d', '2026-11-25')], nowMs: atD(2026, 11, 24, 20, 5) });
ok('n6 evening review counts done of planned (cancelled ignored) and tomorrow', n.length === 1 && /1 of 2/.test(n[0].body) && /1 planned for tomorrow/.test(n[0].body), n);
ok('n7 evening respects quiet hours', dueNudges({ core: core({ quietFrom: '19:00', quietTo: '21:00' }), tasks: [], nowMs: atD(2026, 11, 24, 20, 5) }).length === 0);
// 2026-11-29 is a Sunday
n = dueNudges({ core: core(), tasks: [T('a', '2026-11-23', 'done'), T('b', '2026-11-25', 'done'), T('c', '2026-11-27'), T('d', '2026-11-22', 'done')], nowMs: atD(2026, 11, 29, 19, 2) });
ok('n8 weekly report on Sunday 19:00 covers the last 7 days only', n.length === 1 && n[0].key === 'n:wk:2026-11-29' && /2 of 3/.test(n[0].body), n);
ok('n9 no weekly report on a Monday', dueNudges({ core: core(), tasks: [], nowMs: atD(2026, 11, 30, 19, 2) }).length === 0);
ok('n10 weekly can be switched off', dueNudges({ core: core({ weekly: false }), tasks: [], nowMs: atD(2026, 11, 29, 19, 2) }).length === 0);
n = dueNudges({ core: core(), tasks: [T('a', '2026-11-30', 'done'), T('b', '2026-11-12', 'done'), T('c', '2026-11-13'), T('d', '2026-12-01')], nowMs: atD(2026, 12, 1, 9, 4) });
ok('n11 monthly report on the 1st counts last month', n.length === 1 && n[0].key === 'n:mo:2026-11' && /2 of 3/.test(n[0].body), n);
ok('n12 monthly across a year end', dueNudges({ core: core(), tasks: [T('a', '2026-12-30', 'done')], nowMs: atD(2027, 1, 1, 9, 4) })[0].key === 'n:mo:2026-12');
ok('n13 same key for the whole window (sent once)', dueNudges({ core: core(), tasks: [], nowMs: atD(2026, 11, 24, 8, 1) })[0].key === dueNudges({ core: core(), tasks: [], nowMs: atD(2026, 11, 24, 8, 9) })[0].key);
ok('n14 bad time zone does not crash', Array.isArray(dueNudges({ core: core({ tz: 'Nope/Zone' }), tasks: [], nowMs: atD(2026, 11, 24, 8, 3) })));
console.log('FAILS:', fails); process.exit(fails ? 1 : 0);
