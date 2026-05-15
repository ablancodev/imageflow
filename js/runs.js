// runs.js — Historial de ejecuciones respaldado por PHP/MySQL.
// Las imágenes y vídeos se guardan como ficheros en storage/runs/ en el servidor.
// Los métodos devuelven URLs http en lugar de dataURLs base64.

const RunsManager = (() => {
  const API = '/imageflow/api/runs.php';

  // init() es no-op: no hay IndexedDB que inicializar
  function init() { return Promise.resolve(); }

  async function saveRun(workflowId, workflowName, nodes, durationMs) {
    const nodeResults = nodes
      .filter((n) => n.results && n.results.length > 0)
      .map((n) => ({
        nodeId:      n.id,
        type:        n.type,
        results:     n.results.slice(),        // dataURLs base64 — PHP los decodifica a fichero
        resultsMeta: (n.resultsMeta || []).slice(),
      }));

    if (nodeResults.length === 0) return null;

    const res = await fetch(API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:       'save',
        workflowId,
        workflowName,
        durationMs:   durationMs || 0,
        nodeResults,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('runs/save HTTP ' + res.status + (txt ? ': ' + txt.slice(0, 200) : ''));
    }

    return await res.json();
  }

  async function getRuns(workflowId) {
    const res = await fetch(API + '?workflow_id=' + encodeURIComponent(workflowId));
    if (!res.ok) return [];
    return await res.json();
    // Cada run: {id, workflowId, workflowName, createdAt, durationMs, resultCount,
    //            thumbnail: "http://...", nodeResults:[{nodeId, type, results:["http://..."], resultsMeta}]}
  }

  async function deleteRun(id) {
    await fetch(API + '?id=' + encodeURIComponent(id), { method: 'DELETE' });
  }

  async function deleteWorkflowRuns(workflowId) {
    await fetch(API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'deleteWorkflow', workflowId }),
    });
  }

  return { init, saveRun, getRuns, deleteRun, deleteWorkflowRuns };
})();
window.RunsManager = RunsManager;
