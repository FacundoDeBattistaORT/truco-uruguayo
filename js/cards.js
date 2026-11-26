// Cartas y reglas de valoración del Truco Uruguayo.
// Baraja española de 40 cartas. La "muestra" define las piezas:
// 2, 4, 5, 11 (caballo) y 10 (sota) del palo de la muestra.
// Si la carta vuelta (muestra) es ella misma una pieza, el 12 de ese palo
// ocupa su lugar ("alcahuete") con el mismo valor.

export const SUITS = ['espada', 'basto', 'oro', 'copa'];
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
export const PIEZA_RANKS = [2, 4, 5, 11, 10];

// Valor de envido de cada pieza (ya "incluye" la garantía de los 20
// cuando se suma: envido = 20 + unidades de pieza + mejor otra carta).
const PIEZA_UNITS = { 2: 10, 4: 9, 5: 8, 11: 7, 10: 7 };
// Poder en el juego de bazas (mayor gana).
const PIEZA_POWER = { 2: 18, 4: 17, 5: 16, 11: 15, 10: 14 };

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sameCard(a, b) {
  return a && b && a.rank === b.rank && a.suit === b.suit;
}

export function isPieza(card, muestra) {
  if (card.suit !== muestra.suit) return false;
  if (PIEZA_RANKS.includes(card.rank)) return true;
  // Alcahuete: el 12 del palo de la muestra vale como la pieza mostrada.
  if (card.rank === 12 && PIEZA_RANKS.includes(muestra.rank)) return true;
  return false;
}

function effectivePiezaRank(card, muestra) {
  return card.rank === 12 ? muestra.rank : card.rank;
}

// Poder de la carta en las bazas. Escala 0..18.
export function power(card, muestra) {
  if (isPieza(card, muestra)) return PIEZA_POWER[effectivePiezaRank(card, muestra)];
  if (card.rank === 1 && card.suit === 'espada') return 13;
  if (card.rank === 1 && card.suit === 'basto') return 12;
  if (card.rank === 7 && card.suit === 'espada') return 11;
  if (card.rank === 7 && card.suit === 'oro') return 10;
  switch (card.rank) {
    case 3: return 9;
    case 2: return 8;
    case 1: return 7; // falsos ases (oro, copa)
    case 12: return 6;
    case 11: return 5;
    case 10: return 4;
    case 7: return 3; // falsos sietes (copa, basto)
    case 6: return 2;
    case 5: return 1;
    default: return 0; // 4
  }
}

// Unidades de la carta para envido/flor.
export function envidoUnits(card, muestra) {
  if (isPieza(card, muestra)) return PIEZA_UNITS[effectivePiezaRank(card, muestra)];
  return card.rank <= 7 ? card.rank : 0;
}

// Puntos de envido de una mano de 3 cartas.
export function envidoPoints(hand, muestra) {
  const piezas = hand.filter((c) => isPieza(c, muestra));
  const others = hand.filter((c) => !isPieza(c, muestra));
  if (piezas.length >= 1) {
    // La pieza vale como cualquier palo: siempre arma envido de dos cartas.
    const units = piezas.map((c) => envidoUnits(c, muestra)).sort((x, y) => y - x);
    const rest = [...units.slice(1), ...others.map((c) => envidoUnits(c, muestra))];
    const second = rest.length ? Math.max(...rest) : 0;
    return 20 + units[0] + second;
  }
  let best = 0;
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].suit === hand[j].suit) {
        best = Math.max(best, 20 + envidoUnits(hand[i], muestra) + envidoUnits(hand[j], muestra));
      }
    }
    best = Math.max(best, envidoUnits(hand[i], muestra));
  }
  return best;
}

// Flor: tres del mismo palo, o una pieza + dos del mismo palo, o dos piezas.
export function hasFlor(hand, muestra) {
  const piezas = hand.filter((c) => isPieza(c, muestra));
  if (piezas.length >= 2) return true;
  const others = hand.filter((c) => !isPieza(c, muestra));
  if (piezas.length === 1) return others[0].suit === others[1].suit;
  return hand[0].suit === hand[1].suit && hand[1].suit === hand[2].suit;
}

export function florPoints(hand, muestra) {
  return 20 + hand.reduce((s, c) => s + envidoUnits(c, muestra), 0);
}

export const SUIT_NAMES = { espada: 'espada', basto: 'basto', oro: 'oro', copa: 'copa' };
export const RANK_NAMES = { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 10: '10', 11: '11', 12: '12' };

export function cardName(card) {
  const suitPlural = { espada: 'espadas', basto: 'bastos', oro: 'oros', copa: 'copas' };
  return `${RANK_NAMES[card.rank]} de ${suitPlural[card.suit]}`;
}
