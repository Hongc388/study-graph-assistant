// SVG force-directed topic graph + reading-notes graph (while studying a file).
(function () {
  const SVG = 'http://www.w3.org/2000/svg';

  function el(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    return n;
  }

  function truncate(s, n = 22) {
    const t = String(s || '');
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  }

  function svgPoint(svg, ev) {
    const p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  function bindDrag(svg, node, draw) {
    node.g.addEventListener('mousedown', (ev) => {
      node.pinned = true;
      const move = (m) => {
        const pt = svgPoint(svg, m);
        node.x = pt.x;
        node.y = pt.y;
        draw();
      };
      const up = () => {
        node.pinned = false;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      ev.preventDefault();
      ev.stopPropagation();
    });
  }

  window.renderGraph = function renderGraph(svg, topics, edges, moduleColors, onNodeClick) {
    svg.innerHTML = '';
    const W = svg.clientWidth || 900;
    const H = svg.clientHeight || 600;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const defs = el('defs');
    const marker = el('marker', {
      id: 'arrow', viewBox: '0 0 10 10', refX: 20, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse',
    });
    marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#085041' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const moduleIds = [...new Set(topics.map(t => t.module_id))];
    const centers = new Map(moduleIds.map((mid, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, moduleIds.length);
      return [mid, { x: W / 2 + Math.cos(a) * W / 4.5, y: H / 2 + Math.sin(a) * H / 4.5 }];
    }));
    const nodes = topics.map(t => {
      const c = centers.get(t.module_id);
      return {
        t,
        x: c.x + (Math.random() - 0.5) * 120,
        y: c.y + (Math.random() - 0.5) * 120,
        vx: 0,
        vy: 0,
        pinned: false,
      };
    });
    const byId = new Map(nodes.map(n => [n.t.id, n]));
    const links = edges
      .map(e => ({ e, a: byId.get(e.from_topic), b: byId.get(e.to_topic) }))
      .filter(l => l.a && l.b);

    const edgeLayer = el('g');
    const nodeLayer = el('g');
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    for (const l of links) {
      l.line = el('line', { class: `gedge ${l.e.kind}` });
      l.line.appendChild(el('title')).textContent =
        `${l.e.kind}${l.e.note ? `: ${l.e.note}` : ''}`;
      edgeLayer.appendChild(l.line);
    }
    for (const n of nodes) {
      n.g = el('g', { class: 'gnode' });
      const r = 8 + 6 * (n.t.mastery ?? 0.3);
      n.circle = el('circle', {
        r,
        fill: moduleColors.get(n.t.module_id) || '#5b8cff',
        stroke: '#0e0e10',
        'stroke-width': 1.5,
      });
      const label = el('text', { dy: r + 12, 'text-anchor': 'middle' });
      label.textContent = n.t.name;
      n.g.appendChild(n.circle);
      n.g.appendChild(label);
      nodeLayer.appendChild(n.g);
      bindDrag(svg, n, draw);
      n.g.addEventListener('click', () => onNodeClick && onNodeClick(n.t));
    }

    function draw() {
      for (const l of links) {
        l.line.setAttribute('x1', l.a.x);
        l.line.setAttribute('y1', l.a.y);
        l.line.setAttribute('x2', l.b.x);
        l.line.setAttribute('y2', l.b.y);
      }
      for (const n of nodes) n.g.setAttribute('transform', `translate(${n.x},${n.y})`);
    }

    let ticks = 0;
    function step() {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const d2 = dx * dx + dy * dy || 1;
          const f = 2600 / d2;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx -= dx * f;
          a.vy -= dy * f;
          b.vx += dx * f;
          b.vy += dy * f;
        }
      }
      for (const l of links) {
        const rest = l.e.kind === 'cross_module' || l.e.kind === 'analogy' ? 170 : 90;
        let dx = l.b.x - l.a.x;
        let dy = l.b.y - l.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - rest) * 0.02;
        dx /= d;
        dy /= d;
        l.a.vx += dx * f;
        l.a.vy += dy * f;
        l.b.vx -= dx * f;
        l.b.vy -= dy * f;
      }
      let maxV = 0;
      for (const n of nodes) {
        const c = centers.get(n.t.module_id);
        n.vx += (c.x - n.x) * 0.004;
        n.vy += (c.y - n.y) * 0.004;
        if (!n.pinned) {
          n.vx *= 0.85;
          n.vy *= 0.85;
          n.x += n.vx;
          n.y += n.vy;
          n.x = Math.max(30, Math.min(W - 30, n.x));
          n.y = Math.max(30, Math.min(H - 40, n.y));
          maxV = Math.max(maxV, Math.abs(n.vx) + Math.abs(n.vy));
        }
      }
      draw();
      if (++ticks < 600 && (maxV > 0.05 || ticks < 60)) requestAnimationFrame(step);
    }
    step();
  };

  /** Notes while reading — concept nodes + links for one material. */
  window.renderNotesGraph = function renderNotesGraph(svg, notes, links, opts = {}) {
    svg.innerHTML = '';
    const W = svg.clientWidth || 280;
    const H = svg.clientHeight || 220;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (!notes.length) {
      const t = el('text', {
        x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#7d7d8a', 'font-size': '11',
      });
      t.textContent = 'Notes appear as nodes';
      t.setAttribute('fill', '#8A8983');
      svg.appendChild(t);
      return;
    }

    const selected = new Set((opts.selectedIds || []).map(Number));
    const nodes = notes.map((note, i) => {
      const a = (2 * Math.PI * i) / notes.length - Math.PI / 2;
      const r0 = Math.min(W, H) * 0.28;
      return {
        note,
        x: W / 2 + Math.cos(a) * r0 + (Math.random() - 0.5) * 20,
        y: H / 2 + Math.sin(a) * r0 * 0.9 + (Math.random() - 0.5) * 16,
        vx: 0,
        vy: 0,
        pinned: false,
      };
    });
    const byId = new Map(nodes.map(n => [n.note.id, n]));
    const edgePairs = links
      .map(l => ({ l, a: byId.get(l.from_note), b: byId.get(l.to_note) }))
      .filter(x => x.a && x.b);

    const edgeLayer = el('g');
    const nodeLayer = el('g');
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    for (const ep of edgePairs) {
      ep.line = el('line', { class: 'nedge' });
      edgeLayer.appendChild(ep.line);
    }
    for (const n of nodes) {
      n.g = el('g', { class: 'nnode' });
      const on = selected.has(n.note.id);
      n.circle = el('circle', {
        r: on ? 11 : 8,
        fill: on ? '#085041' : '#F1EFE8',
        stroke: on ? '#0F6E56' : '#E5E3DB',
        'stroke-width': 1.5,
      });
      const label = el('text', { dy: 18, 'text-anchor': 'middle', fill: '#5C5B57', 'font-size': '9.5' });
      label.textContent = truncate(n.note.label, 16);
      n.g.appendChild(n.circle);
      n.g.appendChild(label);
      nodeLayer.appendChild(n.g);
      bindDrag(svg, n, draw);
      n.g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onNodeClick && opts.onNodeClick(n.note);
      });
    }

    function draw() {
      for (const ep of edgePairs) {
        ep.line.setAttribute('x1', ep.a.x);
        ep.line.setAttribute('y1', ep.a.y);
        ep.line.setAttribute('x2', ep.b.x);
        ep.line.setAttribute('y2', ep.b.y);
      }
      for (const n of nodes) n.g.setAttribute('transform', `translate(${n.x},${n.y})`);
    }

    let ticks = 0;
    function step() {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const d2 = dx * dx + dy * dy || 1;
          const f = 900 / d2;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx -= dx * f;
          a.vy -= dy * f;
          b.vx += dx * f;
          b.vy += dy * f;
        }
      }
      for (const ep of edgePairs) {
        let dx = ep.b.x - ep.a.x;
        let dy = ep.b.y - ep.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 70) * 0.03;
        dx /= d;
        dy /= d;
        ep.a.vx += dx * f;
        ep.a.vy += dy * f;
        ep.b.vx -= dx * f;
        ep.b.vy -= dy * f;
      }
      let maxV = 0;
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.01;
        n.vy += (H / 2 - n.y) * 0.01;
        if (!n.pinned) {
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x += n.vx;
          n.y += n.vy;
          n.x = Math.max(28, Math.min(W - 28, n.x));
          n.y = Math.max(22, Math.min(H - 28, n.y));
          maxV = Math.max(maxV, Math.abs(n.vx) + Math.abs(n.vy));
        }
      }
      draw();
      if (++ticks < 400 && (maxV > 0.04 || ticks < 40)) requestAnimationFrame(step);
    }
    step();
  };
})();
