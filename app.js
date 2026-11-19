/* ==========================================================================
   CALL BELL 2.0 — APPLICATION CORE ENGINE
   Features:
   - Synchronous pairing & SSE Stream receiver
   - ntfy urgent push delivery
   - Clean, reliable QR camera scanner with jsQR & fallbacks
   - Kiosk Customer Mode with vibration feedback & pleasant button audio
   - 30-Second independent cooldown & dismissible confirmation modal
   - Tiny QR preview integration & Fullscreen management
   ========================================================================== */
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = "callbell.v6";
  const NTFY = "https://ntfy.sh";

const state = {
  code: "",
  role: null,
  stream: null,
  wakeLock: null,
  audioCtx: null,
  alarmTimer: null,
  vibrationTimer: null,
  cooldownTimer: null,
  remaining: 30,
  busy: false,
  alarmActive: false,
  lastMessage: "",
  scanStream: null,
  scanFrame: null,
  scanCanvas: null,
  scanContext: null,
  installPrompt: null,
  lastRingAt: 0
};

// Required DOM Element Guard to ensure perfect component wiring
const requiredIds = [
  "setup-view", "connect-view", "receiver-view", "kiosk-view",
  "setup-counter", "setup-phone", "back-setup", "shop-code",
  "start-scan", "scan-panel", "scan-video", "stop-scan", "join-shop",
  "connect-result", "phone-topic", "copy-phone-topic", "open-ntfy", "go-receiver",
  "receiver-status", "receiver-settings", "receiver-topic", "copy-receiver-topic",
  "tiny-qr", "tiny-qr-box", "test-alarm", "alarm-state", "test-push", "push-state", "stream-label",
  "kiosk-settings", "guest-button", "thanks-overlay", "thanks-close-btn",
  "countdown-bar", "countdown-number", "countdown-text",
  "settings-modal", "close-modal", "shop-qr", "settings-code", "copy-settings-code",
  "fullscreen-button", "install-app", "settings-test", "reset-device",
  "alarm-overlay", "stop-alarm", "toast"
];

const missing = requiredIds.filter(id => !$(id));
if (missing.length) {
  console.warn("Call Bell DOM warning — missing IDs:", missing.join(", "));
}

/* ==========================================================================
   UTILITY & STATE PERSISTENCE
   ========================================================================== */
function makeCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return "cb-" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function cleanCode(value) {
  let v = String(value || "").trim();
  try {
    if (v.startsWith("http")) {
      const u = new URL(v);
      v = u.pathname.split("/").filter(Boolean).pop() || v;
    }
  } catch {}
  v = decodeURIComponent(v).trim().toLowerCase().replace(/^call-bell-/, "").replace(/[^a-z0-9_-]/g, "");
  return v;
}

function topic() {
  return "call-bell-" + (state.code || "channel");
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ code: state.code, role: state.role }));
  } catch (err) {
    console.error("Failed to save state to localStorage", err);
  }
}

function load() {
  try {
    // Also check previous version storage if upgrading seamlessly
    const v = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem("callbell.v5") || "{}");
    state.code = v.code || "";
    state.role = v.role || null;
  } catch {}
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function showScreen(name) {
  const map = {
    setup: "setup-view",
    connect: "connect-view",
    receiver: "receiver-view",
    kiosk: "kiosk-view"
  };
  Object.entries(map).forEach(([key, id]) => {
    const el = $(id);
    if (el) el.hidden = (key !== name);
  });
  document.body.classList.toggle("kiosk-mode", name === "kiosk");
}

/* ==========================================================================
   AUDIO & HAPTIC SYSTEM
   ========================================================================== */
function vibrate(pattern) {
  try {
    if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
      const res = navigator.vibrate(pattern);
      return res !== false;
    }
  } catch (err) {
    console.warn("Vibration error:", err);
  }
  return false;
}

function getAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!state.audioCtx) {
    state.audioCtx = new AudioContextClass();
  }
  if (state.audioCtx.state === "suspended") {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

// Gentle button press tap audio for customer interaction
function playTapSound() {
  const ctx = getAudio();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.08);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch {}
}

function tone(freq, duration, at) {
  const ctx = getAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.24, at + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.04);
}

// Pleasant hospitality chime sequence (G5, B5, D6)
function playChime() {
  const ctx = getAudio();
  if (!ctx) return false;
  const t = ctx.currentTime;
  tone(784, 0.28, t);
  tone(988, 0.32, t + 0.22);
  tone(1175, 0.44, t + 0.48);
  return true;
}

