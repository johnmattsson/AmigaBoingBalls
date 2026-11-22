# =============================================================================
# page.py — the page itself, checked in a real browser (Chrome, without a
# screen). Not part of the build: it needs Python 3 with Playwright
# (pip install playwright) and Chrome.
#
#     python3 test/page.py            (the published copy; "src" as an
#                                      argument tests the readable one)
#
# It opens the page and fails on any error the page reports while:
#   - it starts;
#   - every preset is shown in turn;
#   - the Megademo runs through all its parts, fast-forwarded;
#   - boing.measure() measures a scene;
#   - the preset menu chooses by mouse and by keys; the Balls slider goes
#     to 0 (every backdrop is drawn without balls); the Controls are dragged;
#     Defaults; rows are ghosted while they would change nothing;
#   - each effect window goes to full screen and back, and comes back to
#     exactly the same place;
#   - 220 random clicks, keys, drags, resizes and speed changes are made.
#
# The test browser has no graphics card, so this checks the WebGL drawing.
# CHROME=/path/to/chrome chooses the browser (default: Playwright's own).
# =============================================================================

import os, random, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PAGE = 'src/index.html' if 'src' in sys.argv[1:] else 'index.html'
PORT = 8791
failures = []

def check(ok, what):
    print(('ok    ' if ok else 'FAIL  ') + what)
    if not ok: failures.append(what)

