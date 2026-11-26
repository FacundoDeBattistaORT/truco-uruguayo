// IA del oponente: heurísticas para los cantos + Monte Carlo para
// elegir carta y evaluar el truco. Solo usa información visible para la IA
// (sus cartas, la muestra y lo jugado por el rival).

import { makeDeck, power, envidoPoints, florPoints, sameCard } from './cards.js';

function unseen(game) {
  const seen = [...game.original.a, game.muestra, ...game.played.p];
  return makeDeck().filter((c) => !seen.some((s) => sameCard(s, c)));
}

function sampleN(pool, n) {
  const a = [...pool];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function handWinnerPure(r, mano) {
  if (r.length < 2) return null;
  const [r1, r2, r3] = r;
  if (r.length === 2) {
    if (r1 === 't' && r2 !== 't') return r2;
    if (r1 !== 't' && (r2 === r1 || r2 === 't')) return r1;
    return null;
  }
  if (r3 !== 't') return r3;
  if (r1 !== 't') return r1;
  if (r2 !== 't') return r2;
  return mano;
}

function leadChoice(cards, muestra) {
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    if (power(cards[i], muestra) > power(cards[best], muestra)) best = i;
  }
  return cards.splice(best, 1)[0];
}

function respondChoice(cards, oppCard, muestra) {
  const op = power(oppCard, muestra);
  let bestWin = -1;
  let lowest = 0;
  for (let i = 0; i < cards.length; i++) {
    const pw = power(cards[i], muestra);
    if (pw > op && (bestWin === -1 || pw < power(cards[bestWin], muestra))) bestWin = i;
    if (pw < power(cards[lowest], muestra)) lowest = i;
  }
  const idx = bestWin !== -1 ? bestWin : lowest;
  return cards.splice(idx, 1)[0];
}

// Simula el resto de la mano con política codiciosa en ambos lados.
function simulate(game, oppSample, forcedCard) {
  const muestra = game.muestra;
  const mano = game.mano;
  const tr = [...game.trickResults];
  let leader = game.leader;
  let tableP = game.table.p ? game.table.p : null;
  let tableA = game.table.a ? game.table.a : null;
  const ai = [...game.hands.a];
  const opp = [...oppSample];
  let forced = forcedCard || null;

  const takeForced = () => {
    const i = ai.findIndex((c) => sameCard(c, forced));
    const card = ai.splice(i, 1)[0];
    forced = null;
    return card;
  };

  while (tr.length < 3 && !handWinnerPure(tr, mano)) {
    let cp, ca;
    if (tableP) {
      cp = tableP;
      tableP = null;
      ca = forced ? takeForced() : respondChoice(ai, cp, muestra);
    } else if (tableA) {
      // La IA ya jugó su carta en esta baza (está respondiendo un canto).
      ca = tableA;
      tableA = null;
      cp = respondChoice(opp, ca, muestra);
    } else if (leader === 'a') {
      ca = forced ? takeForced() : leadChoice(ai, muestra);
      cp = respondChoice(opp, ca, muestra);
    } else {
      cp = leadChoice(opp, muestra);
      ca = forced ? takeForced() : respondChoice(ai, cp, muestra);
    }
    const pa = power(ca, muestra);
    const pp = power(cp, muestra);
    const result = pa > pp ? 'a' : pp > pa ? 'p' : 't';
    tr.push(result);
    if (result !== 't') leader = result;
  }
  return handWinnerPure(tr, mano) || mano;
}

function winProb(game, forcedCard, n) {
  const pool = unseen(game);
  const need = 3 - game.played.p.length;
  let wins = 0;
  for (let k = 0; k < n; k++) {
    if (simulate(game, sampleN(pool, need), forcedCard) === 'a') wins++;
  }
  return wins / n;
}

// Perfiles de dificultad: la fácil simula poco, juega cartas al azar a veces,
// acepta envidos malos y casi no canta; la difícil simula más, ajusta umbrales
// y miente más seguido.
const PROFILES = {
  facil: {
    sims: 40, cardNoise: 0.35, randomFold: 0.15, bluff: 0,
    envAccept: 20.5, envAcceptStake: 0, envCall: 29, envCallP: 0.4, realCall: 99, faltaCall: 99,
    trucoCall: [0.85, 0.9, 0.96], trucoAccept: 0.52, trucoRaise: 0.95,
    florQuiero: 34, florResto: 99,
  },
  media: {
    sims: 160, cardNoise: 0, randomFold: 0, bluff: 0.05,
    envAccept: 23.5, envAcceptStake: 0.7, envCall: 27, envCallP: 0.75, realCall: 31, faltaCall: 32.5,
    trucoCall: [0.68, 0.76, 0.84], trucoAccept: 0.36, trucoRaise: 0.78,
    florQuiero: 31, florResto: 38,
  },
  dificil: {
    sims: 320, cardNoise: 0, randomFold: 0, bluff: 0.09,
    envAccept: 24.3, envAcceptStake: 0.9, envCall: 26, envCallP: 0.85, realCall: 29.5, faltaCall: 31.5,
    trucoCall: [0.62, 0.72, 0.8], trucoAccept: 0.33, trucoRaise: 0.74,
    florQuiero: 30, florResto: 37,
  },
};

