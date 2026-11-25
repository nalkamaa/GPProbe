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
   Vähintään **2 puhdasta monitoistoista sarjaa** molemmilla tehoalueilla. Monitoistoisissa sarjoissa (`#3`, `#4`, `#5`, `#6`, `#8`, `#9`) `analyzeSet` laskee nopeushäviön sarjan omasta havaitusta pudotuksesta (`costSource = 'set'`), ja nämä sarjat kerryttävät havainnot `ownVelocityCost`-malliin:
   - **Perusvoima (`120–130 kg`, ~71–78 %):** tarkentaa sarjat `#3` ja `#4` + jälkisarjat sekä tulevien treenien `computeDailyPlan`-suunnitelman.
   - **Raskas alue (`145–150 kg`, ~85–88 %):** `145 kg × 3` ja `150 kg × 2–3` tuottavat molemmat havainnot (`n ≥ 2`) ja kalibroivat `ownVelocityCost`:n oletuksen (`0,050 m/s/toisto`) tilalle sekä raskaille ykkösille (`≤ 155 kg`, `±7,5 %`-ikkunan sisällä) että tulevien treenien `computeDailyPlan`-suunnitelmalle. Huomaa, että mahdollinen `160 kg` (~94 %) voi jäädä `142,5–145 kg`:n (~84–85 %) `±7,5 %`-ikkunan ulkopuolelle.
3. **RIR & MVT -kalibrointi:**  
   Kun kirjaat oman **koetun RIR:n** erityisesti sarjoista `#5 (145 kg)` ja `#6 (150 kg)` (sekä valinnaisesta `#7:stä`), näemme jälkianalyysissä suoraan, johtuiko alakanttiin arvioitu RIR `0,050 m/s/toisto` -kustannuksesta vai siitä, että oma maastavedon `MVT` on alle `0,155 m/s` (tai `LIFT_ANALYSIS.deadlift.lv` / `DEFAULT_REF_MAX` vaatii säätöä).
4. **Valmiusvertailu (`readinessForDate`):**  
   Vertaa tuoretta submaksimiankkuria (`120–130 kg`, `65–83 % 1RM`) täsmälleen samassa **dead-stop-tilassa** (`Touch-and-go` POIS) aiempiin treeneihin (90 pv ikkuna; suora vertailu `29.10.` ja `24.11.` tuloksiin) ja suodattaa pois väsyneet huippusarjat (`> 85 %`), kevyet lämmittelyt (`< 60 %`) sekä huipun jälkeiset back-off-sarjat (`#8–#9`).
5. **Anturin & BLE-korjausten kenttätesti:**  
   Dead-stop-oletus (`Touch-and-go` POIS), `🧭 Nollaa anturi` kahdessa merkityssä välissä (`drift`-määrän seuranta), `pauseMs`-mittaus tasaisilla lattiapysähdyksillä, 80 Hz trace -segmenttien täsmäys sekä BLE-diagnostiikkaloki.

---

## 2. Sovelluksen valmistelu ja suoritusohjeet

- **Asetukset ennen aloitusta:**
  - Liike: `Maastaveto`
  - Tila: `Perusvoima` (`baseStrength`, tavoitealue `70–80 % 1RM`, VL-cutoff `20 %`, punainen `redVl`-raja `25 %`) — raskaissa kalibrointisarjoissa (`#5–#7`, `85–94 %`) sovellus huomauttaa odotetusti tavoitealueen ylityksestä
  - `Touch-and-go (maastaveto)`: **POIS päältä**
  - `Analyysi → ⚙ Asetukset`: varmista, että **`Lopeta sarja automaattisesti VL-rajalla`** on **POIS päältä** (muuten `20 %` VL-raja voi katkaista sarjan kesken ennen suunniteltuja toistoja)
- **Tavoitetoistot & Ohjatun tilan pysäytys:**
  - Tarkista **Tavoitetoistot**-laskuri aina ennen uuden sarjan aloittamista (erityisesti sarjoissa `#5`, `#6`, `#8` ja `#9`, ettei sarja jää `1`:een ykkösen jälkeen).
  - **Sarjat `#6 (150 kg × 2–3)` ja `#9 (130 kg × 3–4)`:** Aseta **Tavoitetoistot** enimmäismäärään (**`3`** sarjaan `#6`, **`4`** sarjaan `#9`). Jos jäät 2 toistoon sarjassa `#6` (tai 3 toistoon sarjassa `#9`), **lopeta sarja käsin `⏹ LOPETA SARJA` -napista**. Jos Tavoitetoistot olisi `2` (tai `3`), Ohjattu tila pysäyttäisi sarjan automaattisesti heti 2. (tai 3.) toiston jälkeen, koska `RIR < 3` (eikä `+1 toisto ok` -ehdot täyty).
