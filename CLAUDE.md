# Estat del Mar

App web instal·lable (PWA) per a nedadors de la Costa Brava: onades, vent i millor hora per nedar. L'usuari i els seus companys neden al mar cap a les 9 h i fins ara ho consultaven al Windy. L'objectiu és tenir-ho igual o millor, i contrastar-ho amb el Windy.

- Publicada: https://dddaviddd777.github.io/estat-del-mar/ (repo públic `dddaviddd777/estat-del-mar`, GitHub Pages des de `main` a l'arrel).
- També surt a l'índex de projectes (repo `dddaviddd777.github.io`, carpeta germana `../Índex`, array de projectes a `index.html`).
- Va néixer el 19/11/2026 com a apartat "Mar" de l'app del temps (`../Aplicació del temps`) i es va separar el 21/11/2026. **L'usuari no vol cap relació entre les dues apps de moment** ("ja els relacionarem més endavant").
- Parla amb l'usuari en català. Tots els textos de l'app són en català.

## Com treballar-hi
- Provar en local: `node dev-server.js` → http://localhost:5181 (config a `.claude/launch.json`, nom `estat-del-mar`).
- Publicar: commit a `main` i `git push`; GitHub Pages triga ~1 min. Cada canvi de fitxers de l'app ha d'**apujar `VERSION` a `sw.js`** (`mar-vN`) perquè els mòbils agafin la versió nova.
- Després de publicar, comprova la web publicada (no només el local).
- Al panell de navegador de l'app de Claude els service workers poden no funcionar en local; comprova'ls a la web publicada.

## Fitxers
- `index.html`, `css/style.css` (base), `css/mar.css` (pantalla del mar).
- `js/app.js`: mapa Leaflet 1.9.4 (cdnjs) amb tessel·les d'OpenStreetMap (CARTO demana clau), etiquetes de platja col·locades sense solapar-se (`layoutLabels`), barra de temps, llista, fitxa de platja i gràfic de 48 h.
- `js/marine.js`: llista `BEACHES`, descàrrega (`fetchMarine`, TTL 1 h, 4 dies), onada a la platja (`exposure`, `beachWave`), índex (`analyze`), millor franja (`bestWindow`).
- `js/store.js`: localStorage clau `mar.v1` (preferides `favBeaches`, franja `swimWindow`, dades `marine`). La primera vegada recupera preferides de l'antiga clau `temps.v1`.
- `tools/make-icons.js`: genera les icones PNG (sense dependències). `PLA.md`: fonts, llindars i fases.

## Dades
- Onades: Open-Meteo Marine (best_match, ~MeteoFrance wave), punts a 5-15 km mar endins, `cell_selection=sea`. Vent: Open-Meteo Forecast (AROME). Gratuït, sense clau, una sola crida per a totes les platges.
- API del Windy descartada: la prova dona dades falses i la real costa 990 €/any.
- Contrast de models (fitxa de platja): una tercera crida a Open-Meteo Marine amb `models=ecmwf_wam,ncep_gfswave025,dwd_ewam` (onada i direcció), desada a `h.mod`. ECMWF és el que el Windy ensenya per defecte. Si canvia el format de les dades desades, apuja `DATA_VERSION` a `marine.js`.
- Temperatura de l'aigua: requadre al mapa (dalt a l'esquerra, sobre terra), mitjana de les platges amb escala de color (`sstColor`).
- Boies (estudi a `PLA.md` §7): Cap de Begur (Puertos del Estado, 2798) es pot llegir directament des del navegador (API interna de Portus, CORS obert). Palamós (1718) no té dades. Les d'ICATMAR (Cap de Creus, Tordera; Montgó i Medes, d'estiu) rebutgen el navegador: caldria un intermediari.
- Futur: Meteocat (vent costaner i avisos). La clau de Meteocat, si mai s'usa aquí, **mai al repo** (repo públic): aniria com a secret d'un Cloudflare Worker.

## Platges (14, de nord a sud)
Montgó, L'Estartit, Sa Riera, Sa Tuna, Aiguablava, Tamariu, Llafranc, Calella, La Fosca, Palamós (Platja Gran), Sant Antoni, Sant Feliu, Tossa, Lloret.
- `facing` = cap on mira la platja (graus), `open` = mitja obertura del sector obert, `sea` = punt del mapa ~150 m mar endins, revisat sobre el mapa ampliat.
- Orientacions estimades per Claude i encara per validar amb l'usuari: Cala Montgó (80°, s'obre a l'est), Sa Tuna (55°), Tossa (120°), Lloret (155°).
- Si s'afegeix una platja, `cachedMarine()` descarta les dades desades automàticament (comprova que hi siguin totes).

## Criteris decidits per l'usuari
- Semàfor: verd = molt correcte (< 0,3 m), groc = una mica mogut (0,3–0,8 m), vermell = mala mar de debò (≥ 0,8 m o vent fort). El vermell no s'ha de posar per poca cosa.
- Índex de nedada 0-10: penalització d'onada i de vent/ratxes (3 al llindar de groc, 6 al de vermell); compta la pitjor sencera + un terç de l'altra. Més de 7 = bo, de 4 a 7 = mogut, 4 o menys = mala mar. El semàfor surt de l'índex.
- Llindars de vent (km/h, groc/vermell): de mar 15/35, lateral 20/38, de terra 25/40; ratxes 35/50.
- Mapa: només etiquetes (cercle de color amb l'onada + nom + pastilla de vent amb fletxa, km/h i color segons la força). Sense punts ni línies.
- Botons ràpids: "Ara", "Demà 9 h" i demà passat a les 9 h amb el nom del dia.
- Franja de millor hora per defecte: 6–12 h (encara sense pantalla per canviar-la).

## Pendent (proposat, no fet)
1. ~~Botó "Obre al Windy"~~, ~~boia del Cap de Begur~~ i ~~calibratge automàtic~~ fets el 21/11/2026.
   - `js/buoy.js`: lectura en directe de la boia de Begur i comparació amb els models al mateix punt.
   - Calibratge **temporal** (fins al 31/1/2027, `FINS` a `tools/calibra.js`): `.github/workflows/calibratge.yml` corre cada hora `tools/calibra.js`, que compara Cap de Begur, Cap de Creus i Tordera amb els 4 models (a l'hora i amb la previsió de 24 h abans) i desa `registre.jsonl` + `resum.json` a la branca **`calibratge`** (no a `main`, per no omplir-lo de commits). L'app llegeix `resum.json` de raw.githubusercontent.com.
   - Quan hi hagi prou dades (2-3 setmanes): decidir si canviem de model principal o hi apliquem una correcció, i aturar el workflow.
2. Diari de nedades: platja, hora, com estava el mar (0-10) i onada observada, guardat al mòbil amb exportació; servirà per calibrar orientacions i pesos amb dades reals.
3. Calibratge de 2-3 setmanes amb el Windy i el que trobin a l'aigua.
4. Més endavant: boies reals, Meteocat, avís la nit abans.
