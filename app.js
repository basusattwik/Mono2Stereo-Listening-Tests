// Blind listening test. Randomisation happens here; the true system name is never
// present in this file -- results are decoded offline via _private/stimulus_map.csv.

const SUBMIT_URL = 'https://script.google.com/macros/s/AKfycbw6fhl8XmfzioB5rf7M2gwZe_cHBgeYU0lWf6tYAGhH0_KhD0YZYXl7Vkaw1TklUlvb/exec';

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
const STORE_KEY = 'm2s_listening_test_v1';

// ---------------------------------------------------------------- utilities
function hashSeed(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const $ = (id) => document.getElementById(id);
function show(id) {
  document.querySelectorAll('section').forEach(s => (s.hidden = true));
  $(id).hidden = false;
  window.scrollTo(0, 0);
}
function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ---------------------------------------------------------------- state
const state = {
  pid: '',
  sessionId: uuid(),
  pages: [],        // [{clipId, stimuli:[{label, stimId, src}], practice}]
  index: 0,
  responses: [],
  headphones: 'confirmed'
};

function buildPages(pid) {
  const rnd = mulberry32(hashSeed(pid));
  const order = shuffle(CLIPS, rnd);
  const pages = order.map(clip => ({
    clipId: clip.id,
    practice: false,
    stimuli: shuffle(clip.stimuli, rnd).map((stimId, i) => ({
      label: LABELS[i],
      stimId,
      src: `audio/${clip.id}/${stimId}.flac`
    }))
  }));
  // Familiarisation page reuses the first clip with an independent label shuffle.
  const first = order[0];
  pages.unshift({
    clipId: first.id,
    practice: true,
    stimuli: shuffle(first.stimuli, rnd).map((stimId, i) => ({
      label: LABELS[i],
      stimId,
      src: `audio/${first.id}/${stimId}.flac`
    }))
  });
  return pages;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      pid: state.pid, sessionId: state.sessionId,
      index: state.index, responses: state.responses
    }));
  } catch (e) { /* storage full or blocked; submission still proceeds */ }
}

// ---------------------------------------------------------------- submission
async function submitPage(rows) {
  const payload = {
    participant_id: state.pid,
    session_id: state.sessionId,
    page_index: state.index,
    headphones: state.headphones,
    user_agent: navigator.userAgent,
    ratings: rows
  };
  state.responses.push(...rows.map(r => ({ ...r, page_index: state.index })));
  save();
  try {
    await fetch(SUBMIT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  } catch (e) { /* offline; localStorage + download fallback covers this */ }
}

// ---------------------------------------------------------------- intro
$('pid').value = new URLSearchParams(location.search).get('pid') || '';
function introReady() {
  $('toHp').disabled = !($('consent').checked && $('pid').value.trim());
}
$('consent').addEventListener('change', introReady);
$('pid').addEventListener('input', introReady);
introReady();

$('toHp').addEventListener('click', () => {
  state.pid = $('pid').value.trim();
  state.pages = buildPages(state.pid);
  buildHpCheck();
  show('hpcheck');
});

// ---------------------------------------------------------------- headphone check
let audioCtx = null;
function tone(side) {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const pan = audioCtx.createStereoPanner();
  osc.frequency.value = 440;
  pan.pan.value = side === 'left' ? -1 : side === 'right' ? 1 : 0;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
  osc.connect(gain).connect(pan).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 1.3);
}

let hpAnswers = [];
let hpTruth = [];
function buildHpCheck() {
  const rnd = mulberry32(hashSeed(state.pid + '|hp'));
  hpTruth = shuffle(['left', 'right', 'both'], rnd);
  hpAnswers = [null, null, null];
  const box = $('hpTrials');
  box.innerHTML = '';
  hpTruth.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'hp';
    d.innerHTML = `<strong>Sound ${i + 1}</strong>
      <div class="opts">
        <button class="ghost" data-play="${i}">Play</button>
        <button class="ghost" data-ans="left" data-i="${i}">Left</button>
        <button class="ghost" data-ans="right" data-i="${i}">Right</button>
        <button class="ghost" data-ans="both" data-i="${i}">Both</button>
      </div>`;
    box.appendChild(d);
  });
  box.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.play !== undefined) { tone(hpTruth[+b.dataset.play]); return; }
    const i = +b.dataset.i;
    hpAnswers[i] = b.dataset.ans;
    b.parentElement.querySelectorAll('[data-ans]').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    $('toCalib').disabled = hpAnswers.some(a => a === null);
  };
}
$('toCalib').addEventListener('click', () => {
  const ok = hpAnswers.every((a, i) => a === hpTruth[i]);
  if (!ok) {
    $('hpErr').hidden = false;
    state.headphones = 'retry';
    buildHpCheck();
    $('toCalib').disabled = true;
    return;
  }
  $('hpErr').hidden = true;
  show('calib');
});

