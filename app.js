'use strict';

/* =========================================================================
   Ketik — typing trainer
   ========================================================================= */

const $ = (id) => document.getElementById(id);

const KEYS = { settings: 'ketik:settings', history: 'ketik:history', theme: 'ketik:theme' };
const AMOUNTS = { time: [15, 30, 60, 120], words: [10, 25, 50, 100] };
const KB_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const HISTORY_LIMIT = 500;
const MAX_EXTRA = 20;          // extra letters allowed past the end of a word
const WEAK_MIN_KEYSTROKES = 300;
const HEAT_CAP = 0.2;          // miss rate at which a key reaches the darkest step
const SENTINEL = '#';          // kept in the hidden input so mobile backspace still fires `input`

/* ---------- storage ---------- */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage unavailable */ }
  },
};

const settings = Object.assign(
  { mode: 'time', amount: 30, lang: 'english', weak: false },
  store.get(KEYS.settings, {})
);
if (!AMOUNTS[settings.mode]) settings.mode = 'time';
if (!AMOUNTS[settings.mode].includes(settings.amount)) settings.amount = AMOUNTS[settings.mode][1];
if (!WORDS[settings.lang]) settings.lang = 'english';

let history = store.get(KEYS.history, []);
if (!Array.isArray(history)) history = [];

/* ---------- elements ---------- */
const el = {
  testView: $('view-test'),
  statsView: $('view-stats'),
  testArea: $('testArea'),
  resultArea: $('resultArea'),
  wrap: $('wordsWrap'),
  words: $('words'),
  caret: $('caret'),
  input: $('hiddenInput'),
  hint: $('focusHint'),
  liveProgress: $('liveProgress'),
  liveWpm: $('liveWpm'),
  weakNote: $('weakNote'),
  tooltip: $('tooltip'),
};

/* =========================================================================
   Test state
   ========================================================================= */

let t = null; // current test

function freshTest() {
  return {
    words: [],
    typed: [],
    wordEls: [],
    index: 0,
    running: false,
    finished: false,
    start: 0,
    end: 0,
    timer: 0,
    scroll: 0,
    correctKeys: 0,     // keystrokes that matched what was expected
    wrongKeys: 0,       // keystrokes that did not (kept even if later corrected)
    rawChars: 0,        // every inserted character, spaces included
    keyStats: {},       // expected char -> [hits, misses]
    samples: [],        // one per second: { t, wpm, raw, errors }
    sampleRaw: 0,
    sampleErrors: 0,
  };
}

/* ---------- word generation ---------- */

function aggregateKeys(entries) {
  const out = {};
  for (const h of entries) {
    for (const [k, [hit, miss]] of Object.entries(h.keys || {})) {
      const o = out[k] || (out[k] = [0, 0]);
      o[0] += hit;
      o[1] += miss;
    }
  }
  return out;
}

/** Per-letter miss rate, shrunk toward the overall rate so rarely-typed keys don't dominate. */
function weaknessRates(keys) {
  let hits = 0, misses = 0;
  for (const k of Object.keys(keys)) {
    if (k === ' ') continue;
    hits += keys[k][0];
    misses += keys[k][1];
  }
  const total = hits + misses;
  const prior = total ? misses / total : 0;
  const rates = {};
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    const [h, m] = keys[ch] || [0, 0];
    rates[ch] = (m + prior * 12) / (h + m + 12);
  }
  return { rates, prior, total };
}

function weakKeysAvailable() {
  return weaknessRates(aggregateKeys(history)).total >= WEAK_MIN_KEYSTROKES;
}

function makeWordPicker() {
  const list = WORDS[settings.lang];
  let pick = () => list[(Math.random() * list.length) | 0];

  if (settings.weak && weakKeysAvailable()) {
    const { rates, prior } = weaknessRates(aggregateKeys(history));
    const base = prior || 0.01;
    // A word's weight grows sharply with how many weak letters it contains.
    const weights = list.map((w) => {
      let s = 0;
      for (const ch of w) s += (rates[ch] ?? base) / base;
      return Math.pow(s / w.length, 3);
    });
    const cumulative = [];
    let acc = 0;
    for (const w of weights) cumulative.push((acc += w));
    pick = () => {
      const r = Math.random() * acc;
      let lo = 0, hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < r) lo = mid + 1; else hi = mid;
      }
      return list[lo];
    };
  }

  let last = '';
  return () => {
    let w = pick();
    for (let i = 0; i < 5 && w === last; i++) w = pick();
    last = w;
    return w;
  };
}

