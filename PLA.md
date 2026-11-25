# Estat del Mar: app per a nedadors de la Costa Brava

> Va néixer el 19/11/2026 com a apartat "Mar" de l'app del temps i el 21/11/2026 es va separar com a app pròpia.

Objectiu: veure d'un cop d'ull **com estarà el mar a les platges on nedeu** (onades, vent i com s'afecten l'un a l'altre) i **quina és la millor franja per nedar**, normalment a primera hora del matí.

---

## 1. D'on surten les dades del Windy (i com tenir-les nosaltres)

El Windy no té dades pròpies: pinta **models de previsió públics**. Per al mar fa servir sobretot:
- **Onades**: ECMWF WAM (el model d'onades del Centre Europeu), GFS Wave (EUA) i, segons la zona, models regionals.
- **Vent**: ECMWF, ICON (Alemanya), GFS i AROME (Météo-France, alta resolució).

### Opcions

| Opció | Cost | Dades | Valoració |
|---|---|---|---|
| **API del Windy** (Point Forecast) | Prova gratuïta però **amb dades falses** (barrejades a propòsit, només per a desenvolupar). Versió real: **990 €/any**. No inclou ECMWF per llicència. | Onades i vent | ❌ No surt a compte |
| **Open-Meteo Marine** | Gratuït (ús no comercial), sense clau, es pot cridar des del mòbil | Els **mateixos models** que el Windy: ECMWF WAM, GFS Wave, Météo-France (MFWAM), DWD EWAM (Europa, ~5 km). Alçada d'onada, direcció, període, mar de vent i mar de fons per separat, temperatura de l'aigua, corrents | ✅ **Recomanada** |
| **Open-Meteo Forecast** (ja la fem servir) | Gratuït | Vent i ratxes amb AROME (molt detallat a la costa) | ✅ Per al vent |
| **Puertos del Estado (Portus)** | Gratuït | **Mesures reals** de les boies del Cap de Begur i de la bocana de Palamós: onada i temperatura de l'aigua ara mateix | 🟡 Molt valuós per comprovar la previsió, però no té una API documentada: cal estudiar com llegir-les (fase 3) |
| **Meteocat** (quan tinguem la clau) | Gratuït | Vent real a les estacions costaneres i avisos per estat de la mar | 🟡 Complement (fase 3) |

**Conclusió:** amb Open-Meteo Marine + Open-Meteo Forecast tenim pràcticament les mateixes dades que veieu al Windy, gratis i integrades. Les boies reals són la cirereta per saber si la previsió l'encerta.

---

## 2. El que el Windy no fa: tenir en compte l'orientació de cada platja

Els models d'onades tenen cel·les de 5 a 25 km: no "veuen" que una cala està arrecerada. Per això el valor afegit de l'app serà **corregir la previsió segons cap on mira cada platja**:

- **Vent de terra** (bufa de la platja cap al mar, p. ex. tramuntana a una platja que mira al sud): l'aigua de la vora queda plana. Bo per nedar a prop, però vigilar que no t'allunyi.
- **Vent de mar** (bufa cap a la platja, p. ex. llevant a una platja que mira a l'est): fa onada curta i incòmoda encara que sigui fluix.
- **Mar de fons**: només arriba si ve d'una direcció que la platja té oberta. Un mar de fons de llevant entra de ple a Tamariu i molt menys a Sa Riera.

Per a cada platja guardarem la **direcció cap on mira** i l'**angle que té obert al mar**, i amb això l'app calcularà un **índex de nedada** per hores.

### Semàfor per nedar (revisat el 20/11/2026 amb els vostres criteris)

El vermell vol dir mala mar de debò; el vent sol, si no és fort, només arriba a groc.

| | Onada a la platja | Vent sostingut | Ratxes |
|---|---|---|---|
| 🟢 **Bo** | < 0,4 m | de mar < 15 · lateral < 20 · de terra < 25 km/h | < 35 km/h |
| 🟡 **Una mica mogut** | 0,4 – 1 m | de mar 15–35 · lateral 20–38 · de terra 25–40 km/h | 35–50 km/h |
| 🔴 **Mala mar** | ≥ 1 m | de mar ≥ 35 · lateral ≥ 38 · de terra ≥ 40 km/h | ≥ 50 km/h, o tempesta |

Els llindars són a `js/marine.js` (`WAVE_LIMITS`, `WIND_LIMITS`, `GUST_LIMITS`).

"Onada a la platja" = onada prevista mar endins × factor d'exposició de la platja segons d'on ve l'onada.

### Millor franja per nedar
Per a avui i demà, l'app buscarà la **millor finestra de 2 hores entre les 6 i les 12 h** (configurable) i ho dirà en una frase: *"Llafranc: millor de 7 a 9 h (onada 0,2 m, vent de terra 6 km/h). A partir de les 12 h entra garbí."*

---

## 3. Platges proposades (primera llista, per revisar amb vosaltres)

De nord a sud. L'orientació és aproximada i la confirmarem amb el mapa.

| Platja | Municipi | Mira cap a |
|---|---|---|
| Cala Montgó | L'Escala / Torroella | E-SE |
| L'Estartit (platja gran) | Torroella de Montgrí | E |
| Sa Riera | Begur | NE |
| Aiguablava | Begur | E |
| Sa Tuna | Begur | E |
| Tamariu | Palafrugell | E |
| Llafranc | Palafrugell | S-SE |
| Calella de Palafrugell | Palafrugell | SE |
| La Fosca | Palamós | S-SE |
| Platja Gran de Palamós | Palamós | S-SO |
| Sant Antoni de Calonge | Calonge | SE |
| Sant Feliu de Guíxols | Sant Feliu | SE |
| Platja Gran de Tossa | Tossa de Mar | E-SE |
| Platja de Lloret | Lloret de Mar | SE |

Una sola petició a Open-Meteo porta totes les platges de cop. Per a cada platja agafarem un punt **una mica mar endins** (uns centenars de metres), perquè el model d'onades no doni "terra".

---

## 4. Com es veuria

**Pantalla principal:**
1. **Mapa de la Costa Brava** (de l'Escala a Lloret) amb una etiqueta per platja: onada a la platja pintada amb el semàfor, nom i pastilla de vent (fletxa, km/h i color segons la força).
2. **Barra de temps** a sota del mapa, com la del Windy: arrossegant-la es veu com canvia el semàfor hora a hora (ara, 6 h, 9 h, 12 h… fins a 4 dies), amb botons ràpids "Demà 9 h" i "demà passat 9 h".
3. **Llista de platges** ordenada per com estan ara, amb la millor franja d'avui.
4. **Fitxa de platja** (en tocar-ne una):
   - índex de nedada de 0 a 10 (onada + vent + ratxes) amb el detall d'onada i de vent;
   - frase resum i millor franja d'avui i de demà;
   - gràfic per hores de les pròximes 48 h: onada (m), vent i ratxes (km/h), amb fletxes de direcció i el semàfor de fons;
   - període de l'onada i si és mar de vent o mar de fons;
   - temperatura de l'aigua;
   - si hi ha boia a prop: "Mesurat ara a la boia de Palamós: 0,3 m · 18,4 °C".
5. Platges preferides marcades amb una estrella, que surten primer.

Mapa: Leaflet amb el mapa d'OpenStreetMap, sense clau.

---

## 5. Fases

1. **Prototip** amb Open-Meteo Marine + vent AROME: mapa, llista, fitxa de platja, semàfor i índex 0-10. ✅ Fet el 19-20/11/2026 (`index.html`, `js/marine.js`, `js/app.js`). Nota: els models d'onades donen el valor en punts a 5–15 km mar endins; l'orientació de cada platja (a `js/marine.js`) és el que cal calibrar.
2. **Calibratge** (2-3 setmanes): compareu-ho amb el Windy i amb el que trobeu a l'aigua; ajustem llindars i orientacions de cada platja. Previst: botó "Obre al Windy" a cada platja i diari de nedades (com estava el mar de veritat) per comparar-ho amb la previsió.
3. **Dades reals**: boies de Puertos del Estado (Cap de Begur, Palamós) i, amb la clau de Meteocat, vent de les estacions costaneres i avisos marítims.
4. (Opcional) Avís al mòbil la nit abans: *"Demà a les 7 h, Llafranc 🟢"*.

## 6. Què necessito de vosaltres
- La **llista de platges** on nedeu (afegir-ne o treure'n de la taula).
- Quan considereu que el mar **està bé** i quan **no** (per ajustar el semàfor).
- La **franja horària** habitual (p. ex. de 7 a 10 h).

---

## 7. Boies reals: què hi ha i com llegir-les (estudiat el 21/11/2026)

| Boia | Qui | On | Estat | Dades | Accés des del mòbil |
|---|---|---|---|---|---|
| **Cap de Begur** (2798) | Puertos del Estado, xarxa exterior | 41,90 N 3,66 E, ~35 km mar endins | ✅ En marxa, dada cada hora | Onada (Hm0, Hmax, període, direcció), vent, temperatura de l'aigua i de l'aire, corrent, salinitat | ✅ Directe: `POST https://portus.puertos.es/portussvr/api/lastData/station/2798?locale=es` amb el cos `["WAVE","WIND","WATER_TEMP"]` (CORS obert). No és una API documentada: la fa servir el web de Portus i podria canviar. `valor / factor` = valor real. |
| **Palamós** (1718) | Puertos del Estado, xarxa costanera | 41,83 N 3,19 E | ❌ Sense dades (fora de servei; només històric) | — | — |
| **Cap de Creus** | ICATMAR (CSIC + Generalitat) | 42,32 N 3,35 E | ✅ En marxa, cada 20 min | Onada, vent, temperatura de l'aigua, corrent | 🟡 ERDDAP públic (`hebe.icm.csic.es/erddap`), però el servidor **rebutja les peticions del navegador** (403 si porten `Origin`): cal un intermediari (Cloudflare Worker o GitHub Action) |
| **Tordera** (davant de Blanes/Malgrat) | ICATMAR | 41,60 N 2,77 E | ✅ En marxa, cada 20 min | Igual que Cap de Creus | 🟡 Igual: cal intermediari |
| **Montgó, Medes, Sud i Nord Cap de Creus** | ICATMAR | Davant de l'Escala i les Medes | ⏸ Última dada el 21/10/2026 (semblen d'estiu) | Onada, meteo, CTD, corrents | 🟡 Cal intermediari |

**Primera comparació** (21/11/2026, 12 h, Cap de Begur): la boia mesurava **0,59 m del 201°, Tp 5,5 s, aigua 17,2 °C**. Els models al mateix punt donaven: Météo-France 0,54 m (el que fa servir l'app), ECMWF 0,74 m (el del Windy), GFS 0,42 m. L'aigua a la boia de la Tordera era a 17,6 °C, igual que el model a Lloret. Només és una lectura, però va bé per començar.

**Per a què serveixen:**
1. **Saber com és el mar ara**, no només la previsió: "Mesurat ara al Cap de Begur: 0,6 m del SO".
2. **Calibrar**: si guardem cada hora el que diu la boia i el que deien els models, en unes setmanes sabrem quin model l'encerta més aquí i si cal corregir l'onada (p. ex. "l'ECMWF dona un 25 % de més"). Per guardar-ho sense dependre del mòbil cal un procés automàtic (GitHub Action cada hora que desa un JSON al repo, gratuït en un repo públic).
3. **Límit**: les boies són mar endins (Begur a 35 km). Diuen com entra el mar a la costa, no com és la vora de cada platja. Per a la platja, el que compta és el diari de nedades.
