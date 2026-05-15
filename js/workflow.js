// workflow.js — ejecución del grafo en orden topológico.
// Recoge inputs por nodo, ejecuta handler por tipo, propaga outputs.
// Maneja loops con "feedback edges": si un edge va de un nodo posterior
// a uno anterior, lo trata como retroalimentación dentro del bucle.

const Workflow = (() => {

  // Hash determinista para semillas estables — re-ejecutar el workflow
  // sin cambiar nada produce las MISMAS imágenes upstream. Solo cambian
  // los nodos cuyos parámetros cambiaron, o si el usuario fuerza regen.
  function stableSeed(parts) {
    const s = parts.join("|");
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Hash corto de un dataURL para incluirlo en la semilla sin pasarlo entero
  function shortHash(str) {
    if (!str) return "0";
    let h = 5381;
    const step = Math.max(1, Math.floor(str.length / 64));
    for (let i = 0; i < str.length; i += step) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Resuelve el contenido (image dataURL o prompt string) que llega a un puerto input
  function gatherInput(node, key, outputs) {
    const incoming = Connections.getIncoming(node.id).filter((c) => c.to.key === key);
    const values = [];
    incoming.forEach((edge) => {
      const upstream = outputs[edge.from.nodeId];
      if (!upstream) return;
      const v = upstream[edge.from.key];
      if (v == null) return;
      if (Array.isArray(v)) values.push(...v);
      else values.push(v);
    });
    return values;
  }

  // Topological sort ignorando ciclos (los aristas hacia atrás se ignoran;
  // los ciclos los maneja el nodo Loop iterando internamente)
  function topoSort(nodes, conns) {
    const adj = new Map();
    const indeg = new Map();
    nodes.forEach((n) => { adj.set(n.id, []); indeg.set(n.id, 0); });
    conns.forEach((c) => {
      if (!adj.has(c.from.nodeId) || !adj.has(c.to.nodeId)) return;
      adj.get(c.from.nodeId).push(c.to.nodeId);
      indeg.set(c.to.nodeId, indeg.get(c.to.nodeId) + 1);
    });
    const order = [];
    const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      adj.get(id).forEach((to) => {
        indeg.set(to, indeg.get(to) - 1);
        if (indeg.get(to) === 0) queue.push(to);
      });
    }
    // Si quedan nodos (ciclo), añadirlos al final por orden de aparición
    nodes.forEach((n) => { if (!order.includes(n.id)) order.push(n.id); });
    return order;
  }

  let isRunning = false;
  function isBusy() { return isRunning; }

  async function withGuard(fn) {
    if (isRunning) {
      NodeManager.setStatus("Ya hay una ejecución en curso", "error");
      return;
    }
    isRunning = true;
    document.body.classList.add("workflow-running");
    try { return await fn(); }
    finally {
      isRunning = false;
      document.body.classList.remove("workflow-running");
    }
  }

  async function run() {
    return await withGuard(() => runSubset({ targetIds: null }));
  }

  // Ejecuta desde un nodo dado y todos sus descendientes (transitivos).
  // Los nodos upstream que no están en el conjunto reutilizan sus
  // node.results actuales como outputs (sin regenerar).
  async function runFrom(startNodeId) {
    const conns = Connections.getConnections();
    const set = descendants(startNodeId, conns);
    return await withGuard(() => runSubset({ targetIds: set }));
  }

  // Ejecuta SOLO el nodo dado, reusando los outputs upstream existentes.
  // Útil para iterar parámetros de un nodo sin re-ejecutar lo que viene después.
  async function runOne(nodeId) {
    return await withGuard(() => runSubset({ targetIds: new Set([nodeId]) }));
  }

  function descendants(startId, conns) {
    const set = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      conns.filter((c) => c.from.nodeId === id).forEach((c) => {
        if (!set.has(c.to.nodeId)) { set.add(c.to.nodeId); queue.push(c.to.nodeId); }
      });
    }
    return set;
  }

  async function runSubset({ targetIds }) {
    const LOG = (...a) => console.log("[Workflow]", ...a);
    const nodes = NodeManager.getNodes();
    const conns = Connections.getConnections();
    if (nodes.length === 0) {
      NodeManager.setStatus("No hay nodos para ejecutar", "error");
      Logger.error("No hay nodos para ejecutar");
      return;
    }
    const t0 = Date.now();
    const order = topoSort(nodes, conns);
    const targetSet = targetIds; // null = ejecutar todo
    const outputs = {};

    LOG("runSubset", {
      mode: !targetSet ? "ALL" : targetSet.size === 1 ? "ONE" : "FROM",
      target: targetSet ? [...targetSet] : null,
      orderIds: order,
    });
    const mode = !targetSet ? "Workflow completo"
               : targetSet.size === 1 ? "Nodo individual"
               : "Subgrafo";
    const willRun = order.filter((id) => !targetSet || targetSet.has(id)).length;
    Logger.startRun(`${mode} · ${willRun} nodo${willRun !== 1 ? "s" : ""}`);

    // Pre-poblar outputs de nodos que no se van a re-ejecutar
    if (targetSet) {
      nodes.forEach((n) => {
        if (targetSet.has(n.id)) return;
        if (n.type === "image-input") {
          // Compat con formato viejo {src, name}
          if (n.data.src && !Array.isArray(n.data.images)) {
            n.data.images = [{ src: n.data.src, name: n.data.name || "imagen" }];
            delete n.data.src; delete n.data.name;
          }
          const items = Array.isArray(n.data.images) ? n.data.images : [];
          const srcs = items.map((it) => it.src).filter(Boolean);
          if (srcs.length) outputs[n.id] = { image: srcs.slice() };
        } else if (n.type === "text-prompt" && n.data.prompt) {
          outputs[n.id] = { prompt: n.data.prompt };
        } else if (n.results && n.results.length) {
          outputs[n.id] = { image: n.results.slice() };
        }
      });
      LOG("pre-poblado outputs:", Object.keys(outputs));
    }

    NodeManager.setStatus(
      !targetSet ? "Ejecutando workflow…"
      : targetSet.size === 1 ? "Ejecutando nodo…"
      : "Re-ejecutando subgrafo…"
    );
    let executed = 0;
    for (const nodeId of order) {
      if (targetSet && !targetSet.has(nodeId)) continue;
      const node = NodeManager.getNode(nodeId);
      if (!node) continue;
      try {
        NodeManager.setRunning(nodeId, true);
        NodeManager.setError(nodeId, false);
        LOG(`▶ ejecutando ${node.type} (${nodeId})`);
        Logger.info(`Ejecutando ${node.type}…`, { nodeId, nodeType: node.type });
        const t0 = Date.now();
        const result = await runNode(node, outputs);
        const ms = Date.now() - t0;
        outputs[nodeId] = result.outputs;
        const nResults = (result.results && result.results.length) || 0;
        LOG(`✓ ${node.type} (${nodeId}) → ${nResults} imagen(es), outputs:`, Object.keys(result.outputs || {}));
        Logger.success(
          `${node.type} → ${nResults} imagen${nResults !== 1 ? "es" : ""} · ${ms} ms`,
          { nodeId, nodeType: node.type, ms, count: nResults }
        );
        if (result.results) {
          NodeManager.setResults(nodeId, result.results, result.resultsMeta);
          Connections.redraw();
        }
        NodeManager.setRunning(nodeId, false);
        executed++;
      } catch (err) {
        console.error("[Workflow] Error en nodo", nodeId, node.type, err);
        NodeManager.setRunning(nodeId, false);
        NodeManager.setError(nodeId, true);
        NodeManager.setStatus(`Error en ${node.type}: ${err.message}`, "error");
        Logger.error(`${node.type}: ${err.message}`, { nodeId, nodeType: node.type, stack: err.stack });
        Logger.endRun(`Detenido por error en ${node.type}`, false);
        throw err;
      }
    }
    NodeManager.setStatus(`Workflow completado (${executed} nodos)`, "success");
    LOG(`completado (${executed} nodos)`);
    Logger.endRun(`Completado · ${executed} nodo${executed !== 1 ? "s" : ""} ejecutado${executed !== 1 ? "s" : ""}`, true);

    // Guardar resultados en historial persistente
    if (executed > 0) {
      try {
        const wf = WorkflowsManager.getCurrent();
        if (wf) {
          await RunsManager.saveRun(wf.id, wf.name, NodeManager.getNodes(), Date.now() - t0);
          document.dispatchEvent(new CustomEvent('imageflow:run-saved', { detail: { workflowId: wf.id } }));
        }
      } catch (e) {
        console.warn('[Workflow] No se pudo guardar el historial:', e);
      }
    }

    return executed;
  }

  // Ejecuta un nodo individual. Devuelve { outputs: {key: value}, results: [dataURLs?] }
  async function runNode(node, outputs) {
    switch (node.type) {
      case "image-input": {
        // Compat: si hay data.src antiguo, lo migramos en caliente.
        if (node.data.src && !Array.isArray(node.data.images)) {
          node.data.images = [{ src: node.data.src, name: node.data.name || "imagen" }];
          delete node.data.src; delete node.data.name;
        }
        const items = Array.isArray(node.data.images) ? node.data.images : [];
        const srcs = items.map((it) => it.src).filter(Boolean);
        if (srcs.length === 0) throw new Error("Sin imágenes");
        return { outputs: { image: srcs.slice() }, results: srcs.slice() };
      }
      case "text-prompt": {
        const raw = (node.data.prompt || "").trim();
        if (!raw) throw new Error("Prompt vacío");
        const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
        // Si tiene varias líneas, emite array (fan-out aguas abajo).
        const out = lines.length > 1 ? lines : raw;
        return { outputs: { prompt: out } };
      }
      case "ai-evolve": {
        const promptInputs = gatherInput(node, "prompt", outputs);
        const imageInputs = gatherInput(node, "image", outputs);
        const promptOverride = (node.data.prompt || "").trim();
        // El textarea local es UN prompt detallado (multi-línea OK).
        // Para fan-out con varios prompts distintos, usa un Text Prompt
        // multi-línea conectado al puerto de prompt.
        let prompts;
        if (promptOverride) {
          prompts = [promptOverride];
        } else {
          prompts = promptInputs.length ? promptInputs : ["abstract evolution"];
        }

        const imagesPerPrompt = Math.max(1, parseInt(node.data.imagesPerPrompt, 10) || 1);
        const variants = Math.max(1, parseInt(node.data.variants, 10) || 1);
        const sources = imageInputs.length ? imageInputs : [null];
        const rev = node.data._rev || 0;
        const model = node.data.model || "mock";
        const all = [];

        // Total imágenes = sources × prompts × imagesPerPrompt × variants
        for (let v = 0; v < variants; v++) {
          for (let si = 0; si < sources.length; si++) {
            for (let pi = 0; pi < prompts.length; pi++) {
              const src = sources[si];
              const prompt = prompts[pi];
              const seedBase = stableSeed([node.id, prompt, rev, v, si, pi, shortHash(src)]);
              // aiGenerate hace `imagesPerPrompt` llamadas en paralelo a la API
              const out = await ImageGen.aiGenerate({
                prompt, source: src, variants: imagesPerPrompt, seedBase, model,
                aspectRatio: node.data.aspectRatio || "1:1",
                imageSize: node.data.imageSize || "1K",
              });
              all.push(...out);
            }
          }
        }
        return { outputs: { image: all.slice() }, results: all.slice() };
      }
      case "loop": {
        const incoming = Connections.getIncoming(node.id);
        if (incoming.length === 0) throw new Error("Loop sin entrada");
        const imageInputs = gatherInput(node, "image", outputs);
        if (imageInputs.length === 0) throw new Error("Loop necesita imágenes upstream");

        // Estrategia: el Loop reproduce el subgrafo aguas arriba "iterations" veces,
        // alimentando la salida de cada iteración como nueva entrada del nodo previo
        // que tenga input de imagen (típicamente el AI Evolve).
        // Implementación pragmática: tomamos las imágenes de entrada, y por cada
        // iteración llamamos a aiGenerate con un prompt que lleva el "Iteration N",
        // tomando como source la imagen previa según pickStrategy.
        let current = imageInputs;
        const trail = [];
        const iters = Math.max(1, parseInt(node.data.iterations, 10) || 1);
        const rev = node.data._rev || 0;
        for (let i = 0; i < iters; i++) {
          const seed = current.map((s) => s);
          let pick;
          if (node.data.pickStrategy === "all") pick = seed;
          else if (node.data.pickStrategy === "last") pick = [seed[seed.length - 1]];
          else pick = [seed[0]];
          const next = [];
          for (let pi = 0; pi < pick.length; pi++) {
            const s = pick[pi];
            const seedBase = stableSeed([node.id, rev, i, pi, shortHash(s)]);
            const out = await ImageGen.aiGenerate({ prompt: `iteration ${i + 1}`, source: s, variants: 1, seedBase });
            next.push(...out);
          }
          current = next;
          trail.push(...next);
        }
        return { outputs: { image: current.slice() }, results: trail.slice() };
      }
      case "filter": {
        const imgs = gatherInput(node, "image", outputs);
        if (imgs.length === 0) throw new Error("Filter sin entrada");
        const out = [];
        for (const img of imgs) {
          out.push(await ImageGen.applyFilters(img, node.data));
        }
        return { outputs: { image: out.slice() }, results: out.slice() };
      }
      case "resize": {
        const imgs = gatherInput(node, "image", outputs);
        if (imgs.length === 0) throw new Error("Resize sin entrada");
        const allFormats = Settings.getFormats();
        const selected = (node.data.selectedFormats || [])
          .map((id) => allFormats.find((f) => f.id === id))
          .filter(Boolean);
        if (selected.length === 0) throw new Error("Selecciona al menos un formato");
        const fit = node.data.fit || "cover";
        const focalPoint = node.data.focalPoint || { x: 0.5, y: 0.5 };
        const out = [];
        const meta = [];
        for (let i = 0; i < imgs.length; i++) {
          for (const fmt of selected) {
            out.push(await ImageGen.applyResize(imgs[i], {
              width: fmt.width, height: fmt.height, fit, focalPoint,
            }));
            meta.push(`${fmt.name} · ${fmt.width}×${fmt.height}`);
          }
        }
        return { outputs: { image: out.slice() }, results: out.slice(), resultsMeta: meta };
      }
      case "quality": {
        const imgs = gatherInput(node, "image", outputs);
        if (imgs.length === 0) throw new Error("Quality sin entrada");
        const out = [];
        const meta = [];
        const fmt = (node.data.format || "jpeg").toUpperCase();
        for (const img of imgs) {
          const r = await ImageGen.applyQuality(img, node.data);
          out.push(r);
          const kb = ImageGen.estimateKB(r);
          const qStr = node.data.format === "png" ? "lossless" : `${node.data.quality}%`;
          meta.push(`${fmt} ${qStr} · ${kb} KB`);
        }
        return { outputs: { image: out.slice() }, results: out.slice(), resultsMeta: meta };
      }
      case "video-generate": {
        const promptInputs = gatherInput(node, "prompt", outputs);
        const imageInputs  = gatherInput(node, "image",  outputs);
        const prompt = (node.data.prompt || "").trim() || (promptInputs[0] || "");
        const keyframe = imageInputs[0] || null;
        const model = node.data.model || "mock";

        const onProgress = (videoIdx, total, pollAttempt, maxPolls) => {
          const vidLabel = total > 1 ? ` (vídeo ${videoIdx + 1}/${total})` : "";
          NodeManager.setStatus(`Generando vídeo${vidLabel}… poll ${pollAttempt}/${maxPolls}`);
        };

        const videos = await VideoGen.generate({
          prompt,
          keyframe,
          duration:      node.data.duration      || 8,
          aspectRatio:   node.data.aspectRatio    || "16:9",
          count:         node.data.count          || 1,
          negativePrompt: node.data.negativePrompt || "",
          model,
          onProgress,
        });

        const meta = videos.map((_, i) => {
          const dur = node.data.duration || 8;
          const ar  = node.data.aspectRatio || "16:9";
          return `${model !== "mock" ? model.replace("veo-", "Veo ").replace("-generate-preview", "").replace("-generate-001", " GA") : "Mock"} · ${dur}s · ${ar}`;
        });

        return { outputs: { video: videos.slice() }, results: videos.slice(), resultsMeta: meta };
      }
      case "output": {
        const imgs = gatherInput(node, "image", outputs);
        return { outputs: {}, results: imgs.slice() };
      }
      default:
        throw new Error("Tipo de nodo desconocido: " + node.type);
    }
  }

  return { run, runFrom, runOne, isBusy };
})();
window.Workflow = Workflow;
