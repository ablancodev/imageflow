// nodes.js — Definición de tipos de nodo, gestor, render y drag.

const NodeManager = (() => {
  // Definiciones declarativas — fácil añadir tipos
  const TYPES = {
    "image-input": {
      label: "Image Input",
      icon: "🖼",
      group: "trigger",
      inputs: [],
      outputs: [{ key: "image", label: "image" }],
      defaultData: () => ({ images: [] }),
      width: 260,
      render: renderImageInput,
    },
    "text-prompt": {
      label: "Text Prompt",
      icon: "✎",
      group: "trigger",
      inputs: [],
      outputs: [{ key: "prompt", label: "prompt" }],
      defaultData: () => ({ prompt: "Un paisaje de otro mundo, colores cálidos" }),
      width: 260,
      render: renderTextPrompt,
    },
    "ai-evolve": {
      label: "AI Evolve",
      icon: "✦",
      group: "ai",
      inputs: [{ key: "image", label: "img" }, { key: "prompt", label: "prompt" }],
      outputs: [{ key: "image", label: "out" }],
      defaultData: () => ({
        prompt: "Make it more vibrant, cinematic lighting",
        imagesPerPrompt: 3,
        variants: 1,
        model: Settings.get().defaultModel || "mock",
      }),
      width: 300,
      render: renderAIEvolve,
    },
    "loop": {
      label: "Loop",
      icon: "↻",
      group: "loop",
      inputs: [{ key: "image", label: "img" }],
      outputs: [{ key: "image", label: "out" }],
      defaultData: () => ({ iterations: 3, pickStrategy: "first" }),
      width: 240,
      render: renderLoop,
    },
    "filter": {
      label: "Filters",
      icon: "◐",
      group: "filter",
      inputs: [{ key: "image", label: "img" }],
      outputs: [{ key: "image", label: "out" }],
      defaultData: () => ({ brightness: 1, contrast: 1, saturate: 1, hueRotate: 0, blur: 0 }),
      width: 260,
      render: renderFilter,
    },
    "resize": {
      label: "Resize",
      icon: "▢",
      group: "filter",
      inputs: [{ key: "image", label: "img" }],
      outputs: [{ key: "image", label: "out" }],
      defaultData: () => ({ selectedFormats: [], fit: "cover" }),
      width: 280,
      render: renderResize,
    },
    "quality": {
      label: "Quality",
      icon: "◇",
      group: "filter",
      inputs: [{ key: "image", label: "img" }],
      outputs: [{ key: "image", label: "out" }],
      defaultData: () => ({ quality: 80, format: "jpeg", maxDimension: 0 }),
      width: 260,
      render: renderQuality,
    },
    "output": {
      label: "Gallery",
      icon: "▤",
      group: "output",
      inputs: [{ key: "image", label: "img" }],
      outputs: [],
      defaultData: () => ({}),
      width: 320,
      render: renderOutput,
    },
  };

  let nodes = []; // {id, type, x, y, data, results}
  let selectedId = null;
  let nextId = 1;

  function genId() { return "n" + (nextId++) + "_" + Math.random().toString(36).slice(2, 6); }

  function getTypes() { return TYPES; }
  function getNodes() { return nodes; }
  function getNode(id) { return nodes.find((n) => n.id === id); }

  function addNode(type, x, y, data = null, id = null) {
    const def = TYPES[type];
    if (!def) return null;
    const node = {
      id: id || genId(),
      type,
      x, y,
      data: data || def.defaultData(),
      results: [], // dataURLs producidas en última ejecución
    };
    nodes.push(node);
    renderNode(node);
    setStatus(`Nodo "${def.label}" añadido`);
    return node;
  }

  function deleteNode(id) {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const el = document.getElementById("node-" + id);
    if (el) el.remove();
    nodes.splice(idx, 1);
    if (window.Connections) Connections.removeForNode(id);
    if (selectedId === id) selectedId = null;
  }

  function selectNode(id) {
    selectedId = id;
    document.querySelectorAll(".node").forEach((el) => el.classList.toggle("selected", el.id === "node-" + id));
  }

  function clearSelection() {
    selectedId = null;
    document.querySelectorAll(".node.selected").forEach((el) => el.classList.remove("selected"));
  }

  function renderAll() {
    document.querySelectorAll(".node").forEach((el) => el.remove());
    nodes.forEach(renderNode);
  }

  function renderNode(node) {
    const def = TYPES[node.type];
    const existing = document.getElementById("node-" + node.id);
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.className = "node";
    el.id = "node-" + node.id;
    el.dataset.type = node.type;
    el.dataset.id = node.id;
    el.style.left = node.x + "px";
    el.style.top = node.y + "px";
    el.style.width = def.width + "px";

    // Header
    const header = document.createElement("div");
    header.className = "node-header";
    header.innerHTML = `
      <span class="nh-icon">${def.icon}</span>
      <span class="nh-title">${def.label}</span>
      <button class="nh-run" title="Ejecutar este nodo">▶</button>
      <button class="nh-del" title="Eliminar">✕</button>
    `;
    header.querySelector(".nh-del").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteNode(node.id);
      Connections.redraw();
    });
    header.querySelector(".nh-run").addEventListener("mousedown", (e) => e.stopPropagation());
    header.querySelector(".nh-run").addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await Workflow.runOne(node.id);
      } catch (err) {
        console.error("runOne falló:", err);
      }
    });
    el.appendChild(header);

    // Body — delegado al render del tipo
    const body = document.createElement("div");
    body.className = "node-body";
    def.render(body, node);
    el.appendChild(body);

    // Ports
    const ports = computePorts(node);
    ports.forEach((p) => {
      const dot = document.createElement("div");
      dot.className = `port port-${p.dir} port-${p.key}`;
      dot.style.top = p.relY + "px";
      dot.dataset.nodeId = node.id;
      dot.dataset.dir = p.dir;
      dot.dataset.key = p.key;
      dot.title = p.label;
      el.appendChild(dot);
    });

    // Drag header
    let dragging = null;
    header.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("nh-del")) return;
      e.stopPropagation();
      selectNode(node.id);
      dragging = { startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = (e.clientX - dragging.startX) / CanvasView.getScale();
      const dy = (e.clientY - dragging.startY) / CanvasView.getScale();
      node.x = dragging.origX + dx;
      node.y = dragging.origY + dy;
      el.style.left = node.x + "px";
      el.style.top = node.y + "px";
      Connections.redraw();
    });
    window.addEventListener("mouseup", () => { dragging = null; });

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      selectNode(node.id);
    });

    CanvasView.getWorld().appendChild(el);
  }

  // Devuelve coords relativas al nodo de cada port (para SVG)
  function computePorts(node) {
    const def = TYPES[node.type];
    const result = [];
    const headerH = 40;
    const portStartY = headerH + 30;
    const portGap = 26;
    def.inputs.forEach((p, i) => {
      result.push({ ...p, dir: "in", relY: portStartY + i * portGap });
    });
    def.outputs.forEach((p, i) => {
      result.push({ ...p, dir: "out", relY: portStartY + i * portGap });
    });
    return result;
  }

  // Posición ABSOLUTA en mundo de un puerto
  function portWorldPos(nodeId, dir, key) {
    const node = getNode(nodeId);
    if (!node) return null;
    const def = TYPES[node.type];
    const ports = computePorts(node);
    const p = ports.find((pp) => pp.dir === dir && pp.key === key);
    if (!p) return null;
    const x = dir === "in" ? node.x : node.x + def.width;
    return { x, y: node.y + p.relY };
  }

  function setStatus(msg, type = "") {
    const sb = document.getElementById("status-bar");
    const sm = document.getElementById("status-msg");
    if (!sb || !sm) return;
    sm.textContent = msg;
    sb.classList.remove("error", "success");
    if (type) sb.classList.add(type);
    clearTimeout(setStatus._t);
    // Errores se quedan pegados hasta el siguiente status para que se puedan leer.
    if (type !== "error") {
      setStatus._t = setTimeout(() => { sm.textContent = "Listo"; sb.classList.remove("error", "success"); }, 4000);
    }
  }

  // ===== RENDERERS POR TIPO =====
  function renderImageInput(body, node) {
    // Migración: formato viejo {src, name} → {images: [{src, name}]}
    if (node.data.src && !Array.isArray(node.data.images)) {
      node.data.images = [{ src: node.data.src, name: node.data.name || "imagen" }];
      delete node.data.src; delete node.data.name;
    }
    if (!Array.isArray(node.data.images)) node.data.images = [];

    const imgs = node.data.images;

    if (imgs.length === 0) {
      const zone = document.createElement("div");
      zone.className = "upload-zone";
      zone.innerHTML = `<div>📁 Click para subir<br><span style="opacity:0.6">o arrastra una o varias imágenes</span></div>`;
      attachUploadHandlers(zone, node);
      body.appendChild(zone);
    } else {
      const grid = document.createElement("div");
      grid.className = "input-grid";
      imgs.forEach((it, i) => {
        const tile = document.createElement("div");
        tile.className = "input-tile";
        tile.innerHTML = `
          <img src="${it.src}" alt="">
          <span class="input-tile-name" title="${(it.name || "").replace(/"/g, "&quot;")}">${(it.name || "imagen").replace(/</g, "&lt;")}</span>
          <button class="input-tile-del" title="Quitar">✕</button>
        `;
        tile.querySelector(".input-tile-del").addEventListener("click", (e) => {
          e.stopPropagation();
          imgs.splice(i, 1);
          renderNode(node);
          Connections.redraw();
        });
        tile.addEventListener("click", (e) => {
          e.stopPropagation();
          Modal.preview(it.src, it.name || "imagen");
        });
        grid.appendChild(tile);
      });
      body.appendChild(grid);

      const addBtn = document.createElement("div");
      addBtn.className = "upload-zone upload-add-more";
      addBtn.innerHTML = `<div>➕ Añadir más <span style="opacity:0.6">(o arrastra)</span></div>`;
      attachUploadHandlers(addBtn, node);
      body.appendChild(addBtn);

      const counter = document.createElement("div");
      counter.className = "node-meta";
      counter.innerHTML = `<span>${imgs.length} imagen${imgs.length !== 1 ? "es" : ""} cargada${imgs.length !== 1 ? "s" : ""}</span><span class="badge">${imgs.length}</span>`;
      body.appendChild(counter);
    }
  }

  function attachUploadHandlers(el, node) {
    el.addEventListener("click", () => {
      const inp = document.getElementById("hidden-file-input");
      inp.value = "";
      inp.multiple = true;
      inp.onchange = (e) => addFilesToNode(node, e.target.files);
      inp.click();
    });
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      addFilesToNode(node, e.dataTransfer.files);
    });
  }

  async function addFilesToNode(node, fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    if (!Array.isArray(node.data.images)) node.data.images = [];
    const reads = files.map((f) => new Promise((resolve) => {
      const r = new FileReader();
      r.onload = (ev) => resolve({ src: ev.target.result, name: f.name });
      r.onerror = () => resolve(null);
      r.readAsDataURL(f);
    }));
    const items = (await Promise.all(reads)).filter(Boolean);
    node.data.images.push(...items);
    renderNode(node);
    Connections.redraw();
    setStatus(`${items.length} imagen${items.length !== 1 ? "es" : ""} añadida${items.length !== 1 ? "s" : ""}`);
  }

  function renderTextPrompt(body, node) {
    const f = document.createElement("div"); f.className = "field";
    f.innerHTML = `<label>Prompt — una línea por imagen</label><textarea rows="4"></textarea>`;
    const ta = f.querySelector("textarea");
    ta.value = node.data.prompt || "";
    ta.addEventListener("input", (e) => {
      node.data.prompt = e.target.value;
      updateTextPromptCount(node);
    });
    ta.addEventListener("mousedown", (e) => e.stopPropagation());
    body.appendChild(f);

    const counter = document.createElement("div");
    counter.className = "node-meta ai-count";
    counter.id = `tp-count-${node.id}`;
    body.appendChild(counter);
    setTimeout(() => updateTextPromptCount(node), 0);
  }

  function updateTextPromptCount(node) {
    const el = document.getElementById(`tp-count-${node.id}`);
    if (!el) return;
    const lines = (node.data.prompt || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const n = lines.length || 0;
    el.innerHTML = n > 1
      ? `<span>${n} prompts (fan-out)</span><span class="badge">${n}</span>`
      : `<span>1 prompt</span><span class="badge">1</span>`;
  }

  function renderAIEvolve(body, node) {
    // Migración: nodos antiguos guardaban "variants" como "imágenes por prompt".
    if (node.data.imagesPerPrompt == null) {
      node.data.imagesPerPrompt = node.data.variants || 1;
      node.data.variants = 1;
    }

    body.appendChild(makeTextarea(
      "Prompt (sobreescribe el upstream)",
      node.data.prompt, (v) => { node.data.prompt = v; updateAICount(node); }, 3
    ));
    body.appendChild(makeRange("Imágenes por prompt", node.data.imagesPerPrompt, 1, 6, 1, (v) => { node.data.imagesPerPrompt = v; updateAICount(node); }));
    body.appendChild(makeRange("Variantes (re-runs)", node.data.variants, 1, 6, 1, (v) => { node.data.variants = v; updateAICount(node); }));

    // Migrar valores antiguos (mock-v1/v2/v3) a "mock"
    if (/^mock-v\d+$/.test(node.data.model || "")) node.data.model = "mock";

    const sel = document.createElement("div"); sel.className = "field";
    sel.innerHTML = `
      <label>Model</label>
      <select>
        <option value="mock">Mock (local, gratis)</option>
        <option value="nano-banana-2">Nano Banana 2 · Gemini</option>
      </select>
    `;
    const selectEl = sel.querySelector("select");
    selectEl.value = node.data.model;
    selectEl.addEventListener("change", (e) => {
      node.data.model = e.target.value;
      renderNode(node);
      Connections.redraw();
    });
    selectEl.addEventListener("mousedown", (e) => e.stopPropagation());
    body.appendChild(sel);

    // Aviso si el modelo elegido necesita API key y no la hay
    if (Settings.modelRequiresKey(node.data.model) && !Settings.isReady(node.data.model)) {
      const w = document.createElement("div");
      w.className = "api-warning";
      w.innerHTML = `⚠ Falta API key. <a id="open-settings-${node.id}">Abrir Settings</a>`;
      body.appendChild(w);
      w.querySelector("a").addEventListener("click", (e) => {
        e.stopPropagation();
        Settings.openModal();
      });
    }

    const counter = document.createElement("div");
    counter.className = "node-meta ai-count";
    counter.id = `ai-count-${node.id}`;
    body.appendChild(counter);
    setTimeout(() => updateAICount(node), 0);

    body.appendChild(makeRegenerateAllButton(node, "Regenerar variantes"));
    body.appendChild(makeThumbs(node));
  }

  function updateAICount(node) {
    const el = document.getElementById(`ai-count-${node.id}`);
    if (!el) return;
    // El textarea local es 1 prompt si tiene contenido. Si no, dependerá del upstream.
    const localFilled = (node.data.prompt || "").trim().length > 0;
    const promptHint = localFilled ? "1 prompt local" : "prompts upstream";
    const ipp = Math.max(1, parseInt(node.data.imagesPerPrompt, 10) || 1);
    const variants = Math.max(1, parseInt(node.data.variants, 10) || 1);
    const totalPerPrompt = ipp * variants;
    el.innerHTML = `<span>${promptHint} × ${ipp} img × ${variants} runs</span><span class="badge">${totalPerPrompt}/prompt</span>`;
  }

  function renderLoop(body, node) {
    body.appendChild(makeRange("Iterations", node.data.iterations, 1, 8, 1, (v) => { node.data.iterations = v; }));
    const sel = document.createElement("div"); sel.className = "field";
    sel.innerHTML = `<label>Pick from upstream</label><select><option value="first">First image</option><option value="all">All images</option><option value="last">Last only</option></select>`;
    sel.querySelector("select").value = node.data.pickStrategy;
    sel.querySelector("select").addEventListener("change", (e) => { node.data.pickStrategy = e.target.value; });
    sel.querySelector("select").addEventListener("mousedown", (e) => e.stopPropagation());
    body.appendChild(sel);
    const meta = document.createElement("div"); meta.className = "node-meta";
    meta.innerHTML = `<span>Feeds back to upstream</span><span class="badge">↻</span>`;
    body.appendChild(meta);
    body.appendChild(makeRegenerateAllButton(node, "Regenerar iteraciones"));
    body.appendChild(makeThumbs(node));
  }

  function makeRegenerateAllButton(node, label) {
    const f = document.createElement("div"); f.className = "field";
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost regen-all-btn";
    btn.innerHTML = `<span class="ico">↻</span> ${label}`;
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      node.data._rev = (node.data._rev || 0) + 1;
      NodeManager.setStatus("Regenerando…");
      try {
        await Workflow.runFrom(node.id);
        NodeManager.setStatus("Variantes regeneradas", "success");
      } catch (err) {
        // El status de error ya está visible desde runSubset; nada más que hacer
        console.error("Regen falló:", err);
      }
    });
    f.appendChild(btn);
    return f;
  }

  function renderFilter(body, node) {
    body.appendChild(makeRange("Brightness", node.data.brightness, 0, 2, 0.05, (v) => { node.data.brightness = v; }));
    body.appendChild(makeRange("Contrast", node.data.contrast, 0, 2, 0.05, (v) => { node.data.contrast = v; }));
    body.appendChild(makeRange("Saturate", node.data.saturate, 0, 3, 0.05, (v) => { node.data.saturate = v; }));
    body.appendChild(makeRange("Hue", node.data.hueRotate, 0, 360, 1, (v) => { node.data.hueRotate = v; }, "°"));
    body.appendChild(makeRange("Blur", node.data.blur, 0, 8, 0.1, (v) => { node.data.blur = v; }, "px"));
    body.appendChild(makeThumbs(node));
  }

  function renderResize(body, node) {
    if (!Array.isArray(node.data.selectedFormats)) node.data.selectedFormats = [];
    if (!node.data.focalPoint) node.data.focalPoint = { x: 0.5, y: 0.5 };

    // Punto focal — widget arrastrable
    body.appendChild(makeFocalWidget(node));

    const fmts = Settings.getFormats();
    const f = document.createElement("div"); f.className = "field";
    f.innerHTML = `<label>Formatos de salida</label>`;
    const list = document.createElement("div");
    list.className = "fmt-checks";

    if (fmts.length === 0) {
      list.innerHTML = `<div class="hint" style="margin:0">No hay formatos. Defínelos en <a id="open-st-${node.id}">Settings ⚙</a>.</div>`;
      list.querySelector("a").addEventListener("click", (e) => { e.stopPropagation(); Settings.openModal(); });
    } else {
      fmts.forEach((fmt) => {
        const id = `chk-${node.id}-${fmt.id}`;
        const checked = node.data.selectedFormats.includes(fmt.id);
        const row = document.createElement("label");
        row.className = "fmt-check";
        row.innerHTML = `
          <input type="checkbox" id="${id}" ${checked ? "checked" : ""}>
          <span class="fmt-check-name">${escapeHtml(fmt.name)}</span>
          <span class="fmt-check-dim">${fmt.width}×${fmt.height}</span>
        `;
        const inp = row.querySelector("input");
        inp.addEventListener("change", () => {
          const sel = new Set(node.data.selectedFormats);
          if (inp.checked) sel.add(fmt.id);
          else sel.delete(fmt.id);
          node.data.selectedFormats = Array.from(sel);
          updateResizeCount(node);
        });
        inp.addEventListener("mousedown", (e) => e.stopPropagation());
        list.appendChild(row);
      });
    }
    f.appendChild(list);
    body.appendChild(f);

    const fit = document.createElement("div"); fit.className = "field";
    fit.innerHTML = `
      <label>Modo de ajuste</label>
      <select>
        <option value="cover">Cover · rellena, recorta excedente</option>
        <option value="contain">Contain · letterbox (deja bordes)</option>
        <option value="stretch">Stretch · deforma para encajar</option>
      </select>
    `;
    fit.querySelector("select").value = node.data.fit || "cover";
    fit.querySelector("select").addEventListener("change", (e) => { node.data.fit = e.target.value; });
    fit.querySelector("select").addEventListener("mousedown", (e) => e.stopPropagation());
    body.appendChild(fit);

    const counter = document.createElement("div");
    counter.className = "node-meta ai-count";
    counter.id = `rs-count-${node.id}`;
    body.appendChild(counter);
    setTimeout(() => updateResizeCount(node), 0);

    body.appendChild(makeThumbs(node));
  }

  // Busca una imagen upstream para usar como preview del widget de focal point.
  // Prioriza: image-input.data.src → resultado más reciente del upstream conectado.
  function findInputPreview(node) {
    const incoming = Connections.getIncoming(node.id).filter((c) => c.to.key === "image");
    for (const edge of incoming) {
      const up = getNode(edge.from.nodeId);
      if (!up) continue;
      if (up.type === "image-input") {
        const items = Array.isArray(up.data.images) ? up.data.images : (up.data.src ? [{ src: up.data.src }] : []);
        if (items.length) return items[0].src;
      }
      if (up.results && up.results.length) return up.results[0];
    }
    return null;
  }

  function makeFocalWidget(node) {
    const f = document.createElement("div"); f.className = "field";
    f.innerHTML = `<label>Punto focal (cover)</label>`;
    const widget = document.createElement("div");
    widget.className = "focal-widget";
    const previewSrc = findInputPreview(node);
    if (previewSrc) {
      widget.style.backgroundImage = `url("${previewSrc}")`;
    } else {
      widget.classList.add("focal-placeholder");
      widget.innerHTML = `<span class="focal-hint">Arrastra el punto · sin preview</span>`;
    }
    const dot = document.createElement("div");
    dot.className = "focal-dot";
    widget.appendChild(dot);

    const update = () => {
      const fp = node.data.focalPoint;
      dot.style.left = (fp.x * 100) + "%";
      dot.style.top = (fp.y * 100) + "%";
    };
    update();

    let dragging = false;
    const setFromEvent = (ev) => {
      const r = widget.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
      node.data.focalPoint = { x, y };
      update();
    };
    widget.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      setFromEvent(e);
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      setFromEvent(e);
    });
    window.addEventListener("mouseup", () => { dragging = false; });

    f.appendChild(widget);

    // Pequeño output con coords en %
    const coords = document.createElement("div");
    coords.className = "focal-coords";
    const updCoords = () => {
      const fp = node.data.focalPoint;
      coords.textContent = `x: ${Math.round(fp.x * 100)}% · y: ${Math.round(fp.y * 100)}%`;
    };
    updCoords();
    widget.addEventListener("mousemove", updCoords);
    widget.addEventListener("mousedown", updCoords);
    f.appendChild(coords);

    return f;
  }

  function updateResizeCount(node) {
    const el = document.getElementById(`rs-count-${node.id}`);
    if (!el) return;
    const n = (node.data.selectedFormats || []).length;
    el.innerHTML = `<span>${n} formato${n !== 1 ? "s" : ""} × N entrada(s)</span><span class="badge">${n}/img</span>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  function renderQuality(body, node) {
    if (node.data.quality == null) node.data.quality = 80;
    if (!node.data.format) node.data.format = "jpeg";
    if (node.data.maxDimension == null) node.data.maxDimension = 0;

    body.appendChild(makeRange("Calidad", node.data.quality, 1, 100, 1, (v) => { node.data.quality = v; updateQualityHint(node); }, "%"));

    const sel = document.createElement("div"); sel.className = "field";
    sel.innerHTML = `
      <label>Formato</label>
      <select>
        <option value="jpeg">JPEG (foto, mejor compresión)</option>
        <option value="webp">WebP (moderno, peso pequeño)</option>
        <option value="png">PNG (sin pérdida, ignora calidad)</option>
      </select>
    `;
    sel.querySelector("select").value = node.data.format;
    sel.querySelector("select").addEventListener("change", (e) => {
      node.data.format = e.target.value;
      updateQualityHint(node);
    });
    sel.querySelector("select").addEventListener("mousedown", (e) => e.stopPropagation());
    body.appendChild(sel);

    body.appendChild(makeRange(
      "Max dimensión (lado mayor, 0 = sin tope)",
      node.data.maxDimension, 0, 4096, 64,
      (v) => { node.data.maxDimension = v; }, "px"
    ));

    const hint = document.createElement("div");
    hint.className = "node-meta ai-count";
    hint.id = `q-hint-${node.id}`;
    body.appendChild(hint);
    setTimeout(() => updateQualityHint(node), 0);

    body.appendChild(makeThumbs(node));
  }

  function updateQualityHint(node) {
    const el = document.getElementById(`q-hint-${node.id}`);
    if (!el) return;
    const fmt = (node.data.format || "jpeg").toUpperCase();
    if (node.data.format === "png") {
      el.innerHTML = `<span>PNG sin pérdida</span><span class="badge">lossless</span>`;
    } else {
      el.innerHTML = `<span>${fmt} a ${node.data.quality}%</span><span class="badge">${fmt}</span>`;
    }
  }

  function renderOutput(body, node) {
    const meta = document.createElement("div"); meta.className = "node-meta";
    meta.innerHTML = `<span>Resultados finales</span><span class="badge">${(node.results || []).length}</span>`;
    body.appendChild(meta);
    body.appendChild(makeThumbs(node, true));
  }

  // ===== HELPERS DE UI =====
  function makeTextarea(label, value, onChange, rows = 2) {
    const f = document.createElement("div"); f.className = "field";
    f.innerHTML = `<label>${label}</label><textarea rows="${rows}"></textarea>`;
    const ta = f.querySelector("textarea");
    ta.value = value || "";
    ta.addEventListener("input", (e) => onChange(e.target.value));
    ta.addEventListener("mousedown", (e) => e.stopPropagation());
    return f;
  }
  function makeRange(label, value, min, max, step, onChange, unit = "") {
    const f = document.createElement("div"); f.className = "field";
    f.innerHTML = `<label>${label}</label><div class="range-row"><input type="range" min="${min}" max="${max}" step="${step}"><span class="range-val"></span></div>`;
    const inp = f.querySelector("input");
    const out = f.querySelector(".range-val");
    inp.value = value;
    out.textContent = formatVal(value, unit);
    inp.addEventListener("input", (e) => {
      const v = step >= 1 ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
      out.textContent = formatVal(v, unit);
      onChange(v);
    });
    inp.addEventListener("mousedown", (e) => e.stopPropagation());
    return f;
  }
  function formatVal(v, unit) {
    if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(2) + unit;
    return v + unit;
  }

  function makeThumbs(node, large = false) {
    const wrap = document.createElement("div");
    wrap.className = "thumbs";
    if (large) wrap.style.gridTemplateColumns = "repeat(auto-fill, minmax(90px, 1fr))";
    if (!node.results || node.results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "thumb-empty";
      empty.textContent = "Sin resultados";
      wrap.appendChild(empty);
      return wrap;
    }
    const labels = node.resultsMeta || [];
    node.results.forEach((src, i) => {
      const t = document.createElement("div"); t.className = "thumb";
      const label = labels[i] || "";
      t.innerHTML = `
        <img src="${src}" alt="">
        ${label ? `<div class="thumb-label" title="${label.replace(/"/g, "&quot;")}">${label.replace(/</g, "&lt;")}</div>` : ""}
        <div class="thumb-actions">
          <button class="ta-btn" data-action="preview" title="Ver">👁</button>
          <button class="ta-btn" data-action="regen" title="Regenerar con prompt">↻</button>
          <button class="ta-btn" data-action="download" title="Descargar">⬇</button>
          <button class="ta-btn ta-danger" data-action="delete" title="Eliminar">🗑</button>
        </div>
      `;
      t.querySelector('[data-action="preview"]').addEventListener("click", (e) => {
        e.stopPropagation();
        Modal.preview(src, `${TYPES[node.type].label} #${i + 1}`);
      });
      t.querySelector('[data-action="regen"]').addEventListener("click", (e) => {
        e.stopPropagation();
        Modal.regenerate(src, async (newPrompt) => {
          NodeManager.setStatus("Regenerando…");
          try {
            const model = node.data.model || Settings.get().defaultModel || "mock";
            const out = await ImageGen.aiGenerate({ prompt: newPrompt, source: src, variants: 1, model });
            node.results[i] = out[0];
            renderNode(node);
            Connections.redraw();
            NodeManager.setStatus("Imagen regenerada", "success");
          } catch (err) {
            NodeManager.setStatus("Error: " + err.message, "error");
          }
        });
      });
      t.querySelector('[data-action="download"]').addEventListener("click", (e) => {
        e.stopPropagation();
        const a = document.createElement("a");
        const safe = (label || `${node.type}-${i + 1}`).replace(/[^a-z0-9_-]+/gi, "_");
        a.href = src; a.download = `${safe}.png`;
        a.click();
      });
      t.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
        e.stopPropagation();
        node.results.splice(i, 1);
        renderNode(node);
        Connections.redraw();
        NodeManager.setStatus(`Imagen descartada (${node.results.length} restantes)`);
      });
      // doble click rápido = preview
      t.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        Modal.preview(src, `${TYPES[node.type].label} #${i + 1}`);
      });
      wrap.appendChild(t);
    });
    return wrap;
  }

  function setResults(nodeId, results, meta) {
    const n = getNode(nodeId);
    if (!n) return;
    n.results = results;
    n.resultsMeta = Array.isArray(meta) ? meta : null;
    console.log(`[NodeManager] setResults ${n.type} (${nodeId}) → ${(results && results.length) || 0} items`);
    renderNode(n);
  }

  function setRunning(nodeId, on) {
    const el = document.getElementById("node-" + nodeId);
    if (el) el.classList.toggle("running", !!on);
  }

  function setError(nodeId, on) {
    const el = document.getElementById("node-" + nodeId);
    if (el) el.classList.toggle("error", !!on);
  }

  function clearAll() {
    nodes.slice().forEach((n) => deleteNode(n.id));
    Connections.clear();
  }

  function serialize() {
    return {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, data: n.data })),
      connections: Connections.serialize(),
      nextId,
    };
  }
  function deserialize(state) {
    clearAll();
    if (!state || !state.nodes) return;
    nextId = state.nextId || 1;
    state.nodes.forEach((n) => {
      // Migración: el tipo "crop" antiguo pasa a "resize" con defaults nuevos.
      if (n.type === "crop") {
        n.type = "resize";
        n.data = { selectedFormats: [], fit: "cover" };
      }
      addNode(n.type, n.x, n.y, n.data, n.id);
    });
    if (state.connections) Connections.deserialize(state.connections);
  }

  return {
    init: () => {},
    getTypes, getNodes, getNode, addNode, deleteNode, selectNode, clearSelection,
    renderAll, renderNode, computePorts, portWorldPos, setStatus,
    setResults, setRunning, setError, clearAll, serialize, deserialize,
  };
})();