function stopAlarm() {
  state.alarmActive = false;
  clearInterval(state.alarmTimer);
  clearInterval(state.vibrationTimer);
  state.alarmTimer = state.vibrationTimer = null;
  vibrate(0);
  if ($("alarm-overlay")) $("alarm-overlay").hidden = true;
  if ($("active-alarm-bar")) $("active-alarm-bar").hidden = true;
  toast("Alarm stopped");
}

function startAlarm(message) {
  if (state.alarmActive) return;
  state.alarmActive = true;
  if ($("alarm-time")) $("alarm-time").textContent = message || "Someone is waiting at the counter right now.";
  if ($("alarm-overlay")) $("alarm-overlay").hidden = false;
  if ($("active-alarm-bar")) {
    $("active-alarm-bar").hidden = false;
    $("alarm-bar-text").textContent = message || "Customer calling!";
  }

  // Continuous sound and continuous vibration loops until user presses STOP
  playChime();
  vibrate([900, 200, 900, 200, 900, 200, 1000]);

  // Audio loop every 2.2s
  state.alarmTimer = setInterval(() => {
    if (state.alarmActive) playChime();
  }, 2200);

  // Continuous non-stop vibration pulse loop every 1.5s
  state.vibrationTimer = setInterval(() => {
    if (state.alarmActive) {
      vibrate([1000, 150, 1000, 150, 1000]);
    }
  }, 1500);

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Hola Brownie — Customer Waiting", {
        body: message || "Customer is at the counter right now.",
        icon: "./icon-192.png",
        tag: "call-bell-ring",
        renotify: true
      });
    } catch {}
  }
}

/* ==========================================================================
   NTFY PUSH & SSE STREAMING
   ========================================================================== */
function setReceiverStatus(label, live) {
  const el = $("receiver-status");
  if (!el) return;
  el.dataset.state = live ? "live" : "";
  el.innerHTML = '<i></i> <span>' + label + '</span>';
  $("stream-label").textContent = live
    ? "Connected · listening for counter rings"
    : "Reconnecting · keep this tab active";
}

function connectStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  if (!state.code) return;
  setReceiverStatus("Connecting...", false);
  const source = new EventSource(NTFY + "/" + encodeURIComponent(topic()) + "/sse");
  state.stream = source;

  source.onopen = () => setReceiverStatus("Listening", true);
  source.onerror = () => setReceiverStatus("Reconnecting", false);
  source.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.event !== "message" || (data.id && data.id === state.lastMessage)) return;
      state.lastMessage = data.id || String(Date.now());

      // Check if message is a dynamic notice update from shopkeeper
      if (data.message && data.message.startsWith("NOTICE:")) {
        const notice = data.message.replace(/^NOTICE:/, "").trim();
        updateKioskNotice(notice);
        return;
      }

      startAlarm(data.message || "Customer is waiting at the counter.");
      $("push-state").textContent = "Incoming call alert received";
    } catch (err) {
      console.warn("Could not parse incoming SSE message", err);
    }
  };
}

async function sendNtfy(message, isTest = false) {
  const query = new URLSearchParams({
    title: isTest ? "Call Bell Diagnostic Test" : "Call Bell — Guest Assistance",
    priority: "urgent",
    tags: "bell,rotating_light",
    click: location.href
  });
  try {
    const response = await fetch(NTFY + "/" + encodeURIComponent(topic()) + "?" + query, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: message
    });
    return response.ok;
  } catch (err) {
    console.error("ntfy notification failed to deliver", err);
    return false;
  }
}

async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    toast(label + " copied");
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    try {
      document.execCommand("copy");
      toast(label + " copied");
    } catch {
      toast("Please select and copy manually.");
    }
    field.remove();
  }
}

function updateQRCodes() {
  if (!state.code) return;
  const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=" + encodeURIComponent(state.code);
  const tinyUrl = "https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=4&data=" + encodeURIComponent(state.code);
  
  if ($("shop-qr")) $("shop-qr").src = qrUrl;
  if ($("tiny-qr")) $("tiny-qr").src = tinyUrl;
}

function updateKioskNotice(notice) {
  const banner = $("kiosk-live-notice");
  const text = $("kiosk-notice-text");
  if (!banner || !text) return;
  if (notice && notice.trim()) {
    text.textContent = notice.trim();
    banner.hidden = false;
  } else {
    banner.hidden = true;
    text.textContent = "";
  }
}

