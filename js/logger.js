// logger.js — log centralizado del workflow.
// Emite eventos a listeners (UI runner, editor) y mantiene buffer en memoria.

const Logger = (() => {
  const MAX = 300;
  let entries = []; // {ts, level, msg, nodeType?, nodeId?}
  let listeners = [];
  let runId = 0;

  function emit(entry) {
    listeners.forEach((fn) => {
      try { fn(entry, entries); } catch (err) { console.error("Logger listener error:", err); }
    });
  }

  function log(level, msg, opts = {}) {
    const e = { ts: Date.now(), level, msg, ...opts, runId };
    entries.push(e);
    if (entries.length > MAX) entries.shift();
    emit(e);
    return e;
  }

  function info(msg, opts) { return log("info", msg, opts); }
  function success(msg, opts) { return log("success", msg, opts); }
  function warn(msg, opts) { return log("warn", msg, opts); }
  function error(msg, opts) { return log("error", msg, opts); }

  function startRun(label) {
    runId++;
    log("run-start", label || "Iniciando ejecución…", { runId });
  }
  function endRun(label, ok = true) {
    log(ok ? "run-end" : "run-end-error", label || (ok ? "Ejecución completada" : "Ejecución con errores"), { runId });
  }

  function clear() {
    entries = [];
    emit({ ts: Date.now(), level: "clear", msg: "" });
  }
  function getEntries() { return entries.slice(); }
  function getCurrentRunId() { return runId; }
  function subscribe(fn) {
    listeners.push(fn);
    return () => { listeners = listeners.filter((x) => x !== fn); };
  }

  return {
    log, info, success, warn, error,
    startRun, endRun, clear,
    getEntries, getCurrentRunId, subscribe,
  };
})();
window.Logger = Logger;
