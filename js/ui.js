// UI: traduce los eventos del motor a la mesa (animaciones, globos,
// toasts y registro) y presenta las acciones disponibles al jugador.

import { TrucoGame } from './game.js';
import { aiDecide } from './ai.js';
import { isPieza, cardName } from './cards.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let game;
const queue = [];
let pumping = false;

// ---------- Construcción de naipes ----------
// Posiciones de los pips (x, y, tamaño) en un lienzo de 100x150, por número.
const PIP_LAYOUTS = {
  1: [[50, 75, 46]],
  2: [[50, 45, 31], [50, 105, 31]],
  3: [[50, 34, 27], [50, 75, 27], [50, 116, 27]],
  4: [[32, 45, 27], [68, 45, 27], [32, 105, 27], [68, 105, 27]],
  5: [[31, 42, 24], [69, 42, 24], [50, 75, 24], [31, 108, 24], [69, 108, 24]],
  6: [[31, 39, 23], [69, 39, 23], [31, 75, 23], [69, 75, 23], [31, 111, 23], [69, 111, 23]],
  7: [[31, 36, 22], [69, 36, 22], [50, 57, 22], [31, 78, 22], [69, 78, 22], [31, 118, 22], [69, 118, 22]],
};
const FIGS = { 10: 'sota', 11: 'caballo', 12: 'rey' };
const SUIT_COLORS = { espada: '#3b78b5', basto: '#5c8a3c', oro: '#c87f0a', copa: '#c0392b' };
// "Pinta" clásica del naipe español: cortes en la línea del borde según el palo.
const PINTA = { oro: 0, copa: 1, espada: 2, basto: 3 };

function pintaLine(y, breaks, color) {
  const x0 = 12, x1 = 88, gap = 6;
  const seg = ((x1 - x0) - breaks * gap) / (breaks + 1);
  let x = x0, d = '';
  for (let i = 0; i <= breaks; i++) {
    d += `M${x.toFixed(1)} ${y}h${seg.toFixed(1)}`;
    x += seg + gap;
  }
  return `<path d="${d}" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round"></path>`;
}

function cardEl(card, { back = false } = {}) {
  const d = document.createElement('div');
  if (back) {
    d.className = 'card back';
    return d;
  }
  const pieza = game && isPieza(card, game.muestra);
  d.className = `card s-${card.suit}${pieza ? ' pieza' : ''}`;
  const color = SUIT_COLORS[card.suit];
  let inner;
  if (card.rank <= 7) {
    inner = PIP_LAYOUTS[card.rank]
      .map(([x, y, s]) => `<use href="#pip-${card.suit}" x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}"></use>`)
      .join('');
  } else {
    inner = `<use href="#fig-${FIGS[card.rank]}" x="28" y="36" width="44" height="86"></use>
             <use href="#pip-${card.suit}" x="41" y="14" width="18" height="18"></use>`;
  }
  const idx = `${card.rank}<svg aria-hidden="true"><use href="#pip-${card.suit}"></use></svg>`;
  d.innerHTML = `
    <div class="idx" style="color:${color}">${idx}</div>
    <div class="idx br" style="color:${color}">${idx}</div>
    <svg class="cardface" viewBox="0 0 100 150" role="img" aria-label="${cardName(card)}">
      ${pintaLine(8, PINTA[card.suit], color)}
      ${pintaLine(142, PINTA[card.suit], color)}
      ${inner}
    </svg>`;
  return d;
}

// ---------- Render ----------
function stageLabel(n) {
  if (game && game.target !== 30) return `${n} punto${n === 1 ? '' : 's'}`;
  return n <= 15 ? `${n} malas` : `${n - 15} buenas`;
}