function incrementTodayCount() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem("cb_calls_today") || "{}");
  const count = (stored.date === today ? stored.count : 0) + 1;
  localStorage.setItem("cb_calls_today", JSON.stringify({ date: today, count }));
  if ($("kiosk-today-count")) $("kiosk-today-count").textContent = count;
}

function loadTodayCount() {
  const today = new Date().toDateString();
  const stored = JSON.parse(localStorage.getItem("cb_calls_today") || "{}");
  const count = (stored.date === today ? stored.count : 0);
  if ($("kiosk-today-count")) $("kiosk-today-count").textContent = count;
}

async function broadcastNotice(msg) {
  if (!state.code) return;
  const text = msg ? msg.trim() : "";
  const payload = "NOTICE:" + text;
  toast(text ? "Posted notice to tablet" : "Cleared tablet notice");
  await sendNtfy(payload, false);
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !state.wakeLock) {
      state.wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch {}
}

/* ==========================================================================
   NAVIGATION & ROLE SWITCHING
   ========================================================================== */
function enterKiosk() {
  if (!state.code) state.code = makeCode();
  state.role = "counter";
  save();
  showScreen("kiosk");
  $("settings-code").textContent = state.code;
  updateQRCodes();
  requestWakeLock();
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function enterPhoneSetup() {
  state.role = "phone";
  save();
  showScreen("connect");
  $("shop-code").value = state.code || "";
  $("connect-result").hidden = true;
}

function joinPhone() {
  const code = cleanCode($("shop-code").value);
  if (code.length < 8) {
    toast("Please enter or scan the shop code from your tablet.");
    $("shop-code").focus();
    return;
  }
  state.code = code;
  state.role = "phone";
  save();
  $("shop-code").value = code;
  $("phone-topic").textContent = topic();
  $("connect-result").hidden = false;

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then(p => {
      if (p === "granted") toast("Web notifications enabled");
    }).catch(() => {});
  }
}

function openNtfyApp() {
  const appUrl = "ntfy://ntfy.sh/" + encodeURIComponent(topic());
  window.location.href = appUrl;
  setTimeout(() => toast("If ntfy did not open, install it from store and subscribe."), 1400);
}

function openReceiver() {
  if (!state.code) {
    toast("Connect this handset to your shop first.");
    return;
  }
  state.role = "phone";
  save();
  showScreen("receiver");
  $("receiver-topic").textContent = topic();
  updateQRCodes();
  connectStream();
}

function openSettings() {
  $("settings-code").textContent = state.code || "Not generated yet";
  updateQRCodes();
  $("fullscreen-button").querySelector("strong").textContent = document.fullscreenElement
    ? "Exit Fullscreen Kiosk"
    : "Toggle Fullscreen Kiosk";
  
  // Hide "Send Test Alert" on customer tablet device; only show to main shop device
  if ($("settings-test")) {
    $("settings-test").hidden = (state.role === "counter");
  }

  $("settings-modal").hidden = false;
}

function closeSettings() {
  $("settings-modal").hidden = true;
}

async function testPush() {
  $("push-state").textContent = "Dispatching test ping…";
  const ok = await sendNtfy("This is a Call Bell test. Handset notification confirmed.", true);
  $("push-state").textContent = ok ? "Delivered to ntfy · check your phone" : "Delivery failed · check network";
  toast(ok ? "Diagnostic test ping sent!" : "Notification delivery failed");
}

/* ==========================================================================
   CUSTOMER KIOSK CALL & 30-SECOND COOLDOWN SYSTEM
   ========================================================================== */
function startCooldown() {
  state.remaining = 30;
  $("thanks-overlay").hidden = false;
  $("guest-button").disabled = true;
  $("countdown-number").textContent = "30";
  $("countdown-text").textContent = "Next call available in";
  $("countdown-bar").style.width = "100%";

  clearInterval(state.cooldownTimer);
  state.cooldownTimer = setInterval(() => {
    state.remaining--;
    $("countdown-number").textContent = String(state.remaining);
    $("countdown-bar").style.width = (state.remaining / 30 * 100) + "%";

    if (state.remaining <= 0) {
      clearInterval(state.cooldownTimer);
      state.cooldownTimer = null;
      $("thanks-overlay").hidden = true;
      $("guest-button").disabled = false;
      const title = $("guest-button").querySelector(".btn-title-text");
      if (title) title.textContent = "TAP TO CALL";
    }
  }, 1000);
}

// Independent modal dismissal (closes popup without resetting cooldown)
function dismissThanksModal() {
  $("thanks-overlay").hidden = true;
}

