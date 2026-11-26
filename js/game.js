// Motor del Truco Uruguayo mano a mano (jugador 'p' vs IA 'a').
// Independiente de la UI: emite eventos por onEvent y expone
// actions(who) / act(who, action).

import { makeDeck, shuffle, power, envidoPoints, hasFlor, florPoints, cardName } from './cards.js';

const ENVIDO_VALUES = { envido: 2, real: 3 };

export class TrucoGame {
  constructor({ target = 30, onEvent = () => {} } = {}) {
    this.target = target;
    this.onEvent = onEvent;
    this.scores = { p: 0, a: 0 };
    this.mano = Math.random() < 0.5 ? 'p' : 'a';
    this.handNum = 0;
    this.gameOver = false;
    this.phase = 'idle'; // idle | play | respond | hand-end | game-end
  }

  other(w) { return w === 'p' ? 'a' : 'p'; }
  emit(type, data = {}) { this.onEvent({ type, ...data }); }
  faltaValue() { return Math.max(1, this.target - Math.max(this.scores.p, this.scores.a)); }

  newHand() {
    if (this.gameOver) return;
    this.handNum++;
    if (this.handNum > 1) this.mano = this.other(this.mano);
    const deck = shuffle(makeDeck());
    this.hands = { p: deck.slice(0, 3), a: deck.slice(3, 6) };
    this.original = { p: [...this.hands.p], a: [...this.hands.a] };
    this.muestra = deck[6];
    this.table = { p: null, a: null };
    this.played = { p: [], a: [] };
    this.trickResults = [];
    this.leader = this.mano;
    this.playTurn = this.mano;
    this.toAct = this.mano;
    this.pending = null; // { kind: 'envido'|'truco'|'flor'|'florResto', by }
    this.suspendedTruco = null;
    this.truco = { level: 1, pendingLevel: null, pendingBy: null, lastAcceptedBy: null, accepted: false };
    this.envido = { open: false, resolved: false, chain: [] };
    this.flor = {
      p: hasFlor(this.original.p, this.muestra),
      a: hasFlor(this.original.a, this.muestra),
      resolved: false,
    };
    this.phase = 'play';
    this.emit('hand-start', { mano: this.mano, muestra: this.muestra });
    this.resolveFlorAnnouncements();
  }

  // ---- Flor (se anuncia automáticamente al repartir) ----
  resolveFlorAnnouncements() {
    const { p, a } = this.flor;
    if (!p && !a) { this.flor.resolved = true; return; }
    this.envido.resolved = true; // la flor anula el envido
    if (p && a) {
      this.emit('canto', { who: this.mano, text: '¡Tengo flor!' });
      this.emit('canto', { who: this.other(this.mano), text: '¡Flor también!' });
      this.pending = { kind: 'flor', by: this.mano };
      this.phase = 'respond';
      this.toAct = this.other(this.mano);
    } else {
      const who = p ? 'p' : 'a';
      this.emit('canto', { who, text: '¡Tengo flor!' });
      this.flor.resolved = true;
      this.addPoints(who, 3, 'Flor');
    }
  }

  florPts(w) { return florPoints(this.original[w], this.muestra); }

  // ---- Disponibilidad de acciones ----
  canCallEnvido(w) {
    return (
      this.trickResults.length === 0 &&
      !this.envido.resolved && !this.envido.open &&
      !this.flor.p && !this.flor.a &&
      this.truco.level === 1 && !this.truco.accepted &&
      this.played[w].length === 0
    );
  }

  canCallTruco(w) {
    if (this.pending) return false;
    if (this.truco.pendingLevel) return false;
    if (this.truco.level >= 4) return false;
    if (this.truco.level > 1 && this.truco.lastAcceptedBy !== w) return false;
    return true;
  }

  trucoCallId() {
    const next = (this.truco.pendingLevel || this.truco.level) + 1;
    return next === 2 ? 'truco' : next === 3 ? 'retruco' : 'vale4';
  }

  actions(w) {
    if (this.gameOver || this.phase === 'hand-end' || this.phase === 'game-end') return [];
    if (this.toAct !== w) return [];
    const acts = [];
    if (this.phase === 'respond') {
      const k = this.pending.kind;
      if (k === 'flor') {
        acts.push({ id: 'flor-quiero' }, { id: 'flor-achico' }, { id: 'contraflor-resto' });
      } else if (k === 'florResto') {
        acts.push({ id: 'flor-quiero' }, { id: 'flor-achico' });
      } else if (k === 'envido') {
        acts.push({ id: 'quiero' }, { id: 'noquiero' });
        const chain = this.envido.chain;
        const last = chain[chain.length - 1].type;
        if (last === 'envido') {
          if (chain.filter((c) => c.type === 'envido').length < 2) acts.push({ id: 'envido' });
          acts.push({ id: 'real' }, { id: 'falta' });
        } else if (last === 'real') {
          acts.push({ id: 'falta' });
        }
      } else if (k === 'truco') {
        acts.push({ id: 'quiero' }, { id: 'noquiero' });
        if (this.truco.pendingLevel < 4) acts.push({ id: this.trucoCallId() });
        // "El envido está primero": se puede responder al truco cantando envido
        if (this.canCallEnvido(w) && !this.suspendedTruco) {
          acts.push({ id: 'envido' }, { id: 'real' }, { id: 'falta' });
        }
      }
      return acts;
    }
    // phase === 'play'
    this.hands[w].forEach((card, i) => acts.push({ id: 'play', index: i, card }));
    if (this.canCallEnvido(w)) acts.push({ id: 'envido' }, { id: 'real' }, { id: 'falta' });
    if (this.canCallTruco(w)) acts.push({ id: this.trucoCallId() });
    acts.push({ id: 'mazo' });
    return acts;
  }