let nextWord = makeWordPicker();

/* ---------- rendering words ---------- */

function renderWord(i) {
  const wordEl = t.wordEls[i];
  const target = t.words[i];
  const typed = t.typed[i];
  const committed = i < t.index;
  const frag = document.createDocumentFragment();
  const n = Math.max(target.length, typed.length);

  for (let j = 0; j < n; j++) {
    const span = document.createElement('span');
    let cls = 'letter';
    if (j < typed.length) {
      if (j >= target.length) cls += ' extra';
      else cls += typed[j] === target[j] ? ' correct' : ' wrong';
    } else if (committed) {
      cls += ' missed';
    }
    span.className = cls;
    span.textContent = j < target.length ? target[j] : typed[j];
    frag.appendChild(span);
  }
  wordEl.textContent = '';
  wordEl.appendChild(frag);
  wordEl.classList.toggle('is-error', committed && typed !== target);
}

function appendWords(count) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const w = nextWord();
    const wordEl = document.createElement('div');
    wordEl.className = 'word';
    t.words.push(w);
    t.typed.push('');
    t.wordEls.push(wordEl);
    frag.appendChild(wordEl);
    renderWord(t.words.length - 1);
  }
  el.words.appendChild(frag);
}

function positionCaret() {
  if (!t || !t.wordEls.length) return;
  const wordEl = t.wordEls[Math.min(t.index, t.wordEls.length - 1)];
  const letters = wordEl.children;
  const pos = t.typed[t.index] ? t.typed[t.index].length : 0;
  const lineH = wordEl.offsetHeight;

  // Keep the active word on the second visible line once we are past the first.
  const top = wordEl.offsetTop;
  if (top - t.scroll >= lineH * 2 || top < t.scroll) {
    t.scroll = Math.max(0, top - lineH);
    el.words.style.transform = `translateY(${-t.scroll}px)`;
  }

  let x;
  if (pos < letters.length) {
    x = wordEl.offsetLeft + letters[pos].offsetLeft;
  } else {
    const last = letters[letters.length - 1];
    x = wordEl.offsetLeft + last.offsetLeft + last.offsetWidth;
  }
  const caretH = el.caret.offsetHeight;
  const y = top - t.scroll + (lineH - caretH) / 2;
  el.caret.style.transform = `translate(${x - 1}px, ${y}px)`;
}

/* ---------- lifecycle ---------- */

function newTest() {
  if (t) clearInterval(t.timer);
  t = freshTest();
  nextWord = makeWordPicker();

  el.words.textContent = '';
  el.words.style.transform = 'translateY(0)';
  appendWords(settings.mode === 'words' ? settings.amount : 120);

  el.testArea.classList.remove('is-running');
  el.wrap.classList.remove('is-typing');
  el.resultArea.hidden = true;
  el.testArea.hidden = false;
  updateLive();
  renderWeakNote();

  el.input.value = SENTINEL;
  focusInput();
  requestAnimationFrame(positionCaret);
}

function startTest() {
  t.running = true;
  t.start = performance.now();
  el.testArea.classList.add('is-running');
  t.timer = setInterval(tick, 100);
}

function elapsedSeconds(now = performance.now()) {
  return (now - t.start) / 1000;
}

function tick() {
  if (!t.running) return;
  let secs = elapsedSeconds();
  if (settings.mode === 'time') secs = Math.min(secs, settings.amount);

  while (Math.floor(secs) > t.samples.length) pushSample(t.samples.length + 1, 1);

  if (settings.mode === 'time' && secs >= settings.amount) {
    finishTest();
    return;
  }
  updateLive();
}

function pushSample(atSecond, span) {
  const raw = t.rawChars - t.sampleRaw;
  t.samples.push({
    t: atSecond,
    wpm: wpmAt(atSecond),
    raw: (raw / 5) / (span / 60),
    errors: t.sampleErrors,
  });
  t.sampleRaw = t.rawChars;
  t.sampleErrors = 0;
}

