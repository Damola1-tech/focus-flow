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
            p3 = await newpage(b); await p3.goto(BASE + '/?code=abc123'); await p3.wait_for_selector('#sbCode')
            ok('s9a invite link opens Create account with the code filled in', await p3.input_value('#sbCode') == 'abc123' and 'Create your account' in await p3.inner_text('body'))
            # a plan written on phone 1 reaches phone 2 through the server within a few seconds
            await p1.evaluate("(async()=>{const db=await claude.use('db'); await db.doc('plans/zz1').set({id:'zz1',title:'Family trip',owner:'u1'})})()")
            await p2.wait_for_timeout(8000)
            ok('s9b plan from phone 1 shows up on phone 2', bool(await p2.evaluate("!!(CLX.raw.plans && CLX.raw.plans.zz1)")))
            await p1.evaluate("U.flow=null; U.overlay=null; U.view='home'; SB.pushState='off'; SB.pushAsked=true; render()"); await p1.wait_for_timeout(300)
            ok('s9c home nudges to turn on phone alerts', 'Turn on phone alerts' in await p1.inner_text('body'))
            await p1.evaluate("A.sbPushHide()"); await p1.wait_for_timeout(300)
            ok('s9d the nudge can be dismissed', 'Turn on phone alerts' not in await p1.inner_text('body'))
            # the AI coach, through the server
            ok('s9e coach is available when the server has a key', await p1.evaluate("AI.available === true"))
            await p1.evaluate("U.flow=null; U.overlay=null; U.view='coach'; render()"); await p1.wait_for_timeout(300)
            await p1.fill('#coachBox', 'What should I do next?'); await p1.click('form[data-f=coach] button[type=submit]'); await p1.wait_for_timeout(1500)
            ok('s9f coach answers', 'Start with the most important task' in await p1.inner_text('body'), (await p1.inner_text('body'))[-300:])
            await p1.wait_for_timeout(800); await p1.evaluate("sendCoach('Add a 20 minute walk at 5pm')"); await p1.wait_for_timeout(2500)
            t = await p1.inner_text('body'); ok('s9g coach used a tool and the task exists', 'Done, I added it' in t and await p1.evaluate("tasks().some(function(x){return x.title==='Evening walk'})"), t[-300:])
            r = await p1.evaluate("AI.fn.json('Reply with ONLY a JSON object: x')"); ok('s9h json helper parses the reply', r.get('say') == 'Kept it light.', r)
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
            # ---- invite link from an email
            p4 = await newpage(b); await p4.goto(BASE + '/?invite=goodtok'); await p4.wait_for_selector('#sbEmail')
            t = await p4.inner_text('body')
            ok('v1 invite link shows the invited email, locked, and no family code box', await p4.input_value('#sbEmail') == 'invitee@x.com' and await p4.get_attribute('#sbEmail', 'readonly') is not None and await p4.locator('#sbCode').count() == 0 and 'invited' in t, t[:200])
            await p4.fill('#sbName', 'Invitee'); await p4.fill('#sbPass', 'secret12'); await p4.click('button[type=submit]'); await p4.wait_for_timeout(2500)
            ok('v2 account created from the invite alone', 'Finish setup' in await p4.inner_text('body') or 'Continue' in await p4.inner_text('body'))
            p5 = await newpage(b); await p5.goto(BASE + '/?invite=deadtok'); await p5.wait_for_selector('#sbEmail')
            ok('v3 a bad invite link says so and falls back to sign in', 'no longer valid' in await p5.inner_text('body') and 'Sign in' in await p5.inner_text('body'))
            # ---- password reset link
            p6 = await newpage(b); await p6.goto(BASE + '/#access_token=tok.u2&refresh_token=ref.u2&expires_in=3600&type=recovery'); await p6.wait_for_selector('#sbPass2')
            ok('w1 reset link opens the choose-a-new-password screen', 'Choose a new password' in await p6.inner_text('body') and '#' not in p6.url.split('/')[-1])
            await p6.fill('#sbPass', 'brandnew1'); await p6.fill('#sbPass2', 'different1'); await p6.click('button[type=submit]'); await p6.wait_for_timeout(500)
            ok('w2 mismatched passwords are caught', 'not the same' in await p6.inner_text('body'))
            await p6.fill('#sbPass', 'brandnew1'); await p6.fill('#sbPass2', 'brandnew1'); await p6.click('button[type=submit]'); await p6.wait_for_timeout(2500)
            ok('w3 after saving, the person is in the app', await p6.locator('#sbPass').count() == 0 and 'Choose a new password' not in await p6.inner_text('body'))
            ok('w4 the server has the new password', dump()['users']['u2']['pw'] == 'brandnew1')
            p7 = await newpage(b); await p7.goto(BASE + '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'); await p7.wait_for_selector('#sbEmail')
            ok('w5 an expired reset link explains itself', 'expired' in await p7.inner_text('body'))
            # ---- invite by email from a plan
            await p1.evaluate("U.flow=null; U.overlay=null; renderOverlay()")
            h = await p1.evaluate("sbInviteBox({id:'plX'})"); ok('x1 plan owner gets an invite-by-email box', 'invEmails' in h and 'plX' in h)
            await p1.evaluate("document.body.insertAdjacentHTML('beforeend','<textarea id=invEmails>a@x.com, b@y.com bad</textarea>')")
            await p1.evaluate("A.sbInviteEmail({dataset:{plan:'plX'}})"); await p1.wait_for_timeout(1500)
            f = [x for x in dump()['fn'] if x.get('action') == 'invite']
            ok('x2 invite request sent with the valid addresses only', len(f) == 1 and f[0]['emails'] == ['a@x.com', 'b@y.com'] and f[0]['planId'] == 'plX', f)
            # ---- delete the whole account
            await p1.evaluate("A.delProfileYes()"); await p1.wait_for_timeout(3500)
            d = dump(); ok('y1 account deletion asked the server to remove the sign-in', d['deleted'] == ['u1'] or 'u1' in d['deleted'], d['deleted'])
            ok('y2 their documents are gone', not any(k.startswith('data/users/u1') or k == 'people/u1' for k in d['docs']), [k for k in d['docs'] if 'u1' in k])
            ok('y3 and the app returns to the sign-in screen', 'Sign in' in await p1.inner_text('body'), (await p1.inner_text('body'))[:100])
            await b.close()
    finally:
        srv.terminate()
    print('\n'.join(R)); print('FAILS:', sum(1 for r in R if r.startswith('FAIL')))
asyncio.run(main())
