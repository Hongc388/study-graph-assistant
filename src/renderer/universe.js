// Universe view: a semantic-zoom map of the whole library.
//   universe (all modules as galaxies, only module names visible)
//     → click a galaxy: topic clusters with names + material density (no file names)
//       → click a cluster: material "planets" with names
//         → click a planet: details card.
// No edges are drawn — relatedness is expressed by proximity instead (edges
// still pull related things together during layout, they're just invisible).
// Everything lives in ONE world coordinate space; zooming is only viewBox
// animation, and each zoom level toggles which labels are shown (LOD).
(function () {
  const SVG = 'http://www.w3.org/2000/svg';
  const W = 1600;
  const H = 1000;

  function el(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    return n;
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Deterministic pseudo-random per seed, so the sky looks the same every visit.
  function rng(seed) {
    let s = (seed * 2654435761) % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  // ---------- layout (runs synchronously; N is small) ----------

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

    // --- galaxies: one per module, sized by how much lives inside ---
    const galaxies = mods.map((mod, i) => {
      const ts = topicsByMod.get(mod.id) || [];
      const nMats = ts.reduce((s, t) => s + (matsByTopic.get(t.id)?.length || 0), 0)
        + (looseByMod.get(mod.id)?.length || 0);
      const R = Math.min(250, 80 + 14 * Math.sqrt(ts.length * 4 + nMats));
      const a = (2 * Math.PI * i) / Math.max(1, mods.length);
      return {
        mod, ts, nMats, R,
        x: W / 2 + Math.cos(a) * W / 3.4,
        y: H / 2 + Math.sin(a) * H / 3.4,
      };
    });

    // Cross-module relatedness: number of edges between each module pair.
    const affinity = new Map();
    for (const e of edges) {
      if (!e.from_module || !e.to_module || e.from_module === e.to_module) continue;
      const key = [e.from_module, e.to_module].sort((a, b) => a - b).join(':');
      affinity.set(key, (affinity.get(key) || 0) + 1);
    }

    for (let iter = 0; iter < 320; iter++) {
      for (let i = 0; i < galaxies.length; i++) {
        for (let j = i + 1; j < galaxies.length; j++) {
          const a = galaxies[i];
          const b = galaxies[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= d; dy /= d;
          const key = [a.mod.id, b.mod.id].sort((x, y) => x - y).join(':');
          const w = Math.min(affinity.get(key) || 0, 6);
          // related galaxies rest closer; unrelated ones keep their distance
          const rest = (a.R + b.R) * (1.35 - 0.09 * w) + 40;
          const f = (d - rest) * 0.03;
          a.x += dx * f; a.y += dy * f;
          b.x -= dx * f; b.y -= dy * f;
        }
      }
      for (const g of galaxies) {
        g.x += (W / 2 - g.x) * 0.006;
        g.y += (H / 2 - g.y) * 0.006;
        g.x = Math.max(g.R + 20, Math.min(W - g.R - 20, g.x));
        g.y = Math.max(g.R + 20, Math.min(H - g.R - 60, g.y));
      }
    }

    // --- topic clusters inside each galaxy ---
    for (const g of galaxies) {
      const items = g.ts.map((t, i) => {
        const mats = matsByTopic.get(t.id) || [];
        const r = Math.min(64, 13 + 5 * Math.sqrt(mats.length));
        const a = (2 * Math.PI * i) / Math.max(1, g.ts.length);
        const rr = g.R * 0.45;
        return { t, mats, r, lx: Math.cos(a) * rr, ly: Math.sin(a) * rr };
      });
      const loose = looseByMod.get(g.mod.id) || [];
      if (loose.length) {
        items.push({
          t: null, mats: loose,
          r: Math.min(64, 13 + 5 * Math.sqrt(loose.length)),
          lx: 0, ly: -g.R * 0.62,
        });
      }
      const idx = new Map(items.filter(x => x.t).map(x => [x.t.id, x]));
      for (let iter = 0; iter < 260; iter++) {
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];
            let dx = b.lx - a.lx;
            let dy = b.ly - a.ly;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            dx /= d; dy /= d;
            const min = a.r + b.r + 14;
            if (d < min) {
              const f = (min - d) * 0.24;
              a.lx -= dx * f; a.ly -= dy * f;
              b.lx += dx * f; b.ly += dy * f;
            }
          }
        }
        for (const e of edges) {
          if (e.from_module !== g.mod.id || e.to_module !== g.mod.id) continue;
          const a = idx.get(e.from_topic);
          const b = idx.get(e.to_topic);
          if (!a || !b) continue;
          let dx = b.lx - a.lx;
          let dy = b.ly - a.ly;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          dx /= d; dy /= d;
          const f = (d - (a.r + b.r + 18)) * 0.05; // related topics huddle
          a.lx += dx * f; a.ly += dy * f;
          b.lx -= dx * f; b.ly -= dy * f;
        }
        for (const it of items) {
          it.lx *= 0.995;
          it.ly *= 0.995;
          const d = Math.sqrt(it.lx * it.lx + it.ly * it.ly) || 1;
          const max = g.R - it.r - 12;
          if (d > max) { it.lx *= max / d; it.ly *= max / d; }
        }
      }
      for (const it of items) {
        it.x = g.x + it.lx;
        it.y = g.y + it.ly;
        // materials on a phyllotaxis spiral: even density, no overlap logic needed
        const rand = rng((it.t ? it.t.id : g.mod.id) + 7);
        it.mats = it.mats.map((m, k) => {
          const ang = k * 2.39996 + rand() * 0.4;
          const rad = 0.82 * it.r * Math.sqrt((k + 0.6) / Math.max(1, it.mats.length));
          return { m, x: it.x + Math.cos(ang) * rad, y: it.y + Math.sin(ang) * rad };
        });
      }
      g.clusters = items;
    }
    return galaxies;
  }

  // ---------- view ----------

  // opts: { crumbEl, onMaterial(mat), onLevel(level) }
  window.renderUniverse = function renderUniverse(svg, data, opts = {}) {
    const { mods, topics, materials, edges } = data;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.remove('lod1', 'lod2');
    svg.classList.add('lod0');

    if (!mods.length) {
      const t = el('text', {
        x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#8A8983', 'font-size': 26,
      });
      t.textContent = 'The universe is empty — index your library to light it up.';
      svg.appendChild(t);
      if (opts.crumbEl) opts.crumbEl.innerHTML = '';
      return;
    }

    const galaxies = layoutUniverse(mods, topics, materials, edges);
    const state = { level: 0, galaxy: null, cluster: null };
    let vb = { x: 0, y: 0, w: W, h: H };
    let animId = 0;

    function applyVb() {
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    }

    function zoomTo(cx, cy, radius, tight) {
      const pad = radius * (tight ? 1.15 : 1.25);
      const aspect = W / H;
      let w = pad * 2 * Math.max(1, aspect * (tight || radius >= 200 ? 1 : 1.6));
      w = Math.min(w, W);
      const h = w / aspect;
      const target = {
        x: Math.max(0, Math.min(cx - w / 2, W - w)),
        y: Math.max(0, Math.min(cy - h / 2, H - h)),
        w, h,
      };
      const from = { ...vb };
      const t0 = performance.now();
      const DUR = 320;
      cancelAnimationFrame(animId);
      const tick = (now) => {
        // rAF's frame timestamp can predate the performance.now() captured
        // above — clamp both ends or the first frame eases backwards.
        const p = Math.min(1, Math.max(0, (now - t0) / DUR));
        const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
        vb = {
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          w: from.w + (target.w - from.w) * e,
          h: from.h + (target.h - from.h) * e,
        };
        applyVb();
        if (p < 1) animId = requestAnimationFrame(tick);
      };
      animId = requestAnimationFrame(tick);
    }

    function setLevel(level, galaxy, cluster) {
      state.cluster?.el?.classList.remove('active'); // only the entered cluster shows file names
      state.level = level;
      state.galaxy = galaxy || null;
      state.cluster = cluster || null;
      state.cluster?.el?.classList.add('active');
      svg.classList.remove('lod0', 'lod1', 'lod2');
      svg.classList.add(`lod${level}`);
      renderCrumb();
      if (opts.onLevel) opts.onLevel(level);
    }

    function renderCrumb() {
      if (!opts.crumbEl) return;
      const parts = ['<a href="#" class="uni-crumb" data-lv="0">🌌 Universe</a>'];
      if (state.galaxy) {
        parts.push(`<a href="#" class="uni-crumb" data-lv="1">${esc(state.galaxy.mod.code)}</a>`);
      }
      if (state.cluster) {
        parts.push(`<span>${esc(state.cluster.t ? state.cluster.t.name : 'Unsorted')}</span>`);
      }
      opts.crumbEl.innerHTML = parts.join('<span class="uni-sep"> › </span>');
      opts.crumbEl.querySelectorAll('.uni-crumb').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const lv = Number(a.dataset.lv);
          if (lv === 0) goUniverse();
          else if (lv === 1 && state.galaxy) goGalaxy(state.galaxy);
        });
      });
    }

    function goUniverse() {
      setLevel(0);
      zoomTo(W / 2, H / 2, H / 2);
    }
    function goGalaxy(g) {
      setLevel(1, g);
      zoomTo(g.x, g.y, g.R);
    }
    function goCluster(g, c) {
      setLevel(2, g, c);
      zoomTo(c.x, c.y, Math.max(c.r, 30), true);
    }

    // background click climbs one level back up
    svg.addEventListener('click', () => {
      if (state.level === 2) goGalaxy(state.galaxy);
      else if (state.level === 1) goUniverse();
    });

    // ---------- draw the whole world once ----------
    const root = el('g');
    svg.appendChild(root);

    for (const g of galaxies) {
      const gg = el('g', { class: 'uni-galaxy' });
      root.appendChild(gg);
      const color = g.mod.color || '#12866A';

      gg.appendChild(el('circle', { cx: g.x, cy: g.y, r: g.R, fill: color, opacity: 0.06 }));
      gg.appendChild(el('circle', { cx: g.x, cy: g.y, r: g.R * 0.55, fill: color, opacity: 0.06 }));

      // faint starfield inside the galaxy so density reads from far away
      const rand = rng(g.mod.id + 99);
      const stars = el('g', { class: 'uni-stars' });
      for (let k = 0; k < Math.min(70, 12 + g.nMats * 2); k++) {
        const a = rand() * 2 * Math.PI;
        const rr = g.R * Math.sqrt(rand()) * 0.9;
        stars.appendChild(el('circle', {
          cx: g.x + Math.cos(a) * rr, cy: g.y + Math.sin(a) * rr,
          r: 0.9 + rand() * 1.1, fill: color, opacity: 0.28 + rand() * 0.3,
        }));
      }
      gg.appendChild(stars);

      const modLbl = el('text', {
        x: g.x, y: g.y + g.R + 34, 'text-anchor': 'middle', class: 'lbl-mod', fill: '#1A1A18',
      });
      modLbl.textContent = `${g.mod.code} — ${g.mod.name}`;
      const modSub = el('text', {
        x: g.x, y: g.y + g.R + 58, 'text-anchor': 'middle', class: 'lbl-mod lbl-mod-sub', fill: '#8A8983',
      });
      modSub.textContent = `${g.ts.length} topics · ${g.nMats} files`;
      gg.appendChild(modLbl);
      gg.appendChild(modSub);

      // big invisible hit target for the whole galaxy
      const hit = el('circle', { cx: g.x, cy: g.y, r: g.R + 24, fill: 'transparent', class: 'uni-hit' });
      gg.appendChild(hit);
      hit.addEventListener('click', (e) => {
        if (state.level !== 0) return; // deeper levels have their own targets
        e.stopPropagation();
        goGalaxy(g);
      });

      for (const c of g.clusters) {
        const cg = el('g', { class: 'uni-cluster' });
        c.el = cg;
        gg.appendChild(cg);
        cg.appendChild(el('circle', {
          cx: c.x, cy: c.y, r: c.r, fill: color, opacity: 0.10,
          stroke: color, 'stroke-opacity': 0.35, 'stroke-width': 1,
        }));
        cg.appendChild(el('circle', { cx: c.x, cy: c.y, r: 3.4, fill: color, opacity: 0.9 }));

        const tl = el('text', {
          x: c.x, y: c.y - c.r - 6, 'text-anchor': 'middle', class: 'lbl-topic', fill: '#1A1A18',
        });
        tl.textContent = `${c.t ? c.t.name : 'Unsorted'} · ${c.mats.length}`;
        cg.appendChild(tl);

        const chit = el('circle', { cx: c.x, cy: c.y, r: c.r + 8, fill: 'transparent', class: 'uni-hit' });
        cg.appendChild(chit);
        chit.addEventListener('click', (e) => {
          if (state.level === 0) return; // let it bubble as a galaxy click
          e.stopPropagation();
          if (state.level === 1 && state.galaxy === g) goCluster(g, c);
        });

        c.mats.forEach((p, k) => {
          const mg = el('g', { class: 'uni-mat' });
          cg.appendChild(mg);
          mg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 1.7, fill: color, opacity: 0.85 }));
          // alternate label sides so neighbors on the spiral don't overlap
          const left = k % 2 === 1;
          const ml = el('text', {
            x: left ? p.x - 3 : p.x + 3, y: p.y + 1.1,
            'text-anchor': left ? 'end' : 'start', class: 'lbl-mat', fill: '#5C5B57',
          });
          ml.textContent = p.m.title.length > 34 ? `${p.m.title.slice(0, 33)}…` : p.m.title;
          mg.appendChild(ml);
          const mhit = el('circle', { cx: p.x, cy: p.y, r: 4, fill: 'transparent', class: 'uni-hit' });
          mg.appendChild(mhit);
          mhit.addEventListener('click', (e) => {
            if (state.level !== 2 || state.cluster !== c) return;
            e.stopPropagation();
            if (opts.onMaterial) opts.onMaterial(p.m);
          });
        });
      }
    }

    renderCrumb();
  };
})();
