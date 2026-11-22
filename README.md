# Estat del Mar

App web instal·lable (PWA) per a nedadors de la Costa Brava: onades, vent i millor hora per nedar a 16 punts de bany, del Cap de Creus a Lloret.

- **Dades**: Open-Meteo Marine (onades i temperatura de l'aigua) + Open-Meteo Forecast amb el model AROME (vent i ratxes).
- **Valor afegit**: l'onada de mar obert es corregeix segons cap on mira cada platja, i un índex de nedada de 0 a 10 combina onada i vent.
- Vegeu [PLA.md](PLA.md) per a fonts, llindars i fases.

Publicada a https://dddaviddd777.github.io/estat-del-mar/

## Provar-la a l'ordinador
```
node dev-server.js
```
i obrir http://localhost:5181

## Fitxers
- `index.html`, `css/style.css`, `css/mar.css`: pantalla
- `js/app.js`: mapa, llista, fitxa de platja i gràfic
- `js/marine.js`: platges, descàrrega de dades, onada a la platja, índex 0-10 i millor franja
- `js/store.js`: desament local (preferides, franja i últimes dades)
- `sw.js`, `manifest.webmanifest`, `icons/`: instal·lació i mode sense connexió
- `tools/make-icons.js`: regenera les icones