/** Characters that count toward net speed: fully correct words plus their spaces, and the correct prefix of the active word. */
function correctChars() {
  let n = 0;
  for (let i = 0; i < t.index; i++) {
    // The final word of a words-mode test is never followed by a space.
    const space = settings.mode === 'words' && i === t.words.length - 1 ? 0 : 1;
    if (t.typed[i] === t.words[i]) n += t.words[i].length + space;
  }
  const cur = t.typed[t.index];
  if (cur && t.index < t.words.length && t.words[t.index].startsWith(cur)) n += cur.length;
  return n;
}

function wpmAt(secs) {
  return secs > 0 ? (correctChars() / 5) / (secs / 60) : 0;
}

function updateLive() {
  if (settings.mode === 'time') {
    const left = t.running ? Math.max(0, Math.ceil(settings.amount - elapsedSeconds())) : settings.amount;
    el.liveProgress.textContent = left;
  } else {
    el.liveProgress.textContent = `${t.index}/${settings.amount}`;
  }
  const secs = t.running ? elapsedSeconds() : 0;
  el.liveWpm.textContent = secs >= 1 ? `${Math.round(wpmAt(secs))} wpm` : '';
}

function finishTest() {
  if (t.finished) return;
  clearInterval(t.timer);
  t.running = false;
  t.finished = true;
  t.end = performance.now();

  let secs;
  if (settings.mode === 'time') {
    secs = settings.amount;
    while (t.samples.length < settings.amount) pushSample(t.samples.length + 1, 1);
  } else {
    secs = elapsedSeconds(t.end);
    const rest = secs - t.samples.length;
    if (rest > 0.25 || t.samples.length === 0) pushSample(secs, Math.max(rest, 0.05));
  }

  const result = buildResult(secs);
  el.testArea.classList.remove('is-running');

  if (result.chars[0] === 0) {
    // Nothing correct was typed — don't pollute history with an empty run.
    newTest();
    return;
  }

  const prevBest = bestFor(result);
  const isPb = prevBest != null && result.wpm > prevBest;
  history.push(result);
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
  store.set(KEYS.history, history);

  showResult(result, isPb);
}

