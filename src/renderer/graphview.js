// Tiny force-directed graph renderer on plain SVG — no external libraries.
// Nodes repel each other, edges act as springs, everything is dampened each
// tick until the layout settles. Drag a node to pin it while dragging.
(function () {
  const SVG = 'http://www.w3.org/2000/svg';

  function el(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    return n;
  }

  window.renderGraph = function renderGraph(svg, topics, edges, moduleColors, onNodeClick) {
    svg.innerHTML = '';
    const W = svg.clientWidth || 900, H = svg.clientHeight || 600;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // arrowhead for prereq edges
    const defs = el('defs');
    const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 20, refY: 5,
      markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#5b8cff' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Seed positions: cluster nodes of the same module around a shared center
    // so modules are visually grouped before forces even run.
    const moduleIds = [...new Set(topics.map(t => t.module_id))];
    const centers = new Map(moduleIds.map((mid, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, moduleIds.length);
      return [mid, { x: W / 2 + Math.cos(a) * W / 4.5, y: H / 2 + Math.sin(a) * H / 4.5 }];
    }));
    const nodes = topics.map(t => {
      const c = centers.get(t.module_id);
      return { t, x: c.x + (Math.random() - 0.5) * 120, y: c.y + (Math.random() - 0.5) * 120,
               vx: 0, vy: 0, pinned: false };
    });
    const byId = new Map(nodes.map(n => [n.t.id, n]));
    const links = edges
      .map(e => ({ e, a: byId.get(e.from_topic), b: byId.get(e.to_topic) }))
      .filter(l => l.a && l.b);

    const edgeLayer = el('g'), nodeLayer = el('g');
    svg.appendChild(edgeLayer); svg.appendChild(nodeLayer);

    for (const l of links) {
      l.line = el('line', { class: `gedge ${l.e.kind}` });
      l.line.appendChild(el('title')).textContent = `${l.e.kind}${l.e.note ? ': ' + l.e.note : ''}`;
      edgeLayer.appendChild(l.line);
    }
    for (const n of nodes) {
      n.g = el('g', { class: 'gnode' });
      const r = 8 + 6 * (n.t.mastery ?? 0.3);
      n.circle = el('circle', { r, fill: moduleColors.get(n.t.module_id) || '#5b8cff',
        stroke: '#0e0e10', 'stroke-width': 1.5 });
      const label = el('text', { dy: r + 12, 'text-anchor': 'middle' });
      label.textContent = n.t.name;
      n.g.appendChild(n.circle); n.g.appendChild(label);
      nodeLayer.appendChild(n.g);

      n.g.addEventListener('mousedown', (ev) => {
        n.pinned = true;
        const move = (m) => {
          const pt = svgPoint(svg, m);
          n.x = pt.x; n.y = pt.y; draw();
        };
        const up = () => { n.pinned = false;
          window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
        ev.preventDefault();
      });
      n.g.addEventListener('click', () => onNodeClick && onNodeClick(n.t));
    }

    function svgPoint(svg, ev) {
      const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }

    function draw() {
      for (const l of links) {
        l.line.setAttribute('x1', l.a.x); l.line.setAttribute('y1', l.a.y);
        l.line.setAttribute('x2', l.b.x); l.line.setAttribute('y2', l.b.y);
      }
      for (const n of nodes) n.g.setAttribute('transform', `translate(${n.x},${n.y})`);
    }

    // physics loop — stops once movement is negligible
    let ticks = 0;
    function step() {
      // pairwise repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy || 1;
          const f = 2600 / d2;
          const d = Math.sqrt(d2);
          dx /= d; dy /= d;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }
      // springs
      for (const l of links) {
        const rest = l.e.kind === 'cross_module' || l.e.kind === 'analogy' ? 170 : 90;
        let dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - rest) * 0.02;
        dx /= d; dy /= d;
        l.a.vx += dx * f; l.a.vy += dy * f;
        l.b.vx -= dx * f; l.b.vy -= dy * f;
      }
      // gentle pull toward module center keeps clusters together
      let maxV = 0;
      for (const n of nodes) {
        const c = centers.get(n.t.module_id);
        n.vx += (c.x - n.x) * 0.004; n.vy += (c.y - n.y) * 0.004;
        if (!n.pinned) {
          n.vx *= 0.85; n.vy *= 0.85;
          n.x += n.vx; n.y += n.vy;
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
})();
