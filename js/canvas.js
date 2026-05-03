// canvas.js — viewport con pan y zoom transformando un "world" interno.
// Las coordenadas del mundo son las que guardan los nodos.

const CanvasView = (() => {
  let viewport, world, grid, svg;
  let scale = 1;
  let tx = 0, ty = 0;
  let panning = false;
  let panStart = null;
  const MIN_SCALE = 0.25, MAX_SCALE = 2.5;

  let listeners = [];
  function emit() { listeners.forEach((fn) => fn({ scale, tx, ty })); }
  function onChange(fn) { listeners.push(fn); }

  function init() {
    viewport = document.getElementById("canvas-viewport");
    world = document.getElementById("canvas-world");
    grid = document.getElementById("canvas-grid");
    svg = document.getElementById("connections-svg");
    apply();

    viewport.addEventListener("mousedown", (e) => {
      // Solo pan si click directo en viewport/grid (no nodos/ports)
      if (e.target !== viewport && e.target !== grid) return;
      if (e.button !== 0 && e.button !== 1) return;
      panning = true;
      panStart = { x: e.clientX - tx, y: e.clientY - ty };
      viewport.classList.add("panning");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!panning) return;
      tx = e.clientX - panStart.x;
      ty = e.clientY - panStart.y;
      apply();
    });
    window.addEventListener("mouseup", () => {
      if (panning) {
        panning = false;
        viewport.classList.remove("panning");
      }
    });

    viewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = -e.deltaY * 0.0015;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * (1 + delta)));
      // mantener punto bajo el cursor estable
      const factor = newScale / scale;
      tx = mx - factor * (mx - tx);
      ty = my - factor * (my - ty);
      scale = newScale;
      apply();
    }, { passive: false });

    // Click vacío deselecciona nodos
    viewport.addEventListener("click", (e) => {
      if (e.target === viewport || e.target === grid) {
        if (window.NodeManager) NodeManager.clearSelection();
      }
    });
  }

  function apply() {
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    grid.style.transform = `translate(${tx % (24 * scale)}px, ${ty % (24 * scale)}px) scale(${scale})`;
    document.getElementById("zoom-label").textContent = Math.round(scale * 100) + "%";
    emit();
  }

  function setZoom(newScale, anchor) {
    const rect = viewport.getBoundingClientRect();
    const mx = anchor ? anchor.x : rect.width / 2;
    const my = anchor ? anchor.y : rect.height / 2;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    const factor = newScale / scale;
    tx = mx - factor * (mx - tx);
    ty = my - factor * (my - ty);
    scale = newScale;
    apply();
  }

  function reset() {
    scale = 1; tx = 0; ty = 0; apply();
  }

  // Pasa coordenadas de pantalla a coordenadas de mundo
  function screenToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale,
    };
  }

  // Mundo → pantalla (para SVG superpuesto)
  function worldToScreen(x, y) {
    const rect = viewport.getBoundingClientRect();
    return { x: x * scale + tx, y: y * scale + ty };
  }

  function getViewport() { return viewport; }
  function getWorld() { return world; }
  function getSvg() { return svg; }
  function getScale() { return scale; }

  return { init, setZoom, reset, screenToWorld, worldToScreen, onChange, getViewport, getWorld, getSvg, getScale };
})();
