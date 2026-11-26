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

// ---------- Construcción de cartas ----------
function cardEl(card, { back = false } = {}) {
  const d = document.createElement('div');
  if (back) {
    d.className = 'card back';
    return d;
  }
  const pieza = game && isPieza(card, game.muestra);
  d.className = `card s-${card.suit}${pieza ? ' pieza' : ''}`;
  d.innerHTML = `
    <div class="idx">${card.rank}<svg aria-hidden="true"><use href="#suit-${card.suit}"></use></svg></div>
    <div class="pip"><svg role="img" aria-label="${cardName(card)}"><use href="#suit-${card.suit}"></use></svg></div>`;
  return d;
}

// ---------- Render ----------
function stageLabel(n) {
  return n <= 15 ? `${n} malas` : `${n - 15} buenas`;
}

function renderScore() {
  $('#score-p .pts').textContent = game.scores.p;
  $('#score-a .pts').textContent = game.scores.a;
  $('#score-p .stage').textContent = stageLabel(game.scores.p);
  $('#score-a .stage').textContent = stageLabel(game.scores.a);
}

function renderTurnMarkers() {
  const pTurn = !game.gameOver && game.phase !== 'hand-end' && game.toAct === 'p';
  const aTurn = !game.gameOver && game.phase !== 'hand-end' && game.toAct === 'a';
  $('#avatar-p').classList.toggle('turn', pTurn);
  $('#avatar-a').classList.toggle('turn', aTurn);
  $('#score-p').classList.toggle('active', pTurn);
  $('#score-a').classList.toggle('active', aTurn);
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
  return `<span class="mini s-${suit}"><svg aria-hidden="true"><use href="#suit-${suit}"></use></svg>${rank}</span>`;
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

function bubble(who, text) {
  const seat = $(who === 'p' ? '#seat-p' : '#seat-a');
  seat.querySelectorAll('.bubble').forEach((b) => b.remove());
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  seat.appendChild(b);
  setTimeout(() => b.remove(), 2400);
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
function newGame() {
  $('#overlay').hidden = true;
  $('#loglist').replaceChildren();
  queue.length = 0;
  game = new TrucoGame({ target: 30, onEvent });
  game.newHand();
  pump();
}

$('#btn-rematch').addEventListener('click', newGame);
// En pantallas anchas la guía arranca desplegada.
if (window.matchMedia('(min-width: 1140px)').matches) {
  const d = $('#refdetails');
  if (d) d.open = true;
}
newGame();
