// @ts-nocheck
// Focus Flow server job: reminders and plan news every minute, plus invites, test alerts and account deletion.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import nodemailer from "npm:nodemailer@6.9.14";
import { runCron, handleTest, handleInvite, handleDelete, handleCoach, handleCoachStatus, toOpenAI, fromOpenAI } from "./handlers.js";

// Public values have built-in defaults; only the three real secrets (VAPID_PRIVATE_KEY, SMTP_USER, SMTP_PASS) need to be set.
const DEFAULTS: Record<string, string> = {
  SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465",
  SITE_URL: "https://damola1-tech.github.io/focus-flow/",
  VAPID_PUBLIC_KEY: "BAi4ponmrzVygIDtjjYk7ZTy5MI4IAuOD0lOyepzoEHK7gaO-GRyf0Us3rQmghih-fEmcaPVjOW5CplBo_uKaHs",
};
const env = (k: string) => Deno.env.get(k) || DEFAULTS[k] || "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
if (env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")) webpush.setVapidDetails(env("VAPID_SUBJECT") || ("mailto:" + (env("SMTP_USER") || "admin@example.com")), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
const transport = env("SMTP_HOST") ? nodemailer.createTransport({ host: env("SMTP_HOST"), port: +(env("SMTP_PORT") || 465), secure: +(env("SMTP_PORT") || 465) === 465, auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") } }) : null;

const mail = { enabled: !!transport, send: ({ to, subject, text }) => transport.sendMail({ from: env("MAIL_FROM") || ("Focus Flow <" + env("SMTP_USER") + ">"), to, subject, text }) };
const push = { send: (sub, payload) => webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 900 }) };
// The AI helper. Works with a free Google Gemini key by default (AI_API_KEY), or any OpenAI-compatible service
// (AI_BASE_URL + AI_MODEL, for example Groq), or an Anthropic key (ANTHROPIC_API_KEY).
const ai = {
  enabled: !!(env("ANTHROPIC_API_KEY") || env("AI_API_KEY")),
  complete: async ({ messages, tools, system }) => {
    if (env("ANTHROPIC_API_KEY")) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: AbortSignal.timeout(50000),
        headers: { "content-type": "application/json", "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: env("AI_MODEL") || "claude-sonnet-5-5", max_tokens: 700, system, messages, ...(tools.length ? { tools } : {}) }),
      });
      if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text()).slice(0, 200));
      return await res.json();
    }
    const base = (env("AI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/+$/, "");
    const t = toOpenAI(system, messages, tools);
    const res = await fetch(base + "/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(50000),
      headers: { "content-type": "application/json", authorization: "Bearer " + env("AI_API_KEY") },
      body: JSON.stringify({ model: env("AI_MODEL") || "gemini-flash-latest", max_tokens: 700, ...t }),
    });
    if (!res.ok) throw new Error("ai " + res.status + " " + (await res.text()).slice(0, 200));
    return fromOpenAI(await res.json());
  },
};
const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
const uidOf = (path: string) => path.split("/")[2];