- **Nostotekniikka & tempo:**
  - **Maksimaalinen nopeusintentio** konsentrisessa vaiheessa jokaisella toistolla jo `100 kg`:sta lähtien (muuten lämmittelyt vääristävät L–V-profiilin kulmakerrointa).
  - **Selkeä 1,5–2,5 s dead-stop-pysähdys** lattialla toistojen välissä: tanko täysin kuolleeksi lattiassa, mutta uusi toisto liikkeelle hyvissä ajoin ennen Pin-anturin ~5–10 s liikkumattomuuskatkaisua.
- **Anturin nollaus (`🧭 Nollaa anturi`):** Paina painiketta täsmälleen kahdessa merkityssä välissä (sarjan `#2` jälkeen ja sarjan `#5` jälkeen), kun tanko ja anturi ovat paikoillaan. **Odota ~5–10 s sarjan päättymisestä, kunnes ruudulla näkyy `📡 Raakadata analysoitu`, ennen kuin painat `🧭 Nollaa anturi`**, jotta 80 Hz raakadatan lähetys ei katkea kesken. Näin näemme suoraan, vähentääkö välinollaus lattiaiskujen aiheuttamaa `drift`-ajautumaa raskaissa sarjoissa.

---

## 3. Treeniohjelma (8–9 sarjaa, yhteensä 19–24 toistoa)