  act(w, action) {
    const legal = this.actions(w).some((a) => a.id === action.id && (a.index === undefined || a.index === action.index));
    if (!legal) return false;
    switch (action.id) {
      case 'play': this.playCard(w, action.index); break;
      case 'envido': case 'real': case 'falta': this.callEnvido(w, action.id); break;
      case 'truco': case 'retruco': case 'vale4': this.callTruco(w); break;
      case 'quiero': this.respond(w, true); break;
      case 'noquiero': this.respond(w, false); break;
      case 'mazo': this.goToMazo(w); break;
      case 'flor-quiero': this.florRespond(w, 'quiero'); break;
      case 'flor-achico': this.florRespond(w, 'achico'); break;
      case 'contraflor-resto': this.florRespond(w, 'resto'); break;
      default: return false;
    }
    return true;
  }

  // ---- Envido ----
  callEnvido(w, type) {
    // Si responde con envido a un truco pendiente, el truco queda en suspenso.
    if (this.pending && this.pending.kind === 'truco') {
      this.suspendedTruco = { level: this.truco.pendingLevel, by: this.truco.pendingBy };
      this.truco.pendingLevel = null;
      this.truco.pendingBy = null;
    }
    this.envido.open = true;
    this.envido.chain.push({ type, by: w });
    const labels = { envido: '¡Envido!', real: '¡Real envido!', falta: '¡Falta envido!' };
    this.emit('canto', { who: w, text: labels[type] });
    this.pending = { kind: 'envido', by: w };
    this.phase = 'respond';
    this.toAct = this.other(w);
  }

  envidoStakeAccepted() {
    const chain = this.envido.chain;
    if (chain.some((c) => c.type === 'falta')) return this.faltaValue();
    return chain.reduce((s, c) => s + ENVIDO_VALUES[c.type], 0);
  }

  envidoStakeRejected() {
    const prev = this.envido.chain.slice(0, -1);
    if (!prev.length) return 1;
    return prev.reduce((s, c) => s + (c.type === 'falta' ? this.faltaValue() : ENVIDO_VALUES[c.type]), 0);
  }

  resolveEnvidoShowdown() {
    const pe = envidoPoints(this.original.p, this.muestra);
    const ae = envidoPoints(this.original.a, this.muestra);
    let winner;
    if (pe === ae) winner = this.mano;
    else winner = pe > ae ? 'p' : 'a';
    const pts = this.envidoStakeAccepted();
    this.emit('envido-result', { p: pe, a: ae, winner, pts });
    this.envido.resolved = true;
    this.envido.open = false;
    this.pending = null;
    this.addPoints(winner, pts, 'Envido');
  }

  // ---- Truco ----
  callTruco(w) {
    const next = (this.truco.pendingLevel || this.truco.level) + 1;
    // Si estaba respondiendo a un canto previo de truco, el "quiero" va implícito.
    if (this.pending && this.pending.kind === 'truco') {
      this.truco.level = this.truco.pendingLevel;
      this.truco.accepted = true;
    }
    this.truco.pendingLevel = next;
    this.truco.pendingBy = w;
    const labels = { 2: '¡Truco!', 3: '¡Quiero retruco!', 4: '¡Quiero vale cuatro!' };
    this.emit('canto', { who: w, text: labels[next] });
    this.pending = { kind: 'truco', by: w };
    this.phase = 'respond';
    this.toAct = this.other(w);
  }