// Tanteador de libreta: cuadraditos de a 5 (4 lados + diagonal),
// negros para las malas y rojos para las buenas.
function tallySquares(svg, score) {
  const positions = [[5, 5], [33, 5], [5, 33], [33, 33], [5, 61], [33, 61]];
  const rots = [-2.5, 2, -1.5, 2.5, -2, 1.5];
  const s = 20;
  let html = '';
  for (let i = 0; i < 6; i++) {
    const pts = Math.max(0, Math.min(5, score - i * 5));
    if (!pts) continue;
    const [x, y] = positions[i];
    const color = i < 3 ? '#2d2a24' : '#c0392b';
    const segs = [
      `M${x} ${y}v${s}`,
      `M${x} ${y}h${s}`,
      `M${x + s} ${y}v${s}`,
      `M${x} ${y + s}h${s}`,
      `M${x} ${y}l${s} ${s}`,
    ].slice(0, pts).join('');
    html += `<path d="${segs}" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round" transform="rotate(${rots[i]} ${x + s / 2} ${y + s / 2})"></path>`;
  }
  svg.innerHTML = html;
}

function renderScore() {
  tallySquares($('#tally-p'), game.scores.p);
  tallySquares($('#tally-a'), game.scores.a);
  $('#nsub-p').textContent = stageLabel(game.scores.p);
  $('#nsub-a').textContent = stageLabel(game.scores.a);
}

function renderTurnMarkers() {
  const pTurn = !game.gameOver && game.phase !== 'hand-end' && game.toAct === 'p';
  const aTurn = !game.gameOver && game.phase !== 'hand-end' && game.toAct === 'a';
  $('#avatar-p').classList.toggle('turn', pTurn);
  $('#avatar-a').classList.toggle('turn', aTurn);
  $('#ncol-p').classList.toggle('active', pTurn);
  $('#ncol-a').classList.toggle('active', aTurn);
}

function renderAIHand() {
  const el = $('#hand-a');
  el.replaceChildren();
  for (let i = 0; i < game.hands.a.length; i++) el.appendChild(cardEl(null, { back: true }));
}

function renderPlayerHand(clickable) {
  const el = $('#hand-p');
  el.replaceChildren();
  game.hands.p.forEach((card, index) => {
    const c = cardEl(card);
    c.classList.add(clickable ? 'playable' : 'disabled');
    if (clickable) {
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      const play = () => { if (game.act('p', { id: 'play', index })) pump(); };
      c.addEventListener('click', play);
      c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); play(); } });
    }
    el.appendChild(c);
  });
}

// ---------- Guía (se rearma con la muestra de cada mano) ----------
const SUIT_PLURAL = { espada: 'espadas', basto: 'bastos', oro: 'oros', copa: 'copas' };

function miniCard(rank, suit) {
  return `<span class="mini s-${suit}"><svg aria-hidden="true"><use href="#pip-${suit}"></use></svg>${rank}</span>`;
}

function renderReference() {
  const el = $('#refcontent');
  if (!el) return;
  const m = game.muestra;
  const s = m.suit;
  const piezas = [[2, 30], [4, 29], [5, 28], [11, 27], [10, 27]];
  const piezaRows = piezas.map(([r, v], i) => {
    const chip = r === m.rank
      ? `${miniCard(12, s)} <small>(alcahuete: juega por la muestra)</small>`
      : miniCard(r, s);
    return `<div class="refrow"><span>${i + 1}º ${chip}</span><span class="val">envido ${v}</span></div>`;
  }).join('');
  const matas = [[1, 'espada'], [1, 'basto'], [7, 'espada'], [7, 'oro']];
  const mataRows = matas.map(([r, su], i) =>
    `<div class="refrow"><span>${i + 6}º ${miniCard(r, su)}</span></div>`
  ).join('');
  const rest = ['3', '2', '1 oro/copa', '12', '11', '10', '7 copa/basto', '6', '5', '4'];
  const order = rest.map((t) => `<span class="mini plain">${t}</span>`).join('<span>›</span>');
  el.innerHTML = `
    <h3>Piezas — muestra: ${SUIT_PLURAL[s]}</h3>
    ${piezaRows}
    <p class="reftext">Las piezas son el 2, 4, 5, 11 y 10 del palo de la muestra: le ganan a todas las demás cartas.</p>
    <h3>Matas (después de las piezas)</h3>
    ${mataRows}
    <h3>Las demás, de mayor a menor</h3>
    <div class="reforder">${order}</div>
    <h3>Envido</h3>
    <p class="reftext">Dos cartas del mismo palo: se suman + 20 (las figuras valen 0; máximo 33). Con pieza: el valor de la tabla de arriba + tu mejor otra carta.</p>
    <h3>Flor (vale 3)</h3>
    <p class="reftext">Hay flor con tres del mismo palo, una pieza + dos del mismo palo, o dos piezas. Flor contra flor: gana la más alta y vale 6. Su valor: 20 + la suma de las tres cartas (las piezas aportan 10 / 9 / 8 / 7).</p>`;
}

