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
- `tools/make-icons.js`: genera les icones PNG (sense dependències). `tools/check-points.html` (obrir-lo amb el servidor local): mapa ampliat de cada platja amb el punt `sea` (vermell), la platja (blau) i la línia de cap on mira, per revisar-ho. `PLA.md`: fonts, llindars i fases.

## Dades
- Onades: Open-Meteo Marine (best_match, ~MeteoFrance wave), punts a 5-15 km mar endins, `cell_selection=sea`. Vent: Open-Meteo Forecast (AROME). Gratuït, sense clau, una sola crida per a totes les platges.
- API del Windy descartada: la prova dona dades falses i la real costa 990 €/any.
- Contrast de models (fitxa de platja): una tercera crida a Open-Meteo Marine amb `models=ecmwf_wam,ncep_gfswave025,dwd_ewam` (onada i direcció), desada a `h.mod`. ECMWF és el que el Windy ensenya per defecte. Si canvia el format de les dades desades, apuja `DATA_VERSION` a `marine.js`.
- Temperatura de l'aigua: requadre al mapa (dalt a l'esquerra, sobre terra), mitjana de les platges amb escala de color (`sstColor`).
- Boies (estudi a `PLA.md` §7): Cap de Begur (Puertos del Estado, 2798) es pot llegir directament des del navegador (API interna de Portus, CORS obert). Palamós (1718) no té dades. Les d'ICATMAR (Cap de Creus, Tordera; Montgó i Medes, d'estiu) rebutgen el navegador: caldria un intermediari.
- Boia de Begur al mapa (22/11/2026): rombe petit blanc amb vora fosca (`.buoy-dot`, `renderBuoyDot` a `app.js`), a la **posició GPS de l'última lectura** (`lat`/`lon` que dona Portus a cada lectura; la boia gira al voltant de l'ancoratge, s'ha vist a ~1,5 km del punt nominal `BUOY`). Nom i onada mesurada en passar-hi; clic → targeta de la boia.
- Cap de Creus i Tordera (ICATMAR), des del 22/11/2026 a l'app: la GitHub Action (`tools/calibra.js`) desa cada hora l'última lectura de les 3 boies a `boies.json` (branca `calibratge`; se segueix escrivint després de `FINS`). L'app el llegeix (`fetchOthers` a `buoy.js`, TTL 20 min): rombe al mapa a la posició de cada boia i bloc "Altres boies" a la targeta de la boia (onada, direcció, període, aigua, hora i el model de l'app). Arriben amb ~2 h de retard. Els rombes van sota les etiquetes (`zIndexOffset` negatiu).
- Futur: Meteocat (vent costaner i avisos). La clau de Meteocat, si mai s'usa aquí, **mai al repo** (repo públic): aniria com a secret d'un Cloudflare Worker.