| # | Paino × Toistot | % (170 kg) | Lepo | Odotettu `v1` | Tarkoitus kalibroinnissa & toimintaohje |
|---:|---|---:|---:|---:|---|
| **1** | **`100 kg × 3`** | 59 % | 2 min | `0,66–0,72 m/s` | Lämmittely + L–V-profiilin alapää (`≥ 95,2 kg` rajan yläpuolella). Terävä lähtö. |
| **2** | **`115 kg × 2`** | 68 % | 2 min | `0,56–0,60 m/s` | Lämmittelypiste 2 L–V-suoralle.<br>**→ Sarjan jälkeen: odota ~5–10 s (`📡 Raakadata analysoitu`), paina sitten `🧭 Nollaa anturi`.** |
| **3** | **`120 kg × 3`** | 71 % | 3 min | `0,55–0,59 m/s` | **Valmiusankkuri** (`readinessForDate` vertaa tuoretta `120–130 kg` / `65–83 % 1RM` dead-stop-sarjaa vs. `0,543` / `0,567`) + 1. perusvoima-sarja (`ownVelocityCost`). |
| **4** | **`130 kg × 3`** | 76 % | 3 min | `0,46–0,50 m/s` | **Tuore perusvoima-ankkuri** (vs. 24.11. `0,463–0,490`, `VL ≈ 12–20 %`) + 2. perusvoima-`ownVelocityCost`. |
| **5** | **`145 kg × 3`**<br>*(jos #4 `v1 < 0,44`: `142,5 kg × 3`)* | 85 % | 4 min | `0,34–0,39 m/s` | **Raskaan pään 1. `ownVelocityCost`-havainto** (käyttää sarjan omaa pudotusta; `±7,5 %`-ikkunassa `≤ 155 kg` -ykkösille ja tulevalle `computeDailyPlan`-suunnitelmalle). Tavoitealueen (`70–80 %`) ylitysilmoitus on odotettu. Kirjaa koettu RIR.<br>**→ Sarjan jälkeen: odota ~5–10 s (`📡 Raakadata analysoitu`), paina sitten `🧭 Nollaa anturi`.** |
| **6** | **`150 kg × 2–3`** *(Pääsarja)* | 88 % | 4–5 min | `0,28–0,33 m/s` | **Raskaan pään 2. `ownVelocityCost`-havainto + RIR/MVT-kalibrointi.** Aseta **Tavoitetoistot = `3`** (`Lopeta sarja automaattisesti VL-rajalla` POIS). Tee **2 toistoa** jos `v1 ≥ 0,27 m/s` ja **lopeta käsin `⏹ LOPETA SARJA`** (muuten Ohjattu tila pysäyttää heti 2. toiston jälkeen jos tavoite on `2`, koska `RIR < 3`); tee **3. toisto vain**, jos 2. toiston jälkeen jää aidosti **1–2 toistoa varastoon** puhtaalla tekniikalla. Tavoitealueen (`70–80 %`) ylitysilmoitus on odotettu. |
| **7** | **`155–160 kg × 1`** *(Valinnainen)* | 91–94 % | 4 min | `0,22–0,27 m/s` | Tee **VAIN**, jos `#6`:n `v1 ≥ 0,29 m/s` ja sarja `#6` tuntui vähintään **RIR 2**:lta (`155 kg` konservatiivinen; `160 kg` jos `150 kg` oli `≥ 0,31 m/s`). Jätä pois jos `#6` oli `RIR ≤ 1`. Kalibroi L–V-yläpään ja MVT-tason; `≤ 155 kg` saa `ownVelocityCost`-tuen (`145 + 150 kg`), mutta `160 kg` voi jäädä `142,5–145 kg`:n `±7,5 %`-ikkunan ulkopuolelle. Tavoitealueen (`70–80 %`) ylitysilmoitus on odotettu. |
| **8** | **`130 kg × 3`** | 76 % | 3 min | `0,43–0,47 m/s` | **Back-off-työsarja #1:** testaa `readinessForDate`-suodatuksen sekä kuormituksen jälkeisen `130 kg` VL-kustannuksen. |
| **9** | **`130 kg × 3` tai `130 kg × 4`** *(Valinnainen)* | 76 % | — | `0,42–0,46 m/s` | Aseta **Tavoitetoistot = `4`** (`Lopeta sarja automaattisesti VL-rajalla` POIS); jos jäät 3 toistoon, **lopeta käsin `⏹ LOPETA SARJA`** (muuten Ohjattu tila pysäyttää heti 3. toiston jälkeen jos tavoite on `3` ja `RIR < 3`). Tee **`× 3`** perusvoimavolyymin täydentämiseksi tai **`× 4`** jos `#8` meni `VL < 18 %` (selvä marginaali alle sovelluksen **`20 %` cutoff-rajan**) ja olo on raikas. Jätä väliin jos `#8` ylitti **`22 %` VL:n** (yli `20 %` cutoffin ja lähellä **`25 %` punaista `redVl`-rajaa**) tai alaselkä väsyy. |

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
1. Vie treenidata CSV:nä (**`Vie CSV`**) ja vie 80 Hz raakadata polusta **Analyysi → ⚙ Asetukset → `Vie raakadata CSV`**. Sovellus säilyttää muistissa **15 viimeisintä sarjaa**, joten koko 8–9 sarjan treeni mahtuu kerralla talteen (vie ennen sivun sulkemista tai päivitystä).
2. Avaa **Analyysi → ⚙ Asetukset → BLE-diagnostiikka** ja kopioi loki (`Kopioi loki`), jos yksikin toisto puuttui tai käyttäytyi oudosti.
3. Palauta CSV + raakadata-CSV + yllä oleva taulukko koettuine RIR-arvoineen seuraavaa kalibrointia varten.

---

## 5. Jälkianalyysiprotokolla (seuraavaa kierrosta varten)

Kun data on kerätty, vertaamme tuloksia tätä suunnitelmaa vasten:
1. **RIR & MVT -kalibrointi:** Verrataan koettua RIR:iä sovelluksen RIR:iin sarjoissa `#4`, `#5`, `#6` ja `#7`. Selvitetään, riittääkö raskaasta päästä (`145 + 150 kg`) opittu `ownVelocityCost`, vai pitääkö `LIFT_ANALYSIS.deadlift.mvt` (`0,155 m/s`), `repCost` (`0,050`), `lv`-taulukko tai `DEFAULT_REF_MAX.deadlift` (`170 kg`) kalibroida uudelleen.
2. **L–V-kulmakerroin ja e1RM:** Tarkistetaan `sessionProfile` (`r²`, pisteiden osuvuus `100–160 kg` välillä, lämmittelyjen intention vaikutus).
3. **Anturin ajautuma (`drift`) & välinollaus:** Verrataan `drift`-lippujen ja 80 Hz trace -erojen esiintyvyyttä ennen ja jälkeen `rezeroPin()`-nollausten (`#3` ja `#6`).
4. **Taukomittaus (`pauseMs`) & toistonkatoamissuojat:** Tarkistetaan, näkyikö `partial-accepted`-, `reconnect-resumed`- tai `trace-mismatch`-tapahtumia BLE-diagnostiikassa ja osuiko `pause_before_ms` dead-stop-haarukkaan (`~1500–2500 ms`).
