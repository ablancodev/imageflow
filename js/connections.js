// connections.js — gestiona conexiones entre puertos y dibujo SVG.
// Cada conexión = { id, from:{nodeId, key}, to:{nodeId, key} }

const Connections = (() => {
  let connections = [];
  let svg, viewport;
  let dragState = null;
  let nextId = 1;

  const COLOR_BY_OUT_TYPE = {
    "image-input": "#22c55e",
    "text-prompt": "#22c55e",
    "ai-evolve": "#b87cff",
    "loop": "#f5b22a",
    "filter": "#ec4899",
    "crop": "#ec4899",
    "video-generate": "#f97316",
  };

  function init() {
    svg = CanvasView.getSvg();
    viewport = CanvasView.getViewport();

    // Click delegado para puertos: arrastrar nueva conexión
    viewport.addEventListener("mousedown", (e) => {
      const port = e.target.closest(".port");
      if (!port) return;
      e.stopPropagation();
      e.preventDefault();
      const nodeId = port.dataset.nodeId;
      const dir = port.dataset.dir;
      const key = port.dataset.key;

      // Si es input y ya tiene conexión, "agarra" la existente para reorientar
      if (dir === "in") {
        const existing = connections.find((c) => c.to.nodeId === nodeId && c.to.key === key);
        if (existing) {
          // Quitar y empezar arrastre desde su origen
          connections = connections.filter((c) => c !== existing);
          dragState = { fromNodeId: existing.from.nodeId, fromKey: existing.from.key, dir: "out" };
        } else {
          dragState = { fromNodeId: nodeId, fromKey: key, dir: "in" };
        }
      } else {
        dragState = { fromNodeId: nodeId, fromKey: key, dir: "out" };
      }
      viewport.classList.add("connecting");
      redraw();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragState) return;
      dragState.mouseX = e.clientX;
      dragState.mouseY = e.clientY;
      redraw();
    });

    window.addEventListener("mouseup", (e) => {
      if (!dragState) return;
      const port = e.target.closest(".port");
      if (port) {
        const targetNodeId = port.dataset.nodeId;
        const targetDir = port.dataset.dir;
        const targetKey = port.dataset.key;
        // Una conexión solo se establece si une out → in
        if (targetDir !== dragState.dir && targetNodeId !== dragState.fromNodeId) {
          let from, to;
          if (dragState.dir === "out") {
            from = { nodeId: dragState.fromNodeId, key: dragState.fromKey };
            to = { nodeId: targetNodeId, key: targetKey };
          } else {
            from = { nodeId: targetNodeId, key: targetKey };
            to = { nodeId: dragState.fromNodeId, key: dragState.fromKey };
          }
          connect(from, to);
        }
      }
      dragState = null;
      viewport.classList.remove("connecting");
      redraw();
    });

    // Click sobre path elimina conexión
    svg.addEventListener("click", (e) => {
      const path = e.target.closest("path.conn");
      if (!path) return;
      const id = path.dataset.connId;
      connections = connections.filter((c) => c.id !== id);
      redraw();
    });

    CanvasView.onChange(redraw);
    window.addEventListener("resize", redraw);
  }

  function connect(from, to) {
    // Eliminar conexión existente al mismo input
    connections = connections.filter((c) => !(c.to.nodeId === to.nodeId && c.to.key === to.key));
    // No duplicar
    if (connections.find((c) => c.from.nodeId === from.nodeId && c.from.key === from.key && c.to.nodeId === to.nodeId && c.to.key === to.key)) return;
    // Validar tipo de puerto: el output con key=prompt sólo a input prompt; image a image
    const toNode = NodeManager.getNode(to.nodeId);
    const toDef = NodeManager.getTypes()[toNode.type];
    const toPort = toDef.inputs.find((p) => p.key === to.key);
    const fromNode = NodeManager.getNode(from.nodeId);
    const fromDef = NodeManager.getTypes()[fromNode.type];
    const fromPort = fromDef.outputs.find((p) => p.key === from.key);
    if (!toPort || !fromPort) return;
    // Permitir coincidencia exacta de key
    if (fromPort.key !== toPort.key) {
      // excepción: text-prompt → ai-evolve (prompt to prompt) ya cubierto.
      // Si no coinciden, rechazar.
      NodeManager.setStatus(`Tipos incompatibles: ${fromPort.key} → ${toPort.key}`, "error");
      return;
    }
    connections.push({ id: "c" + (nextId++), from, to });
    NodeManager.setStatus(`Conexión creada`);
    redraw();
  }

  function removeForNode(nodeId) {
    connections = connections.filter((c) => c.from.nodeId !== nodeId && c.to.nodeId !== nodeId);
    redraw();
  }

  function getConnections() { return connections; }
  function getIncoming(nodeId) { return connections.filter((c) => c.to.nodeId === nodeId); }
  function getOutgoing(nodeId) { return connections.filter((c) => c.from.nodeId === nodeId); }

  // Construye el path SVG bezier entre dos puntos en pantalla
  function bezierPath(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  function redraw() {
    if (!svg) return;
    svg.innerHTML = "";
    // marcar puertos conectados
    document.querySelectorAll(".port.connected").forEach((el) => el.classList.remove("connected"));

    connections.forEach((c) => {
      const fromNode = NodeManager.getNode(c.from.nodeId);
      const toNode = NodeManager.getNode(c.to.nodeId);
      if (!fromNode || !toNode) return;
      const wp1 = NodeManager.portWorldPos(c.from.nodeId, "out", c.from.key);
      const wp2 = NodeManager.portWorldPos(c.to.nodeId, "in", c.to.key);
      if (!wp1 || !wp2) return;
      const sp1 = CanvasView.worldToScreen(wp1.x, wp1.y);
      const sp2 = CanvasView.worldToScreen(wp2.x, wp2.y);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", bezierPath(sp1.x, sp1.y, sp2.x, sp2.y));
      path.setAttribute("class", "conn");
      path.dataset.connId = c.id;
      const color = COLOR_BY_OUT_TYPE[fromNode.type] || "#7c5cff";
      path.setAttribute("stroke", color);
      svg.appendChild(path);

      // marcar puertos
      const inDot = document.querySelector(`#node-${c.to.nodeId} .port.port-in.port-${c.to.key}`);
      const outDot = document.querySelector(`#node-${c.from.nodeId} .port.port-out.port-${c.from.key}`);
      if (inDot) inDot.classList.add("connected");
      if (outDot) outDot.classList.add("connected");
    });

    // Preview drag
    if (dragState && dragState.mouseX != null) {
      let p1, p2;
      const wp = NodeManager.portWorldPos(dragState.fromNodeId, dragState.dir, dragState.fromKey);
      if (!wp) return;
      const sp = CanvasView.worldToScreen(wp.x, wp.y);
      const rect = viewport.getBoundingClientRect();
      const mx = dragState.mouseX - rect.left;
      const my = dragState.mouseY - rect.top;
      if (dragState.dir === "out") { p1 = sp; p2 = { x: mx, y: my }; }
      else { p1 = { x: mx, y: my }; p2 = sp; }
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", bezierPath(p1.x, p1.y, p2.x, p2.y));
      path.setAttribute("class", "conn preview");
      path.setAttribute("stroke", "#7c5cff");
      svg.appendChild(path);
    }
  }

  function clear() { connections = []; redraw(); }

  function serialize() { return connections.map((c) => ({ from: c.from, to: c.to })); }
  function deserialize(arr) {
    connections = arr.map((c, i) => ({ id: "c" + (nextId++), from: c.from, to: c.to }));
    redraw();
  }

  return { init, connect, removeForNode, redraw, clear, getConnections, getIncoming, getOutgoing, serialize, deserialize };
})();