server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', ROOT],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        chrome = os.environ.get('CHROME') or ('/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)
        browser = p.chromium.launch(executable_path=chrome, args=['--use-gl=angle', '--use-angle=swiftshader',
                                    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'])
        pg = browser.new_page(viewport={'width': 1200, 'height': 800})
        errors = []
        # (Without a graphics card WebGPU isn't there: the page says so and draws with WebGL. That is no error.)
        expected = ('No available adapters', 'Drawing with WebGL', 'stall')
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and not any(e in m.text for e in expected) else None)
        pg.on('pageerror', lambda e: errors.append('PAGE ERROR ' + str(e)))
        pg.on('response', lambda r: errors.append(f'HTTP {r.status} {r.url}') if r.status >= 400 else None)
        def no_errors(what):
            check(not errors, what + ('' if not errors else ': ' + ' | '.join(errors[:3])))
            errors.clear()
        balls_ok = "() => boing.physics.balls.every(b => Number.isFinite(b.position.x + b.position.y + b.position.z))"

        pg.goto(f'http://localhost:{PORT}/{PAGE}')
        pg.wait_for_timeout(4000)
        check(pg.evaluate("() => !document.getElementById('loading')?.isConnected && boing.physics.balls.length === 4"), 'the page starts with four balls')
        no_errors('no errors while starting')

        names = pg.evaluate("() => [...new Set(Object.keys(boing.presets))]")
        for name in names:
            pg.evaluate("(n) => boing.preset(n)", name)
            pg.wait_for_timeout(1200)
            check(pg.evaluate(balls_ok), f'preset {name}')
        no_errors('no errors in any preset')

        # (In a small window: this browser draws without a graphics card, and
        # the show's time only moves on with the frames drawn.)
        pg.set_viewport_size({'width': 660, 'height': 420})
        pg.evaluate("() => { boing.preset('megademo'); boing.settings.speed = 10; }")
        seen = set()
        for i in range(120):
            pg.wait_for_timeout(500)
            seen.add(pg.evaluate("() => boing.show.index"))
            if len(seen) == pg.evaluate("() => boing.presets.megademo.parts.length") and i > 4: break
        check(len(seen) == pg.evaluate("() => boing.presets.megademo.parts.length"), f'the Megademo showed all its parts ({len(seen)})')
        pg.evaluate("() => boing.preset('four')")
        pg.wait_for_timeout(500)
        check(pg.evaluate("() => !document.querySelector('.demo-curtain.drawn')"), 'the Megademo\'s curtain is open again')
        no_errors('no errors in the Megademo')

        pg.set_viewport_size({'width': 1700, 'height': 1000})
        report = pg.evaluate("async () => { const r = await boing.measure({ seconds: 1, warmUp: 0.5, only: ['four balls'] }); return [r.results.length, r.results[0].balls, boing.settings.preset]; }")
        check(report == [1, 4, 'four'], 'boing.measure() measures a scene and puts everything back')
        no_errors('no errors while measuring')

        # The preset menu, by mouse and by keys; 0 balls over every backdrop;
        # Defaults.
        pg.mouse.move(400, 300); pg.mouse.move(405, 305)
        name = lambda: pg.evaluate("() => document.querySelector('.preset-name').textContent")
        # (The bars fade after a few seconds without the mouse: wake them first.
        # Light presets only: with a thousand balls this browser, drawing
        # without a graphics card, takes seconds a frame.)
        def open_menu():
            pg.mouse.move(600, 500); pg.mouse.move(610, 505); pg.wait_for_timeout(700)
            pg.click('.preset-name'); pg.wait_for_timeout(200)
        open_menu()
        pg.click('.pull-item >> text=Cradle'); pg.wait_for_timeout(500)
        by_mouse = name()
        open_menu(); pg.keyboard.press('Home'); pg.keyboard.press('ArrowDown'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
        by_keys = name()
        open_menu(); pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        closed = pg.evaluate("() => !document.querySelector('.pull-menu.open')")
        check(by_mouse == 'Cradle' and by_keys == 'Classic 1984' and closed, 'the preset menu chooses by mouse and by keys, and closes')
        pg.evaluate("() => [...document.querySelectorAll('.panel button')].find(b => b.textContent.includes('Controls'))?.click()")
        pg.evaluate("() => [...document.querySelectorAll('.panel-tabs button')].find(b => b.textContent === 'Scene').click()")
        pg.evaluate("() => [...document.querySelectorAll('.panel-row')].find(r => r.querySelector('.panel-label')?.textContent === 'Balls').querySelector('input').focus()")
        pg.keyboard.press('Home')
        # (The physics, in its own thread, takes the balls away at its next step.)
        try:
            pg.wait_for_function("() => boing.physics.balls.length === 0 && boing.settings.balls === 0", timeout=5000); none = True
        except Exception:
            none = False
        pg.evaluate("() => [...document.querySelectorAll('.panel-tabs button')].find(b => b.textContent === 'Show').click()")
        # (A choice button's next choice: open its menu, click the one after the tick.)
        NEXT = "(l) => { const b = [...document.querySelectorAll('.panel-row')].find(r => r.querySelector('.panel-label')?.textContent === l).querySelector('.choice'); b.click(); const items = [...document.getElementById(b.getAttribute('aria-controls')).querySelectorAll('.pull-item')]; const at = items.findIndex(i => i.getAttribute('aria-checked') === 'true'); items[(at + 1) % items.length].click(); }"
        for i in range(8):
            pg.evaluate(NEXT, 'Backdrop')
            pg.wait_for_timeout(400)
        check(none, 'the Balls slider goes down to no balls at all')
        no_errors('no errors with no balls, over every backdrop')
        pg.evaluate("() => [...document.querySelectorAll('.panel-row')].find(r => r.querySelector('.panel-label')?.textContent === 'Glints').querySelector('input').focus()")
        pg.keyboard.press('End')
        t = pg.locator('.panel-window .panel-title').bounding_box()
        pg.mouse.move(t['x'] + 100, t['y'] + 6); pg.mouse.down(); pg.mouse.move(300, 200, steps=6); pg.mouse.up()
        moved = pg.evaluate("() => document.querySelector('.panel-window').getBoundingClientRect().left < 400")
        scene = "() => [boing.settings.preset, boing.physics.balls.length, boing.settings.gravity].join()"
        before = pg.evaluate(scene)
        pg.evaluate("() => [...document.querySelectorAll('.panel button')].find(b => b.textContent === 'Defaults').click()")
        pg.wait_for_timeout(800)
        check(moved and pg.evaluate("() => boing.settings.glints === 0.5 && !document.querySelector('.panel-window.moved') && (() => { const p = boing.presets[boing.settings.preset].settings ?? {}; return boing.settings.copper === Boolean(p.copper) && boing.settings.pixelSize === (p.pixelSize ?? 1); })()") and pg.evaluate(scene) == before,
              'the Controls can be dragged; Defaults puts the look and the Controls back, and the balls carry on')
        # Rows that would change nothing are ghosted (Music vol with the music
        # off), and the merged rows set both their settings.
        pg.evaluate("() => [...document.querySelectorAll('.panel-tabs button')].find(b => b.textContent === 'Show').click()")
        row = "(l) => [...document.querySelectorAll('.panel-row')].find(r => r.querySelector('.panel-label')?.textContent === l)"
        ghosted = lambda l: pg.evaluate("(l) => (" + row + ")(l).classList.contains('ghosted')", l)
        pg.evaluate("() => { boing.settings.music = false; }"); pg.evaluate(NEXT, 'Music')
        music_on = pg.evaluate("() => boing.settings.music") and not ghosted('Music vol')
        for i in range(5): pg.evaluate(NEXT, 'Music')
        music_off = not pg.evaluate("() => boing.settings.music") and ghosted('Music vol')
        pg.evaluate("() => { boing.settings.sound = true; boing.settings.wallSound = false; }")   # (Balls)
        pg.evaluate(NEXT, 'Boings')
        walls = pg.evaluate("() => boing.settings.sound && boing.settings.wallSound")
        check(music_on and music_off and walls, 'Music and Boings set their settings, and Music vol is ghosted while the music is off')
        pg.evaluate("() => [...document.querySelectorAll('.panel button')].find(b => b.classList.contains('window-close')).click()")

        pg.mouse.move(400, 300); pg.mouse.move(405, 305)
        pg.evaluate("() => [...document.querySelectorAll('.panel button')].find(b => b.textContent.includes('Controls'))?.click()")
        pg.wait_for_timeout(1200)
        place = "() => [...document.querySelectorAll('.window')].map(w => [w.offsetLeft, w.offsetTop, w.offsetWidth, w.offsetHeight].join())"
        for i, name in enumerate(['Twist', 'Bobs', 'Tunnel']):
            pg.evaluate("(n) => [...document.querySelectorAll('.panel-buttons button')].find(b => b.textContent === n).click()", name)
            pg.wait_for_timeout(600)
            # (Each to a place of its own, side by side.)
            bar = pg.locator('.window .window-bar').nth(i).bounding_box()
            pg.mouse.move(bar['x'] + 60, bar['y'] + 6); pg.mouse.down(); pg.mouse.move(100 + 440 * i, 66 + 150 * i, steps=6); pg.mouse.up()
        before = pg.evaluate(place)
        for i in range(3):
            pg.locator('.window .window-bar').nth(i).click(position={'x': 120, 'y': 6})
            pg.locator('.window .twist-frame').nth(i).dblclick(); pg.wait_for_timeout(800)
            pg.evaluate("() => document.exitFullscreen()"); pg.wait_for_timeout(1300)
        check(pg.evaluate(place) == before and len(before) == 3, 'the effect windows come back from full screen where they were')
        for i in range(3): pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        no_errors('no errors in the effect windows')

        pg.set_viewport_size({'width': 1000, 'height': 700})
        random.seed(7)
        keys = ['Space', 'KeyR',
                'Escape', 'KeyG', 'ArrowLeft', 'ArrowRight', 'Comma', 'Period']
        for i in range(220):
            r = random.random()
            try:
                if r < 0.35:
                    pg.evaluate("""(seed) => { const bs = [...document.querySelectorAll('.panel button, .preset-bar button, .speed-bar button, .requester button, .window button')].filter(b => b.offsetParent);
                      if (bs.length) bs[seed % bs.length].click(); }""", random.randrange(10000))
                elif r < 0.55:
                    key = random.choice(keys); pg.keyboard.press(key)
                    if key == 'KeyG': pg.wait_for_timeout(200); pg.keyboard.press('Space')   # (the Guru Meditation: any key ends it)
                elif r < 0.7:
                    pg.evaluate("""(seed) => { const s = [...document.querySelectorAll('.slider')].filter(e => e.offsetParent); if (!s.length) return; const e = s[seed % s.length]; const b = e.getBoundingClientRect();
                      const x = b.left + b.width * ((seed % 97) / 96), y = b.top + b.height / 2;
                      for (const type of ['pointerdown', 'pointermove', 'pointerup']) e.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 })); }""", random.randrange(10000))
                elif r < 0.8:
                    pg.mouse.move(random.randrange(50, 900), random.randrange(50, 650)); pg.mouse.down()
                    pg.mouse.move(random.randrange(50, 900), random.randrange(50, 650), steps=5); pg.mouse.up()
                elif r < 0.85: pg.mouse.wheel(0, random.choice([-300, 300]))
                elif r < 0.9: pg.set_viewport_size({'width': random.randrange(300, 1400), 'height': random.randrange(250, 900)})
                elif r < 0.95: pg.evaluate("(s) => { boing.settings.speed = s; }", random.choice([-4, -1, -0.25, 0, 0.25, 1, 4]))
                else: pg.mouse.click(random.randrange(100, 900), random.randrange(100, 600))
            except Exception as error:
                errors.append('the test itself: ' + str(error)[:120])
            pg.wait_for_timeout(random.choice([50, 150, 400]))
        pg.wait_for_timeout(1500)
        check(pg.evaluate(balls_ok), 'after 220 random actions every ball is somewhere')
        no_errors('no errors in 220 random actions')
        browser.close()
finally:
    server.kill()

print('\n' + ('All passed.' if not failures else f'{len(failures)} failed.'))
sys.exit(1 if failures else 0)
