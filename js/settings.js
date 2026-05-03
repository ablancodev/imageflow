// settings.js — configuración global persistida en localStorage.
// Diseñada para ser idiot-proof: cualquier cambio en un campo persiste,
// y los logs en consola permiten depurar si algo no se guarda.

const Settings = (() => {
  const KEY = "imageflow.settings.v1";
  const LOG = (...a) => console.log("[Settings]", ...a);

  const DEFAULT_FORMATS = [
    { id: "ig-square", name: "Instagram Post (cuadrado)", width: 1080, height: 1080 },
    { id: "ig-portrait", name: "Instagram Portrait", width: 1080, height: 1350 },
    { id: "ig-story", name: "Instagram Story / Reel", width: 1080, height: 1920 },
    { id: "twitter", name: "Twitter / X", width: 1200, height: 675 },
    { id: "fb-post", name: "Facebook Post", width: 1200, height: 630 },
    { id: "linkedin", name: "LinkedIn Post", width: 1200, height: 627 },
    { id: "yt-thumb", name: "YouTube Thumbnail", width: 1280, height: 720 },
    { id: "pinterest", name: "Pinterest Pin", width: 1000, height: 1500 },
    { id: "blog-header", name: "Blog Header", width: 1920, height: 1080 },
    { id: "blog-card", name: "Blog Featured (16:9)", width: 1200, height: 675 },
  ];

  const DEFAULTS = {
    defaultModel: "mock",
    geminiApiKey: "",
    geminiModel: "gemini-3.1-flash-image-preview",
    aspectRatio: "1:1",
    imageSize: "1K",
    requestTimeoutMs: 60000,
    formats: DEFAULT_FORMATS.slice(),
  };

  let state = { ...DEFAULTS };
  let listeners = [];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { ...DEFAULTS, ...parsed };
        // Saneamos geminiModel: si el navegador rellenó con email u otra cosa
        // que no se parece a un id de modelo, volvemos al default.
        if (!/^(gemini|imagen)[\w.-]*/i.test(state.geminiModel || "")) {
          LOG("geminiModel inválido (", state.geminiModel, ") — reseteando al default");
          state.geminiModel = DEFAULTS.geminiModel;
          save();
        }
        LOG("load() leído de localStorage:", { ...state, geminiApiKey: state.geminiApiKey ? `[${state.geminiApiKey.length} chars]` : "(vacío)" });
      } else {
        LOG("load() sin entrada previa");
      }
    } catch (err) {
      console.warn("[Settings] load error:", err);
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      LOG("save() persistido. geminiApiKey:", state.geminiApiKey ? `[${state.geminiApiKey.length} chars]` : "(vacío)");
    } catch (err) {
      console.warn("[Settings] save error:", err);
    }
  }
  function get() { return { ...state }; }
  function set(patch) {
    state = { ...state, ...patch };
    save();
    listeners.forEach((fn) => fn(state));
  }
  function onChange(fn) { listeners.push(fn); }

  function init() {
    load();

    const btn = document.getElementById("btn-settings");
    if (btn) btn.onclick = openModal;

    const modal = document.getElementById("settings-modal");
    const closeModal = () => modal.classList.add("hidden");
    document.getElementById("settings-close").onclick = closeModal;
    document.getElementById("settings-save").onclick = closeModal;
    document.getElementById("st-toggle-key").onclick = () => {
      const inp = document.getElementById("st-gemini-key");
      inp.classList.toggle("masked");
      document.getElementById("st-toggle-key").textContent = inp.classList.contains("masked") ? "👁" : "🙈";
    };
    document.getElementById("st-test-key").onclick = testGeminiKey;
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

    bindAutoSave("st-default-model", "defaultModel");
    bindAutoSave("st-aspect-ratio", "aspectRatio");
    bindAutoSave("st-image-size", "imageSize");
    bindAutoSave("st-gemini-key", "geminiApiKey", (v) => v.trim());
    bindAutoSave("st-gemini-model", "geminiModel", (v) => v.trim() || DEFAULTS.geminiModel);

    // Formatos
    document.getElementById("st-format-add").onclick = () => {
      const id = "fmt-" + Date.now().toString(36);
      const formats = (state.formats || []).slice();
      formats.push({ id, name: "Nuevo formato", width: 1080, height: 1080 });
      set({ formats });
      flashSavedIndicator();
      renderFormatsList();
    };
    document.getElementById("st-format-reset").onclick = () => {
      if (!confirm("¿Restaurar los formatos por defecto? Perderás los personalizados.")) return;
      set({ formats: DEFAULT_FORMATS.slice() });
      flashSavedIndicator();
      renderFormatsList();
    };
  }

  function renderFormatsList() {
    const wrap = document.getElementById("st-formats-list");
    if (!wrap) return;
    const formats = state.formats || [];
    wrap.innerHTML = "";
    formats.forEach((fmt, idx) => {
      const row = document.createElement("div");
      row.className = "format-row";
      row.innerHTML = `
        <input class="fmt-name settings-input" type="text" value="${escapeAttr(fmt.name)}">
        <input class="fmt-w settings-input" type="number" min="16" max="8192" value="${fmt.width}">
        <span class="fmt-x">×</span>
        <input class="fmt-h settings-input" type="number" min="16" max="8192" value="${fmt.height}">
        <button class="btn btn-ghost fmt-del" title="Eliminar">🗑</button>
      `;
      const update = (patch) => {
        const next = (state.formats || []).slice();
        next[idx] = { ...next[idx], ...patch };
        set({ formats: next });
        flashSavedIndicator();
      };
      const nameEl = row.querySelector(".fmt-name");
      const wEl = row.querySelector(".fmt-w");
      const hEl = row.querySelector(".fmt-h");
      nameEl.addEventListener("change", () => update({ name: nameEl.value.trim() || "Sin nombre" }));
      nameEl.addEventListener("blur", () => update({ name: nameEl.value.trim() || "Sin nombre" }));
      wEl.addEventListener("change", () => update({ width: clampDim(parseInt(wEl.value, 10)) }));
      hEl.addEventListener("change", () => update({ height: clampDim(parseInt(hEl.value, 10)) }));
      row.querySelector(".fmt-del").addEventListener("click", () => {
        const next = (state.formats || []).slice();
        next.splice(idx, 1);
        set({ formats: next });
        flashSavedIndicator();
        renderFormatsList();
      });
      wrap.appendChild(row);
    });
    if (formats.length === 0) {
      wrap.innerHTML = `<div class="format-empty">No hay formatos. Pulsa "Añadir" o "Restaurar defaults".</div>`;
    }
  }
  function clampDim(n) {
    if (!n || isNaN(n)) return 1080;
    return Math.max(16, Math.min(8192, Math.round(n)));
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // Persistimos en 'change' (al perder foco para inputs, al cambiar para selects).
  // Y también en 'blur' como red de seguridad. NO usamos 'input' para que el
  // navegador no nos sobrescriba con eventos fantasma.
  function bindAutoSave(elId, key, transform) {
    const el = document.getElementById(elId);
    if (!el) { LOG("WARN bindAutoSave: no existe", elId); return; }
    transform = transform || ((v) => v);
    const handler = () => {
      const newVal = transform(el.value);
      if (state[key] === newVal) return;
      LOG(`${elId} → ${key}:`, newVal ? (typeof newVal === "string" && newVal.length > 12 ? `[${newVal.length} chars]` : newVal) : "(vacío)");
      set({ [key]: newVal });
      flashSavedIndicator();
    };
    el.addEventListener("change", handler);
    el.addEventListener("blur", handler);
  }

  let flashTimer = null;
  function flashSavedIndicator() {
    const ind = document.getElementById("settings-saved-indicator");
    if (!ind) return;
    ind.classList.add("visible");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => ind.classList.remove("visible"), 1200);
  }

  function openModal() {
    const modal = document.getElementById("settings-modal");
    document.getElementById("st-default-model").value = state.defaultModel;
    document.getElementById("st-gemini-key").value = state.geminiApiKey;
    document.getElementById("st-gemini-key").classList.add("masked");
    document.getElementById("st-toggle-key").textContent = "👁";
    document.getElementById("st-gemini-model").value = state.geminiModel;
    document.getElementById("st-aspect-ratio").value = state.aspectRatio;
    document.getElementById("st-image-size").value = state.imageSize;
    document.getElementById("st-test-result").textContent = "";
    document.getElementById("st-test-result").className = "test-result";
    renderFormatsList();
    LOG("openModal — campo se rellena con", state.geminiApiKey ? `[${state.geminiApiKey.length} chars]` : "(vacío)");
    modal.classList.remove("hidden");
  }

  async function testGeminiKey() {
    const key = document.getElementById("st-gemini-key").value.trim();
    const out = document.getElementById("st-test-result");
    if (!key) {
      out.textContent = "Introduce una API key primero";
      out.className = "test-result error";
      return;
    }
    set({ geminiApiKey: key });
    flashSavedIndicator();
    out.textContent = "Probando…";
    out.className = "test-result";
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
        headers: { "x-goog-api-key": key },
      });
      if (res.ok) {
        out.textContent = "✓ API key válida y guardada";
        out.className = "test-result success";
      } else {
        const t = await res.text();
        out.textContent = `✕ ${res.status}: ${t.slice(0, 140)}`;
        out.className = "test-result error";
      }
    } catch (err) {
      out.textContent = "✕ " + err.message;
      out.className = "test-result error";
    }
  }

  function modelRequiresKey(model) {
    return model === "nano-banana-2";
  }
  function isReady(model) {
    if (!modelRequiresKey(model)) return true;
    return !!state.geminiApiKey;
  }
  function getFormats() { return (state.formats || []).slice(); }
  function getFormat(id) { return (state.formats || []).find((f) => f.id === id); }

  return { init, get, set, onChange, openModal, modelRequiresKey, isReady, getFormats, getFormat };
})();
// Exponer en window también, ya que `const` global no crea property en window
window.Settings = Settings;
