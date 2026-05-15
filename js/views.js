// views.js — Library + Runner + switching de vistas.
// El editor (canvas) sigue gestionándose desde NodeManager/Connections; las vistas
// solo cambian qué se muestra en pantalla y proveen UIs alternativas.

const Views = (() => {
  let currentView = "library";

  function show(name) {
    currentView = name;
    document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
    const target = document.getElementById("view-" + name);
    if (target) target.classList.remove("hidden");
    document.body.dataset.view = name;
  }

  function showLibrary() {
    show("library");
    renderLibrary();
  }

  function showEditor(workflowId) {
    const wf = WorkflowsManager.get(workflowId);
    if (!wf) return showLibrary();
    WorkflowsManager.setCurrent(workflowId);
    // Cargar datos del workflow al canvas
    NodeManager.deserialize(wf.data || { nodes: [], connections: [] });
    document.getElementById("editor-name").value = wf.name || "";
    show("editor");
    Connections.redraw();
  }

  function showRunner(workflowId) {
    const wf = WorkflowsManager.get(workflowId);
    if (!wf) return showLibrary();
    WorkflowsManager.setCurrent(workflowId);
    NodeManager.deserialize(wf.data || { nodes: [], connections: [] });
    document.getElementById("runner-title").textContent = wf.name || "Workflow";
    document.getElementById("runner-description").textContent = wf.description || "";
    show("runner");
    renderRunnerTriggers();
    renderRunnerResults();
    renderRunnerLog();
    renderRunnerHistory(workflowId);
  }

  function getCurrent() { return currentView; }

  // ====================== LIBRARY ======================
  function renderLibrary() {
    const grid = document.getElementById("library-grid");
    const empty = document.getElementById("library-empty");
    const list = WorkflowsManager.list();
    grid.innerHTML = "";
    if (list.length === 0) {
      empty.classList.remove("hidden");
      grid.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    grid.classList.remove("hidden");

    list.forEach((wf) => {
      const card = document.createElement("div");
      card.className = "wf-card";
      const nodeCount = (wf.data && wf.data.nodes && wf.data.nodes.length) || 0;
      const triggerCount = ((wf.data && wf.data.nodes) || []).filter(
        (n) => n.type === "image-input" || n.type === "text-prompt"
      ).length;
      const date = wf.updatedAt ? new Date(wf.updatedAt).toLocaleString() : "—";
      card.innerHTML = `
        <div class="wf-card-header">
          <h3 class="wf-card-name"></h3>
          <span class="wf-card-badge">${nodeCount} nodos</span>
        </div>
        <p class="wf-card-desc"></p>
        <div class="wf-card-meta">
          <span>${triggerCount} trigger${triggerCount !== 1 ? "s" : ""}</span>
          <span>·</span>
          <span title="Última edición">${date}</span>
        </div>
        <div class="wf-card-actions">
          <button class="btn btn-primary" data-act="run">▶ Ejecutar</button>
          <button class="btn btn-ghost" data-act="edit">✎ Editar</button>
          <button class="btn btn-ghost" data-act="dup" title="Duplicar">⎘</button>
          <button class="btn btn-ghost" data-act="del" title="Eliminar">🗑</button>
        </div>
      `;
      // Inyectamos texto de forma segura
      card.querySelector(".wf-card-name").textContent = wf.name || "Sin nombre";
      card.querySelector(".wf-card-desc").textContent = wf.description || "(sin descripción)";

      card.querySelector('[data-act="run"]').onclick = () => showRunner(wf.id);
      card.querySelector('[data-act="edit"]').onclick = () => showEditor(wf.id);
      card.querySelector('[data-act="dup"]').onclick = () => {
        WorkflowsManager.duplicate(wf.id);
        renderLibrary();
      };
      card.querySelector('[data-act="del"]').onclick = () => {
        if (!confirm(`¿Eliminar "${wf.name}"? No se puede deshacer.`)) return;
        WorkflowsManager.remove(wf.id);
        renderLibrary();
      };
      grid.appendChild(card);
    });
  }

  // ====================== RUNNER ======================
  function renderRunnerTriggers() {
    const wrap = document.getElementById("runner-triggers");
    wrap.innerHTML = "";
    const triggers = NodeManager.getNodes().filter(
      (n) => n.type === "image-input" || n.type === "text-prompt"
    );
    if (triggers.length === 0) {
      wrap.innerHTML = `<div class="runner-empty">Este workflow no tiene nodos trigger (Image Input o Text Prompt).</div>`;
      return;
    }
    triggers.forEach((node) => {
      const card = document.createElement("div");
      card.className = "runner-trigger";
      const title = document.createElement("div");
      title.className = "runner-trigger-title";
      title.innerHTML = node.type === "image-input"
        ? `<span class="dot dot-trigger"></span> Image Input`
        : `<span class="dot dot-trigger"></span> Text Prompt`;
      card.appendChild(title);

      if (node.type === "image-input") {
        renderRunnerImageInput(card, node);
      } else if (node.type === "text-prompt") {
        renderRunnerTextPrompt(card, node);
      }
      wrap.appendChild(card);
    });
  }

  function renderRunnerImageInput(card, node) {
    if (!Array.isArray(node.data.images)) node.data.images = [];

    const grid = document.createElement("div");
    grid.className = "input-grid";
    if (node.data.images.length === 0) {
      const zone = document.createElement("div");
      zone.className = "upload-zone";
      zone.innerHTML = `<div>📁 Click para subir<br><span style="opacity:0.6">o arrastra una o varias</span></div>`;
      attachRunnerUpload(zone, node, card);
      card.appendChild(zone);
    } else {
      node.data.images.forEach((it, i) => {
        const tile = document.createElement("div");
        tile.className = "input-tile";
        tile.innerHTML = `
          <img src="${it.src}" alt="">
          <span class="input-tile-name"></span>
          <button class="input-tile-del">✕</button>
        `;
        tile.querySelector(".input-tile-name").textContent = it.name || "imagen";
        tile.querySelector(".input-tile-del").onclick = (e) => {
          e.stopPropagation();
          node.data.images.splice(i, 1);
          renderRunnerTriggers();
        };
        tile.onclick = () => Modal.preview(it.src, it.name || "imagen");
        grid.appendChild(tile);
      });
      card.appendChild(grid);
      const more = document.createElement("div");
      more.className = "upload-zone upload-add-more";
      more.innerHTML = `<div>➕ Añadir más (o arrastra)</div>`;
      attachRunnerUpload(more, node, card);
      card.appendChild(more);
    }
  }
  function attachRunnerUpload(el, node, card) {
    const triggerPick = () => {
      const inp = document.getElementById("hidden-file-input");
      inp.value = "";
      inp.multiple = true;
      inp.onchange = async (e) => {
        await readFilesInto(node, e.target.files);
        renderRunnerTriggers();
      };
      inp.click();
    };
    el.onclick = triggerPick;
    el.ondragover = (e) => { e.preventDefault(); el.classList.add("drag-over"); };
    el.ondragleave = () => el.classList.remove("drag-over");
    el.ondrop = async (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      await readFilesInto(node, e.dataTransfer.files);
      renderRunnerTriggers();
    };
  }
  async function readFilesInto(node, fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    const reads = files.map((f) => new Promise((res) => {
      const r = new FileReader();
      r.onload = (ev) => res({ src: ev.target.result, name: f.name });
      r.onerror = () => res(null);
      r.readAsDataURL(f);
    }));
    const items = (await Promise.all(reads)).filter(Boolean);
    if (!Array.isArray(node.data.images)) node.data.images = [];
    node.data.images.push(...items);
  }

  function renderRunnerTextPrompt(card, node) {
    const ta = document.createElement("textarea");
    ta.className = "runner-textarea";
    ta.placeholder = "Escribe el prompt aquí. Una línea por imagen para fan-out.";
    ta.rows = 4;
    ta.value = node.data.prompt || "";
    ta.oninput = () => { node.data.prompt = ta.value; };
    card.appendChild(ta);
  }

  function renderRunnerResults() {
    const wrap = document.getElementById("runner-results");
    wrap.innerHTML = "";
    // Recolectamos resultados de los nodos terminales (Output) o, si no hay,
    // de cualquier nodo con resultados.
    const allNodes = NodeManager.getNodes();
    const outputs = allNodes.filter((n) => n.type === "output");
    const targets = outputs.length ? outputs : allNodes.filter((n) => n.results && n.results.length);
    if (targets.length === 0) {
      wrap.innerHTML = `<div class="runner-empty">Aún sin ejecutar.</div>`;
      return;
    }
    targets.forEach((node) => {
      if (!node.results || !node.results.length) return;
      const sec = document.createElement("div");
      sec.className = "runner-result-section";
      const def = NodeManager.getTypes()[node.type];
      sec.innerHTML = `<div class="runner-result-title">${def.label}</div>`;
      const grid = document.createElement("div");
      grid.className = "runner-result-grid";
      const labels = node.resultsMeta || [];
      node.results.forEach((src, i) => {
        const label = labels[i] || "";
        const video = isVideoSrc(src);
        const t = document.createElement("div");
        t.className = "runner-result-item";
        const mediaEl = video
          ? `<video src="${src}" muted loop autoplay playsinline></video>`
          : `<img src="${src}" alt="">`;
        const ext = video ? guessExt(src, "webm") : guessExt(src, "png");
        t.innerHTML = `
          ${mediaEl}
          ${label ? `<div class="thumb-label" title="${label.replace(/"/g, "&quot;")}">${label.replace(/</g, "&lt;")}</div>` : ""}
          <div class="runner-result-actions">
            <button class="ta-btn" data-action="preview">👁</button>
            <button class="ta-btn" data-action="download">⬇</button>
          </div>
        `;
        t.querySelector('[data-action="preview"]').onclick = () => {
          video ? Modal.previewVideo(src, label || "Vídeo") : Modal.preview(src, label || "Imagen");
        };
        t.querySelector('[data-action="download"]').onclick = () => {
          const a = document.createElement("a");
          const safe = (label || `${node.type}-${i + 1}`).replace(/[^a-z0-9_-]+/gi, "_");
          a.href = src; a.download = `${safe}.${ext}`; a.click();
        };
        grid.appendChild(t);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });
  }

  function isVideoSrc(src) {
    return /\.(webm|mp4|ogg|mov)(\?|$)/i.test(src) || src.startsWith('data:video/');
  }

  function guessExt(src, fallback) {
    const m = src.match(/\.([a-z0-9]+)(\?|$)/i);
    if (m) return m[1].toLowerCase();
    if (src.startsWith('data:image/png')) return 'png';
    if (src.startsWith('data:image/jpeg')) return 'jpg';
    if (src.startsWith('data:image/webp')) return 'webp';
    if (src.startsWith('data:video/webm')) return 'webm';
    return fallback;
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'justo ahora';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
  }

  function fmtDuration(ms) {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  }

  async function renderRunnerHistory(workflowId) {
    const wrap = document.getElementById("runner-history");
    if (!wrap) return;
    wrap.innerHTML = "";

    let runs = [];
    try { runs = await RunsManager.getRuns(workflowId); } catch (e) { /* ignorar */ }

    if (runs.length === 0) {
      wrap.innerHTML = `<div class="runner-empty">Sin historial guardado.</div>`;
      return;
    }

    runs.forEach((run) => {
      const card = document.createElement("div");
      card.className = "history-run";
      card.dataset.runId = run.id;

      const thumb = run.thumbnail
        ? `<img class="history-thumb" src="${run.thumbnail}" alt="">`
        : `<div class="history-thumb-placeholder">▤</div>`;

      const dur = fmtDuration(run.durationMs);
      const meta = [
        `${run.resultCount} resultado${run.resultCount !== 1 ? 's' : ''}`,
        dur,
      ].filter(Boolean).join(' · ');

      card.innerHTML = `
        ${thumb}
        <div class="history-info">
          <div class="history-date">${timeAgo(run.createdAt)}</div>
          <div class="history-meta">${meta}</div>
        </div>
        <div class="history-actions">
          <button class="btn btn-primary" data-restore>Restaurar</button>
          <button class="btn btn-ghost" data-del title="Eliminar">✕</button>
        </div>
      `;

      card.querySelector('[data-restore]').onclick = () => restoreRun(run);
      card.querySelector('[data-del]').onclick = async () => {
        await RunsManager.deleteRun(run.id);
        const cur = WorkflowsManager.getCurrent();
        if (cur) renderRunnerHistory(cur.id);
      };

      wrap.appendChild(card);
    });
  }

  function restoreRun(run) {
    run.nodeResults.forEach((nr) => {
      const node = NodeManager.getNode(nr.nodeId);
      if (node) NodeManager.setResults(nr.nodeId, nr.results, nr.resultsMeta);
    });
    renderRunnerResults();
    // Abrir sección de resultados si estaba colapsada
    const resultsWrap = document.getElementById("runner-results-wrap");
    const resultsToggle = document.querySelector('[data-target="runner-results-wrap"]');
    if (resultsWrap && resultsWrap.classList.contains("collapsed")) {
      resultsWrap.classList.remove("collapsed");
      if (resultsToggle) resultsToggle.classList.remove("collapsed");
    }
  }

  function renderRunnerLog() {
    const wrap = document.getElementById("runner-log");
    if (!wrap) return;
    const entries = Logger.getEntries();
    if (entries.length === 0) {
      wrap.innerHTML = `<div class="runner-empty">Sin actividad aún.</div>`;
      return;
    }
    wrap.innerHTML = "";
    entries.forEach((e) => wrap.appendChild(renderLogEntry(e)));
    wrap.scrollTop = wrap.scrollHeight;
  }

  function renderLogEntry(e) {
    const div = document.createElement("div");
    div.className = `log-entry log-${e.level}`;
    const time = new Date(e.ts).toLocaleTimeString();
    const icons = {
      "info": "▸",
      "success": "✓",
      "warn": "⚠",
      "error": "✕",
      "run-start": "▶",
      "run-end": "✓",
      "run-end-error": "✕",
    };
    const ic = icons[e.level] || "·";
    const nodeBadge = e.nodeType ? `<span class="log-node">${e.nodeType}</span>` : "";
    div.innerHTML = `
      <span class="log-icon">${ic}</span>
      <span class="log-time">${time}</span>
      <span class="log-msg"></span>
      ${nodeBadge}
    `;
    div.querySelector(".log-msg").textContent = e.msg;
    return div;
  }

  function appendLogEntry(e) {
    const wrap = document.getElementById("runner-log");
    if (!wrap) return;
    if (e.level === "clear") {
      wrap.innerHTML = `<div class="runner-empty">Sin actividad aún.</div>`;
      return;
    }
    // Si es la primera entrada real, vaciamos el placeholder
    if (wrap.querySelector(".runner-empty")) wrap.innerHTML = "";
    wrap.appendChild(renderLogEntry(e));
    wrap.scrollTop = wrap.scrollHeight;
  }

  function init() {
    // Suscribir log siempre (aunque no estemos en runner — no pasa nada,
    // appendLogEntry busca el elemento y si no existe sale)
    Logger.subscribe((e) => appendLogEntry(e));

    // Botones de la library
    document.getElementById("btn-new-workflow").onclick = () => {
      const wf = WorkflowsManager.create("Nuevo workflow");
      showEditor(wf.id);
    };
    document.getElementById("btn-settings-lib").onclick = () => Settings.openModal();
    document.getElementById("btn-settings-run").onclick = () => Settings.openModal();

    // Editor back / name editing
    document.getElementById("btn-editor-back").onclick = () => {
      // Persistir antes de salir
      const cur = WorkflowsManager.getCurrent();
      if (cur) WorkflowsManager.saveData(cur.id, NodeManager.serialize());
      showLibrary();
    };
    document.getElementById("editor-name").addEventListener("change", (e) => {
      const cur = WorkflowsManager.getCurrent();
      if (cur) WorkflowsManager.rename(cur.id, e.target.value.trim() || "Sin nombre");
    });
    document.getElementById("editor-name").addEventListener("blur", (e) => {
      const cur = WorkflowsManager.getCurrent();
      if (cur) WorkflowsManager.rename(cur.id, e.target.value.trim() || "Sin nombre");
    });

    // Runner
    document.getElementById("btn-runner-back").onclick = () => showLibrary();
    document.getElementById("btn-runner-edit").onclick = () => {
      const cur = WorkflowsManager.getCurrent();
      if (cur) showEditor(cur.id);
    };
    document.getElementById("btn-runner-execute").onclick = async () => {
      Logger.clear();
      try {
        await Workflow.run();
      } catch (err) {
        // ya logueado
      }
      renderRunnerResults();
    };

    // Refrescar historial cuando se guarda una nueva ejecución
    document.addEventListener('imageflow:run-saved', (e) => {
      const cur = WorkflowsManager.getCurrent();
      if (cur && cur.id === e.detail.workflowId) {
        renderRunnerHistory(cur.id);
      }
    });

    const clearBtn = document.getElementById("runner-log-clear");
    if (clearBtn) clearBtn.onclick = (e) => {
      e.stopPropagation();
      Logger.clear();
    };

    // Toggle de secciones (Resultados / Registro)
    document.querySelectorAll(".runner-section-toggle").forEach((h) => {
      h.addEventListener("click", (e) => {
        // Ignorar clicks en botones internos
        if (e.target.closest("button")) return;
        const id = h.dataset.target;
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        target.classList.toggle("collapsed");
        h.classList.toggle("collapsed");
      });
    });
  }

  return { init, show, showLibrary, showEditor, showRunner, getCurrent, renderLibrary, renderRunnerTriggers, renderRunnerResults, renderRunnerLog, renderRunnerHistory };
})();
window.Views = Views;