async function guestCall() {
  if (state.busy || state.cooldownTimer) return;
  
  // 1. Subtle vibration on customer device where supported
  vibrate(75);
  
  // 2. Play pleasant button interaction sound
  playTapSound();

  state.busy = true;
  $("guest-button").disabled = true;
  const title = $("guest-button").querySelector(".btn-title-text");
  if (title) title.textContent = "SENDING CALL…";

  // 3. Dispatch notification via backend
  const ok = await sendNtfy("A guest is waiting at the counter. Please come assist.", false);
  state.busy = false;

  if (!ok) {
    $("guest-button").disabled = false;
    if (title) title.textContent = "TAP TO CALL";
    toast("Could not send call. Check your internet connection.");
    return;
  }

  incrementTodayCount();
  if (title) title.textContent = "CALL SENT";
  
  // 4. Show confirmation modal & 5. Start 30s cooldown
  startCooldown();
}

function testLocalAlarm() {
  const sound = playChime();
  const buzz = vibrate([350, 150, 350, 150, 500]);
  $("alarm-state").textContent = sound
    ? (buzz ? "Sound and vibration verified" : "Audio works (vibration unavailable on device)")
    : "Audio output unavailable in browser";
  toast(buzz ? "Sound and vibration tested" : "Chime tested · vibration not supported on this browser");
}

/* ==========================================================================
   CAMERA & QR SCANNER
   ========================================================================== */
async function startQrScan() {
  const panel = $("scan-panel");
  const video = $("scan-video");
  panel.hidden = false;
  $("scan-hint").textContent = "Opening device camera…";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    $("scan-hint").textContent = "Camera requires HTTPS. Please type or paste the code.";
    return;
  }
  if (typeof window.jsQR !== "function") {
    $("scan-hint").textContent = "QR scanner module loading... If delayed, enter code manually.";
    return;
  }

  // Camera constraints with multiple fallback modes (cross-Android & iOS compatibility)
  const cameraOptions = [
    { video: { facingMode: { exact: "environment" } } },
    { video: { facingMode: "environment" } },
    { video: { facingMode: "user" } },
    { video: true }
  ];

  let stream = null;
  for (const opt of cameraOptions) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(opt);
      if (stream) break;
    } catch (e) {
      // try next fallback option
    }
  }

  if (!stream) {
    panel.hidden = false;
    $("scan-hint").textContent = "Camera access denied or unavailable. Please enter code manually.";
    return;
  }

  try {
    state.scanStream = stream;
    video.srcObject = state.scanStream;
    video.setAttribute("playsinline", "true");
    await video.play();
    $("scan-hint").textContent = "Point camera at the tablet QR code";

    state.scanCanvas = document.createElement("canvas");
    state.scanContext = state.scanCanvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      if (!state.scanStream || panel.hidden) return;
      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          state.scanCanvas.width = w;
          state.scanCanvas.height = h;
          state.scanContext.drawImage(video, 0, 0, w, h);
          const frame = state.scanContext.getImageData(0, 0, w, h);
          const result = window.jsQR(frame.data, w, h, { inversionAttempts: "attemptBoth" });
          if (result && result.data) {
            const found = cleanCode(result.data);
            if (found.length >= 6) {
              $("shop-code").value = found;
              copyText(found, "Shop code");
              vibrate(100);
              stopQrScan();
              joinPhone();
              toast("Paired with shop code!");
              return;
            }
          }
        }
      }
      state.scanFrame = requestAnimationFrame(scan);
    };
    scan();
  } catch (err) {
    panel.hidden = false;
    $("scan-hint").textContent = "Camera stream could not start. Please enter code manually.";
    console.error("Camera playback failed:", err);
  }
}

function stopQrScan() {
  if (state.scanFrame) cancelAnimationFrame(state.scanFrame);
  state.scanFrame = null;
  if (state.scanStream) {
    state.scanStream.getTracks().forEach(t => t.stop());
    state.scanStream = null;
  }
  $("scan-video").srcObject = null;
  $("scan-panel").hidden = true;
  $("scan-hint").textContent = "Align the tablet QR code inside the viewfinder";
}

function resetDevice() {
  if (!confirm("Are you sure you want to reset Call Bell on this device?")) return;
  stopAlarm();
  stopQrScan();
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  clearInterval(state.cooldownTimer);
  localStorage.removeItem(STORE);
  localStorage.removeItem("callbell.v5");
  state.code = "";
  state.role = null;
  closeSettings();
  showScreen("setup");
  toast("Device reset. You can set it up afresh.");
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
      .then(() => toast("Exited fullscreen"))
      .catch(() => toast("Use your browser controls to exit."));
  } else if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen()
      .then(() => toast("Entered fullscreen kiosk"))
      .catch(() => toast("Fullscreen unavailable in this browser."));
  } else {
    toast("Fullscreen not supported by this browser.");
  }
}