function buildResult(secs) {
  const wpm = wpmAt(secs);
  const raw = (t.rawChars / 5) / (secs / 60);
  const totalKeys = t.correctKeys + t.wrongKeys;
  const acc = totalKeys ? (t.correctKeys / totalKeys) * 100 : 0;

  // Consistency: how steady the per-second raw speed was (100 = perfectly even).
  const raws = t.samples.map((s) => s.raw);
  let cons = null;
  if (raws.length >= 2) {
    const mean = raws.reduce((a, b) => a + b, 0) / raws.length;
    const sd = Math.sqrt(raws.reduce((a, b) => a + (b - mean) ** 2, 0) / raws.length);
    cons = mean > 0 ? Math.max(0, Math.min(100, 100 * (1 - sd / mean))) : 0;
  }

  // Character breakdown: correct / incorrect / extra / missed.
  const chars = [0, 0, 0, 0];
  const lastWord = Math.min(t.index, t.words.length - 1);
  for (let i = 0; i <= lastWord; i++) {
    const target = t.words[i];
    const typed = t.typed[i];
    const committed = i < t.index;
    const n = Math.max(target.length, typed.length);
    for (let j = 0; j < n; j++) {
      if (j >= typed.length) { if (committed) chars[3]++; }
      else if (j >= target.length) chars[2]++;
      else if (typed[j] === target[j]) chars[0]++;
      else chars[1]++;
    }
  }

  return {
    ts: Date.now(),
    mode: settings.mode,
    amount: settings.amount,
    lang: settings.lang,
    weak: settings.weak && weakKeysAvailable(),
    wpm: round1(wpm),
    raw: round1(raw),
    acc: round1(acc),
    cons: cons == null ? null : round1(cons),
    secs: round1(secs),
    chars,
    keys: t.keyStats,
    samples: t.samples.map((s) => [round1(s.t), round1(s.wpm), round1(s.raw), s.errors]),
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

/* ---------- typing ---------- */

function bump(ch, hit) {
  const k = t.keyStats[ch] || (t.keyStats[ch] = [0, 0]);
  k[hit ? 0 : 1]++;
}

function insertChar(ch) {
  if (t.finished || t.index >= t.words.length) return;
  const target = t.words[t.index];
  const cur = t.typed[t.index];

  if (ch === ' ') {
    if (cur.length === 0) return; // a stray space before a word does nothing
    if (!t.running) startTest();
    const ok = cur.length >= target.length;
    if (ok) { t.correctKeys++; bump(' ', true); }
    else { t.wrongKeys++; t.sampleErrors++; bump(' ', false); }
    t.rawChars++;
    t.index++;
    renderWord(t.index - 1);

    if (settings.mode === 'words' && t.index >= settings.amount) {
      finishTest();
      return;
    }
    if (settings.mode === 'time' && t.words.length - t.index < 60) appendWords(80);
    el.wrap.classList.add('is-typing');
    positionCaret();
    updateLive();
    return;
  }

  if (cur.length >= target.length + MAX_EXTRA) return;
  if (!t.running) startTest();

  const pos = cur.length;
  t.typed[t.index] = cur + ch;
  t.rawChars++;
  if (pos < target.length) {
    const hit = ch === target[pos];
    bump(target[pos], hit);
    if (hit) t.correctKeys++; else { t.wrongKeys++; t.sampleErrors++; }
  } else {
    t.wrongKeys++;
    t.sampleErrors++;
  }
  renderWord(t.index);

  // Words mode ends the moment the last word is typed correctly — no trailing space needed.
  if (settings.mode === 'words' && t.index === settings.amount - 1 && t.typed[t.index] === target) {
    t.index++;
    finishTest();
    return;
  }

  el.wrap.classList.add('is-typing');
  positionCaret();
}

function backspace(wholeWord) {
  if (t.finished) return;
  if (t.typed[t.index].length === 0) {
    // Step back into the previous word only if it still has a mistake to fix.
    const prev = t.index - 1;
    if (prev < 0 || t.typed[prev] === t.words[prev]) return;
    t.index = prev;
    t.typed[prev] = wholeWord ? '' : t.typed[prev];
    renderWord(prev);
    renderWord(prev + 1);
  } else {
    t.typed[t.index] = wholeWord ? '' : t.typed[t.index].slice(0, -1);
    renderWord(t.index);
  }
  positionCaret();
  updateLive();
}

/* ---------- input plumbing ---------- */

let composing = false;
let typingIdle = 0;

function resetInput() {
  el.input.value = SENTINEL;
  try { el.input.setSelectionRange(1, 1); } catch (_) { /* not focusable yet */ }
}

function readInput() {
  const v = el.input.value;
  if (!v.startsWith(SENTINEL)) {
    // The sentinel was deleted: that was a backspace (typical on mobile keyboards).
    if (v.length === 0) backspace(false);
  } else {
    for (const ch of v.slice(SENTINEL.length)) {
      insertChar(ch === ' ' ? ' ' : ch);
      if (t.finished) break;
    }
  }
  resetInput();
  clearTimeout(typingIdle);
  typingIdle = setTimeout(() => el.wrap.classList.remove('is-typing'), 600);
}

el.input.addEventListener('compositionstart', () => { composing = true; });
el.input.addEventListener('compositionend', () => { composing = false; readInput(); });
el.input.addEventListener('input', () => { if (!composing) readInput(); });

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace') {
    e.preventDefault();
    backspace(e.ctrlKey || e.altKey || e.metaKey);
  }
});

el.input.addEventListener('focus', () => {
  el.wrap.classList.remove('is-blurred');
  el.hint.hidden = true;
  resetInput();
});
el.input.addEventListener('blur', () => {
  // Defer so a click that immediately refocuses doesn't flash the hint.
  setTimeout(() => {
    if (document.activeElement !== el.input && !el.testArea.hidden && !el.testView.hidden) {
      el.wrap.classList.add('is-blurred');
      el.hint.hidden = false;
    }
  }, 120);
});

function focusInput() {
  if (el.testView.hidden || el.testArea.hidden) return;
  el.input.focus({ preventScroll: true });
}

el.wrap.addEventListener('mousedown', (e) => { e.preventDefault(); focusInput(); });

document.addEventListener('keydown', (e) => {
  const onTest = !el.testView.hidden;
  if (e.key === 'Tab' && !e.shiftKey && onTest) {
    e.preventDefault();
    newTest();
    return;
  }
  if (e.key === 'Escape' && onTest) {
    e.preventDefault();
    newTest();
    return;
  }
  if (e.key === 'Enter' && onTest && !el.resultArea.hidden && document.activeElement === document.body) {
    newTest();
    return;
  }
  // Any printable key while the test is visible but unfocused grabs focus, so the keystroke lands.
  const active = document.activeElement;
  const onControl = active && active !== document.body && active !== el.input && active !== el.wrap;
  if (onTest && !el.testArea.hidden && active !== el.input && !e.ctrlKey && !e.metaKey && !e.altKey
      && e.key.length === 1 && !(onControl && (e.key === ' '))) {
    focusInput();
  }
});

