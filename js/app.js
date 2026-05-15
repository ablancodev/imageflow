// app.js — bootstrap, sidebar drag, toolbar buttons, modales.

const Modal = (() => {
  let regenCb = null;
  let regenSrc = null;

  function init() {
    const reg = document.getElementById("regen-modal");
    document.getElementById("regen-close").onclick = () => reg.classList.add("hidden");
    document.getElementById("regen-cancel").onclick = () => reg.classList.add("hidden");
    document.getElementById("regen-confirm").onclick = async () => {
      const p = document.getElementById("regen-prompt").value.trim();
      if (!p) return;
      reg.classList.add("hidden");
      if (regenCb) await regenCb(p);
    };
    reg.addEventListener("click", (e) => { if (e.target === reg) reg.classList.add("hidden"); });

    const prev = document.getElementById("preview-modal");
    const closePreview = () => {
      prev.classList.add("hidden");
      const vid = document.getElementById("preview-video");
      vid.pause(); vid.src = "";
    };
    document.getElementById("preview-close").onclick = closePreview;
    prev.addEventListener("click", (e) => { if (e.target === prev) closePreview(); });
  }

  function regenerate(src, cb) {
    regenSrc = src; regenCb = cb;
    document.getElementById("regen-img").src = src;
    document.getElementById("regen-prompt").value = "";
    document.getElementById("regen-modal").classList.remove("hidden");
    setTimeout(() => document.getElementById("regen-prompt").focus(), 50);
  }

  function preview(src, title = "Imagen") {
    const img = document.getElementById("preview-img");
    const vid = document.getElementById("preview-video");
    img.src = src; img.style.display = "";
    vid.pause(); vid.src = ""; vid.style.display = "none";
    document.getElementById("preview-title").textContent = title;
    document.getElementById("preview-modal").classList.remove("hidden");
  }

  function previewVideo(src, title = "Vídeo") {
    const img = document.getElementById("preview-img");
    const vid = document.getElementById("preview-video");
    img.src = ""; img.style.display = "none";
    vid.src = src; vid.style.display = "block"; vid.play();
    document.getElementById("preview-title").textContent = title;
    document.getElementById("preview-modal").classList.remove("hidden");
  }

  return { init, regenerate, preview, previewVideo };
})();

