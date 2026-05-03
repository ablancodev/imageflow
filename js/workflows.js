// workflows.js — gestor de workflows guardados en localStorage.
// Cada workflow: { id, name, description, createdAt, updatedAt, data }
// data = { nodes, connections, nextId } (lo mismo que NodeManager.serialize())

const WorkflowsManager = (() => {
  const KEY = "imageflow.workflows.v1";
  const LEGACY_KEY = "imageflow.workflow.v1"; // formato anterior, single
  const CURRENT_KEY = "imageflow.currentWorkflow.v1";

  let workflows = []; // {id, name, description, createdAt, updatedAt, data}
  let currentId = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) workflows = JSON.parse(raw) || [];
    } catch (err) {
      console.warn("[Workflows] load:", err);
      workflows = [];
    }
    try {
      currentId = localStorage.getItem(CURRENT_KEY) || null;
    } catch (_) { currentId = null; }

    // Migrar workflow viejo single si existe y no hay nada
    if (workflows.length === 0) {
      try {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const data = JSON.parse(legacy);
          const wf = {
            id: genId(),
            name: "Mi primer workflow",
            description: "Migrado del formato anterior",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            data,
          };
          workflows.push(wf);
          currentId = wf.id;
          save();
          console.log("[Workflows] Workflow legacy migrado");
        }
      } catch (err) {
        console.warn("[Workflows] migración legacy falló:", err);
      }
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(workflows));
      if (currentId) localStorage.setItem(CURRENT_KEY, currentId);
    } catch (err) { console.warn("[Workflows] save:", err); }
  }

  function genId() { return "wf-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6); }

  function list() { return workflows.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
  function get(id) { return workflows.find((w) => w.id === id) || null; }
  function getCurrent() { return currentId ? get(currentId) : null; }
  function setCurrent(id) {
    currentId = id;
    save();
  }

  function create(name = "Nuevo workflow", data = null) {
    const wf = {
      id: genId(),
      name,
      description: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: data || { nodes: [], connections: [], nextId: 1 },
    };
    workflows.push(wf);
    save();
    return wf;
  }

  function update(id, patch) {
    const wf = get(id);
    if (!wf) return null;
    Object.assign(wf, patch, { updatedAt: Date.now() });
    save();
    return wf;
  }

  function saveData(id, data) {
    return update(id, { data });
  }

  function rename(id, name) {
    return update(id, { name });
  }

  function setDescription(id, description) {
    return update(id, { description });
  }

  function duplicate(id) {
    const wf = get(id);
    if (!wf) return null;
    const copy = {
      ...JSON.parse(JSON.stringify(wf)),
      id: genId(),
      name: wf.name + " (copia)",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    workflows.push(copy);
    save();
    return copy;
  }

  function remove(id) {
    const idx = workflows.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    workflows.splice(idx, 1);
    if (currentId === id) currentId = null;
    save();
    return true;
  }

  function init() { load(); }

  return {
    init, list, get, getCurrent, setCurrent,
    create, update, saveData, rename, setDescription,
    duplicate, remove,
  };
})();
window.WorkflowsManager = WorkflowsManager;
