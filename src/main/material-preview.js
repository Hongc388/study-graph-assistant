/* Preview shell: PDF page tracking + text/md/html scroll restore. */
(function () {
  const params = new URLSearchParams(location.search);
  const filePath = params.get('file') || '';
  const fileUrl = params.get('fileUrl') || '';
  const materialId = Number(params.get('materialId') || 0);
  const ext = (params.get('ext') || '').toLowerCase();
  const startPage = Math.max(1, Number(params.get('page') || 1));
  const startScroll = Math.max(0, Number(params.get('scroll') || 0));

  let currentPage = startPage;
  let pdfDoc = null;
  let saving = false;
  let pdfZoom = 1;
  let preview = null;
  let pdfCtx = null; // 2d context of the current page canvas — used by the wiped-canvas guard

  function api() {
    return preview || window.previewApi;
  }

  function scrollEl() {
    if (pdfDoc) return document.getElementById('pdf-wrap');
    if (ext === 'md') return document.getElementById('md-view');
    if (ext === 'html') return document.getElementById('html-wrap');
    return document.getElementById('text-view');
  }

  function readScroll() {
    if (ext === 'html') {
      const frame = document.getElementById('preview-frame');
      try { return Math.round(frame.contentWindow?.scrollY || 0); } catch { return 0; }
    }
    const el = scrollEl();
    return el ? Math.round(el.scrollTop) : 0;
  }

  function progressPayload() {
    const payload = { materialId };
    if (pdfDoc) {
      payload.last_page = currentPage;
      payload.last_scroll = readScroll();
    } else {
      payload.last_scroll = readScroll();
    }
    return payload;
  }

  async function persistProgress() {
    if (!materialId || saving) return;
    saving = true;
    try {
      await api().saveProgress(progressPayload());
    } finally {
      saving = false;
    }
  }

  window.__savePreviewProgress = () => {
    if (!materialId) return;
    api()?.saveProgressSync(progressPayload());
  };

  const debouncedSave = (() => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(persistProgress, 400); };
  })();

  window.addEventListener('beforeunload', () => {
    if (!materialId) return;
    api()?.saveProgressSync(progressPayload());
  });
  window.addEventListener('blur', debouncedSave);

  async function waitForApi() {
    for (let i = 0; i < 100; i++) {
      if (window.previewApi?.readFile) return window.previewApi;
      await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('Preview API unavailable — quit the app fully (Cmd+Q) and run npm start again');
  }

  async function renderPdfPage(num) {
    const wrap = document.getElementById('pdf-wrap');
    wrap.innerHTML = '';
    const page = await pdfDoc.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const fitScale = Math.max(1, (wrap.clientWidth - 24) / base.width);
    const scale = Math.min(fitScale * pdfZoom, 4);
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;

    const pageBox = document.createElement('div');
    pageBox.id = 'page-box';
    pageBox.style.width = `${Math.floor(viewport.width)}px`;
    pageBox.style.height = `${Math.floor(viewport.height)}px`;
    wrap.appendChild(pageBox);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    pdfCtx = ctx;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    pageBox.appendChild(canvas);

    const transform = outputScale !== 1
      ? [outputScale, 0, 0, outputScale, 0, 0]
      : null;
    await page.render({ canvasContext: ctx, viewport, transform }).promise;

    // Highlight layer sits between the canvas and the selectable text layer.
    const hlLayer = document.createElement('div');
    hlLayer.id = 'hl-layer';
    pageBox.appendChild(hlLayer);
    drawHighlights();

    // pdf.js text layer: invisible glyph-positioned spans that make the page
    // selectable like real text. --scale-factor is required by pdf.js ≥3.
    try {
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      textLayer.style.setProperty('--scale-factor', String(viewport.scale));
      pageBox.appendChild(textLayer);
      await globalThis.pdfjsLib.renderTextLayer({
        textContentSource: await page.getTextContent(),
        container: textLayer,
        viewport,
      }).promise;
    } catch { /* scanned/image-only page — highlighting just won't trigger */ }

    if (startScroll && num === startPage) wrap.scrollTop = startScroll;

    document.getElementById('page-info').textContent =
      `Page ${num} / ${pdfDoc.numPages} · ${Math.round(pdfZoom * 100)}%`;
    document.getElementById('prev').disabled = num <= 1;
    document.getElementById('next').disabled = num >= pdfDoc.numPages;
  }

  // Chromium can discard a hidden or long-idle window's canvas backing store
  // (macOS App Nap / GPU memory purge); the rendered page then comes back
  // blank. Detect the wiped canvas and quietly repaint the current page.
  function canvasWiped() {
    if (!pdfCtx) return false;
    const { width, height } = pdfCtx.canvas;
    if (!width || !height) return true;
    try {
      for (const y of [0, Math.floor(height / 2), Math.max(0, height - 8)]) {
        const d = pdfCtx.getImageData(0, y, width, Math.min(8, height)).data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] || d[i + 1] || d[i + 2]) return false; // found a lit pixel
        }
      }
      return true; // every sampled pixel is black — the backing store is gone
    } catch { return false; }
  }

  let repainting = false;
  async function repaintIfWiped() {
    if (!pdfDoc || repainting || document.hidden || !canvasWiped()) return;
    repainting = true;
    try {
      const wrap = document.getElementById('pdf-wrap');
      const top = wrap.scrollTop;
      const left = wrap.scrollLeft;
      await renderPdfPage(currentPage);
      wrap.scrollTop = top;
      wrap.scrollLeft = left;
    } finally {
      repainting = false;
    }
  }

  async function openPdf() {
    document.getElementById('toolbar').hidden = false;
    document.getElementById('pdf-wrap').hidden = false;
    document.getElementById('zoom-in').hidden = false;
    document.getElementById('zoom-out').hidden = false;
    const pdfjsLib = globalThis.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js failed to load');
    pdfjsLib.GlobalWorkerOptions.workerSrc = params.get('worker') ||
      '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js';
    const data = await api().readFile(filePath);
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    currentPage = Math.min(startPage, pdfDoc.numPages);
    await renderPdfPage(currentPage);
    document.getElementById('prev').onclick = async () => {
      if (currentPage <= 1) return;
      currentPage--;
      await renderPdfPage(currentPage);
      debouncedSave();
    };
    document.getElementById('next').onclick = async () => {
      if (currentPage >= pdfDoc.numPages) return;
      currentPage++;
      await renderPdfPage(currentPage);
      debouncedSave();
    };
    document.getElementById('zoom-in').onclick = async () => {
      pdfZoom = Math.min(pdfZoom + 0.15, 2.5);
      await renderPdfPage(currentPage);
    };
    document.getElementById('zoom-out').onclick = async () => {
      pdfZoom = Math.max(pdfZoom - 0.15, 0.6);
      await renderPdfPage(currentPage);
    };
    document.getElementById('pdf-wrap').addEventListener('scroll', debouncedSave);
    await initHighlights();
    // heal the page after the OS blanks the canvas behind our back
    document.addEventListener('visibilitychange', repaintIfWiped);
    window.addEventListener('focus', repaintIfWiped);
    setInterval(repaintIfWiped, 20000);
  }

  // ---------- pdf highlights (select text, pick a color, it persists) ----------
  let highlights = [];

  const HL_COLORS = ['yellow', 'green', 'pink'];

  function pageBoxEl() { return document.getElementById('page-box'); }

  // Merge the per-span client rects of a selection into one rect per text line,
  // so a sentence becomes a clean bar instead of stacked translucent fragments.
  function mergeLineRects(rects) {
    const rows = [];
    for (const r of rects) {
      const row = rows.find(x => Math.abs(x.y - r.y) < r.h * 0.5);
      if (row) {
        const right = Math.max(row.x + row.w, r.x + r.w);
        row.x = Math.min(row.x, r.x);
        row.w = right - row.x;
        row.h = Math.max(row.h, r.h);
      } else {
        rows.push({ ...r });
      }
    }
    return rows;
  }

  function selectionRects() {
    const sel = window.getSelection();
    const box = pageBoxEl();
    if (!sel || sel.isCollapsed || !box || sel.rangeCount === 0) return null;
    const bb = box.getBoundingClientRect();
    const rects = [...sel.getRangeAt(0).getClientRects()]
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => ({
        x: (r.left - bb.left) / bb.width,
        y: (r.top - bb.top) / bb.height,
        w: r.width / bb.width,
        h: r.height / bb.height,
      }))
      .filter(r => r.x > -0.01 && r.y > -0.01 && r.x < 1 && r.y < 1);
    if (!rects.length) return null;
    return { rects: mergeLineRects(rects), text: sel.toString() };
  }

  function drawHighlights() {
    const layer = document.getElementById('hl-layer');
    if (!layer) return;
    layer.innerHTML = highlights
      .filter(h => h.page === currentPage)
      .map(h => {
        let rects;
        try { rects = JSON.parse(h.rects); } catch { return ''; }
        return rects.map(r => `<div class="hl hl-${esc(h.color)}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"></div>`).join('');
      }).join('');
  }

  function hideHlPop() {
    document.getElementById('hl-pop').hidden = true;
  }

  function showHlPop() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return hideHlPop();
    const box = pageBoxEl();
    if (!box || !box.contains(sel.anchorNode)) return hideHlPop();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (r.width < 2) return hideHlPop();
    const pop = document.getElementById('hl-pop');
    pop.hidden = false;
    pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, window.innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 8)}px`;
  }

  async function saveHighlight(color) {
    const got = selectionRects();
    hideHlPop();
    if (!got || !materialId) return;
    highlights = await api().highlightsCreate({
      material_id: materialId,
      page: currentPage,
      color,
      text: got.text.replace(/\s+/g, ' ').trim().slice(0, 500),
      rects: JSON.stringify(got.rects),
    });
    window.getSelection()?.removeAllRanges();
    drawHighlights();
    renderHlList();
  }

  function renderHlList() {
    const head = document.getElementById('hl-head');
    const list = document.getElementById('hl-list');
    if (!head || !list) return;
    head.hidden = highlights.length === 0;
    list.hidden = highlights.length === 0;
    list.innerHTML = highlights.map(h => `
      <div class="hl-item" data-page="${h.page}">
        <span class="hl-dot hl-${esc(h.color)}"></span>
        <span class="hl-text">${esc(h.text || '(passage)')}</span>
        <span class="hl-meta">p.${h.page}</span>
        <button class="danger-ghost hl-del" data-id="${h.id}" type="button">✕</button>
      </div>`).join('');
    list.querySelectorAll('.hl-item').forEach(el => {
      el.addEventListener('click', async (e) => {
        if (e.target.classList.contains('hl-del')) return;
        const p = Number(el.dataset.page);
        if (p !== currentPage) { currentPage = p; await renderPdfPage(p); debouncedSave(); }
      });
    });
    list.querySelectorAll('.hl-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        highlights = await api().highlightsDelete({ id: Number(btn.dataset.id), materialId });
        drawHighlights();
        renderHlList();
      });
    });
  }

  async function initHighlights() {
    if (!materialId || !api().highlightsList) return;
    highlights = await api().highlightsList(materialId);
    drawHighlights();
    renderHlList();
    const pop = document.getElementById('hl-pop');
    pop.innerHTML = HL_COLORS.map(c =>
      `<button class="hl-swatch hl-${c}" data-color="${c}" type="button" title="Highlight ${c}"></button>`).join('');
    pop.querySelectorAll('.hl-swatch').forEach(btn => {
      // mousedown, not click — click fires after the selection has collapsed
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        saveHighlight(btn.dataset.color);
      });
    });
    document.getElementById('pdf-wrap').addEventListener('mouseup', () => {
      setTimeout(showHlPop, 0); // let the selection settle first
    });
    document.getElementById('pdf-wrap').addEventListener('scroll', hideHlPop, { passive: true });
  }

  async function openText() {
    const el = document.getElementById('text-view');
    el.hidden = false;
    el.textContent = await api().readFile(filePath);
    if (startScroll) el.scrollTop = startScroll;
    el.addEventListener('scroll', debouncedSave, { passive: true });
  }

  async function openMarkdown() {
    const el = document.getElementById('md-view');
    el.hidden = false;
    const raw = await api().readFile(filePath);
    el.innerHTML = await api().renderMarkdown(raw);
    if (startScroll) el.scrollTop = startScroll;
    el.addEventListener('scroll', debouncedSave, { passive: true });
  }

  function bindHtmlScroll(frame) {
    try {
      const win = frame.contentWindow;
      if (!win) return;
      if (startScroll) win.scrollTo(0, startScroll);
      win.addEventListener('scroll', debouncedSave, { passive: true });
    } catch { /* sandboxed or cross-doc */ }
  }

  async function openHtml() {
    const wrap = document.getElementById('html-wrap');
    wrap.hidden = false;
    const frame = document.getElementById('preview-frame');
    frame.onload = () => bindHtmlScroll(frame);
    frame.src = fileUrl || filePath;
  }

  // ---------- reading notes (concept nodes while studying) ----------
  let noteGraph = { notes: [], links: [] };
  let selectedNoteIds = [];

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateHint() {
    const hint = document.getElementById('notes-hint');
    if (!hint) return;
    if (selectedNoteIds.length === 1) {
      hint.className = 'armed';
      hint.textContent = 'Click another note to link, or Add for a new concept.';
    } else if (selectedNoteIds.length === 2) {
      hint.className = 'armed';
      hint.textContent = 'Linked. Click a note to select again.';
    } else {
      hint.className = '';
      hint.textContent = 'Type a concept while reading. Click two notes to link them.';
    }
  }

  function redrawNotes() {
    const svg = document.getElementById('notes-graph');
    const list = document.getElementById('notes-list');
    if (!svg || !list) return;
    if (window.renderNotesGraph) {
      window.renderNotesGraph(svg, noteGraph.notes, noteGraph.links, {
        selectedIds: selectedNoteIds,
        onNodeClick: (note) => toggleSelect(note.id),
      });
    }
    list.innerHTML = noteGraph.notes.map(n => `
      <div class="note-item ${selectedNoteIds.includes(n.id) ? 'selected' : ''}" data-id="${n.id}">
        <div class="row">
          <b>${esc(n.label)}</b>
          <button class="danger-ghost note-del" data-id="${n.id}" type="button">✕</button>
        </div>
        <div class="meta">${n.page ? `p.${n.page} · ` : ''}${esc((n.created_at || '').slice(0, 16).replace('T', ' '))}</div>
      </div>`).join('') || '<div class="meta" style="padding:6px;color:#7d7d8a">No notes yet — capture ideas as you read.</div>';

    list.querySelectorAll('.note-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('note-del')) return;
        toggleSelect(Number(el.dataset.id));
      });
    });
    list.querySelectorAll('.note-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        noteGraph = await api().notesDelete({ id, materialId });
        selectedNoteIds = selectedNoteIds.filter(x => x !== id);
        redrawNotes();
        updateHint();
      });
    });
  }

  async function toggleSelect(id) {
    if (selectedNoteIds.includes(id)) {
      selectedNoteIds = selectedNoteIds.filter(x => x !== id);
    } else if (selectedNoteIds.length === 1) {
      const fromId = selectedNoteIds[0];
      noteGraph = await api().notesLink({ fromId, toId: id, materialId });
      selectedNoteIds = [];
    } else {
      selectedNoteIds = [id];
    }
    redrawNotes();
    updateHint();
  }

  async function addNote() {
    const input = document.getElementById('note-input');
    const label = (input.value || '').trim();
    if (!label || !materialId) return;
    noteGraph = await api().notesCreate({
      material_id: materialId,
      label,
      page: pdfDoc ? currentPage : null,
    });
    input.value = '';
    selectedNoteIds = [];
    redrawNotes();
    updateHint();
  }

  async function initNotesPanel() {
    if (!materialId || !api().notesList) return;
    const panel = document.getElementById('notes-panel');
    panel.hidden = false;
    document.getElementById('notes-toggle').onclick = () => {
      panel.classList.toggle('collapsed');
      document.getElementById('notes-toggle').textContent =
        panel.classList.contains('collapsed') ? '⟨' : '⟩';
    };
    document.getElementById('note-add').onclick = addNote;
    document.getElementById('note-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addNote();
      }
    });
    noteGraph = await api().notesList(materialId);
    redrawNotes();
    updateHint();
  }

  // ----- focus/pomodoro pill (state pushed from the main window each second) -----
  const mmss = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return `${m}:${s}`;
  };

  function renderTimerPill(state) {
    const pill = document.getElementById('timer-pill');
    if (!state) { pill.hidden = true; return; }
    pill.hidden = false;
    let html = `⏱ ${mmss(state.elapsedMs)}${state.paused ? ' <span class="dim">paused</span>' : ''}`;
    if (state.pomo) {
      if (state.pomo.phase === 'work') {
        html += ` <span class="dim">·</span> 🍅 ${mmss(state.pomo.remainingMs)} to break`;
      } else {
        html += ` <span class="dim">·</span> <span class="brk">☕ break ${mmss(state.pomo.remainingMs)}</span>`;
      }
    }
    pill.innerHTML = html;
  }

  // ----- break overlay: offer the earned break, freeze while resting -----
  let breakAnswered = false; // guards against double-clicks between state pushes

  function renderBreakOverlay(p) {
    const overlay = document.getElementById('break-overlay');
    if (!p || p.phase === 'work') { overlay.hidden = true; breakAnswered = false; return; }
    const pending = p.phase === 'break_pending';
    const title = document.getElementById('break-title');
    const sub = document.getElementById('break-sub');
    const count = document.getElementById('break-count');
    const actions = document.getElementById('break-actions');
    overlay.hidden = false;
    actions.hidden = !pending;
    count.hidden = pending;
    if (pending) {
      title.textContent = 'Pomodoro done 🍅';
      sub.textContent = `You earned a ${p.breakMin}-minute break. Step away from the screen?`;
      const yes = document.getElementById('break-yes');
      yes.textContent = `Take ${p.breakMin} min`;
      yes.disabled = document.getElementById('break-no').disabled = breakAnswered;
    } else {
      title.textContent = '☕ On a break';
      sub.textContent = 'The reading is frozen until the break ends.';
      count.textContent = mmss(p.remainingMs);
    }
  }

  function initTimerPill() {
    if (!api().onTimer) return;
    api().onTimer((state) => {
      renderTimerPill(state);
      renderBreakOverlay(state && state.pomo);
    });
    const answer = (accept) => {
      if (breakAnswered) return;
      breakAnswered = true;
      document.getElementById('break-yes').disabled = true;
      document.getElementById('break-no').disabled = true;
      api().breakChoice(accept);
    };
    document.getElementById('break-yes').addEventListener('click', () => answer(true));
    document.getElementById('break-no').addEventListener('click', () => answer(false));
  }

  async function boot() {
    if (!filePath) {
      document.body.textContent = 'Preview error: missing file';
      return;
    }
    try {
      preview = await waitForApi();
      if (ext === 'pdf') await openPdf();
      else if (ext === 'md') await openMarkdown();
      else if (ext === 'html') await openHtml();
      else await openText();
      await initNotesPanel();
      initTimerPill();
    } catch (e) {
      document.body.textContent = `Preview error: ${e.message}`;
    }
  }

  boot();
})();
