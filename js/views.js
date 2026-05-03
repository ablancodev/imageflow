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
        const t = document.createElement("div");
        t.className = "runner-result-item";
        t.innerHTML = `
          <img src="${src}" alt="">
          ${label ? `<div class="thumb-label" title="${label.replace(/"/g, "&quot;")}">${label.replace(/</g, "&lt;")}</div>` : ""}
          <div class="runner-result-actions">
            <button class="ta-btn" data-action="preview">👁</button>
            <button class="ta-btn" data-action="download">⬇</button>
          </div>
        `;
        t.querySelector('[data-action="preview"]').onclick = () => Modal.preview(src, label || "Imagen");
        t.querySelector('[data-action="download"]').onclick = () => {
          const a = document.createElement("a");
          const safe = (label || `${node.type}-${i + 1}`).replace(/[^a-z0-9_-]+/gi, "_");
          a.href = src; a.download = `${safe}.png`; a.click();
        };
        grid.appendChild(t);
      });
      sec.appendChild(grid);
      wrap.appendChild(sec);
    });
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

  return { init, show, showLibrary, showEditor, showRunner, getCurrent, renderLibrary, renderRunnerTriggers, renderRunnerResults, renderRunnerLog };
})();
window.Views = Views;
