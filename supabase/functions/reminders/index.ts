// @ts-nocheck
// Focus Flow reminder job. Called every minute by the schedule in cron.sql.
// Also answers the "Send a test alert" button (a signed-in person calls it with { test: true }).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import nodemailer from "npm:nodemailer@6.9.14";
import { dueReminders } from "./logic.js";

const env = (k: string) => Deno.env.get(k) || "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
if (env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")) {
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
}
const mailer = env("SMTP_HOST")
  ? nodemailer.createTransport({ host: env("SMTP_HOST"), port: +(env("SMTP_PORT") || 465), secure: +(env("SMTP_PORT") || 465) === 465, auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") } })
  : null;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" } });

async function deliver(uid: string, settings: any, items: { key: string; title: string; body: string }[], force = false) {
  let sent = 0;
  const { data: subs } = await admin.from("push_subs").select("endpoint, sub").eq("user_id", uid);
  let email = "";
  if (settings.emailNotify || force) { const u = await admin.auth.admin.getUserById(uid); email = u.data?.user?.email || ""; }
  for (const it of items) {
    for (const s of subs || []) {
      try {
        await webpush.sendNotification(s.sub, JSON.stringify({ title: it.title, body: it.body, tag: it.key }), { TTL: 900 });
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_subs").delete().eq("endpoint", s.endpoint);
      }
    }
    if (email && mailer && (settings.emailNotify || force)) {
      try {
        await mailer.sendMail({ from: env("MAIL_FROM") || env("SMTP_USER"), to: email, subject: `Focus Flow: ${it.title}`, text: `${it.body}\n\nOpen Focus Flow to start.` });
        sent++;
      } catch (e) { console.error("mail failed", String(e)); }
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  const cron = req.headers.get("x-cron-secret");
  const isCron = env("CRON_SECRET") && cron === env("CRON_SECRET");

  // A signed-in person pressing "Send a test alert"
  if (!isCron) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(token);
    const uid = data?.user?.id;
    if (!uid) return json({ error: "not signed in" }, 401);
    const { data: core } = await admin.from("docs").select("data").eq("path", `data/users/${uid}/core`).maybeSingle();
    const sent = await deliver(uid, core?.data?.settings || {}, [{ key: `test:${Date.now()}`, title: "Focus Flow test", body: "Alerts are working on this phone." }], true);
    return json({ sent });
  }

  const now = Date.now();
  const months = new Set<string>();
  for (const off of [-1, 0, 1]) months.add(new Date(now + off * 86400000).toISOString().slice(0, 7));
  const { data: cores } = await admin.from("docs").select("path, data").like("path", "data/users/%/core");
  const taskDocs: Record<string, any[]> = {};
  for (const m of months) {
    const { data } = await admin.from("docs").select("path, data").like("path", `data/users/%/tasks-${m}`);
    for (const r of data || []) { const uid = r.path.split("/")[2]; (taskDocs[uid] ||= []).push(...(r.data?.tasks || [])); }
  }
  let total = 0;
  for (const c of cores || []) {
    const uid = c.path.split("/")[2];
    const due = dueReminders({ core: c.data, tasks: taskDocs[uid] || [], nowMs: now });
    if (!due.length) continue;
    const fresh = [];
    for (const it of due) {
      const key = `${uid}:${it.key}`;
      const { error } = await admin.from("sent_reminders").insert({ key });   // fails if already sent
      if (!error) fresh.push(it);
    }
    if (fresh.length) total += await deliver(uid, c.data?.settings || {}, fresh);
  }
  await admin.from("sent_reminders").delete().lt("at", new Date(now - 3 * 86400000).toISOString());
  return json({ ok: true, sent: total });
});
