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
- **A tidier panel.** The controls are spread over four pages with tabs: Scene, Look, Sound and Info. FPS, Preset and the Twist and About buttons are always shown.
- **Shadows on the walls.** The four side walls of the box (and its ceiling, when the lamp is tilted) now catch the balls' shadows, like the back wall in the original Amiga demo. A shadow that used to spill onto the floor outside the box now climbs the wall instead. The walls between you and the box are hidden and let shadows through; the walls you do see catch those shadows a little past their ends, as if they carried on towards you.
- **Copper bars.** A Copper switch replaces the plain grey backdrop with the classic Amiga demo look: a colour gradient and three glowing bars gliding up and down, in the Amiga's 4096 colours and one colour per screen line. The bars pause and rewind with the balls.
- **Scroller.** A Scroller switch adds the other demo classic, a sine scroller: a text gliding along the bottom, bent into a travelling wave and coloured the copper way. It pauses and rewinds with the balls. Like real demos it has its own chunky hand-made font (each letter is a grid of 5 × 7 squares in `js/scroller.js`). Its text opens with the credit line, so a **Credits** switch can hide the line at the bottom of the page.
- **Volume sliders** for the boings and for the music, on the Sound page.
- **Music.** A Music switch plays a chiptune, and a Track button chooses between four original tunes, each in a style the Amiga was loved for: Jump'n'run (bouncy platform-game music), Anthem (a slow, soaring demo tune over big held chords), Funk (a syncopated tracker groove with a plucked bass) and Chip intro (fast, bright square waves). There is no music file; `js/music.js` holds the notes as lists of numbers and makes every sound from scratch.
- **Trails.** A Trails slider draws the path each ball has flown, fading out: from half a second up to ten seconds long (0 = off).
- **Kinds of bounce.** "Ball hits" and "Wall hits" choose how things bounce: Rough (1, 1, 1), Garwin (1, 1, -1), Smooth (1, -1, -1) or Twist (1, -1, 1). The three numbers say what happens to the speed into the surface, the sliding along it and the twisting against it (1 = reversed, -1 = untouched). These are the only four kinds that lose no energy.
- **Totals.** The Info page shows the conservation laws at work: total energy, momentum and angular momentum, and how much of the motion energy is in spin ("Spin %", which hovers around 50 for rough balls).
- **Presets.** Nine ready-made scenes. Four showpieces: Four balls; Classic 1984 (one big ball as in the original, with its shadow on the back wall); Carousel (48 balls in the box while the camera circles above the ceiling); and Copper demo (balls of all sizes filling the whole window over the copper bars, in Amiga-sized pixels, with the scroller and music). And five physics experiments: Under table (the super ball trick: it comes back!); Break shot (billiards in mid-air: one ball fired into a triangle of ten); Giant+dwarfs (one huge ball jostled about by forty tiny ones); Gas (sixty small weightless balls, with the Info page open to watch the energy being shared out); and Rewind (one ball shot into a tidy block of 27: eight seconds of scattering and colliding, then time runs backwards until the block has put itself together again). Choosing a preset puts every option back to its usual value first (only the two volume sliders are left alone) and turns the camera to the front.
- **About window**, with the history of the demo and a short explanation of the controls. Like the Twist window it can be dragged by its title bar and has a close gadget in the top-left corner. The Twist window can also be resized with the gadget in its bottom-right corner.
- **Twist window.** A "Twist..." button opens a draggable Workbench window with another demo classic, the twister: a square bar wrung like a wet towel. On the Amiga it was faked line by line; here it is a real 3D shape with perspective, a lamp, a shiny highlight and the Boing checker pattern.
- **Size mix** (formerly Sizes) now reads as "how many times bigger is the biggest ball than the smallest": 1.0 = all equal, up to 4.0 (from half to double the standard size).
- **Same-sized checker squares.** Bigger balls have more squares and smaller balls fewer, so the squares are about the same size on every ball. (The big ball of Classic 1984 keeps the original's 8 rows.)
- **Wall sound**: an optional boing when a ball hits a wall, as in the original demo. Classic 1984 switches it on.
- **Grid+cam** switch: hide the box. The window itself then becomes the room: the balls bounce off the left, right and top edges of the window (whatever its shape) and off a level floor along the bottom, and shadows only fall on that floor. Goes well with the copper bars. The camera stays put in this mode (the room is made to fit the view); clicking balls still pushes them.
- **Pixel size** slider: 1 is as sharp as your screen allows; anything more draws the scene in big square pixels of that size, with hard edges and the Amiga's 4096 colours. The Copper demo sets it to whatever gives an Amiga screen's 256 lines in your window.
- **Shadows** switch: turn all shadows off (and save the graphics card the work).
- **Lamp sliders.** "Lamp dist" is how far away the lamp is: near throws long, spreading shadows, far keeps them the size of the balls (it starts at 21 for the box and 45 for the window-sized room). "Lamp tilt" swings the lamp from straight above (0°, shadows on the floor) to right in front (90°, shadows on the back wall, as in the original demo).
- **Auto cam**: the camera slowly circles the box and glides in and out by itself. Dragging and zooming still work. It needs the grid, so switching it on switches Grid+cam on too (and switching Grid+cam off switches it off).

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
- A Balls slider: anything from 1 to 100 balls, and a Size mix slider to mix small and big balls (up to four times as big as the smallest). Bigger balls are heavier, so they shove small ones around.
- An Energy slider: shows the balls' total energy (movement + spin + height, per ball; 1.0 = the classic start). It stays constant by itself, because nothing in the box loses energy; clicks add some. Drag it to calm the balls down or liven them up.
- The Info page of the panel shows performance: physics and graphics time per frame, the highest frame rate the demo could reach, and ball hits per second. FPS now shows the frames the demo actually draws.
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

Keys: Space pauses, Escape closes the window in front, 1–9 choose a preset.

The panel in the top-right corner offers ready-made scenes (Preset) and sets the number and sizes of the balls, how they bounce, gravity and the speed of time — try a negative speed to run time backwards. Rewinding retraces the path very accurately, but not forever: bouncing balls are chaotic, so tiny rounding errors (in the 16th digit) grow with every collision between balls. In practice the rewind is spot-on for roughly the last 20 ball-on-ball hits, then gradually drifts onto a different path.

## How the code is organised

| File | What it does |
|---|---|
| `index.html` | The page, its styling, and loading `js/main.js` |
| `js/main.js` | Sets everything up and runs the animation loop |
| `js/physics.js` | Moves, spins and bounces the balls |
| `js/renderer.js` | Uploads shapes to the graphics card and draws each frame |
| `js/shaders.js` | The GPU programs, including the shadow calculation |
| `js/camera.js` | The orbiting camera and mouse/touch input |
| `js/math.js` | Small 3D vector, rotation and matrix helpers |
| `js/audio.js` | Plays the boing sounds, placed left or right |
| `js/gui.js` | The settings panel, the About window and draggable windows |
| `js/twist.js` | The Twist window: the twister effect, with its own shaders |
| `js/music.js` | The chiptune: the notes and the little player that performs them |
| `js/scroller.js` | The sine scroller, with its own little font |
| `js/presets.js` | The ready-made scenes of the Preset button |

Every file starts with a plain-language explanation of what it does.

### How the balls are drawn

Each ball is a single flat square facing the camera. For every pixel of it, the shader sends a ray from the camera and calculates exactly where it hits the ball, so balls are perfectly round at any zoom. See the top of `js/shaders.js`.

### How the shadows work

Every object that casts a shadow is a perfect sphere, so instead of a shadow map the shaders work it out exactly for each pixel: *standing here and looking straight at the lamp, is any ball in the way?* The lamp is a single point, so the answer is yes or no and the shadow edges are razor sharp. The same calculation shades the floor, the grid and the balls themselves — which is why balls can now shadow each other. To keep this fast with many balls, a small "shadow grid" lists which balls can be in the way in each part of the lamp's view, so each pixel only checks a few balls instead of all of them. See `js/shaders.js`.

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

## Publishing a new version

Before publishing changes (for example to GitHub Pages), change `VERSION` near the bottom of `index.html`: raise the build number after the dash (`2.04-12` → `2.04-13`). The release shown on the page stays 2.04. Browsers keep copies of files they have downloaded; the version number makes every visitor fetch the new set of files at once, instead of a mix of old and new.

## Running it locally

The scripts are JavaScript modules, which browsers won't load straight from your disk (`file://`). Start any small web server in this folder, for example:

```
python3 -m http.server
```

and open http://localhost:8000.

Needs a browser with WebGL2 (every current desktop and mobile browser).

## Tinkering

While the demo runs, open the browser's developer console and try:

```js
boing.settings.speed = 0.2                          // slow motion
boing.physics.balls[0].velocity.y = 20; boing.physics.changed()            // launch the red ball
boing.physics.balls.forEach(b => b.spin.y = 30); boing.physics.changed()   // spin everything fast
boing.renderer.skipHidden = false     // compare graphics time without the hidden-pixel pass
boing.physics.wallBounce = { normal: 1, tangential: 1, angular: 1 }        // make the walls grippy too
```

After changing balls from the console, call `boing.physics.changed()` so the physics re-plans its collisions straight away (it otherwise does so within a second).
