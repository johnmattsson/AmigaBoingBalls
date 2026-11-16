# Amiga Boing Balls

A tribute to my favorite demo of all time. Use the mouse to orbit and zoom, and click the balls to push them.

Featured on Experiments with Google
https://experiments.withgoogle.com/amiga-boing-balls

View the demo on GitHub Pages
https://johnmattsson.github.io/AmigaBoingBalls/index.html

![image](https://user-images.githubusercontent.com/5421061/214696768-63839d2b-17ff-4717-b847-163d127516cb.png)

## Release 2.04

Latest additions:
- **Keyboard shortcuts.** Space pauses (and carries on), Escape closes the window in front, and 1 to 9 choose a preset. Shift-click or right-click the Preset button to step backwards.
- **Ball size** slider (1.0 = the usual size), and a fifth choice for Wall hits, **1984**: slippery, and the ball turns the other way after each side wall, as in the original demo (not real physics). With these, everything the presets do can also be set by hand, except their hand-placed starting throws.
- **A tidier panel.** The controls are spread over four pages with tabs: Scene, Look, Sound and Info. The Twist and About buttons are always shown; FPS is at the top of the Info page. The panel closes with the close gadget on the left of its title bar, like every window, or with the Close button at the bottom.
- **Shadows on the walls.** The four side walls of the box (and its ceiling, when the lamp is tilted) now catch the balls' shadows, like the back wall in the original Amiga demo. A shadow that used to spill onto the floor outside the box now climbs the wall instead. The walls between you and the box are hidden and let shadows through; the walls you do see catch those shadows a little past their ends, as if they carried on towards you.
- **Copper bars.** A Copper switch replaces the plain grey backdrop with the classic Amiga demo look: a colour gradient and four glowing bars in the colours of the balls gliding up and down, in the Amiga's 4096 colours and one colour per screen line. The bars pause and rewind with the balls.
- **Scroller.** A Scroller switch adds the other demo classic, a sine scroller: a text gliding along the bottom, bent into a travelling wave and coloured the copper way. It pauses and rewinds with the balls. Like real demos it has its own chunky hand-made font (each letter is a grid of 5 × 7 squares in `js/scroller.js`). Its text opens with the credit line, so a **Credits** switch can hide the line at the bottom of the page.
- **Volume sliders** for the boings and for the music, on the Sound page.
- **Music.** A Music switch plays a chiptune, and a Track button chooses between four original tunes, each in a style the Amiga was loved for: Jump'n'run (bouncy platform-game music), Anthem (a slow, soaring demo tune over big held chords), Funk (a syncopated tracker groove with a plucked bass) and Chip intro (fast, bright square waves). There is no music file; `js/music.js` holds the notes as lists of numbers and makes every sound from scratch.
- **Trails.** A Trails slider draws the path each ball has flown, fading out: from half a second up to ten seconds long (0 = off).
- **Kinds of bounce.** "Ball hits" and "Wall hits" choose how things bounce: Rough (1, 1, 1), Garwin (1, 1, -1), Smooth (1, -1, -1) or Twist (1, -1, 1). The three numbers say what happens to the speed into the surface, the sliding along it and the twisting against it (1 = reversed, -1 = untouched). These are the only four kinds that lose no energy.
- **Info graph.** A small graph on the Info page, recording only while it is shown, shows the last 20 seconds or so of the spin share and, with the rewind test on, how far a rewind would miss (log scale).
- **Totals.** The Info page shows the conservation laws at work: total energy, momentum and angular momentum, and how much of the motion energy is in spin ("Spin share", which hovers around 50 % for rough balls).
- **Running time backwards.** The speed gadgets on the title bar run time backwards (<<), pauses (||) and forwards (>). Every collision is worked out exactly, so the balls retrace their paths, but only for some twenty collisions per ball: bouncing balls are chaotic, and every collision makes the computer's rounding errors several times bigger. The **Rewind test** on the Info page (off by default, as it costs about as much time as the physics; switching it on starts it afresh, measuring a rewind back to that moment, and starts the graph again; it only runs while the Controls are open, and starts afresh when they are opened again) shows as it goes how close to the start running backwards would bring the balls, in ball radii: "ok", "drift" (yellow: it will visibly miss) or "lost" (red: it can no longer find its way back). It is an estimate, from a hidden "twin" of the scene that starts a tiny distance away and shows how fast this scene magnifies small errors (see `js/rewindcheck.js`); and a plain "lost (by hand)" once the balls or the room have been changed by hand (a push; the Balls, Ball size, Size mix, Energy or Gravity slider; another kind of bounce; In a box, or resizing the window while it is off). Changing Digits starts the test afresh.
- **Digits.** Digits on the Scene page makes the physics compute with about 32 or 64 digits instead of the usual 16 (each number is carried as two or four ordinary numbers, in `js/precise.js`). It is slower, but running time backwards lasts much longer: the Gas preset comes back from about 4 seconds with 16 digits, 12 with 32 and over 30 with 64. The Gas preset uses 32. After changing it, press R so that the whole scene runs with the new digits (Restart keeps the Digits setting).
- **Presets.** Seven ready-made scenes, on the title bar next to the speed gadgets (on a second row in narrower windows): < and > step through them, and Restart starts the scene again. The page starts with Four balls. Four showpieces: Four balls; Classic 1984 (one big ball as in the original, with its shadow on the back wall); Carousel (48 balls in the box while the camera circles above the ceiling); and Copper demo (balls of all sizes filling the whole window over the copper bars, with the scroller and music). And three physics experiments: Under table (the super ball trick: it comes back!); Break shot (billiards in mid-air: a yellow ball fired into a triangle of fifteen; press << after a while and the triangle puts itself together again); and Gas (a thousand tiny balls packed in a corner, without spin, spreading out to fill the box while "Spin share" on the Info page climbs from 0 towards 50 %; running time backwards packs them back into the corner from about 4 seconds, or about 12 with 32 digits). Choosing a preset puts every option back to its usual value first (only the two volume sliders are left alone) and turns the camera to the front.
- **About window**, in four parts with tabs: the Amiga (the Boing Ball and its legends, the twister, why 2.04, thanks), this demo (including its sound and colours), the controls, and the physics. Like the Twist window it can be dragged by its title bar and has a close gadget in the top-left corner. The Twist window can also be resized with the gadget in its bottom-right corner. While the twist is full screen the balls pause (whatever the speed is set to, also after choosing a preset meanwhile), and carry on when it comes back.
- **Twist v4 window.** A "Twist v4..." button opens a draggable Workbench window with another demo classic, the twister: a square bar wrung like a wet towel. On the Amiga it was faked line by line; here it is a real 3D shape with perspective, a lamp, a shiny highlight and the Boing checker pattern. The zoom gadget at the right end of its title bar (or a double-click on the twist) shows just the twister on the full screen, without title bar or borders, drawn with all the screen's pixels; Escape (or another double-click) puts the window back. A wide picture has room for more: as many twists as fit (one in the window, three on a 16:9 screen), each a little behind its neighbour so the wringing runs across like a wave, and each with the colours in another order.
- **Size mix** (formerly Sizes) now reads as "how many times bigger is the biggest ball than the smallest": 1.0 = all equal, up to 4.0 (from half to double the standard size).
- **Same-sized checker squares.** Bigger balls have more squares and smaller balls fewer, so the squares are about the same size on every ball. (The big ball of Classic 1984 keeps the original's 8 rows.)
- **Wall sound**: an optional boing when a ball hits a wall, as in the original demo. Classic 1984 switches it on.
- **In a box** switch: hide the box. The window itself then becomes the room: the balls bounce off the left, right and top edges of the window (whatever its shape) and off a level floor along the bottom, and shadows only fall on that floor. Goes well with the copper bars. The camera stays put in this mode (the room is made to fit the view); clicking balls still pushes them.
- **Pixel size** slider: 1 is as sharp as your screen allows; anything more draws the scene in big square pixels of that size, with hard edges and the Amiga's 4096 colours. The Copper demo sets it to whatever gives an Amiga screen's 256 lines in your window.
- **A Workbench window, or full screen.** The page is drawn as a Workbench 2.0 window: a blue title bar with the close gadget at its left end, then the title, the speed and preset gadgets (the preset gadgets on a second row in narrower windows), and the zoom gadget at its right end; and a thin frame. A web page can't close itself, so the close gadget puts the window away at once, while the show goes on The window fades away together with the controls, leaving just the scene, and comes back when you move the mouse. The zoom gadget, or the F key, puts just the scene on the full screen, with the controls on a plain grey bar along the top (fading the same way); its close gadget, Escape or F goes back.
- **The controls fade away.** After three seconds without the mouse moving, a touch or a key, the speed and preset bars and the Open Controls button fade out, leaving the scene alone; any movement brings them back. (Not while the pointer rests on them or the panel is open.)
- **Shadows** switch: turn all shadows off (and save the graphics card the work).
- **Lamp sliders.** "Lamp dist" is how far away the lamp is: near throws long, spreading shadows, far keeps them the size of the balls (it starts at 21 for the box and 45 for the window-sized room). "Lamp tilt" swings the lamp from straight above (0°, shadows on the floor) to right in front (90°, shadows on the back wall, as in the original demo). With the grid off it stops earlier (about 66° at the usual distance): lower, the lamp would throw the shadows of the highest balls almost endlessly far, and they would be cut off at the horizon.
- **Auto cam**: the camera slowly circles the box and glides in and out by itself. Dragging and zooming still work. It needs the grid, so switching it on switches In a box on too (and switching In a box off switches it off).

### The rewrite

A complete rewrite in plain WebGL2 with no libraries at all (previously three.js, OrbitControls, dat.gui and howler.js — about 480 KB of scripts; now about 60 KB of source, more than half of it comments).

New:
- **Balls cast shadows on each other**, not just on the floor — still with the sharp, old-school shadow edges.
- Collisions are calculated exactly (the moment two balls or a ball and a wall touch is solved with a quadratic equation), so balls never sink into each other and running time backwards retraces the path very accurately.
- Runs at the same speed on every screen (60 Hz, 120 Hz, …). The old version ran its physics once per frame, so it ran faster on faster screens.
- Perfectly round balls at any zoom: each ball is calculated per pixel instead of being built from triangles.
- Every edge (ball outlines, checker squares, grid lines, shadows) is smoothed the same way: sharp, but without stair-steps. Edges are blended in linear light, so they don't look heavy or dark, while all the solid colours are exactly those of 1.3.
- Touch support: drag to orbit, pinch to zoom, tap to push.
- Dragging the camera no longer pushes a ball when you let go over it.
- Restored sounds: the original Amiga recordings, with the out-of-step stereo channels lined up, rumble and noise removed, and a little extra clarity for small speakers.
- Each boing comes from where the bounce happens on screen — left, right or anywhere in between.
- A Boings on/off switch, and boings that are louder the harder the balls hit.
- A Balls slider: anything from 1 to 1000 balls, and a Size mix slider to mix small and big balls (up to four times as big as the smallest). Bigger balls are heavier, so they shove small ones around.
- An Energy slider: shows the balls' total energy (movement + spin + height, per ball; 1.0 = the classic start). It stays constant by itself, because nothing in the box loses energy; clicks add some. Drag it to calm the balls down or liven them up.
- The Info page of the panel shows performance: physics and graphics time per frame, the highest frame rate the demo could reach, ball hits per second, late frames per second (frames that came more than 1.5 times the usual time after the one before, so a picture stayed on screen twice; "usual" follows the screen, so a screen that changes its rate, such as a MacBook going from 120 to 60 Hz in Low Power Mode, doesn't count as stutter; in brackets the count since the page was opened). A graph under them shows the last two minutes: late frames in red, and in blue frames in which the balls didn't move evenly although the frame came on time (a repeat: the physics had no new step ready, so the balls stood still for a frame; or a jump: steps that piled up, or time saved up while the physics was busy, made them leap ahead), recorded all the time, also with the Controls closed. FPS now shows the frames the demo actually draws.
- Many boings at once are kept clean: at most 8 play together, and an automatic limiter stops them from distorting.
- On phones and tablets the settings panel is drawn larger, for fingers.
- Saves battery: while paused, the scene is only redrawn when the camera moves. And while the page is hidden (another tab in front), everything stops: physics, drawing, boings and music.
- The settings panel now looks like an AmigaOS 2.0 Workbench window (the release number nods to Kickstart/Workbench 2.04).

## Controls

| Action | Mouse | Touch |
|---|---|---|
| Orbit the camera | drag | drag with one finger |
| Zoom | scroll wheel | pinch |
| Push a ball | click it | tap it |

Keys: Space pauses, R starts the preset again, F switches to and from full screen, Escape closes the window in front, 1–7 choose a preset. The speed of time is on the title bar, with buttons to run backwards (<<), pause (||) and run forwards (>). While time runs backwards, "<< REWIND" blinks below it. The presets are on the title bar too, next to the speed gadgets.

The Controls panel (top right) sets the number and sizes of the balls, how they bounce and gravity; the speed of time is on the title bar — try a negative speed to run time backwards. Rewinding retraces the path very accurately, but not forever: bouncing balls are chaotic, so tiny rounding errors (in the 16th digit) grow with every collision between balls. In practice the rewind is spot-on for roughly the last ten hits of each ball, then gradually drifts onto a different path.

## How the code is organised

The readable demo is in `src/`; the top folder holds the copy that is published, made from it with the comments and spaces taken out (see Publishing).

| File | What it does |
|---|---|
| `src/index.html` | The page, its styling, and loading `js/main.js` |
| `src/js/main.js` | Sets everything up and runs the animation loop |
| `src/js/physics.js` | Moves, spins and bounces the balls |
| `src/js/renderer.js` | Uploads shapes to the graphics card and draws each frame |
| `src/js/shaders.js` | The GPU programs, including the shadow calculation |
| `src/js/camera.js` | The orbiting camera and mouse/touch input |
| `src/js/math.js` | Small 3D vector, rotation and matrix helpers |
| `src/js/audio.js` | Plays the boing sounds, placed left or right |
| `src/js/gui.js` | The settings panel, the About window and draggable windows |
| `src/js/twist.js` | The Twist window: the twister effect, with its own shaders |
| `src/js/music.js` | The chiptune: the notes and the little player that performs them |
| `src/js/scroller.js` | The sine scroller, with its own little font |
| `src/js/presets.js` | The ready-made scenes of the Preset button |
| `src/js/precise.js` | The physics with 32 or 64 digits (the Digits choice), for longer rewinds |
| `src/js/precise-wasm.js` | The 64-digit arithmetic compiled to WebAssembly (generated: see below) |
| `src/js/rewindcheck.js` | The rewind test: a slightly nudged twin of the scene |
| `src/js/physics-host.js` | Runs the physics and the rewind test, and answers each step with a snapshot of the balls |
| `src/js/physics-worker.js` | Starts `physics-host.js` on a thread of its own (a Web Worker) |
| `src/js/physics-client.js` | The page's side of the physics: passes changes on, keeps a copy of the balls for drawing |
| `src/js/hdr.js` | Showing the picture on an HDR screen with WebGPU |
| `build/build.mjs`, `package.json` | Makes the published copy (top folder) from `src/` (see Publishing) |
| `src/static/make-favicons.py` | Draws the tab icons (16, 32, 48 and 192 pixels) and the phone home-screen icon |
| `src/wasm/precise.c`, `src/wasm/build.sh` | The source of `src/js/precise-wasm.js`, and the script that builds it |

Every file starts with a plain-language explanation of what it does. Elsewhere in this README, `js/…` means `src/js/…`.

### How the balls are drawn

Each ball is a single flat square facing the camera. For every pixel of it, the shader sends a ray from the camera and calculates exactly where it hits the ball, so balls are perfectly round at any zoom. See the top of `js/shaders.js`.

### How the shadows work

Every object that casts a shadow is a perfect sphere, so instead of a shadow map the shaders work it out exactly for each pixel: *standing here and looking straight at the lamp, is any ball in the way?* The lamp is a single point, so the answer is yes or no and the shadow edges are razor sharp. The same calculation shades the floor, the grid and the balls themselves — which is why balls can now shadow each other. To keep this fast with many balls, a small "shadow grid" lists which balls can be in the way in each part of the lamp's view, so each pixel only checks a few balls instead of all of them. See `js/shaders.js`.

### The physics on a thread of its own

The physics and the rewind test run in a Web Worker (`js/physics-worker.js`), a thread of its own, so a slow physics step (1000 balls packed in a corner, computed with 64 digits) never holds up the drawing, the camera or the controls. The page keeps a copy of the balls as they were after the last step (`js/physics-client.js`): every frame it asks for the next step and shows one finished step, keeping one more finished step in hand. The balls are drawn two frames (1/30 s) behind the physics, always the same, and an answer that comes a little late (browsers can wake the worker's thread a moment later, especially after the tab was in the background) is simply the one in hand next time. Without that, the same picture of the balls would be shown twice and then jump: a stutter that no frame timing shows. The Info page's late-frame graph shows such repeats in blue. Changes (a push, a preset, the sliders) are passed on as messages, and every step is answered with a snapshot: positions, orientations, the trails' new points (the page keeps the trails itself; sending them whole came to 13 MB a step with 1000 balls and 10-second trails, now about 90 kB), what was hit (for the boings) and the numbers on the Info page. Where a worker can't be started (the page opened as a file, or an old browser), the same code runs on the page itself, as before; and should the worker ever stop with an error, or not start within 4 seconds (a browser can leave it hanging after a quick reload), the physics carries on on the page.

### Tilt, and keeping the screen on

On a phone or tablet, **Tilt** (Scene page) lets gravity pull the way the device is tilted, read from its motion sensor (the `deviceorientation` event; Safari on the iPhone asks for permission first). The direction is turned with the screen and with the camera, so "down" is always down in the room as you see it. Energy is still conserved while the direction stays the same; a turning gravity can't be undone by a rewind, so the rewind test says "lost (by hand)".

While the demo is shown, the screen is kept from dimming or locking (the Screen Wake Lock API, where the browser has it). After a minute of pause it is let go, so a forgotten, paused demo doesn't keep the screen on; it is taken again when the demo runs.

### Pushing balls in a crowd

Which pairs of balls could meet before the next collision plan? Two balls can only meet if they are closer than the distance both can travel, so the plan needs a speed limit for every ball. It used to be one limit for all, a little above the fastest ball. A single push in the Gas preset then made every one of the 1000 balls consider about 50 times as many neighbours (168,000 pairs instead of 3,400), and a frame took up to a third of a second. Now every ball gets the same limit a little above the fastest typical speed (at most three times the average), except a ball that is much faster than the rest: it gets a limit of its own, and only it looks further ahead. After a push a frame now takes about 2–12 ms instead of 50–340 ms. Nothing is missed: in tests with many pushes no two balls ever overlapped. See `nearbyPairs` in `js/physics.js`.

### 64 digits with WebAssembly

The 64-digit arithmetic (adding, multiplying and scaling numbers of four parts) also exists in C, in `wasm/precise.c`, compiled to WebAssembly. There it runs about eight times faster than in JavaScript, which makes the whole 64-digit physics about twice as fast (Gas: about 13 → 6 ms per frame in its first second, about 1.9 → 1.1 ms after that). It does the same operations in the same order as the JavaScript in `js/precise.js`, so the results are identical to the last bit; if a browser cannot run WebAssembly, the JavaScript is used instead. For 32 digits it made no difference (those operations are so short that calling WebAssembly costs as much as it saves), and the usual 16 digits need no help.

The compiled code is packed into `js/precise-wasm.js` as text, so the page needs no extra file. After changing `wasm/precise.c`, run `wasm/build.sh` (it needs `clang` with the WebAssembly target, version 15 or later).

### Colour: HDR inside, wide colour and HDR screens

The scene is drawn into an off-screen picture of 16-bit floating-point numbers holding linear light, so it can keep light brighter than white. The last step copies it to the screen and cuts everything at white, which on an ordinary screen looks exactly as before (where a graphics card can't draw in floating point, the older 8-bit picture is used). See `createLinearTarget` in `js/renderer.js`.

**Wide colour**: wherever the browser supports it, the colours are sent to the screen as Display P3 instead of sRGB. Grey stays grey, but on a wide-colour screen (most phones and Macs) the red, green, blue and yellow come out deeper than sRGB can show. On an ordinary screen nothing changes.

**Glints** (a slider on the Look page, 0 = none as in the original, 1 = white; 0.5 to begin with): a small shiny spot where each ball mirrors the lamp (not in shadow). With HDR on it shines brighter than white, up to 1 + 3 × the HDR setting times white.

**HDR** (a slider on the Look page, where the browser has WebGPU): how bright light brighter than white gets, from 0 (off, the default: no WebGPU at all) to 2 (1 = the full design). It needs WebGPU with HDR canvases, so for now Chrome or Edge 129 or later, and a screen with HDR switched on. A canvas drawn with WebGL can't go brighter than white, so the WebGL picture is packed into its 8 bits (0–0.8 up to white, 0.8–1 for up to eight times white) and `js/hdr.js` hands it to WebGPU every frame, unpacks it and shows it on its own canvas. With HDR on, the scene is drawn by a second renderer on an OffscreenCanvas that never shows on the page, so that only WebGPU's canvas changes on screen: with two canvases changing every frame, the browser could show them out of step and the motion would stutter. The Twist window does the same with its own canvas, but simply. If WebGPU stops, the slider goes back to 0.

Above 0, everything that can shine does:
- the copper bars' white highlights shine up to three times white (at 1);
- the glints, if Glints is above 0 (see above);
- the scroller's letters are drawn into the scene, three times as bright (its own canvas is then hidden and only used as the source of the picture);
- the twist's shiny highlight gets brighter than white.

At 0 there is none of this, and everything looks as always.

Everything else is in wide colour too: the title bar, the Controls and the windows (every colour in the page's CSS is also given as a Display P3 colour), and the Info graph. (Only the mouse pointer stays sRGB: the system draws it.)

### Tuning the look

Near the top of `js/renderer.js`:

| Setting | What it does |
|---|---|
| `EDGE_WIDTH` | How many pixels every edge is blended over. 1 = sharpest; try 1.2 for calmer edges on moving things |
| `GRID_LINE_WIDTH` | Thickness of the grid lines, in screen points |
| `SHADOW_STRENGTH` | How much darker shadows are (0.4 = 40 %, as in 1.3) |
| `BOX_STAGE.lightHeight` | The lamp's distance from the box (also the Lamp dist slider's start, `LAMP_OVER_BOX` in `js/main.js`) |
| `TRAIL_WIDTH`, `TRAIL_OPACITY` | Thickness and strength of the trails (their length is the Trails slider) |

The copper bars' colours, number and speed are in `COPPER_FRAGMENT_SHADER` at the end of `js/shaders.js`. The twister's motion is the three lines of `angleAt()` near the top of `js/twist.js`.

## Running it locally

The scripts are JavaScript modules, which browsers won't load straight from your disk (`file://`). Start any small web server, in `src/` for the readable demo or in the top folder for the published copy, for example:

```
python3 -m http.server
```

and open http://localhost:8000.

Needs a browser with WebGL2 (every current desktop and mobile browser).

## When something goes wrong

- If the demo can't start (a script fails to load, or an error while starting), the bottom line of the page says so, instead of the page staying grey; after 10 seconds without a start it says it is still starting.
- If the browser takes the graphics card away from the page ("WebGL context lost": a graphics driver restart, or too many 3D pictures at once, which Safari can do on a quick reload), the scene is made anew when it comes back.

## Publishing

The top folder is the web site: `index.html`, `js/` and `static/`, minified from the readable demo in `src/` (about 410 kB of scripts and page down to 160 kB, before the server's own compression). Put the whole folder on GitHub and GitHub Pages (publishing the branch's root) serves the fast copy; the readable one is in `src/` for anyone to read, and runs as it is too.

After changing anything in `src/`:

1. Raise `VERSION` near the bottom of `src/index.html`: the build number after the dash (`2.04-12` → `2.04-13`). The release shown on the page stays 2.04. Browsers keep copies of files they have downloaded; the version number makes every visitor fetch the new set of files at once, instead of a mix of old and new.
2. Make the published copy anew:

```sh
npm install      # once: fetches esbuild, the minifier
npm run build    # src/ → index.html, js/, static/
```

Each script is minified on its own rather than bundled, as the page loads them as separate modules with the version in their addresses (the build also adds the version to every import between them, so that the physics worker, which has no import map, can't mix an old cached file with new ones after an update); from the shaders only comments and indentation are taken out. See `build/build.mjs`.

A shared link to the page (social media, chats) shows a picture, the title and the description: the `og:` tags in `src/index.html` and `static/preview.jpg`, a 1200 × 630 screenshot of the Four balls preset. Those tags name full addresses: the page's own, `https://coffeevortex.net/` (which leads to the GitHub Pages page), and the picture's, `https://johnmattsson.github.io/AmigaBoingBalls/static/preview.jpg`. Change them if the page moves.

The page also helps the browser load quickly: it fetches the Amiga font at once (`preload`) and announces all its scripts up front (`modulepreload`), so they are fetched side by side instead of one after another as each imports the next.

## Tinkering

While the demo runs, open the browser's developer console and try:

```js
boing.settings.speed = 0.2                          // slow motion
boing.tinker('physics.balls[0].velocity.y = 20; physics.changed()')                         // launch the red ball
boing.tinker('physics.balls.forEach(b => b.spin = b.spin.add({x: 0, y: 30, z: 0})); physics.changed()')   // spin everything fast
boing.physics.wallBounce = { normal: 1, tangential: 1, angular: 1 }        // make the walls grippy too
```

The physics runs in a worker, a thread of its own (see below), so `boing.physics.balls` are only the page's copies of the balls, for drawing. To change the real ones, `boing.tinker(code)` runs the code in the worker, where `physics` is the real Physics. After changing balls there, call `physics.changed()` so the physics re-plans its collisions straight away (it otherwise does so within a second).