(function App() {
  function init() {
    safeStep("status-bar click clears", () => {
      const sb = document.getElementById("status-bar");
      if (sb) sb.addEventListener("click", () => {
        document.getElementById("status-msg").textContent = "Listo";
        sb.classList.remove("error", "success");
      });
    });
    safeStep("Settings.init", () => Settings.init());
    safeStep("WorkflowsManager.init", () => WorkflowsManager.init());
    safeStep("CanvasView.init", () => CanvasView.init());
    safeStep("NodeManager.init", () => NodeManager.init());
    safeStep("Connections.init", () => Connections.init());
    safeStep("Modal.init", () => Modal.init());
    safeStep("Views.init", () => Views.init());

    safeStep("sidebar drag", setupSidebarDrag);
    safeStep("toolbar", setupToolbar);
    safeStep("keyboard", setupKeyboard);

    // Si no hay ningún workflow, sembramos uno de ejemplo
    safeStep("seed initial library", () => {
      if (WorkflowsManager.list().length === 0) {
        const wf = WorkflowsManager.create("Ejemplo: prompt → AI → filtro → galería", null);
        WorkflowsManager.setDescription(wf.id,
          "Workflow de ejemplo. Edítalo o crea el tuyo con el botón superior.");
        // Cargar en NodeManager para crear el ejemplo y luego guardarlo
        NodeManager.deserialize({ nodes: [], connections: [], nextId: 1 });
        seedExample();
        WorkflowsManager.saveData(wf.id, NodeManager.serialize());
      }
    });

    // Vista de arranque: library
    safeStep("show library", () => Views.showLibrary());
  }

  function safeStep(label, fn) {
    try { fn(); } catch (err) { console.error(`[init] fallo en ${label}:`, err); }
  }

  function seedExample() {
    // Pequeña demo para que el usuario vea algo en pantalla al abrir
    const tp = NodeManager.addNode("text-prompt", 80, 120);
    const ai = NodeManager.addNode("ai-evolve", 420, 80);
    const fl = NodeManager.addNode("filter", 800, 80);
    const out = NodeManager.addNode("output", 1120, 80);
    Connections.connect({ nodeId: tp.id, key: "prompt" }, { nodeId: ai.id, key: "prompt" });
    Connections.connect({ nodeId: ai.id, key: "image" }, { nodeId: fl.id, key: "image" });
    Connections.connect({ nodeId: fl.id, key: "image" }, { nodeId: out.id, key: "image" });
    Connections.redraw();
    NodeManager.setStatus("Ejemplo cargado — pulsa Run Workflow");
  }

  function setupSidebarDrag() {
    const items = document.querySelectorAll(".node-item");
    items.forEach((item) => {
      // Usamos drag custom con mouse en vez de HTML5 drag para que funcione bien con el canvas
      item.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const type = item.dataset.nodeType;
        const ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.textContent = NodeManager.getTypes()[type].label;
        document.body.appendChild(ghost);

        const move = (ev) => {
          ghost.style.left = (ev.clientX + 10) + "px";
          ghost.style.top = (ev.clientY + 10) + "px";
        };
        const up = (ev) => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          ghost.remove();
          // Si soltamos sobre el viewport, crear nodo en coords mundo
          const vp = CanvasView.getViewport();
          const r = vp.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
            const w = CanvasView.screenToWorld(ev.clientX, ev.clientY);
            NodeManager.addNode(type, w.x - 120, w.y - 30);
            Connections.redraw();
            persist();
          }
        };
        move(e);
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
    });
  }

  function setupToolbar() {
    document.getElementById("btn-run").onclick = async () => {
      try { await Workflow.run(); } catch (err) { /* status ya seteado */ }
      persist();
    };
    document.getElementById("btn-save").onclick = () => {
      const data = NodeManager.serialize();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "imageflow.json"; a.click();
      URL.revokeObjectURL(url);
      NodeManager.setStatus("Workflow exportado", "success");
    };
    document.getElementById("btn-load").onclick = () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "application/json";
      inp.onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = (ev) => {
          try {
            NodeManager.deserialize(JSON.parse(ev.target.result));
            Connections.redraw();
            NodeManager.setStatus("Workflow cargado", "success");
            persist();
          } catch (err) { NodeManager.setStatus("Error cargando JSON", "error"); }
        };
        r.readAsText(f);
      };
      inp.click();
    };
    document.getElementById("btn-clear").onclick = () => {
      if (!confirm("¿Borrar todo el contenido del workflow actual?")) return;
      NodeManager.clearAll();
      const cur = WorkflowsManager.getCurrent();
      if (cur) WorkflowsManager.saveData(cur.id, NodeManager.serialize());
    };

    document.getElementById("zoom-in").onclick = () => CanvasView.setZoom(CanvasView.getScale() * 1.2);
    document.getElementById("zoom-out").onclick = () => CanvasView.setZoom(CanvasView.getScale() / 1.2);
    document.getElementById("zoom-reset").onclick = () => CanvasView.reset();
  }

  function setupKeyboard() {
    document.addEventListener("keydown", (e) => {
      // Evitar interferir en inputs/textareas
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        // Si hay nodo seleccionado, eliminarlo
        const selected = document.querySelector(".node.selected");
        if (selected) {
          NodeManager.deleteNode(selected.dataset.id);
          Connections.redraw();
          persist();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        document.getElementById("btn-run").click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        document.getElementById("btn-save").click();
      }
    });
  }

  let persistTimer;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      // Solo persistimos cuando estamos en el editor — en library/runner el
      // workflow ya está guardado y no debemos sobreescribirlo con el estado
      // vacío del NodeManager mientras esa vista está activa.
      if (Views.getCurrent && Views.getCurrent() !== "editor") return;
      const cur = WorkflowsManager.getCurrent && WorkflowsManager.getCurrent();
      if (!cur) return;
      try {
        WorkflowsManager.saveData(cur.id, NodeManager.serialize());
      } catch (err) {
        console.warn("No se pudo guardar workflow:", err);
      }
    }, 500);
  }

  // Persistir cada vez que cambia el canvas
  document.addEventListener("mouseup", persist);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