function installApp() {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    state.installPrompt.userChoice.finally(() => { state.installPrompt = null; });
    return;
  }
  toast(/iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "In Safari, tap the Share icon → Add to Home Screen."
    : "Open your browser menu (⋮) → Install app or Add to Home Screen.");
}

/* ==========================================================================
   EVENT LISTENERS & LIFECYCLE
   ========================================================================== */
function attachEvents() {
  $("setup-counter").addEventListener("click", enterKiosk);
  $("setup-phone").addEventListener("click", enterPhoneSetup);
  $("back-setup").addEventListener("click", () => { stopQrScan(); showScreen("setup"); });
  $("join-shop").addEventListener("click", joinPhone);
  $("start-scan").addEventListener("click", startQrScan);
  $("stop-scan").addEventListener("click", stopQrScan);
  $("copy-phone-topic").addEventListener("click", () => copyText(topic(), "Topic"));
  $("open-ntfy").addEventListener("click", openNtfyApp);
  $("go-receiver").addEventListener("click", openReceiver);
  $("test-alarm").addEventListener("click", testLocalAlarm);
  $("test-push").addEventListener("click", testPush);
  $("copy-receiver-topic").addEventListener("click", () => copyText(topic(), "Topic"));

  // Customer button & confirmation modal dismiss
  $("guest-button").addEventListener("click", guestCall);
  $("thanks-close-btn").addEventListener("click", dismissThanksModal);

  // Settings & Navigation
  $("kiosk-settings").addEventListener("click", openSettings);
  $("receiver-settings").addEventListener("click", openSettings);
  $("close-modal").addEventListener("click", closeSettings);
  $("settings-modal").addEventListener("click", e => {
    if (e.target === $("settings-modal")) closeSettings();
  });
  $("copy-settings-code").addEventListener("click", () => copyText(state.code, "Shop code"));
  $("fullscreen-button").addEventListener("click", toggleFullscreen);
  $("install-app").addEventListener("click", installApp);
  $("settings-test").addEventListener("click", testPush);
  $("reset-device").addEventListener("click", resetDevice);
  $("stop-alarm").addEventListener("click", stopAlarm);
  if ($("handset-stop-btn")) $("handset-stop-btn").addEventListener("click", stopAlarm);

  // Shopkeeper Notice Presets
  document.querySelectorAll(".status-preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".status-preset-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const notice = btn.getAttribute("data-notice") || "";
      if ($("custom-notice-input")) $("custom-notice-input").value = notice;
      broadcastNotice(notice);
    });
  });

  if ($("broadcast-notice-btn")) {
    $("broadcast-notice-btn").addEventListener("click", () => {
      const val = $("custom-notice-input") ? $("custom-notice-input").value : "";
      broadcastNotice(val);
    });
  }

  // Tiny QR preview trigger
  $("tiny-qr-box").addEventListener("click", openSettings);

  document.addEventListener("fullscreenchange", () => {
    if (!$("settings-modal").hidden) {
      $("fullscreen-button").querySelector("strong").textContent = document.fullscreenElement
        ? "Exit Fullscreen Kiosk"
        : "Toggle Fullscreen Kiosk";
    }
  });

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    state.installPrompt = e;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.role === "counter") requestWakeLock();
      if (state.role === "phone" && !$("receiver-view").hidden) connectStream();
    }
  });

  window.addEventListener("online", () => {
    if (state.role === "phone" && !$("receiver-view").hidden) connectStream();
  });

  window.addEventListener("beforeunload", () => {
    if (state.stream) state.stream.close();
    stopQrScan();
  });
}

  // Bootstrap
  const init = () => {
    attachEvents();
    load();
    loadTodayCount();

    if (state.role === "counter" && state.code) {
      $("settings-code").textContent = state.code;
      updateQRCodes();
      showScreen("kiosk");
      connectStream(); // Listen for live notices broadcast from shopkeeper phone!
    } else if (state.role === "phone" && state.code) {
      $("shop-code").value = state.code;
      $("receiver-topic").textContent = topic();
      updateQRCodes();
      showScreen("receiver");
      connectStream();
    } else {
      showScreen("setup");
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(err => {
        console.warn("Service worker registration error", err);
      });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
