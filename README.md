# Truco Uruguayo

App web single player para jugar al truco uruguayo contra una IA. Sin dependencias ni build: HTML, CSS y JavaScript (módulos ES).

## Cómo correrla

Los módulos ES necesitan un servidor (no funciona abriendo `index.html` con doble clic). Cualquiera de estas opciones:

```
npm start            # usa npx serve
# o
python -m http.server 8000
```

y abrir http://localhost:3000 (serve) o http://localhost:8000.

## Reglas implementadas

- Baraja española de 40 cartas, partida a 30 puntos (malas y buenas).
- **Muestra y piezas**: el 2, 4, 5, 11 y 10 del palo de la muestra son piezas y le ganan al as de espadas. Si la muestra es ella misma una pieza, el 12 de ese palo ocupa su lugar (alcahuete).
- **Envido** (2), **real envido** (3) y **falta envido**, con piezas valiendo 30/29/28/27/27. "El envido está primero": se puede responder al truco cantando envido en la primera baza.
- **Flor** (automática, 3 puntos), y con flor contra flor: *con flor quiero*, *con flor me achico* y *contraflor al resto*.
- **Truco / retruco / vale cuatro**, irse al mazo, pardas (incluida mano gana si van todas pardas).

## IA

- Cantos de envido/flor por umbrales sobre sus puntos reales, con algo de ruido y mentidas ocasionales.
- Truco y elección de carta por Monte Carlo: simula manos posibles del rival con las cartas no vistas y juega la carta con mejor probabilidad de ganar la mano.

## Estructura

- `js/cards.js` — baraja, poder de cartas, envido y flor (puro, testeable).
- `js/game.js` — motor de la mano: turnos, cantos, bazas y puntaje (emite eventos).
- `js/ai.js` — decisiones de la IA.
- `js/ui.js` — mesa, animaciones y acciones del jugador.
