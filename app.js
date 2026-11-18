/* Counter Bell — app logic */
const $ = (id) => document.getElementById(id);
const STORE = 'counterbell.v1';
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];

const state = {
  code: '', server: 'https://ntfy.sh', role: null,
  armed: false, escalate: false, ringing: false,
  presses: 0, history: [], cooldown: false,
  client: null, brokerIdx: 0, actx: null, wakeLock: null,
  timers: {}, installEvent: null, lastId: ''
};

/* ---------- persistence ---------- */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    Object.assign(state, {
      code: s.code || '', server: s.server || 'https://ntfy.sh',
      role: s.role || null, escalate: !!s.escalate,
      presses: s.presses || 0, history: s.history || []
    });
  } catch {}
}
function save() {
  localStorage.setItem(STORE, JSON.stringify({
    code: state.code, server: state.server, role: state.role,
    escalate: state.escalate, presses: state.presses,
    history: state.history.slice(0, 40)
  }));
}

/* ---------- helpers ---------- */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 48);
const topic = () => 'counterbell-' + state.code;
const pushUrl = () => state.server.replace(/\/+$/, '') + '/' + encodeURIComponent(topic());

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function setStatus(el, text, stateName) {
  el.dataset.state = stateName || '';
  el.lastElementChild.textContent = text;
}
const haptic = (p) => { try { navigator.vibrate?.(p); } catch {} };

/* ---------- audio ---------- */
function audio() {
  if (!state.actx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    state.actx = new Ctx();
  }
  if (state.actx.state === 'suspended') state.actx.resume();
  return state.actx;
}
function tone(freq, dur, at) {
  const ctx = state.actx;
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.42, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.03);
}
function sirenLoop() {
  if (!state.ringing || !state.actx) return;
  const t = state.actx.currentTime;
  tone(920, 0.15, t); tone(690, 0.15, t + 0.19); tone(920, 0.15, t + 0.38);
  state.timers.siren = setTimeout(sirenLoop, 1120);
}
function vibrateLoop() {
  if (!state.ringing) return;
  haptic([680, 200, 680, 200]);
  state.timers.vibe = setTimeout(vibrateLoop, 1650);
}

/* ---------- wake lock ---------- */
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || state.wakeLock) return;
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch {}
}