const store = {
  async cores() { return ok(await admin.from("docs").select("path, data").like("path", "data/users/%/core")).map((r) => ({ uid: uidOf(r.path), data: r.data })); },
  async tasksFor(months: string[]) {
    const out: Record<string, any[]> = {};
    for (const m of months) for (const r of ok(await admin.from("docs").select("path, data").like("path", `data/users/%/tasks-${m}`))) (out[uidOf(r.path)] ||= []).push(...(r.data?.tasks || []));
    return out;
  },
  async recent(parents: string[], since: string) {
    return ok(await admin.from("docs").select("path, parent, data, updated_at").in("parent", parents).gt("updated_at", since)).map((r) => ({ path: r.path, parent: r.parent, data: r.data, updatedAt: Date.parse(r.updated_at) }));
  },
  async getDocs(paths: string[]) {
    const out: Record<string, any> = {}; if (!paths.length) return out;
    for (const r of ok(await admin.from("docs").select("path, data").in("path", paths))) out[r.path] = r.data;
    return out;
  },
  async insertDocIfMissing(path: string, parent: string, data: any) {
    const { error } = await admin.from("docs").insert({ path, parent, data });
    return !error;
  },
  async deleteDocs(paths: string[]) { for (let i = 0; i < paths.length; i += 100) ok(await admin.from("docs").delete().in("path", paths.slice(i, i + 100))); },
  async paths(parent: string, planId: string) { return ok(await admin.from("docs").select("path").eq("parent", parent).filter("data->>planId", "eq", planId)).map((r) => r.path); },
  async plansOwnedBy(uid: string) { return ok(await admin.from("docs").select("path").eq("parent", "plans").filter("data->>ownerId", "eq", uid)).map((r) => r.path.split("/")[1]); },
  async memberPaths(uid: string) { return ok(await admin.from("docs").select("path").eq("parent", "plan_members").filter("data->>uid", "eq", uid)).map((r) => r.path); },
  async personalPaths(uid: string) { return ok(await admin.from("docs").select("path").like("path", `data/users/${uid}/%`)).map((r) => r.path); },
  async claim(key: string) { const { error } = await admin.from("sent_reminders").insert({ key }); return !error; },
  async cleanup(before: string) { await admin.from("sent_reminders").delete().lt("at", before); },
  async subs(uid: string) { return ok(await admin.from("push_subs").select("endpoint, sub").eq("user_id", uid)); },
  async dropSub(endpoint: string) { await admin.from("push_subs").delete().eq("endpoint", endpoint); },
  async userEmail(uid: string) { const u = await admin.auth.admin.getUserById(uid); return u.data?.user?.email || ""; },
  async findUser(email: string) { const r = await admin.rpc("find_user_by_email", { e: email }); return r.data || null; },
  async deleteUser(uid: string) { const r = await admin.auth.admin.deleteUser(uid); if (r.error) throw new Error(r.error.message); },
  async inviteCount(uid: string, since: string) { const r = await admin.from("invites").select("token", { count: "exact", head: true }).eq("inviter", uid).gt("created_at", since); return r.count || 0; },
  async createInvite(i: any) { ok(await admin.from("invites").insert({ token: i.token, email: i.email, plan_id: i.planId, inviter: i.inviter })); },
  async aiUse(uid: string, day: string) { const r = await admin.rpc("bump_ai_usage", { u: uid, d: day }); if (r.error) throw new Error(r.error.message); return r.data; },
  async revokeInvite(token: string) { await admin.from("invites").update({ revoked: true }).eq("token", token); },
};
const deps = { store, mail, push, ai };
const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  try {
    const given = req.headers.get("x-cron-secret") || "";
    if (given) {
      // the schedule proves itself with a secret that lives only inside the database (app_config.cron_secret)
      const row = await admin.from("app_config").select("value").eq("key", "cron_secret").maybeSingle();
      if (row.data?.value && row.data.value === given) return json(await runCron(deps));
      return json({ error: "bad secret" }, 401);
    }
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(token);
    const uid = data?.user?.id;
    if (!uid) return json({ error: "not signed in" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === "test" || body.test) return json(await handleTest(deps, uid));
    if (body.action === "invite") { const r = await handleInvite(deps, uid, body, { SITE_URL: env("SITE_URL") }); return json(r.body, r.status); }
    if (body.action === "coachStatus") return json(await handleCoachStatus(deps, uid, { COACH_DAILY: env("COACH_DAILY") }));
    if (body.action === "coach") { const r = await handleCoach(deps, uid, body, { COACH_DAILY: env("COACH_DAILY") }); return json(r.body, r.status); }
    if (body.action === "deleteAccount") return json(await handleDelete(deps, uid));
    return json({ error: "unknown action" }, 400);
  } catch (e) { console.error(String(e)); return json({ error: "server error" }, 500); }
});