/* =========================================================================
   Results
   ========================================================================= */

function configLabel(r) {
  const lang = r.lang === 'indonesia' ? 'id' : 'en';
  return `${r.mode} ${r.amount} · ${lang}${r.weak ? ' · weak' : ''}`;
}

function configKey(r) { return `${r.mode}|${r.amount}|${r.lang}`; }

function bestFor(r) {
  const key = configKey(r);
  let best = null;
  for (const h of history) {
    if (configKey(h) === key && (best == null || h.wpm > best)) best = h.wpm;
  }
  return best;
}

function showResult(r, isPb) {
  el.testArea.hidden = true;
  el.resultArea.hidden = false;
  el.input.blur();

  $('rWpm').textContent = Math.round(r.wpm);
  $('rAcc').textContent = `${Math.round(r.acc)}%`;
  $('rPb').hidden = !isPb;
  $('rType').textContent = configLabel(r);
  $('rRaw').textContent = Math.round(r.raw);
  $('rChars').textContent = r.chars.join('/');
  $('rCons').textContent = r.cons == null ? '—' : `${Math.round(r.cons)}%`;
  $('rTime').textContent = `${Math.round(r.secs)}s`;

  renderResultChart(r);
  renderKeyboard($('rKeyboard'), r.keys, true);
  $('nextBtn').focus({ preventScroll: true });
}

function renderResultChart(r) {
  const chartEl = $('rChart');
  const s = r.samples;
  if (s.length < 2) {
    chartEl._cfg = null;
    chartEl.innerHTML = '<p class="card-foot">Test was too short to chart.</p>';
    return;
  }
  const xs = s.map((p) => p[0]);
  const wpm = s.map((p) => p[1]);
  const raw = s.map((p) => p[2]);
  drawLineChart(chartEl, {
    xs,
    series: [
      { values: raw, cls: 'line-raw' },
      { values: wpm, cls: 'line-wpm', hoverDot: true },
    ],
    markers: s.filter((p) => p[3] > 0).map((p) => ({ x: p[0], y: p[2] })),
    yMax: niceMax(Math.max(...wpm, ...raw)),
    xFmt: (v) => `${Math.round(v)}s`,
    tip: (i) => `
      <div class="tt-title">${Math.round(xs[i] * 10) / 10}s</div>
      <div class="tt-row"><i class="sw sw-wpm"></i>wpm<b>${Math.round(wpm[i])}</b></div>
      <div class="tt-row"><i class="sw sw-raw"></i>raw<b>${Math.round(raw[i])}</b></div>
      <div class="tt-row"><i class="sw sw-err"></i>errors<b>${s[i][3]}</b></div>`,
  });
}

/* =========================================================================
   Charts (hand-rolled SVG)
   ========================================================================= */

function niceMax(v) {
  if (!(v > 0)) return 50;
  const step = v > 150 ? 50 : v > 60 ? 20 : 10;
  return Math.ceil((v * 1.08) / step) * step;
}

