/* We Investigate Anything — procedural hero scene (Twin Peaks / noir).
   Builds the mountain massif (fractal midpoint displacement), the dense
   forest (~2500 scattered firs), and the masstin investigation graph.
   Deterministic (fixed seed) so the scene is stable across loads. */
(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function subdivide(pts, passes, disp, rough, R, minY) {
    for (var p = 0; p < passes; p++) {
      var out = [pts[0]];
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        var my = (a[1] + b[1]) / 2 + (R() * 2 - 1) * disp;
        if (my < minY) my = minY;
        out.push([(a[0] + b[0]) / 2, my]);
        out.push(b);
      }
      pts = out; disp *= rough;
    }
    return pts;
  }
  function ptsPath(pts, close) {
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 1; i < pts.length; i++) d += ' L' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
    if (close) d += ' L1320 680 L0 680 Z';
    return d;
  }
  function fir(cx, baseY, h, w) {
    var t = baseY - h, w1 = w * 0.5, w2 = w * 0.74, w3 = w;
    var y1 = t + h * 0.36, y2 = t + h * 0.66, y3 = baseY;
    var n = function (x) { return x.toFixed(1); };
    return 'M' + n(cx) + ' ' + n(t)
      + ' L' + n(cx + w1 * 0.5) + ' ' + n(y1) + ' L' + n(cx + w1 * 0.22) + ' ' + n(y1)
      + ' L' + n(cx + w2 * 0.5) + ' ' + n(y2) + ' L' + n(cx + w2 * 0.22) + ' ' + n(y2)
      + ' L' + n(cx + w3 * 0.5) + ' ' + n(y3) + ' L' + n(cx - w3 * 0.5) + ' ' + n(y3)
      + ' L' + n(cx - w2 * 0.22) + ' ' + n(y2) + ' L' + n(cx - w2 * 0.5) + ' ' + n(y2)
      + ' L' + n(cx - w1 * 0.22) + ' ' + n(y1) + ' L' + n(cx - w1 * 0.5) + ' ' + n(y1) + ' Z';
  }
  function buildScene() {
    var R = mulberry32(20261006);
    var m1pts = subdivide([[0, 400], [210, 312], [430, 150], [642, 262], [860, 214], [1082, 286], [1320, 330]], 4, 46, 0.54, R, 120);
    var m2pts = subdivide([[0, 452], [260, 406], [520, 442], [780, 410], [1040, 440], [1320, 418]], 4, 28, 0.5, R, 384);
    var m3pts = subdivide([[0, 504], [320, 474], [640, 504], [960, 478], [1320, 490]], 4, 20, 0.5, R, 442);
    var tb = [], tm = [], tf = [], i;
    for (i = 0; i < 1500; i++) tb.push(fir(R() * 1380 - 30, 282 + R() * 216, 11 + R() * 26, 7 + R() * 13));
    for (i = 0; i < 700; i++) tm.push(fir(R() * 1380 - 30, 466 + R() * 150, 28 + R() * 102, 14 + R() * 28));
    for (i = 0; i < 300; i++) tf.push(fir(R() * 1380 - 30, 702 + R() * 6, 60 + R() * 212, 28 + R() * 54));
    var summit = m1pts[0];
    for (i = 1; i < m1pts.length; i++) if (m1pts[i][1] < summit[1]) summit = m1pts[i];
    var CH = [[300, 606, 'b', 'RED-01'], [360, 556, 'r', ''], [410, 502, 'b', 'helen'], [448, 452, 'g', ''], [470, 402, 'a', 'EVILPC$'], [452, 352, 'b', ''], [440, 300, 'r', '4741'], [434, 240, 'a', ''], [summit[0], summit[1], 'a', 'T1098']];
    var CM = { r: 'var(--red)', g: 'var(--green)', b: 'var(--blue)', a: 'var(--amber)' };
    var gnodes = CH.map(function (n, k) { return { x: n[0], y: n[1], lx: n[0] + 9, c: CM[n[2]], label: n[3], d: (k * 0.5).toFixed(2) + 's' }; });
    var chainPts = CH.map(function (n) { return n[0].toFixed(1) + ',' + n[1].toFixed(1); }).join(' ');
    return { m1: ptsPath(m1pts, true), m1line: ptsPath(m1pts, false), m2: ptsPath(m2pts, true), m3: ptsPath(m3pts, true), tb: tb, tm: tm, tf: tf, gnodes: gnodes, chainPts: chainPts };
  }
  function g(id) { return document.getElementById(id); }
  function paint() {
    if (!g('m1')) return;
    var s = buildScene();
    g('m1').setAttribute('d', s.m1); g('clipPath1').setAttribute('d', s.m1); g('m1line').setAttribute('d', s.m1line);
    g('m2').setAttribute('d', s.m2); g('m3').setAttribute('d', s.m3);
    g('treesBack').innerHTML = s.tb.map(function (d) { return '<path d="' + d + '" style="fill:var(--tree)"/>'; }).join('');
    g('treesMid').innerHTML = s.tm.map(function (d) { return '<path d="' + d + '" style="fill:var(--treefront)"/>'; }).join('');
    g('treesFront').innerHTML = s.tf.map(function (d) { return '<path d="' + d + '" style="fill:var(--treefront)"/>'; }).join('');
    g('chain').setAttribute('points', s.chainPts);
    g('gnodes').innerHTML = s.gnodes.map(function (n) { return '<circle class="node" cx="' + n.x + '" cy="' + n.y + '" r="4" fill="currentColor" style="color:' + n.c + ';filter:drop-shadow(0 0 5px ' + n.c + ');animation-delay:' + n.d + '"/>'; }).join('');
    g('glabels').innerHTML = s.gnodes.map(function (n) { return '<text x="' + n.lx + '" y="' + n.y + '" dy="3.2" style="font-family:\'Space Mono\',monospace;font-size:9px;letter-spacing:.05em;fill:var(--muted);opacity:.72">' + (n.label || '') + '</text>'; }).join('');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();
