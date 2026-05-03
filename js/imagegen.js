// imagegen.js — Mock AI generator + filtros nativos sobre canvas.
// Para enchufar IA real, reemplaza ImageGen.aiGenerate() por una llamada a tu API.

const ImageGen = (() => {
  const SIZE = 384;

  // PRNG determinista por prompt → mismas semillas dan mismos colores
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function paletteFromPrompt(prompt) {
    const rng = mulberry32(hashSeed(prompt || "default"));
    const baseHue = Math.floor(rng() * 360);
    const accent = (baseHue + 120 + Math.floor(rng() * 60)) % 360;
    const shift = (baseHue + 240 + Math.floor(rng() * 40)) % 360;
    return {
      a: `hsl(${baseHue}, 75%, 55%)`,
      b: `hsl(${accent}, 70%, 50%)`,
      c: `hsl(${shift}, 80%, 45%)`,
      d: `hsl(${(baseHue + 30) % 360}, 65%, 35%)`,
      rng,
    };
  }

  // Genera una imagen base a partir de un prompt — mesh gradient + ruido + texto sutil
  function generateFromPrompt(prompt, seed = 0) {
    const c = document.createElement("canvas");
    c.width = SIZE; c.height = SIZE;
    const ctx = c.getContext("2d");
    const pal = paletteFromPrompt((prompt || "abstract") + ":" + seed);

    // Fondo radial
    const g = ctx.createRadialGradient(
      SIZE * (0.3 + pal.rng() * 0.4), SIZE * (0.3 + pal.rng() * 0.4), 30,
      SIZE / 2, SIZE / 2, SIZE * 0.85
    );
    g.addColorStop(0, pal.a);
    g.addColorStop(0.55, pal.b);
    g.addColorStop(1, pal.d);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Blobs aditivos
    ctx.globalCompositeOperation = "lighter";
    const blobs = 4 + Math.floor(pal.rng() * 4);
    for (let i = 0; i < blobs; i++) {
      const x = pal.rng() * SIZE;
      const y = pal.rng() * SIZE;
      const r = 60 + pal.rng() * 140;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const colors = [pal.a, pal.b, pal.c];
      grad.addColorStop(0, colors[i % 3].replace("hsl", "hsla").replace(")", ", 0.55)"));
      grad.addColorStop(1, "hsla(0,0%,0%,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // Ruido sutil
    const id = ctx.getImageData(0, 0, SIZE, SIZE);
    const data = id.data;
    for (let i = 0; i < data.length; i += 4) {
      const n = (pal.rng() - 0.5) * 18;
      data[i] = Math.max(0, Math.min(255, data[i] + n));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    }
    ctx.putImageData(id, 0, 0);

    // Etiqueta del prompt (esquina inferior)
    if (prompt) {
      const text = prompt.length > 40 ? prompt.slice(0, 38) + "…" : prompt;
      ctx.font = "bold 13px -apple-system, system-ui, sans-serif";
      const padX = 8, padY = 4;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(8, SIZE - 26, w + padX * 2, 22);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(text, 8 + padX, SIZE - 11);
    }

    return c.toDataURL("image/png");
  }

  // Carga una imagen y devuelve un canvas con su contenido
  function loadImageToCanvas(src, size = SIZE) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d");
        // cover
        const ratio = Math.max(size / img.width, size / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(c);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  // "Evolution" — toma una imagen fuente y la mezcla con un mesh gradient
  // derivado del prompt. Visualmente da la idea de variación coherente.
  async function evolveFromImage(srcDataURL, prompt, seed) {
    const base = await loadImageToCanvas(srcDataURL);
    const ctx = base.getContext("2d");
    const pal = paletteFromPrompt(prompt + ":" + seed);

    // Capa de color encima con multiply
    ctx.globalCompositeOperation = "color";
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, pal.a);
    g.addColorStop(0.5, pal.b);
    g.addColorStop(1, pal.c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Blobs en lighter para simular "estilo nuevo"
    ctx.globalCompositeOperation = "soft-light";
    const blobs = 3 + Math.floor(pal.rng() * 3);
    for (let i = 0; i < blobs; i++) {
      const x = pal.rng() * SIZE, y = pal.rng() * SIZE, r = 80 + pal.rng() * 120;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = [pal.a, pal.b, pal.c][i % 3];
      grad.addColorStop(0, c.replace("hsl", "hsla").replace(")", ", 0.7)"));
      grad.addColorStop(1, "hsla(0,0%,0%,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // Tag visual con prompt
    if (prompt) {
      const text = prompt.length > 36 ? prompt.slice(0, 34) + "…" : prompt;
      ctx.font = "bold 12px -apple-system, system-ui, sans-serif";
      const w = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(8, SIZE - 24, w + 12, 20);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(text, 14, SIZE - 10);
    }

    return base.toDataURL("image/png");
  }

  // ============ Gemini "Nano Banana 2" ============
  // Llamada directa al endpoint público desde el navegador con la API key
  // del usuario (guardada en Settings/localStorage).
  async function geminiGenerate({ prompt, source, settings, signal }) {
    const apiKey = settings.geminiApiKey;
    const model = settings.geminiModel || "gemini-3.1-flash-image-preview";
    if (!apiKey) throw new Error("Falta la API key de Gemini (Settings ⚙)");

    const parts = [{ text: prompt || "Generate an interesting image" }];
    if (source) {
      const m = source.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
      } else {
        // Si llega como URL pública la convertimos a base64
        const blob = await (await fetch(source)).blob();
        const b64 = await blobToBase64(blob);
        parts.push({ inline_data: { mime_type: blob.type || "image/png", data: b64 } });
      }
    }

    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: settings.aspectRatio || "1:1",
          imageSize: settings.imageSize || "1K",
        },
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = txt.slice(0, 240);
      try {
        const j = JSON.parse(txt);
        if (j.error && j.error.message) msg = j.error.message;
      } catch {}
      throw new Error(`Gemini ${res.status}: ${msg}`);
    }
    const data = await res.json();
    const candidate = data.candidates && data.candidates[0];
    if (!candidate) throw new Error("Gemini devolvió respuesta vacía");
    const imgPart = (candidate.content && candidate.content.parts || []).find(
      (p) => p.inlineData || p.inline_data
    );
    if (!imgPart) {
      const textPart = (candidate.content && candidate.content.parts || []).find((p) => p.text);
      const reason = candidate.finishReason ? ` (${candidate.finishReason})` : "";
      throw new Error("Gemini no devolvió imagen" + reason + (textPart ? `: ${textPart.text.slice(0, 100)}` : ""));
    }
    const inline = imgPart.inlineData || imgPart.inline_data;
    return `data:${inline.mimeType || inline.mime_type};base64,${inline.data}`;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // PUBLIC: Genera una o más imágenes desde prompt + (opcional) imagen fuente.
  // Despacha al provider correcto según `model`. Contrato: Promise<string[]>.
  async function aiGenerate({ prompt, source = null, variants = 1, seedBase = Date.now(), model = "mock" }) {
    const out = [];
    if (model === "nano-banana-2") {
      const settings = Settings.get();
      // Gemini devuelve 1 imagen por llamada → paralelizamos N requests
      const tasks = [];
      for (let i = 0; i < variants; i++) {
        const variantPrompt = variants > 1 ? `${prompt} (variant ${i + 1})` : prompt;
        tasks.push(geminiGenerate({ prompt: variantPrompt, source, settings }));
      }
      const results = await Promise.allSettled(tasks);
      const errors = [];
      results.forEach((r) => {
        if (r.status === "fulfilled") out.push(r.value);
        else errors.push(r.reason && r.reason.message ? r.reason.message : String(r.reason));
      });
      if (out.length === 0) throw new Error(errors[0] || "Sin imágenes generadas");
      if (errors.length) console.warn("Algunas variantes fallaron:", errors);
      return out;
    }
    // Provider "mock" — generador local determinista
    for (let i = 0; i < variants; i++) {
      const seed = seedBase + i;
      await new Promise((r) => setTimeout(r, 120 + Math.random() * 220));
      if (source) {
        out.push(await evolveFromImage(source, prompt || "evolved", seed));
      } else {
        out.push(generateFromPrompt(prompt || "abstract", seed));
      }
    }
    return out;
  }

  // Filters — aplican CSS filter via canvas
  async function applyFilters(srcDataURL, { brightness = 1, contrast = 1, saturate = 1, hueRotate = 0, blur = 0, invert = 0 } = {}) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = srcDataURL; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.filter =
      `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) hue-rotate(${hueRotate}deg) blur(${blur}px) invert(${invert})`;
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  }

  // Resize — redimensiona al tamaño objetivo. fit: cover | contain | stretch.
  // focalPoint {x,y} normalizado [0..1] se usa en cover para mantener ese punto
  // visible en el centro del recorte (clampeado a los bordes de la imagen).
  async function applyResize(srcDataURL, { width, height, fit = "cover", focalPoint, background = "#000000" } = {}) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = srcDataURL; });
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d");
    if (fit === "contain") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      const r = Math.min(width / img.width, height / img.height);
      const w = img.width * r, h = img.height * r;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
    } else if (fit === "stretch") {
      ctx.drawImage(img, 0, 0, width, height);
    } else {
      // cover con focal point opcional
      const fp = focalPoint || { x: 0.5, y: 0.5 };
      const r = Math.max(width / img.width, height / img.height);
      const w = img.width * r, h = img.height * r;
      // Queremos que el píxel (fp.x * w, fp.y * h) de la imagen escalada caiga
      // en el centro del lienzo. Después clampeamos para no dejar bandas negras.
      let dx = width / 2 - fp.x * w;
      let dy = height / 2 - fp.y * h;
      dx = Math.min(0, Math.max(width - w, dx));
      dy = Math.min(0, Math.max(height - h, dy));
      ctx.drawImage(img, dx, dy, w, h);
    }
    return c.toDataURL("image/png");
  }

  // Quality — re-encoda con calidad/formato configurables. Útil para reducir
  // peso antes de subir a redes o blog. JPEG/WebP soportan calidad; PNG es lossless.
  // maxDimension > 0 reduce el lado más largo a ese valor (sin agrandar).
  async function applyQuality(srcDataURL, { quality = 80, format = "jpeg", maxDimension = 0 } = {}) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = srcDataURL; });
    let width = img.width, height = img.height;
    if (maxDimension > 0) {
      const longest = Math.max(width, height);
      if (longest > maxDimension) {
        const r = maxDimension / longest;
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
    }
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d");
    // JPEG no soporta transparencia → fondo blanco para evitar negro
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    const mime = format === "png" ? "image/png"
               : format === "webp" ? "image/webp"
               : "image/jpeg";
    return c.toDataURL(mime, format === "png" ? undefined : Math.max(0.01, Math.min(1, quality / 100)));
  }

  // Estima KB a partir del tamaño base64 del dataURL (~3/4 del string)
  function estimateKB(dataURL) {
    if (!dataURL) return 0;
    const i = dataURL.indexOf(",");
    const base64 = i >= 0 ? dataURL.slice(i + 1) : dataURL;
    return Math.round((base64.length * 3 / 4) / 1024);
  }

  return { aiGenerate, applyFilters, applyResize, applyQuality, estimateKB, generateFromPrompt };
})();