export function aiDecide(game, level = 'media') {
  const P = PROFILES[level] || PROFILES.media;
  const acts = game.actions('a');
  if (!acts.length) return null;
  const ids = new Set(acts.map((x) => x.id));
  const myEnv = envidoPoints(game.original.a, game.muestra);
  const e = myEnv + (game.mano === 'a' ? 0.7 : 0);
  const rnd = Math.random();

  if (game.phase === 'respond') {
    const kind = game.pending.kind;
    if (kind === 'flor') {
      const f = florPoints(game.original.a, game.muestra);
      if (f >= P.florResto && ids.has('contraflor-resto') && rnd < 0.8) return { id: 'contraflor-resto' };
      if (f >= P.florQuiero) return { id: 'flor-quiero' };
      return rnd < 0.3 ? { id: 'flor-quiero' } : { id: 'flor-achico' };
    }
    if (kind === 'florResto') {
      const f = florPoints(game.original.a, game.muestra);
      return f >= P.florResto - 3 ? { id: 'flor-quiero' } : { id: 'flor-achico' };
    }
    if (kind === 'envido') {
      const stake = game.envidoStakeAccepted();
      if (ids.has('falta') && e >= P.faltaCall + 1 && rnd < 0.6) return { id: 'falta' };
      if (ids.has('real') && e >= P.realCall + 1 && rnd < 0.55) return { id: 'real' };
      if (ids.has('envido') && e >= 29 && rnd < 0.5) return { id: 'envido' };
      const threshold = P.envAccept + Math.min(6, Math.max(0, stake - 2)) * P.envAcceptStake;
      if (e >= threshold || rnd < P.bluff + 0.03) return { id: 'quiero' };
      return { id: 'noquiero' };
    }
    if (kind === 'truco') {
      // "El envido está primero"
      if (ids.has('envido')) {
        if (ids.has('falta') && e >= P.faltaCall && rnd < 0.5) return { id: 'falta' };
        if (ids.has('real') && e >= P.realCall && rnd < 0.5) return { id: 'real' };
        if (e >= P.envCall - 0.5 && rnd < P.envCallP) return { id: 'envido' };
      }
      if (P.randomFold && rnd < P.randomFold) return { id: 'noquiero' };
      const wp = winProb(game, null, P.sims);
      const lvl = game.truco.pendingLevel;
      const raiseId = lvl === 2 ? 'retruco' : lvl === 3 ? 'vale4' : null;
      if (raiseId && ids.has(raiseId) && wp > P.trucoRaise && rnd < 0.8) return { id: raiseId };
      const acceptThr = P.trucoAccept + (lvl - 2) * 0.06;
      if (wp >= acceptThr || Math.random() < P.bluff) return { id: 'quiero' };
      return { id: 'noquiero' };
    }
  }

  // Fase de juego: ¿cantar envido?
  if (ids.has('envido')) {
    const oppNear = game.scores.p >= game.target - 6;
    if (ids.has('falta') && (e >= P.faltaCall + 1.5 || (oppNear && e >= 28)) && rnd < 0.7) return { id: 'falta' };
    if (ids.has('real') && e >= P.realCall + 1.5 && rnd < 0.45) return { id: 'real' };
    if (e >= P.envCall && rnd < P.envCallP) return { id: 'envido' };
    if (e >= P.envCall - 3 && rnd < P.envCallP * 0.4) return { id: 'envido' };
    if (rnd < P.bluff) return { id: 'envido' }; // mentir un poco
  }

  // ¿Cantar truco / retruco / vale cuatro?
  const trucoAct = acts.find((x) => ['truco', 'retruco', 'vale4'].includes(x.id));
  if (trucoAct) {
    const wp = winProb(game, null, P.sims);
    const thr = P.trucoCall[game.truco.level - 1] ?? 0.9;
    if (wp > thr && rnd < 0.85) return { id: trucoAct.id };
    if (rnd < P.bluff && game.trickResults.length > 0 && game.truco.level === 1) return { id: trucoAct.id };
  }

  // Elegir carta por Monte Carlo (la fácil a veces tira cualquiera).
  const plays = acts.filter((x) => x.id === 'play');
  if (plays.length === 1) return plays[0];
  if (P.cardNoise && Math.random() < P.cardNoise) return plays[Math.floor(Math.random() * plays.length)];
  let best = null;
  let bestScore = -Infinity;
  for (const pl of plays) {
    const wp = winProb(game, pl.card, Math.max(60, Math.round(P.sims * 0.6)));
    const score = wp - power(pl.card, game.muestra) * 0.004; // a igual chance, guardar la brava
    if (score > bestScore) { bestScore = score; best = pl; }
  }
  return best;
}