/* ---------- push ---------- */
async function sendRing() {
  const id = Math.random().toString(36).slice(2) + Date.now();
  const params = new URLSearchParams({
    title: 'Customer at the counter',
    priority: 'urgent',
    tags: 'bell',
    click: location.href
  });
  if (state.client?.connected) {
    state.client.publish('venice/' + topic(), JSON.stringify({ type: 'ring', id }), { qos: 1 });
  }
  try {
    const res = await fetch(pushUrl() + '?' + params, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'Someone is at the counter · ' + new Date().toLocaleTimeString()
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------- backup MQTT ---------- */
function connectBroker() {
  if (!window.mqtt) return;
  state.client?.end(true);
  const url = BROKERS[state.brokerIdx % BROKERS.length];
  let opened = false;
  const client = mqtt.connect(url, {
    clientId: 'cb-' + Math.random().toString(16).slice(2),
    clean: true, connectTimeout: 5000, reconnectPeriod: 4000
  });
  state.client = client;
  client.on('connect', () => {
    opened = true;
    if (state.role === 'receiver') client.subscribe('venice/' + topic(), { qos: 1 });
  });
  client.on('message', (_t, payload) => {
    try { const d = JSON.parse(payload.toString()); if (d.type === 'ring') ring(d.id); } catch {}
  });
  client.on('error', () => {
    if (!opened) { state.brokerIdx++; setTimeout(connectBroker, 900); }
  });
}

/* ---------- ring lifecycle ---------- */
function ring(id) {
  if (id) { if (id === state.lastId) return; state.lastId = id; }
  state.ringing = true;
  const now = new Date();
  $('ring-meta').textContent = now.toLocaleTimeString();
  $('ring').hidden = false;
  document.title = 'Ringing · Counter Bell';
  audio(); sirenLoop(); vibrateLoop(); keepAwake(); haptic([700, 240, 700, 240]);

  state.history.unshift({ t: now.toISOString(), kind: 'ring' });
  state.history = state.history.slice(0, 40);
  save(); renderHistory();

  if (state.escalate) scheduleEscalation(1);
}
function scheduleEscalation(n) {
  if (!state.ringing || n > 5) return;
  state.timers.esc = setTimeout(async () => {
    if (!state.ringing) return;
    await sendRing();
    scheduleEscalation(n + 1);
  }, 60000);
}
function dismiss() {
  state.ringing = false;
  clearTimeout(state.timers.siren);
  clearTimeout(state.timers.vibe);
  clearTimeout(state.timers.esc);
  haptic(0);
  $('ring').hidden = true;
  document.title = 'Counter Bell';
  if (state.role === 'receiver') setStatus($('recv-status'), 'Idle', '');
}

/* ---------- screens ---------- */
function show(name) {
  for (const s of ['s-onboard', 's-station', 's-receiver']) {
    $(s).hidden = s !== name;
  }
}
function enterRole(role) {
  state.role = role;
  state.code = slug($('code').value) || 'default';
  state.server = ($('server').value.trim() || 'https://ntfy.sh');
  save();
  if (role === 'station') {
    $('station-code').textContent = '#' + topic();
    $('press-count').textContent = state.presses;
    setStatus($('station-status'), 'Ready', 'live');
    show('s-station');
    keepAwake();
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    $('recv-code').textContent = '#' + topic();
    $('channel-text').textContent = topic();
    $('qr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=340x340&data=' +
      encodeURIComponent('ntfy://' + state.server.replace(/^https?:\/\//, '') + '/' + topic());
    $('escalate').checked = state.escalate;
    renderHistory();
    setStatus($('recv-status'), 'Idle', '');
    show('s-receiver');
  }
  connectBroker();
}

/* ---------- history ---------- */
function renderHistory() {
  const list = $('history');
  if (!state.history.length) {
    list.innerHTML = '<li class="empty">No rings yet.</li>';
    return;
  }
  list.innerHTML = state.history.slice(0, 20).map((h) => {
    const d = new Date(h.t);
    return `<li><span>${h.kind === 'test' ? 'Test ring' : 'Customer'}</span><time>${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>`;
  }).join('');
}

/* ---------- wiring ---------- */
function reroll() {
  const rand = () => Math.random().toString(36).slice(2, 8);
  $('code').value = 'b-' + rand() + rand().slice(0, 3);
}

$('reroll').addEventListener('click', reroll);
$('pick-station').addEventListener('click', () => enterRole('station'));
$('pick-receiver').addEventListener('click', () => enterRole('receiver'));

$('press').addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  if (state.cooldown) return;
  state.cooldown = true;
  const btn = $('press');
  const label = $('press-label');
  const original = label.innerHTML;

  btn.dataset.state = 'sending';
  label.innerHTML = '<span class="press-main">Sending…</span>';
  haptic(80);
  setStatus($('station-status'), 'Sending', 'busy');

  const ok = await sendRing();
  state.presses++;
  $('press-count').textContent = state.presses;
  save();

  if (ok) {
    btn.dataset.state = 'sent';
    label.innerHTML = '<span class="press-main">Sent</span>';
    setStatus($('station-status'), 'Delivered', 'live');
  } else {
    btn.dataset.state = 'failed';
    label.innerHTML = '<span class="press-main">Failed · retry</span>';
    setStatus($('station-status'), 'No connection', 'bad');
  }

  setTimeout(() => {
    btn.dataset.state = '';
    label.innerHTML = original;
    setStatus($('station-status'), 'Ready', 'live');
    state.cooldown = false;
  }, 2200);
});

$('dismiss').addEventListener('click', dismiss);

$('test').addEventListener('click', async () => {
  const btn = $('test');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const ok = await sendRing();
  state.history.unshift({ t: new Date().toISOString(), kind: 'test' });
  save(); renderHistory();
  btn.textContent = ok ? 'Test sent' : 'Failed — check code';
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Send test ring'; }, 2200);
  if (!ok) toast('Check the channel code and your connection.');
});

$('arm').addEventListener('click', async () => {
  audio();
  tone(880, 0.12, state.actx.currentTime);
  state.armed = true;
  $('arm').textContent = 'Armed';
  $('arm-hint').textContent = 'Siren armed on this page too.';
  keepAwake();
});

$('escalate').addEventListener('change', (e) => {
  state.escalate = e.target.checked;
  save();
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(topic());
    toast('Channel copied');
  } catch { toast('Copy failed'); }
});

$('open-app').addEventListener('click', () => {
  location.href = 'ntfy://' + state.server.replace(/^https?:\/\//, '') + '/' + topic();
});
$('open-web').addEventListener('click', () => {
  window.open(state.server.replace(/\/+$/, '') + '/' + topic(), '_blank', 'noopener');
});

$('station-settings').addEventListener('click', () => { show('s-onboard'); $('code').value = state.code; });
$('recv-settings').addEventListener('click', () => { show('s-onboard'); $('code').value = state.code; });

/* ---------- install ---------- */
function installSheet() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  $('sheet-body').innerHTML = ios
    ? '<ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>.</li><li>Launch it from the new icon.</li></ol>'
    : '<ol><li>Open the browser menu.</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Launch it from the new icon.</li></ol>';
  $('sheet').hidden = false;
}
$('install').addEventListener('click', () => {
  if (state.installEvent) { state.installEvent.prompt(); state.installEvent = null; }
  else installSheet();
});
$('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvent = e; });

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ---------- visibility / lifecycle ---------- */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (state.role) keepAwake();
    if (!state.client?.connected) connectBroker();
  }
});
window.addEventListener('online', () => { if (state.role) connectBroker(); });

/* ---------- boot ---------- */
load();
$('code').value = state.code || '';
if (!state.code) reroll();
$('server').value = state.server === 'https://ntfy.sh' ? '' : state.server;
$('escalate').checked = state.escalate;
if (state.role) {
  show(state.role === 'station' ? 's-station' : 's-receiver');
  enterRole(state.role);
} else {
  show('s-onboard');
}
