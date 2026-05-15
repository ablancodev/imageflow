// workflows.js — gestor de workflows respaldado por MySQL vía API PHP.
// Mantiene una caché en memoria para que las lecturas (list, get) sigan siendo síncronas.
// Las escrituras actualizan la caché inmediatamente y envían la petición a la API en paralelo.
// Si la API no está disponible, cae de vuelta a localStorage de forma transparente.

const WorkflowsManager = (() => {
  const API = '/imageflow/api/workflows.php';

  // ─── Claves localStorage (fallback y migración) ───────────────────────────
  const LS_KEY        = 'imageflow.workflows.v1';
  const LS_LEGACY_KEY = 'imageflow.workflow.v1';
  const LS_CURRENT    = 'imageflow.currentWorkflow.v1';

  let workflows  = [];  // caché en memoria: [{id, name, description, createdAt, updatedAt, data}]
  let currentId  = null;
  let apiOk      = true; // false → modo offline (localStorage)

  // ─── ID generation ────────────────────────────────────────────────────────
  function genId() {
    return 'wf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  // ─── init (async) ─────────────────────────────────────────────────────────
  async function init() {
    currentId = localStorage.getItem(LS_CURRENT) || null;

    try {
      const res = await fetch(API + '?withData=1');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const remote = await res.json();
      apiOk = true;

      if (remote.length === 0) {
        // Intentar migrar desde localStorage
        const local = _readLocalStorage();
        if (local.length > 0) {
          console.log('[Workflows] Migrando', local.length, 'workflow(s) de localStorage a MySQL…');
          for (const wf of local) {
            try { await _post({ action: 'create', ...wf }); }
            catch (e) { console.warn('[Workflows] migración falló para', wf.id, e); }
          }
          const res2 = await fetch(API + '?withData=1');
          const migrated = await res2.json();
          workflows = migrated.map(normalizeWf);
          _clearLocalStorage();
          console.log('[Workflows] Migración completada.');
        } else {
          workflows = [];
        }
      } else {
        workflows = remote.map(normalizeWf);
      }

      // Validar currentId contra la caché
      if (currentId && !get(currentId)) currentId = null;

    } catch (err) {
      console.warn('[Workflows] API no disponible, usando localStorage:', err.message);
      apiOk = false;
      _loadFromLocalStorage();
    }
  }

  // ─── Lecturas síncronas (desde caché) ─────────────────────────────────────
  function list() {
    return workflows.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  function get(id) { return workflows.find((w) => w.id === id) || null; }
  function getCurrent() { return currentId ? get(currentId) : null; }
  function setCurrent(id) {
    currentId = id;
    if (!apiOk) localStorage.setItem(LS_CURRENT, id || '');
  }

  // ─── Escrituras (optimistic cache + async API) ────────────────────────────
  function create(name = 'Nuevo workflow', data = null) {
    const wf = {
      id:          genId(),
      name:        name || 'Sin nombre',
      description: '',
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
      data:        data || { nodes: [], connections: [], nextId: 1 },
    };
    workflows.push(wf);
    _persist('create', wf);
    return wf;
  }

  function update(id, patch) {
    const wf = get(id);
    if (!wf) return null;
    Object.assign(wf, patch, { updatedAt: Date.now() });
    return wf;
  }

  function saveData(id, data) {
    const wf = get(id);
    if (!wf) return null;
    wf.data      = data;
    wf.updatedAt = Date.now();
    _persist('save', { id, data, updatedAt: wf.updatedAt });
    return wf;
  }

  function rename(id, name) {
    const wf = get(id);
    if (!wf) return null;
    name         = (name || 'Sin nombre').trim() || 'Sin nombre';
    wf.name      = name;
    wf.updatedAt = Date.now();
    _persist('rename', { id, name, updatedAt: wf.updatedAt });
    return wf;
  }

  function setDescription(id, description) {
    const wf = get(id);
    if (!wf) return null;
    wf.description = description;
    wf.updatedAt   = Date.now();
    _persist('setDescription', { id, description, updatedAt: wf.updatedAt });
    return wf;
  }

  function duplicate(id) {
    const wf = get(id);
    if (!wf) return null;
    const copy = {
      ...JSON.parse(JSON.stringify(wf)),
      id:        genId(),
      name:      wf.name + ' (copia)',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    workflows.push(copy);
    _persist('create', copy);
    return copy;
  }

  function remove(id) {
    const idx = workflows.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    workflows.splice(idx, 1);
    if (currentId === id) currentId = null;

    if (apiOk) {
      fetch(API + '?id=' + encodeURIComponent(id), { method: 'DELETE' })
        .catch((e) => console.warn('[Workflows] delete falló:', e));
    } else {
      _saveLocalStorage();
    }
    // Borrar historial de ejecuciones
    RunsManager.deleteWorkflowRuns(id).catch(() => {});
    return true;
  }

  // ─── Internos ─────────────────────────────────────────────────────────────
  function _persist(action, payload) {
    if (apiOk) {
      _post({ action, ...payload })
        .catch((e) => {
          console.warn('[Workflows] persistencia API falló, guardando en localStorage:', e);
          _saveLocalStorage();
        });
    } else {
      _saveLocalStorage();
    }
  }

  function _post(body) {
    return fetch(API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ─── localStorage (fallback) ──────────────────────────────────────────────
  function _readLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) || []) : [];
    } catch { return []; }
  }

  function _loadFromLocalStorage() {
    workflows = _readLocalStorage();

    // Migración de formato legacy single-workflow
    if (workflows.length === 0) {
      try {
        const legacy = localStorage.getItem(LS_LEGACY_KEY);
        if (legacy) {
          const data = JSON.parse(legacy);
          const wf = { id: genId(), name: 'Mi primer workflow', description: 'Migrado del formato anterior', createdAt: Date.now(), updatedAt: Date.now(), data };
          workflows.push(wf);
          currentId = wf.id;
          _saveLocalStorage();
        }
      } catch (e) { console.warn('[Workflows] migración legacy falló:', e); }
    }

    try { currentId = localStorage.getItem(LS_CURRENT) || null; } catch { currentId = null; }
    if (currentId && !get(currentId)) currentId = null;
  }

  function _saveLocalStorage() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(workflows)); } catch (e) { console.warn('[Workflows] localStorage.set falló:', e); }
  }

  function _clearLocalStorage() {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_LEGACY_KEY);
      localStorage.removeItem(LS_CURRENT);
    } catch { /* ignorar */ }
  }

  function normalizeWf(row) {
    return {
      id:          row.id,
      name:        row.name,
      description: row.description || '',
      createdAt:   row.createdAt   || 0,
      updatedAt:   row.updatedAt   || 0,
      data:        row.data        || { nodes: [], connections: [], nextId: 1 },
    };
  }

  return {
    init, list, get, getCurrent, setCurrent,
    create, update, saveData, rename, setDescription,
    duplicate, remove,
  };
})();
window.WorkflowsManager = WorkflowsManager;
