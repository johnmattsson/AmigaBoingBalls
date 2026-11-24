// =============================================================================
// info.js — the Info page of the Controls: the physics at work (energy,
// momentum, hits), Precision and the Rewind test with its graph, the speed
// histogram, and how fast the computer draws it all.
//
// (It reaches the rest of the page only through `page`: see needs and gives.)
// =============================================================================
import { addCanvasRow, addGraph } from './graphs.js';
import { wide } from './gui.js';
import { SPEED_BARS, SPEED_RANGE } from './physics-host.js';
import { DRIFTING, LOST } from './rewindcheck.js';
import { PAGES } from './settings.js';

// What this part needs from the rest of the page, and what it gives it. (Handed
// over by start in app.js: it can reach nothing else.)
export const name = 'info';
export const needs = [
  'controls', 'energyPerBall', 'panel', 'physics', 'renderer', 'restored', 'rewindCheck',
  'sceneHooks', 'settings',
];
export const gives = [
  'details', 'drawSpeeds', 'graph', 'infoWasShown', 'lateGraph', 'lateInAll', 'sampleSpeeds',
  'showRewindTest', 'showTotals', 'speedSamples', 'wideColourScreen',
];

export function setup(page) {
  // ---- The Info page ---------------------------------------------------------------
  // First the conservation laws at work, updated a few times a second.
  page.panel.startPage('Info');
  const physicsInfo = {
    energy: page.panel.addReadout('Energy'),        // the Energy slider's number, with more digits
    momentum: page.panel.addReadout('Momentum'),    // size of the total momentum
    angular: page.panel.addReadout('Ang. mom.'),    // size of the total angular momentum
  };

  // The rewind test: runs a slightly nudged copy of the scene alongside (see
  // rewindcheck.js) and shows, as it goes, how far from the start a rewind
  // would bring the balls, in ball radii: "ok", "drift" (it will visibly miss)
  // or "lost" (it can no longer find its way back). Switching it on starts it
  // afresh, measuring how well a rewind would get back to that moment, and
  // starts the graph again; Restart measures from the start of the preset.
  // Precision (see sceneHooks.digits), just above the rewind test, as it
  // decides how long a rewind lasts.
  page.controls.push(page.panel.addSetting('digits', page.settings, { onChange: page.sceneHooks.digits }));
  const rewindTest = page.panel.addSetting('rewindEstimate', page.settings, { onChange: (on) => {
    page.rewindCheck.setEnabled(on);
    if (on) graph.clear();
    showRewindTest();
    if (on) graph.draw();
  } });
  page.controls.push(rewindTest);
  const rewindTestRow = rewindTest.row;
  // (Its result in the same row, beside the box, and only while it runs.)
  const rewindReadout = page.panel.addReadout('Rewind');
  rewindReadout.row.remove();
  rewindTestRow.append(rewindReadout.box);
  rewindReadout.box.style.marginLeft = '3px';

  // The rewind test's graph, shown only while the test runs: the last 20
  // seconds or so of how far a rewind would miss (on a logarithmic scale from
  // 1e-16 at the bottom to 1e+4 ball radii at the top; the dotted line is 1,
  // where a rewind is lost). Sampled a few times a second; started again with
  // every preset.
  const logMiss = (e) => (Math.log10(Math.max(1e-16, Math.min(1e4, e))) + 16) / 20;
  const graph = addGraph(page.panel, 160, {
    lines: [{ color: '#ff8800', y: logMiss }],
    guides: [logMiss(1)],
    key: [['Rewind miss', '#ff8800']],
  });
  graph.row.classList.add('switched-off');   // (until the test runs: see showRewindTest)
  let rewindShown = '';
  function showRewindTest() {
    let text = 'off', look = '';
    if (page.rewindCheck.enabled) {
      const estimate = page.rewindCheck.estimate();
      if (page.rewindCheck.changedByHand) { text = 'lost'; look = 'lost'; }
      else if (estimate >= LOST) { text = 'lost'; look = 'lost'; }
      // (Only the number: the colour tells drift from ok, and the row is narrow.)
      else if (estimate >= DRIFTING) { text = estimate.toExponential(0); look = 'drifting'; }
      else { text = estimate.toExponential(0); }
    }
    if (text + look === rewindShown) return;   // (only touch the page when it changes)
    rewindShown = text + look;
    rewindReadout.set(text);
    rewindReadout.box.className = `readout sunken ${look}`;
    rewindReadout.box.style.visibility = page.rewindCheck.enabled ? '' : 'hidden';
    graph.row.classList.toggle('switched-off', !page.rewindCheck.enabled);
  }

  // The totals:
  //  - Energy only changes when you click a ball or move
  //    Energy or Gravity.
  //  - Momentum and angular momentum are passed between balls when they hit
  //    each other but never lost; only the walls and gravity change the totals.
  function showTotals() {
    physicsInfo.energy.set(page.energyPerBall().toFixed(4));
    physicsInfo.momentum.set(page.physics.totalMomentum().length().toFixed(3));
    physicsInfo.angular.set(page.physics.totalAngularMomentum().length().toFixed(3));
  }

  // The speeds of the balls, as bars, and in red the curve they settle to
  // after enough collisions: the Maxwell–Boltzmann distribution, which
  // James Clerk Maxwell worked out in 1860 for the molecules of a gas. (See
  // speedHistogram in physics-host.js: the speeds are measured against the
  // typical one, the root mean square.) Start Gas: every ball starts at the
  // same speed, a single spike, and within a few seconds of collisions the
  // bars spread out into the curve. Beside each blue bar a green one: how
  // fast the balls spin, which (with Rough or Garwin bounces, which pass
  // energy between flying and spinning) settles into the same curve, as Gas
  // shows, its balls starting without any spin at all. (Both are each
  // measured against their own typical speed: the shapes, not how the
  // energy is shared.) Averaged over the last few seconds, so it
  // settles even with few balls.
  const speedCanvas = addCanvasRow(page.panel);
  const speedAverage = new Float64Array(SPEED_BARS), spinAverage = new Float64Array(SPEED_BARS);
  page.speedSamples = 0;
  // The curve: with u the speed ÷ the typical speed, f(u) = 3√6/√π u² e^(−3u²/2).
  const maxwell = (u) => (3 * Math.sqrt(6) / Math.sqrt(Math.PI)) * u * u * Math.exp(-1.5 * u * u);
  function sampleSpeeds() {
    const bars = page.physics.speeds;
    if (!bars) return;
    const keep = page.speedSamples < 12 ? page.speedSamples / (page.speedSamples + 1) : 0.92;   // (quick at first, then a few seconds' memory)
    const spins = page.physics.spins;
    for (let k = 0; k < SPEED_BARS; k++) {
      speedAverage[k] = keep * speedAverage[k] + (1 - keep) * bars[k];
      spinAverage[k] = keep * spinAverage[k] + (1 - keep) * (spins ? spins[k] : 0);
    }
    page.speedSamples++;
  }
  function drawSpeeds() {
    const c = speedCanvas();
    if (!c) return;
    const { g, w, h } = c;
    const TOP = 1.25;   // (the curve's peak is at about 1.02: room above it)
    const x = (u) => 1 + (u / SPEED_RANGE) * (w - 2);
    const y = (f) => h - 1 - Math.min(1, f / TOP) * (h - 4);
    const barWidth = SPEED_RANGE / SPEED_BARS;
    // (Each stretch of speeds: the flight's bar on the left, the spin's on the right.)
    for (const [averages, color, side] of [[speedAverage, '#0087bd', 0], [spinAverage, '#009f6b', 1]]) {
      g.fillStyle = wide(color);
      for (let k = 0; k < SPEED_BARS; k++) {
        const left = x(k * barWidth), half = (x((k + 1) * barWidth) - left) / 2, top = y(averages[k]);
        g.fillRect(left + side * half + 0.5, top, half - 0.5, h - 1 - top);
      }
    }
    g.strokeStyle = wide('#c40233'); g.lineWidth = 1.5; g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const u = (i / 120) * SPEED_RANGE;
      if (i === 0) g.moveTo(x(u), y(maxwell(u))); else g.lineTo(x(u), y(maxwell(u)));
    }
    g.stroke();
    // (The key, top right: the curve, then the two kinds of bar under it.)
    [['Maxwell', '#c40233'], ['Speed', '#0087bd'], ['Spin', '#009f6b']].forEach(([name, color], k) => {
      g.fillStyle = wide(color);
      g.fillText(name, w - 4 - g.measureText(name).width, 3 + 9 * k);
    });
  }

  // Then the numbers for this computer, updated once a second. (Only what
  // differs from one visitor to the next and shows nowhere else; what the
  // demo always does is told in the About window.)
  const details = {
    pixels: page.panel.addReadout('Pixels'),      // the pixels drawn, across × down
    refresh: page.panel.addReadout('Refresh'),    // the screen's refresh rate (the FPS bar is full at it)
    colours: page.panel.addReadout('Colours'),    // wide colour (Display P3) where the screen has it, else sRGB; and HDR
    drawnWith: page.panel.addReadout('Drawn with'), // WebGPU, or WebGL where there's none (see gpu-renderer.js)
    physics: page.panel.addReadout('Physics'),    // time spent moving the balls, per step: its thread and the page's side (see showCounts)
    graphics: page.panel.addReadout('Graphics'),  // all else per drawn frame: the page's own work, the effect windows, the graphics card (see showCounts)
    hits: page.panel.addReadout('Hits/s'),        // ball-on-ball collisions per second
    // Dropped frames: frames that came late, more than 1.5 times the usual
    // time after the one before, so one picture stayed on screen twice and the
    // motion jerked. (The FPS above can still say 60 then: it counts a whole
    // second.)
    late: page.panel.addReadout('Dropped'),
  };
  const wideColourScreen = () => page.renderer.wideColor && matchMedia('(color-gamut: p3)').matches;
  // The late frames of the last two minutes, one bar a second, counted all the
  // time (also with the Controls closed), so any stutter shows up afterwards:
  // nothing at the bottom line means none; one late frame already makes a
  // clear spike, and the height grows (logarithmically) up to a whole second
  // of them.
  page.infoWasShown = false;
  page.lateInAll = 0;   // since the page was opened
  const spike = (count) => (count === 0 ? 0 : 0.3 + 0.7 * Math.min(1, Math.log(count) / Math.log(60)));
  const lateGraph = addGraph(page.panel, 120, {
    lines: [{ color: '#c40233', y: spike }],
    key: [['Dropped', '#c40233']],
  });

  // The page in four groups, with a groove between them: how the picture
  // is drawn (Pixel size, HDR); the physics at work (the conservation laws,
  // the speeds); how fast it all runs (FPS, then the rest of the readings,
  // made above in that order); and, set apart at the bottom, the settings
  // for testing the physics (Precision, the rewind test and its graph).
  const rows = [...page.panel.rows.children].filter((r) => page.panel.pageOfRow.get(r) === 'Info');
  const labelled = (text) => rows.find((r) => r.querySelector(':scope > .panel-label')?.textContent === text);
  const speedRow = rows.find((r) => r.classList.contains('panel-graph') && r !== graph.row && r !== lateGraph.row);
  const testing = [labelled('Precision'), rewindTestRow, graph.row];
  const order = [labelled('Pixel size'), labelled('HDR'), 'line',
    labelled('Energy'), labelled('Momentum'), labelled('Ang. mom.'), speedRow, 'line', labelled('FPS')];
  const placed = new Set([...order, ...testing]);
  order.push(...rows.filter((r) => !placed.has(r)), 'line', ...testing);
  const marker = document.createComment('Info');
  rows[0].before(marker);
  for (const row of order) if (row) marker.before(row === 'line' ? page.panel.addLine() : row);
  marker.remove();

  // Below the pages, always shown: the two windows.
  page.panel.startPage(null);
  // (The page kept from the last visit; one there is no more: the first.)
  const saved = page.restored.page;
  page.panel.showPage(PAGES.includes(saved) ? saved : PAGES[0]);
  // (For the rest of the page.)
  Object.assign(page, { details, drawSpeeds, graph, lateGraph, sampleSpeeds, showRewindTest, showTotals, wideColourScreen });
}