function drawLineChart(container, cfg) {
  container._cfg = cfg;
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (!W || !H) return;

  const m = { l: 34, r: 10, t: 8, b: 22 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const { xs, series, markers = [], yMax, xFmt, tip, dots = false } = cfg;
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const sx = (v) => m.l + (x1 === x0 ? iw / 2 : ((v - x0) / (x1 - x0)) * iw);
  const sy = (v) => m.t + ih - (Math.min(v, yMax) / yMax) * ih;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">`;

  svg += '<g class="grid">';
  for (let k = 1; k <= 4; k++) {
    const y = sy((yMax * k) / 4);
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
  }
  svg += '</g>';
  svg += `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}"/>`;
  for (let k = 0; k <= 4; k++) {
    svg += `<text class="tick" x="${m.l - 8}" y="${sy((yMax * k) / 4) + 4}" text-anchor="end">${Math.round((yMax * k) / 4)}</text>`;
  }

  const tickEvery = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor(iw / 70))));
  for (let i = 0; i < xs.length; i += tickEvery) {
    svg += `<text class="tick" x="${sx(xs[i])}" y="${H - 4}" text-anchor="middle">${xFmt(xs[i])}</text>`;
  }

  for (const s of series) {
    let d = '';
    s.values.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`;
    });
    svg += `<path class="${s.cls}" d="${d}"/>`;
    if (dots && s.hoverDot) {
      s.values.forEach((v, i) => { if (v != null) svg += `<circle class="pt" r="4" cx="${sx(xs[i])}" cy="${sy(v)}"/>`; });
    }
  }
  for (const p of markers) {
    svg += `<circle class="err-dot" r="4" cx="${sx(p.x)}" cy="${sy(p.y)}"/>`;
  }

  svg += `<line class="cross" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  svg += `<circle class="hover-dot" r="5" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${m.l}" y="0" width="${iw}" height="${H}"/>`;
  svg += '</svg>';
  container.innerHTML = svg;

  const cross = container.querySelector('.cross');
  const dot = container.querySelector('.hover-dot');
  const hit = container.querySelector('.hit');
  const main = series.find((s) => s.hoverDot) || series[0];

  const onMove = (e) => {
    const rect = container.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    xs.forEach((x, i) => {
      const dist = Math.abs(sx(x) - px);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    const cx = sx(xs[best]);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    if (main.values[best] != null) {
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', sy(main.values[best]));
      dot.setAttribute('visibility', 'visible');
    }
    showTooltip(tip(best), e.clientX, e.clientY);
  };
  const onLeave = () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTooltip();
  };
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerdown', onMove);
  hit.addEventListener('pointerleave', onLeave);
}

function showTooltip(html, x, y) {
  const tip = el.tooltip;
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = x + 14;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  let top = y - h - 12;
  if (top < 8) top = y + 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}

function hideTooltip() { el.tooltip.hidden = true; }

const chartObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    if (entry.target._cfg) drawLineChart(entry.target, entry.target._cfg);
  }
});
chartObserver.observe($('rChart'));
chartObserver.observe($('sChart'));

/* =========================================================================
   Keyboard heatmap
   ========================================================================= */

function heatStep(rate) {
  if (rate <= 0) return 0;
  return Math.min(6, 1 + Math.floor((rate / HEAT_CAP) * 6));
}

function renderKeyboard(container, keys, showCounts) {
  container.textContent = '';
  const rows = [...KB_ROWS, ' '];
  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    for (const ch of row === ' ' ? [' '] : row) {
      const [hit, miss] = keys[ch] || [0, 0];
      const total = hit + miss;
      const rate = total ? miss / total : 0;
      const keyEl = document.createElement('div');
      keyEl.className = `key${ch === ' ' ? ' space' : ''}${total ? ` h${heatStep(rate)}` : ' no-data'}`;
      keyEl.dataset.key = ch;
      keyEl.dataset.hit = hit;
      keyEl.dataset.miss = miss;
      keyEl.textContent = ch === ' ' ? 'space' : ch;
      if (showCounts && total && ch !== ' ') {
        const small = document.createElement('small');
        small.textContent = `${Math.round(rate * 100)}%`;
        keyEl.appendChild(small);
      }
      rowEl.appendChild(keyEl);
    }
    container.appendChild(rowEl);
  }
}

document.addEventListener('pointerover', (e) => {
  const keyEl = e.target.closest && e.target.closest('.key');
  if (!keyEl) return;
  const hit = +keyEl.dataset.hit;
  const miss = +keyEl.dataset.miss;
  const total = hit + miss;
  const name = keyEl.dataset.key === ' ' ? 'space' : keyEl.dataset.key;
  const rect = keyEl.getBoundingClientRect();
  showTooltip(
    total
      ? `<div class="tt-title">${name}</div>
         <div class="tt-row">missed<b>${miss} of ${total}</b></div>
         <div class="tt-row">miss rate<b>${((miss / total) * 100).toFixed(1)}%</b></div>`
      : `<div class="tt-title">${name}</div><div class="tt-row">not typed yet</div>`,
    rect.left + rect.width / 2,
    rect.top
  );
});
document.addEventListener('pointerout', (e) => {
  if (e.target.closest && e.target.closest('.key')) hideTooltip();
});

