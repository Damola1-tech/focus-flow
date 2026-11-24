"""Runs the real app against a pretend Supabase (mock_supabase.js): sign-up, family code, save, reload, sharing, sign-out."""
import asyncio, json, os, re, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright
PORT = 8799; BASE = f'http://localhost:{PORT}'; R = []
def ok(n, c, extra=''): R.append(('PASS ' if c else 'FAIL ') + n + (' ' + str(extra) if (extra and not c) else ''))
def dump(): return json.load(urllib.request.urlopen(BASE + '/__db'))
async def newpage(b):
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}); p = await ctx.new_page(); p.errs = []
    p.on('pageerror', lambda e: p.errs.append(str(e)))
    await p.route(re.compile(r'https://fonts\..*'), lambda r: r.abort()); return p
async def signup(p, name, email, code):
    await p.goto(BASE); await p.wait_for_selector('#sbEmail'); await p.click('text=Create an account')
    await p.fill('#sbName', name); await p.fill('#sbEmail', email); await p.fill('#sbPass', 'secret12'); await p.fill('#sbCode', code)
    await p.click('button[type=submit]'); await p.wait_for_timeout(1500)
async def main():
    srv = subprocess.Popen(['node', os.path.join(os.path.dirname(__file__), 'mock_supabase.js')], env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE)
    srv.stdout.readline()
    try:
        async with async_playwright() as pw:
            b = await pw.chromium.launch(args=['--no-sandbox'])
            p1 = await newpage(b); await p1.goto(BASE); await p1.wait_for_selector('#sbEmail')
            ok('s1 sign-in screen shown first', 'Sign in' in await p1.inner_text('body'))
            await p1.click('text=Create an account'); await p1.fill('#sbName', 'Damola'); await p1.fill('#sbEmail', 'd@x.com'); await p1.fill('#sbPass', 'secret12'); await p1.fill('#sbCode', 'WRONG')
            await p1.click('button[type=submit]'); await p1.wait_for_timeout(800)
            ok('s2 wrong family code refused', 'family code is not right' in (await p1.inner_text('body')), (await p1.inner_text('body'))[:200])
            await p1.fill('#sbPass', 'secret12'); await p1.fill('#sbCode', ' abc123 '); await p1.click('button[type=submit]'); await p1.wait_for_timeout(2500)
            t = await p1.inner_text('body'); ok('s3 account created, setup wizard shown', 'Continue' in t or 'Finish setup' in t, t[:200])
            await p1.click('text=Continue'); await p1.wait_for_timeout(200); await p1.click('text=Finish setup'); await p1.wait_for_timeout(2500)
            d = dump(); ok('s4 core doc saved for u1', 'data/users/u1/core' in d['docs'], list(d['docs']))
            ok('s5 people dir has u1', d['docs'].get('people/u1', {}).get('name') == 'Damola')
            ok('s6 time zone saved', bool(d['docs']['data/users/u1/core'].get('settings', {}).get('tz')), d['docs']['data/users/u1/core'].get('settings'))
            await p1.reload(); await p1.wait_for_timeout(2500); t = await p1.inner_text('body')
            ok('s7 reload stays signed in, no wizard', 'Finish setup' not in t and 'Sign in' not in t, t[:160])
            # second user, then a shared plan visible to both
            p2 = await newpage(b); await signup(p2, 'Aunty Bisi', 'b@x.com', 'abc123')
            await p2.click('text=Continue'); await p2.wait_for_timeout(200); await p2.click('text=Finish setup'); await p2.wait_for_timeout(2500)
            d = dump(); ok('s8 u2 has own core', 'data/users/u2/core' in d['docs'])
            ok('s9 u2 cannot read u1 personal data', not any(k.startswith('data/users/u1') for k in json.loads(await p2.evaluate("(async()=>{const r=await fetch('/rest/v1/docs?select=path,data&parent=eq.data%2Fusers%2Fu1',{headers:{apikey:'a',Authorization:'Bearer '+JSON.parse(localStorage.getItem('focusflow.sb.session')).access_token}});return JSON.stringify((await r.json()).map(x=>x.path))})()")))) 
            # a plan written on phone 1 reaches phone 2 through the server within a few seconds
            await p1.evaluate("(async()=>{const db=await claude.use('db'); await db.doc('plans/zz1').set({id:'zz1',title:'Family trip',owner:'u1'})})()")
            await p2.wait_for_timeout(8000)
            ok('s9b plan from phone 1 shows up on phone 2', bool(await p2.evaluate("!!(CLX.raw.plans && CLX.raw.plans.zz1)")))
            # settings: account card, push state, test alert, sign out
            await p1.evaluate("U.flow=null; U.overlay=null; renderOverlay()"); await p1.wait_for_timeout(200)
            await p1.evaluate("U.view='settings'; render()"); await p1.wait_for_timeout(600)
            s = await p1.inner_text('body'); ok('s10 settings shows signed-in email + sign out', 'd@x.com' in s and 'Sign out' in s, s[-400:])
            ok('s11 phone alerts section present', 'Phone alerts' in s)
            await p1.evaluate("A.sbPushTest()"); await p1.wait_for_timeout(600); ok('s12 test alert reaches server', dump()['tests'] == 1)
            ok('s13 no page errors', not p1.errs and not p2.errs, (p1.errs, p2.errs))
            await p1.evaluate("A.sbSignOut()"); await p1.wait_for_timeout(1500)
            ok('s14 sign out returns to sign-in screen', 'Sign in' in await p1.inner_text('body'))
            await p1.fill('#sbEmail', 'd@x.com'); await p1.fill('#sbPass', 'wrongpw1'); await p1.click('button[type=submit]'); await p1.wait_for_timeout(800)
            ok('s15 wrong password message', 'Wrong email or password' in await p1.inner_text('body'))
            await p1.fill('#sbPass', 'secret12'); await p1.click('button[type=submit]'); await p1.wait_for_timeout(2500)
            t = await p1.inner_text('body'); ok('s16 sign back in, data still there', 'Sign in' not in t and 'Finish setup' not in t, t[:160])
            await b.close()
    finally:
        srv.terminate()
    print('\n'.join(R)); print('FAILS:', sum(1 for r in R if r.startswith('FAIL')))
asyncio.run(main())
