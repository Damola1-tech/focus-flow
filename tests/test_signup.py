import asyncio, sys, json; sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import *
import os
FILE = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'dist', 'FocusFlow.html'))
R = []
def ok(n, c, extra=''): R.append(('PASS ' if c else 'FAIL ') + n + (' ' + str(extra) if (extra and not c) else ''))
async def setup(p, goal='Read more'):
    await p.goto(FILE); await p.wait_for_timeout(1000)
    await p.click('text=Continue'); await p.wait_for_timeout(200)
    await p.click('text=Finish setup'); await p.wait_for_timeout(1500)
    if await p.locator('text=Skip for now').count(): await p.click('text=Skip for now'); await p.wait_for_timeout(500)
async def main():
    async with async_playwright() as pw:
        b = await launch(pw); w = World()
        # ---- user 1: new account
        p1 = await w.new_page(b, 'u1', 'Damola')
        await setup(p1)
        txt = await p1.inner_text('body')
        ok('c1 home after setup (checkin or home)', 'Damola' in txt or 'mood' in txt.lower() or 'energy' in txt.lower(), txt[:200])
        ok('c2 core doc written', 'data/users/u1/core' in w.db, list(w.db))
        ok('c3 people dir has u1', w.db.get('people/u1', {}).get('name') == 'Damola')
        print(txt[:300]); await p1.screenshot(path='/tmp/s_home.png')
        # ---- reload keeps data
        await p1.reload(); await p1.wait_for_timeout(1500)
        t2 = await p1.inner_text('body'); ok('c4 reload shows profile not wizard', 'Set up your profile' not in t2, t2[:150])
        # ---- user 2 new account
        p2 = await w.new_page(b, 'u2', 'Aunty Bisi'); await setup(p2)
        ok('c5 u2 in directory', 'people/u2' in w.db)
        print(R[-5:]); print(p1.errs, p2.errs)
        await b.close()
    print('\n'.join(R))
if __name__ == "__main__": asyncio.run(main())