/* =========================================================================
   Stats view
   ========================================================================= */

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function avg(arr, pick) {
  return arr.length ? arr.reduce((a, x) => a + pick(x), 0) / arr.length : 0;
}

function formatDuration(secs) {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function renderStats() {
  const empty = history.length === 0;
  $('statsEmpty').hidden = !empty;
  $('statsBody').hidden = empty;
  if (empty) return;

  const last10 = history.slice(-10);
  const prev10 = history.slice(-20, -10);
  const avgWpm = avg(last10, (h) => h.wpm);

  $('sCount').textContent = history.length;
  $('sAvg').textContent = Math.round(avgWpm);
  $('sAcc').textContent = `${Math.round(avg(last10, (h) => h.acc))}%`;
  $('sTime').textContent = formatDuration(history.reduce((a, h) => a + h.secs, 0));

  const delta = $('sAvgDelta');
  if (prev10.length >= 3) {
    const d = avgWpm - avg(prev10, (h) => h.wpm);
    delta.className = `tile-sub ${d >= 0.5 ? 'up' : d <= -0.5 ? 'down' : ''}`;
    delta.textContent = `${d >= 0.5 ? '▲' : d <= -0.5 ? '▼' : '–'} ${Math.abs(d).toFixed(1)} vs previous ${prev10.length}`;
  } else {
    delta.className = 'tile-sub';
    delta.textContent = 'needs 13+ tests to compare';
  }

  // WPM trend (last 100 tests) with a rolling average.
  const recent = history.slice(-100);
  const offset = history.length - recent.length;
  const xs = recent.map((_, i) => offset + i + 1);
  const wpm = recent.map((h) => h.wpm);
  const rolling = recent.map((_, i) => {
    const abs = offset + i;
    if (abs < 4) return null;
    const win = history.slice(Math.max(0, abs - 9), abs + 1);
    return avg(win, (h) => h.wpm);
  });
  const sChart = $('sChart');
  if (recent.length < 2) {
    sChart._cfg = null;
    sChart.innerHTML = '<p class="card-foot">Finish another test to see a trend.</p>';
  } else {
    drawLineChart(sChart, {
      xs,
      series: [
        { values: wpm, cls: 'line-wpm', hoverDot: true },
        { values: rolling, cls: 'line-avg' },
      ],
      dots: recent.length <= 40,
      yMax: niceMax(Math.max(...wpm)),
      xFmt: (v) => `#${v}`,
      tip: (i) => {
        const h = recent[i];
        return `<div class="tt-title">Test #${xs[i]} · ${dateFmt.format(h.ts)}</div>
          <div class="tt-row"><i class="sw sw-wpm"></i>wpm<b>${Math.round(h.wpm)}</b></div>
          <div class="tt-row"><i class="sw sw-avg"></i>rolling avg<b>${rolling[i] == null ? '—' : Math.round(rolling[i])}</b></div>
          <div class="tt-row">accuracy<b>${Math.round(h.acc)}%</b></div>
          <div class="tt-row">test<b>${configLabel(h)}</b></div>`;
      },
    });
  }

  // All-time key heatmap + weakest letters.
  const keys = aggregateKeys(history);
  renderKeyboard($('sKeyboard'), keys, true);
  const weakest = Object.entries(keys)
    .filter(([k, [h, m]]) => k !== ' ' && h + m >= 15)
    .map(([k, [h, m]]) => [k, m / (h + m)])
    .filter(([, r]) => r > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  $('sWeakest').innerHTML = weakest.length
    ? `Weakest keys: ${weakest.map(([k, r]) => `<b>${k}</b> (${(r * 100).toFixed(1)}%)`).join(', ')}.
       Turn on <b>weak keys</b> to practise them.`
    : 'No clear weak keys yet — keep typing.';

  // Personal bests per configuration.
  const bests = new Map();
  for (const h of history) {
    const k = configKey(h);
    if (!bests.has(k) || h.wpm > bests.get(k).wpm) bests.set(k, h);
  }
  const pbRows = [...bests.values()].sort((a, b) =>
    a.mode.localeCompare(b.mode) || a.amount - b.amount || a.lang.localeCompare(b.lang));
  $('pbTable').innerHTML = `
    <thead><tr><th>test</th><th class="num">wpm</th><th class="num">acc</th><th>date</th></tr></thead>
    <tbody>${pbRows.map((h) => `
      <tr><td>${h.mode} ${h.amount} · ${h.lang === 'indonesia' ? 'id' : 'en'}</td>
      <td class="num strong">${Math.round(h.wpm)}</td>
      <td class="num">${Math.round(h.acc)}%</td>
      <td class="dim">${dayFmt.format(h.ts)}</td></tr>`).join('')}
    </tbody>`;

  const rows = history.slice(-50).reverse();
  $('historyTable').innerHTML = `
    <thead><tr><th>date</th><th>test</th><th class="num">wpm</th><th class="num">raw</th><th class="num">acc</th><th class="num">cons</th></tr></thead>
    <tbody>${rows.map((h) => `
      <tr><td class="dim">${dateFmt.format(h.ts)}</td>
      <td>${configLabel(h)}</td>
      <td class="num strong">${Math.round(h.wpm)}</td>
      <td class="num">${Math.round(h.raw)}</td>
      <td class="num">${Math.round(h.acc)}%</td>
      <td class="num">${h.cons == null ? '—' : Math.round(h.cons) + '%'}</td></tr>`).join('')}
    </tbody>`;
}

$('clearBtn').addEventListener('click', () => {
  if (!confirm('Delete all test history? This cannot be undone.')) return;
  history = [];
  store.set(KEYS.history, history);
  if (settings.weak) { settings.weak = false; store.set(KEYS.settings, settings); }
  renderConfig();
  renderStats();
});

/* =========================================================================
   Config bar, navigation, theme
   ========================================================================= */

function renderConfig() {
  const amountSeg = document.querySelector('.seg[data-group="amount"]');
  amountSeg.innerHTML = AMOUNTS[settings.mode]
    .map((n) => `<button type="button" data-value="${n}">${n}</button>`).join('');

  for (const seg of document.querySelectorAll('.seg')) {
    const group = seg.dataset.group;
    for (const btn of seg.querySelectorAll('button')) {
      const v = btn.dataset.value;
      const on = group === 'focus' ? settings.weak : String(settings[group]) === v;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on);
    }
  }

  const weakBtn = document.querySelector('.seg[data-group="focus"] button');
  const available = weakKeysAvailable();
  weakBtn.disabled = !available;
  weakBtn.title = available
    ? 'Pick words that use the keys you miss most'
    : `Available after about ${WEAK_MIN_KEYSTROKES} keystrokes of history`;
}

function renderWeakNote() {
  if (!settings.weak || !weakKeysAvailable()) {
    el.weakNote.hidden = true;
    return;
  }
  const { rates } = weaknessRates(aggregateKeys(history));
  const top = Object.entries(rates).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => `<b>${k}</b>`);
  el.weakNote.innerHTML = `Weak-key practice: words lean on ${top.join(', ')}`;
  el.weakNote.hidden = false;
}

