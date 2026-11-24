# Maastavedon VBT-kalibrointitreenin suunnitelma

**Liike:** `Maastaveto` (dead-stop)  
**Tavoite sovelluksessa:** `Perusvoima` (`baseStrength`)  
**Lähtötilanne:**  
- `2026-10-29`: `120 kg @ 0,543 m/s`, `140 kg @ 0,432 m/s`, `160 kg × 1 @ 0,238 m/s`  
- `2026-11-24`: `120 kg @ 0,567 m/s`, `130 kg @ 0,463–0,490 m/s`, `150 kg × 1 @ 0,291 m/s` (`DEFAULT_REF_MAX.deadlift = 170 kg`, päivän L–V `e1RM = 168,4 kg`)

---

## 1. Mitä tällä yhdellä treenillä kalibroidaan (`index.html`)

1. **Kuorma–nopeusprofiili (`sessionProfile` / `buildLVProfile`):**  
   6–7 nousevaa kuormaa välillä `100–160 kg`. Kaikki kuormat ovat `≥ 56 %` `170 kg`:n ankkurista (`95,2 kg`), joten myös `100 kg` jää mukaan regressioon laajentamaan kuormaväliä (`span ≥ 50 kg`).
2. **Oma nopeuskustannus (`ownVelocityCost`, `±7,5 % 1RM` -ikkuna):**  
   Vähintään **2 puhdasta monitoistoista sarjaa** molemmilla tehoalueilla:
   - **Perusvoima (`120–130 kg`, ~71–78 %):** tarkentaa sarjat `#3` ja `#4` + jälkisarjat.
   - **Raskas alue (`145–150 kg`, ~84–89 %):** `145 kg × 3` ja `150 kg × 2–3` osuvat molemmat `150 kg`:n `±7,5 % 1RM` -ikkunaan (`n ≥ 2`), jolloin sovellus alkaa käyttää omaa raskaan pään kustannustasi oletuksen `0,050 m/s/toisto` sijaan.
3. **RIR & MVT -kalibrointi:**  
   Kun kirjaat oman **koetun RIR:n** erityisesti sarjoista `#5 (145 kg)` ja `#6 (150 kg)` (sekä valinnaisesta `#7:stä`), näemme jälkianalyysissä suoraan, johtuiko alakanttiin arvioitu RIR `0,050 m/s/toisto` -kustannuksesta vai siitä, että oma maastavedon `MVT` on alle `0,155 m/s` (tai `LIFT_ANALYSIS.deadlift.lv` / `DEFAULT_REF_MAX` vaatii säätöä).
4. **Valmiusvertailu (`readinessForDate`):**  
   Tuore `120 kg` (suora vertailu `29.10.` ja `24.11.` tuloksiin), `130 kg` ja `145–150 kg` + varmistus, että huipun jälkeiset back-off-sarjat (`#8–#9`) suodattuvat pois valmiusvertailusta.
5. **Anturin & BLE-korjausten kenttätesti:**  
   Dead-stop-oletus (`Touch-and-go` POIS), `🧭 Nollaa anturi` kahdessa merkityssä välissä (`drift`-määrän seuranta), `pauseMs`-mittaus tasaisilla lattiapysähdyksillä, 80 Hz trace -segmenttien täsmäys sekä BLE-diagnostiikkaloki.

---

## 2. Sovelluksen valmistelu ja suoritusohjeet

- **Asetukset ennen aloitusta:**
  - Liike: `Maastaveto`
  - Tila: `Perusvoima` (`baseStrength`)
  - `Touch-and-go (maastaveto)`: **POIS päältä**
- **Tavoitetoistot joka sarjaan:** Tarkista **Tavoitetoistot**-laskuri aina ennen uuden sarjan aloittamista (erityisesti sarjoissa `#5`, `#6` ja `#8`, ettei sarja jää `1`:een ykkösen jälkeen).
- **Nostotekniikka & tempo:**
  - **Maksimaalinen nopeusintentio** konsentrisessa vaiheessa jokaisella toistolla jo `100 kg`:sta lähtien (muuten lämmittelyt vääristävät L–V-profiilin kulmakerrointa).
  - **Selkeä 1,5–2,5 s dead-stop-pysähdys** lattialla toistojen välissä: tanko täysin kuolleeksi lattiassa, mutta uusi toisto liikkeelle hyvissä ajoin ennen Pin-anturin ~5–10 s liikkumattomuuskatkaisua.
- **Anturin nollaus (`🧭 Nollaa anturi`):** Paina painiketta täsmälleen kahdessa merkityssä välissä (sarjan `#2` jälkeen ja sarjan `#5` jälkeen), kun tanko ja anturi ovat paikoillaan. Näin näemme suoraan, vähentääkö välinollaus lattiaiskujen aiheuttamaa `drift`-ajautumaa raskaissa sarjoissa.

---

## 3. Treeniohjelma (8–9 sarjaa, yhteensä 19–24 toistoa)