function renderMuestra() {
  const zone = $('#muestra-slot');
  zone.replaceChildren();
  const m = cardEl(game.muestra);
  m.classList.add('muestra-card');
  zone.appendChild(m);
}

function renderTricks() {
  const el = $('#tricks');
  el.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    const r = game.trickResults[i];
    if (r === 'p') d.classList.add('win');
    else if (r === 'a') d.classList.add('lose');
    else if (r === 't') d.classList.add('tie');
    el.appendChild(d);
  }
}

function placeCard(who, card) {
  const slot = $(who === 'p' ? '#slot-p' : '#slot-a');
  slot.replaceChildren(cardEl(card));
}

function clearSlots() {
  $('#slot-p').replaceChildren();
  $('#slot-a').replaceChildren();
  $('#slot-p').classList.remove('win');
  $('#slot-a').classList.remove('win');
}

// Cantos como texto grande sobre la mesa, al estilo del juego clásico.
let cantoTimer = null;
function bubble(who, text) {
  const b = $('#canto-banner');
  b.textContent = text.replace(/[¡!¿?]/g, '').toUpperCase();
  b.classList.toggle('ia', who === 'a');
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
  clearTimeout(cantoTimer);
  cantoTimer = setTimeout(() => b.classList.remove('show'), 2200);
}

let toastTimer = null;
function toast(big, small, ms = 1900) {
  const t = $('#toast');
  t.querySelector('.big').textContent = big;
  t.querySelector('.small').textContent = small || '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function log(text, cls = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  $('#loglist').prepend(li);
  while ($('#loglist').children.length > 80) $('#loglist').lastChild.remove();
}

// ---------- Acciones del jugador ----------
const ACTION_LABELS = {
  envido: 'Envido', real: 'Real envido', falta: 'Falta envido',
  truco: '¡Truco!', retruco: '¡Quiero retruco!', vale4: '¡Quiero vale cuatro!',
  quiero: '¡Quiero!', noquiero: 'No quiero', mazo: 'Ir al mazo',
  'flor-quiero': 'Con flor quiero', 'flor-achico': 'Con flor me achico',
  'contraflor-resto': '¡Contraflor al resto!',
};
const ACTION_STYLE = {
  noquiero: 'secondary', 'flor-achico': 'secondary', mazo: 'danger',
};

function renderActions() {
  const row = $('#btnrow');
  const prompt = $('#prompt');
  row.replaceChildren();
  if (game.gameOver) { prompt.textContent = ''; return; }
  const acts = game.actions('p');
  const nonPlay = acts.filter((a) => a.id !== 'play');
  const canPlay = acts.some((a) => a.id === 'play');
  renderPlayerHand(canPlay);
  if (!acts.length) {
    prompt.textContent = 'Esperando a la IA…';
    return;
  }
  prompt.textContent = game.phase === 'respond'
    ? 'Tenés que responder:'
    : canPlay ? 'Te toca: jugá una carta o cantá.' : '';
  for (const a of nonPlay) {
    const b = document.createElement('button');
    b.className = `act ${ACTION_STYLE[a.id] || ''}`;
    b.textContent = ACTION_LABELS[a.id] || a.id;
    b.addEventListener('click', () => { if (game.act('p', a)) pump(); });
    row.appendChild(b);
  }
}

function lockActions() {
  $('#btnrow').replaceChildren();
  $('#prompt').textContent = '';
  renderPlayerHand(false);
}

// ---------- Cola de eventos ----------
function onEvent(e) { queue.push(e); }