document.querySelector('.config').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  const group = btn.closest('.seg').dataset.group;
  const v = btn.dataset.value;

  if (group === 'mode' && settings.mode !== v) {
    const i = AMOUNTS[settings.mode].indexOf(settings.amount);
    settings.mode = v;
    settings.amount = AMOUNTS[v][Math.max(0, i)];
  } else if (group === 'amount') {
    settings.amount = Number(v);
  } else if (group === 'lang') {
    settings.lang = v;
  } else if (group === 'focus') {
    settings.weak = !settings.weak;
  }
  store.set(KEYS.settings, settings);
  renderConfig();
  newTest();
});

function showView(name) {
  hideTooltip();
  el.testView.hidden = name !== 'test';
  el.statsView.hidden = name !== 'stats';
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('is-active', b.dataset.view === name);
  if (name === 'stats') {
    if (t && t.running) newTest(); // abandon an in-progress test rather than let the clock run
    renderStats();
  } else {
    renderConfig();
    if (!t || t.finished) newTest(); else focusInput();
  }
}

document.addEventListener('click', (e) => {
  const trigger = e.target.closest('[data-view]');
  if (!trigger) return;
  e.preventDefault();
  showView(trigger.dataset.view);
});

$('restartBtn').addEventListener('click', newTest);
$('nextBtn').addEventListener('click', newTest);

$('themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  try { localStorage.setItem(KEYS.theme, root.dataset.theme); } catch (_) {}
});

new ResizeObserver(() => positionCaret()).observe(el.wrap);

/* ---------- boot ---------- */
renderConfig();
newTest();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionCaret);
