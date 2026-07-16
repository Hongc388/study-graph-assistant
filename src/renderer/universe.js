// Universe view: a pseudo-3D semantic-zoom map of the whole library, rendered
// on a <canvas> with a real perspective camera (not just a flat SVG pan/zoom).
//   universe (all modules, orbit camera) → click a module: its topics
//     → click a topic: its material "planets" → click a planet: details card.
// Layout is computed once (module positions relax by cross-module edge
// affinity, topics relax within their module by same-module edges) so
// proximity — not lines — carries "closer = more related". Each node then
// gets a small constant per-node wobble on top of that fixed position, just
// enough to read as alive without wandering off its meaningful spot.
(function () {
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Deterministic pseudo-random per seed, so the sky looks the same every visit.
  function rng(seed) {
    let s = (seed * 2654435761) % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  function fibonacciSphere(n, radius) {
    const pts = [];
    if (n <= 0) return pts;
    const off = 2 / n;
    const inc = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = (i * off - 1) + off / 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * inc;
      pts.push({ x: Math.cos(phi) * r * radius, y: y * radius, z: Math.sin(phi) * r * radius });
    }
    return pts;
  }

  function vlen(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1; }

  // ---------- layout (runs once; N is small) ----------

  function layoutUniverse(mods, topics, materials, edges) {
    const topicsByMod = new Map(mods.map(m => [m.id, []]));
    for (const t of topics) topicsByMod.get(t.module_id)?.push(t);

    const matsByTopic = new Map();
    const looseByMod = new Map(mods.map(m => [m.id, []]));
    for (const m of materials) {
      if (m.type === 'overview') continue; // course-info lives in the About panel
      if (m.topic_id) {
        if (!matsByTopic.has(m.topic_id)) matsByTopic.set(m.topic_id, []);
        matsByTopic.get(m.topic_id).push(m);
      } else {
        looseByMod.get(m.module_id)?.push(m);
      }
    }

    const R_UNIVERSE = 300;
    const seed = fibonacciSphere(mods.length, R_UNIVERSE);
    const galaxies = mods.map((mod, i) => {
      const ts = topicsByMod.get(mod.id) || [];
      const nMats = ts.reduce((s, t) => s + (matsByTopic.get(t.id)?.length || 0), 0)
        + (looseByMod.get(mod.id)?.length || 0);
      const R = Math.min(130, 42 + 7 * Math.sqrt(ts.length * 4 + nMats));
      return { mod, ts, nMats, R, pos: { ...seed[i] } };
    });

    // Cross-module relatedness: number of edges between each module pair.
    const affinity = new Map();
    for (const e of edges) {
      if (!e.from_module || !e.to_module || e.from_module === e.to_module) continue;
      const key = [e.from_module, e.to_module].sort((a, b) => a - b).join(':');
      affinity.set(key, (affinity.get(key) || 0) + 1);
    }

    for (let iter = 0; iter < 240; iter++) {
      for (let i = 0; i < galaxies.length; i++) {
        for (let j = i + 1; j < galaxies.length; j++) {
          const a = galaxies[i], b = galaxies[j];
          let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          dx /= d; dy /= d; dz /= d;
          const key = [a.mod.id, b.mod.id].sort((x, y) => x - y).join(':');
          const w = Math.min(affinity.get(key) || 0, 6);
          const rest = (a.R + b.R) * (1.5 - 0.1 * w) + 46;
          const f = (d - rest) * 0.025;
          a.pos.x += dx * f; a.pos.y += dy * f; a.pos.z += dz * f;
          b.pos.x -= dx * f; b.pos.y -= dy * f; b.pos.z -= dz * f;
        }
      }
      for (const g of galaxies) {
        // soft pull back onto the universe shell so relaxation doesn't collapse inward
        const d = vlen(g.pos);
        const k = (R_UNIVERSE - d) * 0.012;
        g.pos.x += g.pos.x / d * k; g.pos.y += g.pos.y / d * k; g.pos.z += g.pos.z / d * k;
      }
    }

    // --- topic clusters inside each galaxy ---
    for (const g of galaxies) {
      const items = g.ts.map(t => {
        const mats = matsByTopic.get(t.id) || [];
        const r = Math.min(20, 4 + 2.4 * Math.sqrt(mats.length));
        return { t, mats, r };
      });
      const loose = looseByMod.get(g.mod.id) || [];
      if (loose.length) items.push({ t: null, mats: loose, r: Math.min(20, 4 + 2.4 * Math.sqrt(loose.length)) });

      const localR = Math.max(24, g.R * 0.6);
      const pts = fibonacciSphere(items.length, localR);
      items.forEach((it, i) => { it.local = { ...pts[i] }; });

      const idx = new Map(items.filter(x => x.t).map(x => [x.t.id, x]));
      for (let iter = 0; iter < 160; iter++) {
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            let dx = b.local.x - a.local.x, dy = b.local.y - a.local.y, dz = b.local.z - a.local.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
            dx /= d; dy /= d; dz /= d;
            const min = a.r + b.r + 8;
            if (d < min) {
              const f = (min - d) * 0.22;
              a.local.x -= dx * f; a.local.y -= dy * f; a.local.z -= dz * f;
              b.local.x += dx * f; b.local.y += dy * f; b.local.z += dz * f;
            }
          }
        }
        for (const e of edges) {
          if (e.from_module !== g.mod.id || e.to_module !== g.mod.id) continue;
          const a = idx.get(e.from_topic), b = idx.get(e.to_topic);
          if (!a || !b) continue;
          let dx = b.local.x - a.local.x, dy = b.local.y - a.local.y, dz = b.local.z - a.local.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          dx /= d; dy /= d; dz /= d;
          const f = (d - (a.r + b.r + 10)) * 0.04; // related topics huddle
          a.local.x += dx * f; a.local.y += dy * f; a.local.z += dz * f;
          b.local.x -= dx * f; b.local.y -= dy * f; b.local.z -= dz * f;
        }
        for (const it of items) {
          const d = vlen(it.local);
          if (d > localR) { it.local.x *= localR / d; it.local.y *= localR / d; it.local.z *= localR / d; }
        }
      }

      for (const it of items) {
        it.pos = { x: g.pos.x + it.local.x, y: g.pos.y + it.local.y, z: g.pos.z + it.local.z };
        const matPts = fibonacciSphere(it.mats.length, Math.min(11, 3.4 + it.r * 0.6));
        it.matPos = it.mats.map((m, k) => ({ m, local: matPts[k] }));
      }
      g.items = items;
    }
    return galaxies;
  }

  // ---------- flatten into a render/hit-test friendly world list ----------

  function buildWorld(galaxies) {
    const world = [];
    for (const g of galaxies) {
      const modNode = {
        kind: 'module', ref: g.mod, galaxy: g, color: g.mod.color || '#6b7a8f',
        r: 8, label: g.mod.code, sub: g.mod.name, pos: g.pos,
        seed: (g.mod.id || 1) * 13 + 1,
      };
      world.push(modNode);
      for (const it of g.items) {
        const topicNode = {
          kind: 'topic', ref: it.t, galaxy: g, item: it, parentNode: modNode,
          color: g.mod.color, r: Math.max(2.6, it.r * 0.5),
          label: it.t ? it.t.name : 'Unsorted',
          sub: `${it.mats.length} file${it.mats.length === 1 ? '' : 's'}`,
          pos: it.pos, seed: ((it.t ? it.t.id : (g.mod.id || 1) * 1000) + 1) * 7 + 3,
        };
        world.push(topicNode);
        it.matPos.forEach((mp, k) => {
          world.push({
            kind: 'material', ref: mp.m, galaxy: g, item: it, parentNode: topicNode,
            color: g.mod.color, r: 1.5, label: mp.m.title, sub: mp.m.type,
            pos: { x: it.pos.x + mp.local.x, y: it.pos.y + mp.local.y, z: it.pos.z + mp.local.z },
            seed: ((mp.m.id || k) + 1) * 11 + 5,
          });
        });
      }
    }
    return world;
  }

  // ---------- view ----------

  // opts: { crumbEl, onMaterial(mat), onLevel(level) }
  window.renderUniverse = function renderUniverse(canvas, data, opts = {}) {
    const { mods, topics, materials, edges } = data;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!mods.length) {
      canvas.width = canvas.clientWidth || 600;
      canvas.height = canvas.clientHeight || 300;
      ctx.fillStyle = '#8A8983';
      ctx.font = '15px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('The universe is empty — index your library to light it up.',
        canvas.width / 2, canvas.height / 2);
      if (opts.crumbEl) opts.crumbEl.innerHTML = '';
      return () => {};
    }

    const galaxies = layoutUniverse(mods, topics, materials, edges);
    const world = buildWorld(galaxies);

    const state = { level: 0, galaxy: null, item: null };
    let stopped = false;

    // ---------- camera: eases toward a target instead of snapping ----------
    const DEFAULT_CAM = { yaw: 0.5, pitch: -0.3, dist: 780 };
    let yaw = DEFAULT_CAM.yaw, pitch = DEFAULT_CAM.pitch, dist = DEFAULT_CAM.dist;
    let yawT = yaw, pitchT = pitch, distT = dist;
    // look-at target: the camera orbits this point, not the world origin —
    // otherwise zooming into an off-center galaxy flies toward empty space
    let center = { x: 0, y: 0, z: 0 };
    let centerT = { x: 0, y: 0, z: 0 };
    const PITCH_MIN = -0.85, PITCH_MAX = 0.85;
    const DIST_MIN = 90, DIST_MAX = 1500;
    const focal = 640;
    let autoSpin = true;
    let motionOn = true;
    let showLinks = false;
    let frozen = false;
    let focusAnim = 0;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    function cw() { return canvas.clientWidth || 600; }
    function ch() { return canvas.clientHeight || 400; }

    function project(p) {
      let x = p.x - center.x, y = p.y - center.y, z = p.z - center.z;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      let vx = x * cy - z * sy;
      let vz = x * sy + z * cy;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const vy = y * cp - vz * sp;
      vz = y * sp + vz * cp;
      const zc = vz + dist;
      if (zc <= 5) return null;
      const scale = focal / zc;
      return { x: cw() / 2 + vx * scale, y: ch() / 2 + vy * scale, scale, depth: zc };
    }

    function wobble(node, t) {
      if (!motionOn) return { x: 0, y: 0, z: 0 };
      const s = node.seed;
      const amp = node.kind === 'module' ? 2.6 : node.kind === 'topic' ? 1.9 : 1.2;
      const f1 = 0.00032 + (s % 7) * 0.00004;
      const f2 = 0.00026 + (s % 5) * 0.00003;
      return {
        x: Math.sin(t * f1 + s) * amp,
        y: Math.cos(t * f2 + s * 1.7) * amp,
        z: Math.sin(t * f1 * 0.8 + s * 2.3) * amp,
      };
    }

    function hexA(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function map(v, a, b, c, d) { return c + (d - c) * clamp((v - a) / (b - a), 0, 1); }

    // ---------- level navigation ----------
    function renderCrumb() {
      if (!opts.crumbEl) return;
      const parts = ['<a href="#" class="uni-crumb" data-lv="0">🌌 Universe</a>'];
      if (state.galaxy) parts.push(`<a href="#" class="uni-crumb" data-lv="1">${esc(state.galaxy.mod.code)}</a>`);
      if (state.item) parts.push(`<span>${esc(state.item.t ? state.item.t.name : 'Unsorted')}</span>`);
      opts.crumbEl.innerHTML = parts.join('<span class="uni-sep"> › </span>');
      opts.crumbEl.querySelectorAll('.uni-crumb').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const lv = Number(a.dataset.lv);
          if (lv === 0) goLevel(0);
          else if (lv === 1 && state.galaxy) goLevel(1, state.galaxy);
        });
      });
    }

    function goLevel(level, galaxy, item) {
      state.level = level;
      state.galaxy = galaxy || null;
      state.item = item || null;
      focusAnim = 0;
      distT = level === 0 ? DEFAULT_CAM.dist
        : level === 1 ? clamp(galaxy.R * 6, DIST_MIN, DEFAULT_CAM.dist)
        : clamp(Math.max(item.r, 6) * 14, DIST_MIN, DEFAULT_CAM.dist * 0.7);
      centerT = level === 0 ? { x: 0, y: 0, z: 0 }
        : level === 1 ? { ...galaxy.pos }
        : { ...item.pos };
      renderCrumb();
      if (opts.onLevel) opts.onLevel(level, state.galaxy, state.item);
    }

    function goBack() {
      if (state.level === 2) goLevel(1, state.galaxy);
      else if (state.level === 1) goLevel(0);
      else resetCamera();
    }
    function resetCamera() {
      yawT = DEFAULT_CAM.yaw; pitchT = DEFAULT_CAM.pitch; distT = DEFAULT_CAM.dist;
      centerT = { x: 0, y: 0, z: 0 };
    }

    goLevel(0);

    // ---------- draw loop ----------
    let hitList = [];
    let hover = null;

    function draw(t) {
      if (stopped) return;
      ctx.clearRect(0, 0, cw(), ch());

      // pause the slow auto-spin while aiming at a node, or it drifts away
      // from under the cursor right before the click
      if (autoSpin && state.level === 0 && !dragging && !frozen && !hover) yawT += 0.00022 * 16.7;
      yaw += (yawT - yaw) * 0.12;
      pitch += (pitchT - pitch) * 0.12;
      dist += (distT - dist) * 0.09;
      center.x += (centerT.x - center.x) * 0.09;
      center.y += (centerT.y - center.y) * 0.09;
      center.z += (centerT.z - center.z) * 0.09;
      if (state.level > 0) focusAnim = Math.min(1, focusAnim + 0.02);
      else focusAnim = Math.max(0, focusAnim - 0.04);

      const projected = [];
      for (const n of world) {
        const wob = reduceMotion || frozen ? { x: 0, y: 0, z: 0 } : wobble(n, t);
        const p = { x: n.pos.x + wob.x, y: n.pos.y + wob.y, z: n.pos.z + wob.z };
        const pr = project(p);
        if (!pr) continue;

        const fog = clamp(map(pr.depth, dist - 160, dist + 420, 1, 0.05), 0.04, 1);
        let alphaBase = n.kind === 'module' ? 0.8 : n.kind === 'topic' ? 0.55 : 0.5;
        let dim = 1;
        if (state.level >= 1 && state.galaxy) {
          const inGalaxy = n.galaxy === state.galaxy;
          if (n.kind === 'module') dim = inGalaxy ? 1 : (1 - focusAnim * 0.88);
          else dim = inGalaxy ? 1 : (1 - focusAnim * 0.92);
        }
        if (state.level === 2 && state.item) {
          const inItem = n.item === state.item || (n.kind === 'topic' && n.item === state.item);
          if (n.kind === 'material' || n.kind === 'topic') dim *= inItem ? 1 : (1 - focusAnim * 0.85);
        }
        const target = alphaBase * fog * dim;
        n.dispAlpha = n.dispAlpha == null ? target : n.dispAlpha + (target - n.dispAlpha) * 0.08;
        projected.push({ n, pr, alpha: n.dispAlpha });
      }
      projected.sort((a, b) => b.pr.depth - a.pr.depth);

      if (showLinks) {
        ctx.lineWidth = 1.4;
        for (const { n, pr, alpha } of projected) {
          if (!n.parentNode) continue;
          const wob = reduceMotion || frozen ? { x: 0, y: 0, z: 0 } : wobble(n.parentNode, t);
          const pp = project({ x: n.parentNode.pos.x + wob.x, y: n.parentNode.pos.y + wob.y, z: n.parentNode.pos.z + wob.z });
          if (!pp) continue;
          ctx.strokeStyle = hexA(n.color, 0.14 * alpha);
          ctx.beginPath();
          ctx.moveTo(pr.x, pr.y);
          ctx.lineTo(pp.x, pp.y);
          ctx.stroke();
        }
      }

      for (const item of projected) {
        const { n, pr, alpha } = item;
        const rad = Math.max(1.3, n.r * pr.scale * 0.9);
        const isHover = hover === n;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, isHover ? rad * 1.7 : rad, 0, Math.PI * 2);
        ctx.fillStyle = hexA(n.color, isHover ? 1 : alpha);
        ctx.fill();
        item.rad = rad;
        item.screen = pr;
      }

      hitList = projected;
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    // ---------- interaction ----------
    let dragging = false, lastX = 0, lastY = 0, dragMoved = false;

    function interactive(n) {
      if (state.level === 0) return n.kind === 'module';
      if (state.level === 1) return n.kind === 'topic' && n.galaxy === state.galaxy;
      return n.kind === 'material' && n.item === state.item;
    }

    function onPointerDown(e) {
      dragging = true; dragMoved = false;
      lastX = e.clientX; lastY = e.clientY;
      canvas.classList.add('dragging');
      canvas.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e) {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        yawT += dx * 0.005;
        pitchT = clamp(pitchT + dy * 0.005, PITCH_MIN, PITCH_MAX);
        yaw = yawT; pitch = pitchT;
        lastX = e.clientX; lastY = e.clientY;
        hover = null;
        if (opts.tipEl) opts.tipEl.style.opacity = 0;
        return;
      }
      // projected coords are canvas-local; the canvas doesn't start at the
      // window origin here (sidebar + header), so convert the pointer first
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let best = null, bestD = Infinity;
      for (const item of hitList) {
        if (!interactive(item.n)) continue;
        const dx = mx - item.screen.x, dy = my - item.screen.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        // generous halo: anywhere near a node counts, nearest one wins
        const hitR = Math.max(item.rad + 10, 16);
        if (d < hitR && d < bestD) { best = item; bestD = d; }
      }
      hover = best ? best.n : null;
      canvas.style.cursor = hover ? 'pointer' : '';
      if (opts.tipEl) {
        if (hover) {
          opts.tipEl.style.left = e.clientX + 'px';
          opts.tipEl.style.top = e.clientY + 'px';
          opts.tipEl.innerHTML = hover.sub
            ? `<b>${esc(hover.label)}</b> <span class="sub">· ${esc(hover.sub)}</span>`
            : `<b>${esc(hover.label)}</b>`;
          opts.tipEl.style.opacity = 1;
        } else {
          opts.tipEl.style.opacity = 0;
        }
      }
    }
    function onPointerUp() {
      if (dragging && !dragMoved) {
        if (hover) {
          if (state.level === 0 && hover.kind === 'module') goLevel(1, hover.galaxy);
          else if (state.level === 1 && hover.kind === 'topic') goLevel(2, hover.galaxy, hover.item);
          else if (state.level === 2 && hover.kind === 'material') opts.onMaterial?.(hover.ref);
        } else {
          goBack();
        }
      }
      dragging = false;
      canvas.classList.remove('dragging');
    }
    function onWheel(e) {
      e.preventDefault();
      // multiplicative + gentle: additive zoom felt violent on trackpads,
      // where a small flick reports large deltaY values
      distT = clamp(distT * Math.exp(e.deltaY * 0.0012), DIST_MIN, DIST_MAX);
    }
    function onKeydown(e) {
      if (e.key !== 'Escape') return;
      goBack();
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeydown);

    if (reduceMotion) { autoSpin = false; motionOn = false; }

    // ---------- external controls (freeze / links / motion / reset) ----------
    function setMotion(on) { motionOn = on; if (on) autoSpin = true; }
    function setFreeze(on) {
      frozen = on;
      motionOn = !on;
      autoSpin = !on;
    }
    function setLinks(on) { showLinks = on; }
    function reset() { goLevel(0); resetCamera(); }

    // teardown, so re-rendering the view doesn't leak listeners/rAF loops
    function destroy() {
      stopped = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeydown);
    }

    // goLevel/galaxies/openMaterial let E2E tests drive the canvas view,
    // where there is no DOM to click
    return {
      setMotion, setFreeze, setLinks, reset, destroy,
      goLevel, galaxies,
      openMaterial: (mat) => opts.onMaterial?.(mat),
    };
  };
})();
