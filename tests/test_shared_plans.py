import asyncio, sys, json; sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import *
from test_signup import setup, ok, R, FILE
async def nav(p, v): await p.click(f'.side [data-a=nav][data-v={v}]'); await p.wait_for_timeout(300)
async def main():
    async with async_playwright() as pw:
        b = await launch(pw); w = World()
        p1 = await w.new_page(b, 'u1', 'Damola', (1100, 800)); await setup(p1)
        p2 = await w.new_page(b, 'u2', 'Aunty Bisi', (1100, 800)); await setup(p2)
        await nav(p1, 'shared'); print(await p1.eval_on_selector_all('main button', 'els=>els.map(e=>e.innerText.trim()+"|"+(e.dataset.a||""))'))
        await p1.click('main [data-a=spNew]'); await p1.wait_for_timeout(300)
        print(await p1.inner_text('.sheet'))
        await p1.fill('#spTitle', 'Road trip to Abuja')
        await p1.click('.sheet .chip:has-text("Aunty Bisi")')
        await p1.click('.sheet button[type=submit]'); await p1.wait_for_timeout(1500)
        ok('s1 plan docs written', any(k.startswith('plans/') for k in w.db) and any(k.startswith('plan_members/') for k in w.db) and any(k.startswith('plan_tasks/') for k in w.db), list(w.db))
        mem = [v for k, v in w.db.items() if k.startswith('plan_members/')]
        ok('s2 u2 invited', any(m['uid'] == 'u2' and m['status'] == 'invited' for m in mem), mem)
        await p2.wait_for_timeout(1500); await nav(p2, 'shared')
        t = await p2.inner_text('main'); ok('s3 u2 sees invite', 'Road trip to Abuja' in t and 'Accept' in t, t[:300])
        await p2.click('main [data-a=spAccept]'); await p2.wait_for_timeout(1500)
        mem = [v for k, v in w.db.items() if k.startswith('plan_members/')]
        ok('s4 u2 joined', any(m['uid'] == 'u2' and m['status'] == 'joined' for m in mem), mem)
        await p1.wait_for_timeout(1200); await nav(p1, 'shared')
        t = await p1.inner_text('main'); ok('s5 owner card shows 2 avatars', await p1.locator('main .avs .av').count() >= 2, t[:200])
        # open plan on u2, tick a task
        print('\n'.join(R)); print('P2:', (await p2.inner_text('main'))[:400]); print({k:v for k,v in w.db.items() if k.startswith('plan_m')})
        print(await p2.eval_on_selector_all('main button', 'els=>els.map(e=>e.innerText.trim()+"|"+(e.dataset.a||""))'))
        await p2.click('main [data-a=spToggle] >> nth=0'); await p2.wait_for_timeout(1500)
        done = [v for k, v in w.db.items() if k.startswith('plan_tasks/') and v['done']]
        ok('s6 u2 tick written', len(done) == 1 and done[0]['doneBy'] == 'u2', done)
        await p1.wait_for_timeout(1200)
        await p1.click('main [data-a=spOpen]'); await p1.wait_for_timeout(500)
        t = await p1.inner_text('main'); ok('s7 owner sees progress', '1 of' in t or '%' in t, t[:300])
        print(p1.errs, p2.errs)
        await b.close()
    print('\n'.join(R))
asyncio.run(main())
