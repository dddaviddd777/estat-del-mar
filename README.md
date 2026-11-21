# Dades de calibratge d'Estat del Mar

Branca de dades, separada de l'app. Una GitHub Action (`.github/workflows/calibratge.yml` a `main`) l'actualitza cada hora:

- `registre.jsonl`: una línia per boia i hora. `hs` = onada mesurada (m), `dir`, `tp`, `sst` = temperatura de l'aigua mesurada; `m` = onada que donava cada model per a aquella hora (`main` Météo-France, `ecmwf`, `gfs`, `dwd`); `m24` = la previsió feta ~24 h abans; `msst` = temperatura de l'aigua del model. Hores en UTC (segons).
- `previsions.json`: previsions guardades per comparar-les quan arribi la mesura.
- `resum.json`: error mitjà de cada model (`bias`: positiu = dona més onada que la real; `mae`: error absolut mitjà). L'app el llegeix.

Boies: Cap de Begur (Puertos del Estado), Cap de Creus i Tordera (ICATMAR). Temporal: deixa de registrar a partir de la data `FINS` de `tools/calibra.js`.
