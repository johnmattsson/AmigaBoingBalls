// =============================================================================
// graphs.js — the small graphs on the Info page of the Controls: a row of
// the panel with a canvas in it, drawn in the panel's own style. What they
// show is decided in main.js.
// =============================================================================

import { wide } from './gui.js';

// A small graph on a page of the panel. It keeps its last `samples` values of a
// few lines, taken only while the Info page is shown, and draws them from
// left (oldest) to right (newest).
//   lines:   [{ color, y }], y(value) giving 0 (bottom) … 1 (top); a value
//            of null leaves a gap
//   guides:  heights (0 … 1) of dotted lines
//   key:     [[name, color]]: what the lines are, top right, one under the other
export function addGraph(panel, samples, { lines, guides = [], key = [] }) {
  const row = panel.addRow('');
  row.classList.add('panel-graph');
  row.firstChild.remove();   // (no label: the graph takes the whole row)
  const canvas = document.createElement('canvas');
  canvas.className = 'sunken';
  row.append(canvas);
  const values = lines.map(() => []);
  return {
    row,
    clear() { for (const list of values) list.length = 0; },
    sample(...now) {
      now.forEach((v, k) => values[k].push(v));
      if (values[0].length > samples) for (const list of values) list.shift();
    },
    draw() {
      const ratio = Math.min(2, devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
      const g = canvas.getContext('2d', { colorSpace: 'display-p3' });   // wide colour
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, w, h);
      const x = (i) => (i / (samples - 1)) * (w - 2) + 1;
      const y = (fraction) => h - 1 - Math.max(0, Math.min(1, fraction)) * (h - 2);
      g.strokeStyle = wide('#555555'); g.setLineDash([2, 3]); g.lineWidth = 1;
      for (const f of guides) {
        g.beginPath(); g.moveTo(0, y(f)); g.lineTo(w, y(f)); g.stroke();
      }
      g.setLineDash([]);
      lines.forEach((line, k) => {
        g.strokeStyle = wide(line.color); g.lineWidth = 1.5; g.beginPath();
        let started = false;
        values[k].forEach((v, i) => {
          const f = v === null ? null : line.y(v);
          if (f === null) { started = false; return; }
          if (started) g.lineTo(x(i), y(f)); else g.moveTo(x(i), y(f));
          started = true;
        });
        g.stroke();
      });
      g.font = '8px Amiga, monospace'; g.textBaseline = 'top';
      key.forEach(([name, color], k) => {
        g.fillStyle = wide(color);
        g.fillText(name, w - 4 - g.measureText(name).width, 3 + 9 * k);
      });
    },
  };
}

// A graph row to draw in freely (as addGraph's): returns a
// function that gets the canvas ready and gives its 2D drawing, width and
// height (in CSS pixels), or null while it can't be seen.
export function addCanvasRow(panel) {
  const row = panel.addRow('');
  row.classList.add('panel-graph');
  row.firstChild.remove();
  const canvas = document.createElement('canvas');
  canvas.className = 'sunken';
  row.append(canvas);
  return () => {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    }
    const g = canvas.getContext('2d', { colorSpace: 'display-p3' });
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '8px Amiga, monospace'; g.textBaseline = 'top';
    return { g, w, h };
  };
}
