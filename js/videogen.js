// videogen.js — Generación de vídeo: mock local + Google Veo via Gemini API.

const VideoGen = (() => {

  // ── Mock: canvas animado → WebM via MediaRecorder ───────────────────────────
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function createMockVideo(prompt, keyframe, duration, aspectRatio) {
    return new Promise((resolve, reject) => {
      const isPortrait = aspectRatio === "9:16";
      const width  = isPortrait ? 360 : 640;
      const height = isPortrait ? 640 : 360;

      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");

      const baseHue = hashSeed(prompt || "video") % 360;

      const setup = keyframe ? new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = keyframe;
      }) : Promise.resolve(null);

      setup.then((bgImg) => {
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
        const stream = canvas.captureStream(24);
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: "video/webm" });
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        };

        recorder.start(100);
        const fps = 24;
        const totalFrames = Math.round(duration * fps);
        let frame = 0;

        function drawFrame() {
          if (frame >= totalFrames) { recorder.stop(); return; }
          const t = frame / totalFrames;

          if (bgImg) {
            const scale = Math.max(width / bgImg.width, height / bgImg.height);
            const sw = bgImg.width * scale, sh = bgImg.height * scale;
            ctx.drawImage(bgImg, (width - sw) / 2, (height - sh) / 2, sw, sh);
            ctx.globalAlpha = 0.25 + Math.sin(t * Math.PI * 2) * 0.1;
            const g = ctx.createLinearGradient(0, 0, width, height);
            g.addColorStop(0, `hsla(${(baseHue + t * 80) % 360}, 80%, 55%, 0.6)`);
            g.addColorStop(1, `hsla(${(baseHue + 180 + t * 40) % 360}, 70%, 40%, 0.4)`);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, width, height);
            ctx.globalAlpha = 1;
          } else {
            const g = ctx.createLinearGradient(
              0, 0,
              width * (0.5 + 0.5 * Math.cos(t * Math.PI * 2)),
              height * (0.5 + 0.5 * Math.sin(t * Math.PI * 2))
            );
            g.addColorStop(0, `hsl(${(baseHue + t * 120) % 360}, 75%, 45%)`);
            g.addColorStop(1, `hsl(${(baseHue + 180 + t * 60) % 360}, 65%, 30%)`);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, width, height);

            ctx.globalCompositeOperation = "lighter";
            for (let i = 0; i < 3; i++) {
              const bx = width  * (0.5 + 0.35 * Math.sin(t * Math.PI * 2 + i * 2.1));
              const by = height * (0.5 + 0.35 * Math.cos(t * Math.PI * 2 + i * 1.7));
              const r  = Math.min(width, height) * (0.12 + 0.08 * Math.sin(t * Math.PI * 4 + i));
              const bg = ctx.createRadialGradient(bx, by, 0, bx, by, r);
              bg.addColorStop(0, `hsla(${(baseHue + i * 120 + t * 60) % 360}, 80%, 65%, 0.5)`);
              bg.addColorStop(1, "hsla(0,0%,0%,0)");
              ctx.fillStyle = bg;
              ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
          }

          // Label
          const label = (prompt || "Mock video").slice(0, 38);
          const fontSize = Math.round(width / 32);
          ctx.font = `bold ${fontSize}px -apple-system, system-ui, sans-serif`;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(10, height - fontSize * 2 - 6, tw + 16, fontSize + 10);
          ctx.fillStyle = "rgba(255,255,255,0.95)";
          ctx.fillText(label, 18, height - fontSize - 6 + fontSize * 0.8);

          // Progress bar
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(0, height - 3, width, 3);
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillRect(0, height - 3, width * t, 3);

          frame++;
          requestAnimationFrame(drawFrame);
        }
        drawFrame();
      }).catch(reject);
    });
  }

  // Normaliza el keyframe: convierte a PNG y escala al lado largo ≤ 1280px
  function normalizeKeyframe(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (Math.max(w, h) > MAX) {
          const r = MAX / Math.max(w, h);
          w = Math.round(w * r); h = Math.round(h * r);
        }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = dataURL;
    });
  }

  // ── Google Veo via Gemini API (predictLongRunning) ───────────────────────────
  async function veoGenerate({ prompt, keyframe, duration, aspectRatio, count, negativePrompt, model, onProgress, signal }) {
    const settings = Settings.get();
    const apiKey = settings.geminiApiKey;
    if (!apiKey) throw new Error("Falta la API key de Google (Settings ⚙)");

    // Build instance — normaliza el keyframe a PNG ≤1280px antes de enviarlo
    const instance = { prompt: prompt || "Generate a video" };
    if (keyframe) {
      const normalized = await normalizeKeyframe(keyframe);
      const m = normalized.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        instance.image = { bytesBase64Encoded: m[2], mimeType: m[1] };
      }
    }

    const body = {
      instances: [instance],
      parameters: {
        aspectRatio: aspectRatio || "16:9",
        durationSeconds: duration || 8,
        ...(negativePrompt ? { negativePrompt } : {}),
      },
    };

    const modelId = model || "veo-3.1-generate-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:predictLongRunning`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const txt = await res.text();
      let msg = txt.slice(0, 300);
      try { const j = JSON.parse(txt); if (j.error && j.error.message) msg = j.error.message; } catch {}
      throw new Error(`Veo ${res.status}: ${msg}`);
    }

    const opData = await res.json();
    const opName = opData.name;
    if (!opName) throw new Error("Veo no devolvió operation name");

    // Poll until done — max ~6 min (72 × 5s)
    const pollBase = "https://generativelanguage.googleapis.com/v1beta/";
    const pollUrl = opName.startsWith("http") ? opName : pollBase + opName;
    const maxAttempts = 72;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      if (signal && signal.aborted) throw new Error("Cancelado");

      if (onProgress) onProgress(attempt, maxAttempts);

      const pollRes = await fetch(pollUrl, {
        headers: { "x-goog-api-key": apiKey },
        signal,
      });
      if (!pollRes.ok) {
        const t = await pollRes.text();
        throw new Error(`Veo poll ${pollRes.status}: ${t.slice(0, 200)}`);
      }

      const pollData = await pollRes.json();
      if (!pollData.done) continue;

      if (pollData.error) {
        throw new Error(`Veo error: ${pollData.error.message || JSON.stringify(pollData.error).slice(0, 200)}`);
      }

      // Response shape per docs: response.generateVideoResponse.generatedSamples[].video.uri
      const videos = [];
      const samples = (
        pollData.response &&
        pollData.response.generateVideoResponse &&
        pollData.response.generateVideoResponse.generatedSamples
      ) || [];

      for (const sample of samples) {
        const uri = sample.video && sample.video.uri;
        if (!uri) continue;
        // Download video with API key header (URI contains signed credentials)
        try {
          const vr = await fetch(uri, {
            headers: { "x-goog-api-key": apiKey },
            signal,
          });
          if (!vr.ok) throw new Error(`download ${vr.status}`);
          const blob = await vr.blob();
          const dataUrl = await new Promise((res, rej) => {
            const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej;
            fr.readAsDataURL(blob);
          });
          videos.push(dataUrl);
        } catch (e) {
          throw new Error(`Error descargando vídeo: ${e.message}`);
        }
      }

      if (videos.length === 0) throw new Error("Veo no devolvió vídeos en la respuesta");
      return videos;
    }

    throw new Error("Veo timeout: generación superó 6 minutos");
  }

  // ── PUBLIC ────────────────────────────────────────────────────────────────────
  async function generate({ prompt, keyframe = null, duration = 8, aspectRatio = "16:9", count = 1, negativePrompt = "", model = "mock", onProgress, signal }) {
    const n = Math.min(Math.max(1, count || 1), 4);

    if (model === "mock") {
      const results = [];
      const mockDuration = Math.min(duration, 2);
      for (let i = 0; i < n; i++) {
        results.push(await createMockVideo(prompt, keyframe, mockDuration, aspectRatio));
      }
      return results;
    }

    // Veo only supports 1 video per call — run sequentially
    const results = [];
    for (let i = 0; i < n; i++) {
      const videoOnProgress = onProgress
        ? (attempt, max) => onProgress(i, n, attempt, max)
        : null;
      const [video] = await veoGenerate({ prompt, keyframe, duration, aspectRatio, negativePrompt, model, onProgress: videoOnProgress, signal });
      results.push(video);
    }
    return results;
  }

  return { generate };
})();