// ---------------------------------------------------------------- calibration
let calibAudio = null;
$('calibPlay').addEventListener('click', () => {
  if (!calibAudio) {
    calibAudio = new Audio(state.pages[0].stimuli[0].src);
    calibAudio.loop = true;
  }
  if (calibAudio.paused) { calibAudio.play(); $('calibPlay').textContent = 'Stop'; }
  else { calibAudio.pause(); $('calibPlay').textContent = 'Play example'; }
});
$('toPractice').addEventListener('click', () => {
  if (calibAudio) { calibAudio.pause(); calibAudio = null; }
  $('calibPlay').textContent = 'Play example';
  show('instructions');
});
$('toTest').addEventListener('click', () => { state.index = 0; renderPage(); show('test'); });

// ---------------------------------------------------------------- test page
let players = [];
let sharedTime = 0;

function stopAll() {
  players.forEach(p => {
    if (!p.audio.paused) { sharedTime = p.audio.currentTime; p.audio.pause(); }
    p.btn.classList.remove('on');
    p.btn.textContent = 'Play';
  });
}

function renderPage() {
  const page = state.pages[state.index];
  const total = state.pages.length - 1;
  const shown = state.index;                       // practice is page 0
  $('practiceNote').hidden = !page.practice;
  $('pageTitle').textContent = page.practice
    ? 'Practice excerpt'
    : `Excerpt ${shown} of ${total}`;
  $('bar').style.width = `${(shown / total) * 100}%`;
  $('testErr').hidden = true;
  $('next').textContent = page.practice ? 'Start the real test' : 'Continue';

  players.forEach(p => p.audio.pause());
  players = [];
  sharedTime = 0;

  const box = $('stimuli');
  box.innerHTML = '';
  page.stimuli.forEach(st => {
    const el = document.createElement('div');
    el.className = 'stim';
    el.innerHTML = `
      <div class="stim-head">
        <span class="tag">${st.label}</span>
        <button class="play">Play</button>
      </div>
      <div class="scale">
        <label>Audio quality</label>
        <input type="range" min="0" max="100" value="50" data-k="quality">
        <output class="unset">&mdash;</output>
      </div>
      <div class="scale">
        <label>Spatial imaging</label>
        <input type="range" min="0" max="100" value="50" data-k="spatial">
        <output class="unset">&mdash;</output>
      </div>`;
    box.appendChild(el);

    const audio = new Audio(st.src);
    audio.loop = true;
    audio.preload = 'auto';
    const btn = el.querySelector('.play');
    const rec = { stim: st, audio, btn, plays: 0, quality: null, spatial: null };

    btn.addEventListener('click', () => {
      const wasPlaying = !audio.paused;
      stopAll();
      if (wasPlaying) return;
      audio.currentTime = Math.min(sharedTime, Math.max(0, (audio.duration || 5) - 0.05));
      audio.play();
      rec.plays++;
      btn.classList.add('on');
      btn.textContent = 'Playing';
    });

    el.querySelectorAll('input[type=range]').forEach(r => {
      const out = r.parentElement.querySelector('output');
      r.addEventListener('input', () => {
        rec[r.dataset.k] = +r.value;
        out.textContent = r.value;
        out.classList.remove('unset');
      });
    });

    players.push(rec);
  });
}

$('next').addEventListener('click', async () => {
  const missing = players.some(p => p.quality === null || p.spatial === null);
  if (missing) { $('testErr').hidden = false; return; }
  stopAll();

  const page = state.pages[state.index];
  if (!page.practice) {
    await submitPage(players.map(p => ({
      clip_id: page.clipId,
      stim_id: p.stim.stimId,
      label: p.stim.label,
      quality: p.quality,
      spatial: p.spatial,
      n_plays: p.plays
    })));
  }

  state.index++;
  save();
  if (state.index < state.pages.length) {
    renderPage();
  } else {
    $('code').textContent = state.sessionId.slice(0, 6).toUpperCase();
    show('done');
  }
});

// ---------------------------------------------------------------- backup download
$('dl').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({
    participant_id: state.pid, session_id: state.sessionId,
    headphones: state.headphones, responses: state.responses
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `listening_test_${state.pid}.json`;
  a.click();
});