| # | Paino × Toistot | % (170 kg) | Lepo | Odotettu `v1` | Tarkoitus kalibroinnissa & toimintaohje |
|---:|---|---:|---:|---:|---|
| **1** | **`100 kg × 3`** | 59 % | 2 min | `0,66–0,72 m/s` | Lämmittely + L–V-profiilin alapää (`≥ 95,2 kg` rajan yläpuolella). Terävä lähtö. |
| **2** | **`115 kg × 2`** | 68 % | 2 min | `0,56–0,60 m/s` | Lämmittelypiste 2 L–V-suoralle.<br>**→ Sarjan jälkeen: paina `🧭 Nollaa anturi`.** |
| **3** | **`120 kg × 3`** | 71 % | 3 min | `0,55–0,59 m/s` | **Valmiusankkuri** (`readinessForDate` vs. `0,543` / `0,567`) + 1. perusvoima-`ownVelocityCost`. |
| **4** | **`130 kg × 3`** | 76 % | 3 min | `0,46–0,50 m/s` | **Tuore perusvoima-ankkuri** (vs. 24.11. `0,463–0,490`, `VL ≈ 12–20 %`) + 2. perusvoima-`ownVelocityCost`. |
| **5** | **`145 kg × 3`**<br>*(jos #4 `v1 < 0,44`: `142,5 kg × 3`)* | 85 % | 4 min | `0,34–0,39 m/s` | **Raskaan pään 1. kustannushavainto** (`±7,5 %` ikkunassa `150 kg`:lle). Kirjaa koettu RIR.<br>**→ Sarjan jälkeen: paina `🧭 Nollaa anturi`.** |
| **6** | **`150 kg × 2–3`** *(Pääsarja)* | 88 % | 4–5 min | `0,28–0,33 m/s` | **Raskaan pään 2. kustannushavainto + RIR/MVT-kalibrointi.** Tee **2 toistoa** jos `v1 ≥ 0,27 m/s`; tee **3. toisto vain**, jos 2. toiston jälkeen jää aidosti **1–2 toistoa varastoon** puhtaalla tekniikalla. Pysähdy aidossa **RIR 1–2**:ssa. |
| **7** | **`155–160 kg × 1`** *(Valinnainen)* | 91–94 % | 4 min | `0,22–0,27 m/s` | Tee **VAIN**, jos `#6`:n `v1 ≥ 0,29 m/s` ja sarja `#6` tuntui vähintään **RIR 2**:lta (`155 kg` konservatiivinen; `160 kg` jos `150 kg` oli `≥ 0,31 m/s`). Jätä pois jos `#6` oli `RIR ≤ 1`. Kalibroi L–V-yläpään ja hitaan noston MVT-tason. |
| **8** | **`130 kg × 3`** | 76 % | 3 min | `0,43–0,47 m/s` | **Back-off-työsarja #1:** testaa `readinessForDate`-suodatuksen sekä kuormituksen jälkeisen `130 kg` VL-kustannuksen. |
| **9** | **`130 kg × 3` tai `130 kg × 4`** *(Valinnainen)* | 76 % | — | `0,42–0,46 m/s` | Tee **`× 3`** perusvoimavolyymin täydentämiseksi tai **`× 4`** jos `#8` meni `VL < 18 %` ja olo on raikas (mittaa 3→4 toiston kustannuksen). Jätä väliin jos `#8` ylitti `22 %` VL:n tai alaselkä väsyy. |

---

## 4. Treenin aikainen kirjauspohja

Täytä erityisesti **Koettu RIR**, **Tehdyt toistot** vs. **Sovelluksen toistot** sekä mahdolliset huomiot sarjojen jälkeen:

| Sarja | Suunniteltu | Tehdyt toistot | Sovelluksen toistot | Koettu RIR | Anturi nollattu ennen sarjaa? | Huomiot (BLE, trace, pysähdyksen pituus, tuntuma) |
|---:|---|---:|---:|---:|:---:|---|
| 1 | `100 kg × 3` | | | | Ei | |
| 2 | `115 kg × 2` | | | | Ei | |
| 3 | `120 kg × 3` | | | | **Kyllä** | |
| 4 | `130 kg × 3` | | | | Ei | |
| 5 | `145 kg × 3` *(tai 142,5)* | | | | Ei | |
| 6 | `150 kg × 2–3` | | | | **Kyllä** | |
| 7 | `155–160 kg × 1` *(val.)* | | | | Ei | |
| 8 | `130 kg × 3` | | | | Ei | |
| 9 | `130 kg × 3–4` *(val.)* | | | | Ei | |

### Treenin jälkeen talteen
1. Vie treenidata CSV:nä (**`Vie CSV`**) ja ota halutessasi myös 80 Hz raakadata (**`Raakadata`**).
2. Avaa **Analyysi → Asetukset → BLE-diagnostiikka** ja kopioi loki, jos yksikin toisto puuttui tai käyttäytyi oudosti.
3. Palauta CSV + yllä oleva taulukko koettuine RIR-arvoineen seuraavaa kalibrointia varten.

---

## 5. Jälkianalyysiprotokolla (seuraavaa kierrosta varten)

Kun data on kerätty, vertaamme tuloksia tätä suunnitelmaa vasten:
1. **RIR & MVT -kalibrointi:** Verrataan koettua RIR:iä sovelluksen RIR:iin sarjoissa `#4`, `#5`, `#6` ja `#7`. Selvitetään, riittääkö raskaasta päästä (`145 + 150 kg`) opittu `ownVelocityCost`, vai pitääkö `LIFT_ANALYSIS.deadlift.mvt` (`0,155 m/s`), `repCost` (`0,050`), `lv`-taulukko tai `DEFAULT_REF_MAX.deadlift` (`170 kg`) kalibroida uudelleen.
2. **L–V-kulmakerroin ja e1RM:** Tarkistetaan `sessionProfile` (`r²`, pisteiden osuvuus `100–160 kg` välillä, lämmittelyjen intention vaikutus).
3. **Anturin ajautuma (`drift`) & välinollaus:** Verrataan `drift`-lippujen ja 80 Hz trace -erojen esiintyvyyttä ennen ja jälkeen `rezeroPin()`-nollausten (`#3` ja `#6`).
4. **Taukomittaus (`pauseMs`) & toistonkatoamissuojat:** Tarkistetaan, näkyikö `partial-accepted`-, `reconnect-resumed`- tai `trace-mismatch`-tapahtumia BLE-diagnostiikassa ja osuiko `pause_before_ms` dead-stop-haarukkaan (`~1500–2500 ms`).