async function show(e) {
  switch (e.type) {
    case 'hand-start': {
      clearSlots();
      renderMuestra();
      renderReference();
      renderAIHand();
      renderPlayerHand(false);
      renderTricks();
      renderScore();
      log(`— Mano ${game.handNum}: es mano ${e.mano === 'p' ? 'vos' : 'la IA'} · muestra: ${cardName(e.muestra)}`, 'sep');
      await sleep(500);
      break;
    }
    case 'canto':
      bubble(e.who, e.text);
      log(`${e.who === 'p' ? 'Vos' : 'IA'}: ${e.text}`);
      await sleep(1050);
      break;
    case 'card-played':
      placeCard(e.who, e.card);
      if (e.who === 'a') renderAIHand(); else renderPlayerHand(false);
      log(`${e.who === 'p' ? 'Vos' : 'IA'}: ${e.name}`);
      await sleep(600);
      break;
    case 'trick-result': {
      if (e.result !== 't') $(e.result === 'p' ? '#slot-p' : '#slot-a').classList.add('win');
      renderTricks();
      const msg = e.result === 't' ? `Baza ${e.trick}: parda` : `Baza ${e.trick}: ${e.result === 'p' ? 'tuya' : 'de la IA'}`;
      log(msg, 'hl');
      await sleep(1150);
      clearSlots();
      break;
    }
    case 'envido-result': {
      const who = e.winner === 'p' ? 'Ganaste' : 'Ganó la IA';
      toast(`Envido: vos ${e.p} — IA ${e.a}`, `${who} (+${e.pts})`);
      log(`Envido: vos ${e.p} — IA ${e.a} → ${who} +${e.pts}`, 'hl');
      await sleep(2000);
      break;
    }
    case 'flor-result': {
      const who = e.winner === 'p' ? 'Ganaste' : 'Ganó la IA';
      toast(`Flor: vos ${e.p} — IA ${e.a}`, `${who} (+${e.pts})`);
      log(`Flor: vos ${e.p} — IA ${e.a} → ${who} +${e.pts}`, 'hl');
      await sleep(2000);
      break;
    }
    case 'truco-accepted':
      log(`La mano vale ${e.level} puntos`, 'hl');
      break;
    case 'score':
      renderScore();
      log(`+${e.pts} para ${e.who === 'p' ? 'vos' : 'la IA'} (${e.reason})`);
      await sleep(250);
      break;
    case 'hand-end': {
      const who = e.winner === 'p' ? 'Ganaste la mano' : 'La IA ganó la mano';
      toast(who, `+${e.pts} · ${e.reason}`);
      await sleep(1500);
      break;
    }
    case 'game-end': {
      const over = $('#overlay');
      over.querySelector('h2').textContent = e.winner === 'p' ? '¡Ganaste!' : 'Ganó la IA';
      over.querySelector('p').textContent = `Resultado final: vos ${game.scores.p} — IA ${game.scores.a}.`;
      over.hidden = false;
      break;
    }
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  lockActions();
  renderTurnMarkers();
  while (queue.length) {
    const e = queue.shift();
    await show(e);
  }
  pumping = false;
  afterIdle();
}

function afterIdle() {
  renderTurnMarkers();
  if (game.gameOver) return;
  if (game.phase === 'hand-end') {
    setTimeout(() => { game.newHand(); pump(); }, 800);
    return;
  }
  if (game.toAct === 'a') {
    lockActions();
    setTimeout(() => {
      const a = aiDecide(game);
      if (a && game.act('a', a)) pump();
    }, 700 + Math.random() * 600);
  } else {
    renderActions();
  }
}

// ---------- Inicio ----------
let lastTarget = 30;

function newGame(target = lastTarget) {
  lastTarget = target;
  $('#overlay').hidden = true;
  $('#menu').hidden = true;
  $('#brand-sub').textContent = `a ${target} puntos · con muestra y flor`;
  $('#loglist').replaceChildren();
  queue.length = 0;
  game = new TrucoGame({ target, onEvent });
  game.newHand();
  pump();
}

function showMenu() {
  $('#overlay').hidden = true;
  $('#menu').hidden = false;
}

$('#btn-p30').addEventListener('click', () => newGame(30));
$('#btn-p15').addEventListener('click', () => newGame(15));
$('#btn-rematch').addEventListener('click', () => newGame());
$('#btn-menu').addEventListener('click', showMenu);
// En pantallas anchas la guía arranca desplegada.
if (window.matchMedia('(min-width: 1140px)').matches) {
  const d = $('#refdetails');
  if (d) d.open = true;
}