## Platges (16, de nord a sud)
Cap de Creus, Cap Norfeu, Montgó, L'Estartit, Sa Riera, Sa Tuna, Aiguablava, Tamariu, Llafranc, Calella, La Fosca, Palamós (Platja Gran), Sant Antoni, Sant Feliu, Tossa, Lloret.
- `facing` = cap on mira la platja (graus), `open` = mitja obertura del sector obert, `sea` = punt del mapa ~150 m mar endins, revisat sobre el mapa ampliat.
- Orientacions revisades totes sobre el mapa (OSM, zoom 14-15) el 21/11/2026 amb `tools/check-points.html`. Canvis: Montgó 80→100° (±30, la cala s'obre a l'ESE i el cap de Montgó la tapa del N-NE; coordenades de la platja corregides), Aiguablava 80→15° (±30, s'obre al N-NE; el punt queia damunt del Parador), Tamariu 100→120° (±50), Calella 150→125° (±50, el S-SO el tapa la costa fins al Cap Roig), La Fosca 160→125° (±45, el Cap Gros la tapa del S), Sant Antoni 160→145° (±60). L'Estartit moguda a petició de l'usuari al punt on neden, davant del port i de Cala Calella (42.0549, 3.2164; obert ±75° cap a l'E, estimat d'una captura). La resta ja quadraven. Falten validar amb l'experiència de l'usuari.
- 22/11/2026, a partir de punts desats per l'usuari (coordenades de les captures, ±50 m): nous **Cap de Creus** (42.315, 3.321, corregit el mateix dia; al SE de la punta del Far, mira 130° ±100, el cap el tapa del NO) i **Cap Norfeu** (42.236, 3.249; al sud del cap, mira 170° ±90); **L'Estartit** a 42.0558, 3.2143 (al costat de Cala Calella); **Tamariu** a 41.917, 3.209 (mig de la badia); **Sant Antoni** a 41.8355, 3.0957 (davant de la Cala dels Capellans / l'Embarcador, costa rocosa N-S: mira 115° ±80). Per a aquestes, `lat/lon` (on es demanen les dades) = `sea` (el punt on neden).
- Les etiquetes esquiven el requadre de la temperatura de l'aigua (`dodgeBox` a `layoutLabels`).
- Si s'afegeix una platja, `cachedMarine()` descarta les dades desades automàticament (comprova que hi siguin totes).

## Criteris decidits per l'usuari
- Semàfor: verd = molt correcte (< 0,3 m), groc = una mica mogut (0,3–0,8 m), vermell = mala mar de debò (≥ 0,8 m o vent fort). El vermell no s'ha de posar per poca cosa.
- Índex de nedada 0-10: penalització d'onada i de vent/ratxes (3 al llindar de groc, 6 al de vermell); compta la pitjor sencera + un terç de l'altra. Més de 7 = bo, de 4 a 7 = mogut, 4 o menys = mala mar. El semàfor surt de l'índex.
- Llindars de vent (km/h, groc/vermell): de mar 15/35, lateral 20/38, de terra 25/40; ratxes 35/50.
- Per a l'usuari, la direcció de l'onada pesa més que la del vent, i el període compta molt (21/11/2026). `seaState` a `marine.js`: tipus de mar segons el període de pic (el més gran entre pic i mitjà): picada/choppy < 4 s (×1,25 a l'índex), curta 4–6 s (×1), mitjana 6–8 s (×0,95), llarga ≥ 8 s (×0,9), creuada/rentadora si dos trens d'onades difereixen ≥ 45° i el segon fa ≥ 40 % (×1,2). El factor només afecta l'índex, no l'alçada que es mostra. Refracció: amb període llarg el sector obert s'eixampla fins a 20°. Valors estimats, a calibrar.
- Manual "Com funciona" (botó "i" de la capçalera, i des de la fitxa) a `index.html` (`#help`). Si canvien llindars o factors, actualitza'l també.
- Mapa: només etiquetes, sense punts ni línies. Etiqueta (21/11/2026, perquè el semàfor no es confongués amb l'alçada): cercle de color = **nota per nedar** (l'únic element amb el color del semàfor) + nom + pastilla blava quadrada = **onada a la platja** (m, fletxa cap on va) + pastilla de vent arrodonida (fletxa, km/h, color segons la força). Des del 22/11/2026 (proposta A, triada per l'usuari) onada i vent van **apilats** en una columna a la dreta (onada a dalt, vent a sota), cadascun amb una icona petita (`WAVE_ICO`/`WIND_ICO`) i sense perdre la fletxa de direcció; l'etiqueta fa ~120 px d'ample i 32 d'alt. `PILL_H`/`DATA_W` a `app.js` han de coincidir amb `.bm .pill` i `.st` a `mar.css`. Al mòbil `fitCoast` deixa 170 px a la dreta perquè hi càpiguen.
- Etiquetes i zoom (22/11/2026, a petició de l'usuari: amb el zoom allunyat quedaven en una columna il·legible): `labelMode` a `app.js` mira quants píxels d'alçada toquen a cada etiqueta (la columna pot fer 2 × la costa + 60 px, màxim l'alçada del mapa). Amb prou lloc, mida normal; justes, s'encongeixen fins al 70 % (`transform: scale`, `pillPos`); si ni així, només el cercle de la nota (`.pill.mini`). En acostar-se tornen a créixer. Els botons de zoom fan mig nivell (`zoomDelta: 0.5`) perquè el canvi sigui gradual.
- Esborrar un punt: icona de paperera (`#dDel`) a la capçalera de la fitxa, al costat de la creu (abans era un enllaç a baix). Els desats demanen confirmació.
- Punts propis (`pts` a `app.js`): un de provisional (`punt`, clau `point`) i els desats (clau `savedPoints`: id, nom, lat, lon, facing, like), fixos al mapa (punt blau) i a dalt de la llista. Desar = posar-li nom a la fitxa; des de la fitxa es canvia el nom o s'esborra. Les seves etiquetes entren a `layoutLabels` amb les de les platges (l'ordre vertical el decideix la posició del punt, de nord a sud, perquè no s'encreuin). Mapa del mòbil 560 px d'alt (530 sota 380 px d'ample) perquè hi càpiguen les 14 etiquetes apilades a mida normal.
- Punt lliure: mantenir premut el mapa (`tapHold`) o clic dret obre la mateixa fitxa per a aquell punt (`fetchPoint` a `marine.js`, TTL 1 h). Si és a menys de 1,5 km d'una platja n'agafa l'orientació (`like`, xip "Com <platja>"); si no, mar obert (`facing` null) fins que l'usuari tria cap on s'obre la costa. La fitxa diu a quants km és la cel·la del model (`cellKm`): el model no entra a les cales, totes les de Begur agafen la mateixa cel·la a ~7 km; es desa a `store` (`point`) i queda marcat fins que l'esborra.
- Ordinador i pantalles horitzontals (≥ 900 × 540 px; `wide` a `app.js` ha de coincidir amb la media query de `css/mar.css`): mapa gran a l'esquerra amb la barra de temps, columna a la dreta (`.side`: platges, boia, peu) amb desplaçament propi; la fitxa s'obre damunt d'aquesta columna sense tapar el mapa; el manual és una finestra centrada. Al mòbil, una sola columna com sempre.
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
