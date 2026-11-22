import asyncio, json, re
from playwright.async_api import async_playwright
MOCK = r"""
(() => {
  const subs = [];
  const call = async (op, path, data) => JSON.parse(await window.__dbExec(JSON.stringify({op, path, data})));
  function docRef(path){ return { path, id: path.split('/').pop(),
    async get(){ const r = await call('get', path); return { exists: r!==null, data: () => r }; },
    async set(d){ await call('set', path, d); }, async update(d){ await call('update', path, d); }, async delete(){ await call('delete', path); } }; }
  async function refresh(s){ const rows = await call('list', s.path); const str = JSON.stringify(rows); if (str === s.last) return; s.last = str;
    s.cb({ docs: rows.map(r => ({ id: r.id, data: () => JSON.parse(JSON.stringify(r.data)) })), metadata: { fromCache: false } }); }
  const colRef = path => ({ path, doc: id => docRef(path + '/' + id), onSnapshot(cb, err){ const s = { path, cb, last: null }; subs.push(s); refresh(s); return () => { subs.splice(subs.indexOf(s),1); }; } });
  window.__dbChanged = () => subs.forEach(refresh);
  const user = { id: async () => window.__UID, me: async () => ({ name: window.__UNAME || '' }), can: async () => true, isOwner: async () => false, canEdit: async () => false };
  const db = { collection: colRef, doc: docRef };
  window.__samples = [];
  const sample = async (input, opts) => { window.__samples.push({ input, tools: !!(opts && opts.tools) }); const f = window.__sampleFn; return f ? await f(input, opts) : { text: 'Hello from the coach.' }; };
  sample.json = async (prompt, opts) => { window.__samples.push({ prompt }); const f = window.__jsonFn; return f ? await f(prompt) : { say: 'Done.', changes: [], add: [] }; };
  sample.limits = async () => ({ tools: true, images: false });
  window.claude = { use: async (name) => ({ user, db, sample })[name] || null };
})();
"""
class World:
    def __init__(self): self.db = {}; self.pages = []
    def segs(self, p): return p.split('/')
    async def exec(self, raw):
        r = json.loads(raw); op, path, data = r['op'], r['path'], r.get('data')
        if op == 'get': return json.dumps(self.db.get(path))
        if op == 'list':
            n = len(self.segs(path)) + 1; pre = path + '/'
            rows = [{'id': k.split('/')[-1], 'data': v} for k, v in sorted(self.db.items()) if k.startswith(pre) and len(self.segs(k)) == n]
            return json.dumps(rows)
        if op in ('set', 'update'):
            self.db[path] = data if op == 'set' else {**self.db.get(path, {}), **data}
        if op == 'delete': self.db.pop(path, None)
        asyncio.get_event_loop().call_soon(lambda: asyncio.ensure_future(self.notify()))
        return json.dumps(True)
    async def notify(self):
        for p in self.pages:
            try: await p.evaluate("window.__dbChanged && window.__dbChanged()")
            except Exception: pass
    async def new_page(self, browser, uid=None, name='', viewport=(390, 844), cloud=True):
        ctx = await browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]})
        page = await ctx.new_page()
        errs = []; page.on('pageerror', lambda e: errs.append(str(e))); page.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' and 'fonts' not in m.text and 'ERR_' not in m.text and 'Failed to load resource' not in m.text else None)
        await page.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
        page.errs = errs
        if cloud:
            await page.expose_function('__dbExec', self.exec)
            await page.add_init_script(f"window.__UID={json.dumps(uid)};window.__UNAME={json.dumps(name)};" + MOCK)
            self.pages.append(page)
        return page
async def launch(pw): return await pw.chromium.launch(args=['--no-sandbox'])