  respond(w, accept) {
    if (!this.pending) return;
    const kind = this.pending.kind;
    this.emit('canto', { who: w, text: accept ? '¡Quiero!' : 'No quiero' });
    if (kind === 'envido') {
      if (accept) {
        this.resolveEnvidoShowdown();
      } else {
        const caller = this.envido.chain[this.envido.chain.length - 1].by;
        const pts = this.envidoStakeRejected();
        this.envido.resolved = true;
        this.envido.open = false;
        this.pending = null;
        this.addPoints(caller, pts, 'Envido no querido');
      }
      if (this.gameOver) return;
      // Si había un truco en suspenso, hay que responderlo ahora.
      if (this.suspendedTruco) {
        const st = this.suspendedTruco;
        this.suspendedTruco = null;
        this.truco.pendingLevel = st.level;
        this.truco.pendingBy = st.by;
        this.pending = { kind: 'truco', by: st.by };
        this.phase = 'respond';
        this.toAct = this.other(st.by);
      } else {
        this.pending = null;
        this.phase = 'play';
        this.toAct = this.playTurn;
      }
    } else if (kind === 'truco') {
      if (accept) {
        this.truco.level = this.truco.pendingLevel;
        this.truco.pendingLevel = null;
        this.truco.pendingBy = null;
        this.truco.lastAcceptedBy = w;
        this.truco.accepted = true;
        this.pending = null;
        this.phase = 'play';
        this.toAct = this.playTurn;
        this.emit('truco-accepted', { level: this.truco.level });
      } else {
        const pts = this.truco.pendingLevel - 1;
        this.endHand(this.pending.by, pts, 'Truco no querido');
      }
    }
  }

  // ---- Flor (respuestas cuando ambos tienen flor) ----
  florRespond(w, resp) {
    const caller = this.pending.by; // quien "espera" la respuesta
    const kind = this.pending.kind;
    if (resp === 'achico') {
      this.emit('canto', { who: w, text: 'Con flor me achico' });
      this.flor.resolved = true;
      this.pending = null;
      this.phase = 'play';
      this.toAct = this.playTurn;
      this.addPoints(this.other(w), 4, 'Flor (achique)');
      return;
    }
    if (resp === 'resto' && kind === 'flor') {
      this.emit('canto', { who: w, text: '¡Contraflor al resto!' });
      this.pending = { kind: 'florResto', by: w };
      this.toAct = this.other(w);
      return;
    }
    // quiero
    this.emit('canto', { who: w, text: 'Con flor quiero' });
    const fp = this.florPts('p');
    const fa = this.florPts('a');
    let winner;
    if (fp === fa) winner = this.mano;
    else winner = fp > fa ? 'p' : 'a';
    const pts = kind === 'florResto' ? Math.max(this.faltaValue(), 6) : 6;
    this.emit('flor-result', { p: fp, a: fa, winner, pts });
    this.flor.resolved = true;
    this.pending = null;
    this.phase = 'play';
    this.toAct = this.playTurn;
    this.addPoints(winner, pts, kind === 'florResto' ? 'Contraflor al resto' : 'Flor');
  }

  // ---- Juego de cartas ----
  playCard(w, index) {
    const card = this.hands[w].splice(index, 1)[0];
    this.table[w] = card;
    this.played[w].push(card);
    this.emit('card-played', { who: w, card, name: cardName(card) });
    if (this.table.p && this.table.a) {
      const pw = power(this.table.p, this.muestra);
      const aw = power(this.table.a, this.muestra);
      const result = pw > aw ? 'p' : aw > pw ? 'a' : 't';
      this.trickResults.push(result);
      this.emit('trick-result', { result, trick: this.trickResults.length, table: { ...this.table } });
      this.table = { p: null, a: null };
      const winner = this.handWinner();
      if (winner) {
        this.endHand(winner, this.truco.level, 'Bazas');
        return;
      }
      this.leader = result === 't' ? this.leader : result;
      this.playTurn = this.leader;
      this.toAct = this.leader;
    } else {
      this.playTurn = this.other(w);
      this.toAct = this.other(w);
    }
  }

  handWinner() {
    const r = this.trickResults;
    if (r.length < 2) return null;
    const [r1, r2, r3] = r;
    if (r.length === 2) {
      if (r1 === 't' && r2 !== 't') return r2;
      if (r1 !== 't' && (r2 === r1 || r2 === 't')) return r1;
      return null; // 1-1 o doble parda: se juega la tercera
    }
    // tercera baza
    if (r3 !== 't') {
      if (r1 === 't' && r2 === 't') return r3;
      if (r1 !== 't' && r2 !== 't') return r3; // estaban 1-1
      return r3;
    }
    // tercera parda
    if (r1 !== 't') return r1;
    if (r2 !== 't') return r2;
    return this.mano; // todas pardas: gana el mano
  }

  goToMazo(w) {
    this.emit('canto', { who: w, text: 'Me voy al mazo' });
    const opp = this.other(w);
    let pts = this.truco.level;
    if (this.trickResults.length === 0 && !this.envido.resolved && !this.flor.p && !this.flor.a) {
      pts += 1; // el envido no jugado también se pierde
    }
    this.endHand(opp, pts, 'Al mazo');
  }

  endHand(winner, pts, reason) {
    this.phase = 'hand-end';
    this.pending = null;
    this.emit('hand-end', { winner, pts, reason });
    this.addPoints(winner, pts, reason);
  }

  addPoints(w, n, reason) {
    this.scores[w] = Math.min(this.target, this.scores[w] + n);
    this.emit('score', { scores: { ...this.scores }, who: w, pts: n, reason });
    if (this.scores[w] >= this.target && !this.gameOver) {
      this.gameOver = true;
      this.phase = 'game-end';
      this.emit('game-end', { winner: w });
    }
  }
}
