# Gpath Lite (`GPProbe`)

Kevyt ja luotettava sovellus **Gpath Pin** (`GPATH_Sensor`) -anturille. Sisältää sekä suoraan selaimessa (iPhone / Android / PC) toimivan **Web Bluetooth -sovelluksen** (`index.html`) että natiivin **SwiftUI iOS -lähdekoodin** (`ios/GpathLite/`).

## Käyttö iPhonella ilman Mac-tietokonetta (Web Bluetooth + Bluefy)

1. Lataa iPhonelle App Storesta ilmainen **Bluefy – Web BLE Browser** -selain.
2. Avaa Bluefy-selaimessa osoite:
   **`https://nalkamaa.github.io/GPProbe/`**
3. Varmista, että virallinen Gpath-sovellus on suljettu ja Gpath Pin on päällä.
4. Paina **Yhdistä** ja valitse listalta `GPATH_Sensor`.

## Ominaisuudet

- **Suora BLE-yhteys ja automaattinen kättely (`0x06` -> `0x86`)**: Pitää yhteyden vakaana ja näyttää akun varauksen (`%`).
- **Treenin esivalinnat**:
  - Päivämäärän valinta
  - Vapaasti muokattava liikelista (voit lisätä ja poistaa omia liikkeitä)
  - Kuorma (`kg`) ja tavoitetoistot (`Tavoite`)
- **Reaaliaikaiset mittarit**:
  - **Movement Power**: keskinopeus (`m/s`) ja teho (`W`), kalibroitu virallisen sovelluksen kaavalla
  - **VBT-liikenopeusalueet (Voiman osa-alueet)**: automaattinen liikekohtainen viitetaulukko ja reaaliaikainen luokittelu (**Maksimivoima**, **Voima-alue**, **Nopeusvoima – voimapainotteinen**, **Nopeusvoima – räjähtävä**) kun valittuna on **Jalkakyykky**, **Penkkipunnerrus**, **Sotilaspenkkipunnerrus** tai **Maastaveto**
  - **Controlled Lowering**: laskuvaiheen nopeus (`m/s`) värikoodattuna (`0.20–0.60 m/s` vihreä, `> 0.60 m/s` punainen)
  - **Range of Motion (ROM)**: toistojen keskimääräinen liikelaajuus (`cm`) ja toistokohtainen ROM
- **Äänimerkit (Web Audio API)**:
  - Nollaus valmis (sarja voi alkaa)
  - Toisto rekisteröity
  - Tavoitetoistomäärä saavutettu
  - Varoitusääni liian nopeasta laskusta (`> 0.60 m/s`)
- **Kalenteri & CSV-vienti**:
  - Kuukausikalenteri, jossa treenipäivät on merkitty vihreällä pisteellä
  - Päiväkohtainen yhteenveto ja sarjojen tarkastelu
  - Koko treenihistorian vienti `.csv`-tiedostoon (Excel / Google Sheets -yhteensopiva)

## Syvä VBT-analyysi (Analyysi-välilehti + live-sarja)

- **Velocity Loss (VL %) parhaasta toistosta** (`V_best`), ei 1. toistosta → PAP, telineestä otto ja maastavedon kuollut lähtö eivät vääristä tulosta. Telineestä otto / vajaa liikerata tunnistetaan "epäilyttäväksi" ja jätetään laskennan ulkopuolelle.
- **Harjoitustavoite → VL-katkaisuraja** (kyykky / penkki / maastaveto): Piikkaus 10/10/5 %, Kehittävä maksimivoima 15/15/10 % (oletus), Perusvoima 20/25/15 %. Äänimerkki ja valinnainen automaattinen sarjan lopetus rajalla.
- **MVT (failure-raja) ja RIR-arvio**: oletus 0,30 / 0,165 / 0,155 m/s, opitaan automaattisesti hitaimmasta suoritetusta toistosta tai asetetaan käsin. RIR = (V − MVT) / nopeuskustannus per toisto (sarjan oma kulmakerroin tai 0,06 / 0,05 / 0,05 m/s).
- **Laatupisteet 0–100**: laadukkaat toistot (50), intensiteetti tavoitteeseen (20), VL-hallinta (15), ROM-tasaisuus (10), hallittu lasku (5). Lämmittelysarjat (< 65 % 1RM) tunnistetaan.
- **Kuorma–nopeusprofiili ja VBT-e1RM** (lineaarinen regressio, R²), tavoitenopeudet ja -kuormat, e1RM-trendi, päivän valmius samalla kuormalla aiempiin sessioihin verrattuna.
- **Touch-and-go -tunnistus** maastavedossa (tauko < 0,8 s), **MV/MPV**-valinta.
- CSV-vientiin lisätty toisto- ja sarjakohtaiset VBT-sarakkeet (vanhat sarakkeet ennallaan).

### Gpath Pin -raakadata (80 Hz, `0xA4`)

Pin lähettää jokaisen sarjan jälkeen automaattisesti (~5–10 s viimeisen toiston jälkeen) 80 Hz aikasarjan. Sovellus kokoaa sen, kohdistaa toistoihin ja laskee:

- **Butterworth 4. aste, 8 Hz, nollavaiheinen** nopeuskäyrälle (tangon whip ja värinä pois).
- **Kuolokohta**: V₁ → V_min → V₂ -kuvio, korkeus pohjasta (cm), miniminopeus ja kesto. V_min < 0,10 m/s ⇒ RIR 0.
- **Tankoreitti (kokeellinen)**: gyro + kiihtyvyys -fuusio (Mahony), vaakakiihtyvyyden kaksoisintegrointi nousun yli nollanopeuskorjauksella. ΔX-rajat: kyykky 6 cm, maastaveto 3,5 cm; kaikissa liikkeissä vertailu sarjan parhaan toiston reittiin (> 3 cm ⇒ tekninen uupumus).
- **Kallistus**: tangon akselin kulman muutos nousun aikana, > 4° ⇒ epäsymmetriavaroitus.
- **RQI** = 0,40·intensiteetti + 0,40·väsymys + 0,20·tankoreitti (sarjatasolla väsymysosan määrää väsynein toisto).

Anturimalli (validoitu btsnoop-kaappauksista, fuusio toistaa firmwaren pystykiihtyvyyden r = 0,99): kiihtyvyys = sarakkeet 0, 1, 5 (2048 LSB/g), gyro = sarakkeet 2–4 (16,4 LSB/°/s). Tangon akseli tunnistetaan automaattisesti lepoasentojen painovoimasta tai asetetaan käsin (Analyysi → VBT-asetukset). Viimeisimmät 5 raakadatasarjaa voi viedä CSV:nä.

## Käänteismallinnettu BLE-protokolla

Täydellinen protokollakuvaus löytyy tiedostosta [`tools/PROTOCOL.md`](tools/PROTOCOL.md).


### Päivän suositus (Prilepin + VBT)

Kun päivän aikana on tehty **viitesarja ~65–82 % 1RM** (nousevan lämmittelyn raskain sarja ennen työsarjoja, maksimaalisella tahdolla), sovellus laskee:

1. **Päivän e1RM**: viitesarjan V_best ja oma kuorma–nopeuskulma aiemmista treeneistä (tai väestötaulukko), + päivän profiili jos ≥ 3 kuormaa (R² ≥ 0,9).
2. **Valmius**: päivän e1RM vs. 3 viimeisimmän treenin mediaani (42 pv). ≤ −5 % ⇒ intensiteetti −2,5 %-yks. ja volyymi Prilepinin alarajalle.
3. **Kuorma**: progressio edellisestä treenistä (onnistunut = työsarjat VL-rajan sisällä ja RQI ≥ 65 ⇒ +5 kg kyykky/mave, +2,5 kg penkki; liian väsyneet ⇒ −1 askel), rajattuna päivän tavoitealueeseen (esim. 80–90 % päivän e1RM:stä).
4. **Volyymi**: Prilepinin taulukko (70–80 %: 3–6 / 18; 80–90 %: 2–4 / 15; 90+ %: 1–2 / 7).
5. **Toistot/sarja** = min(Prilepin, ennuste VL-rajaan, RIR ≥ 2). Nopeuskustannus/toisto = (V₀ − MVT) / maksimitoistot (Epley-käänteis), keskiarvoistettuna omien sarjojen kanssa.
6. **Sarjojen välinen säätö**: jos työsarjan V_best on > 0,06 m/s alle ennusteen ⇒ −5 %; yli ennusteen ⇒ +1 askel.

Työsarjat eivät muuta päivän e1RM:ää, joten suositus pysyy vakaana harjoituksen ajan. "Käytä"-painike täyttää kuorman ja toistot.

### Jaksosuunnittelija (Analyysi-välilehti)

Blokkiperiodisaatio: **Kerääminen** (perusvoima 70–80 %) → **Muuntaminen** (maksimivoima 80–90 %) → **Realisointi** (piikkaus 85–95 %) → **Kevennys / testi**. Oletuspituudet 4 + 4 + 2 + 1 viikkoa, muokattavissa.

- Jakso valitsee tavoitteen automaattisesti (tavoitevalikko lukittuu) ja tallentaa jokaiseen sarjaan jakson, viikon ja aallon.
- Viikkoaalto: alaraja → optimi → yläraja → kevennys (Prilepinin vaihteluväli). Kevennysviikolla volyymi ~60 % alarajasta ja VL-raja −5 %-yks.
- Viikkovolyymi liikkeittäin (työsarjat, lämmittely pois) vs. edellinen viikko.
- Ehdotukset datasta: e1RM tasaantunut ≥ 2 vk → seuraava jakso; valmius ≤ −5 % kahdesti → kevennys etuajassa; viikkovolyymin hyppy > 30 %.
- Painikkeet: *Seuraava jakso nyt*, *Kevennys tälle viikolle* (siirtää loppua viikolla), *Lopeta jakso*.

### Vapaa treeni

Treeni-välilehden yläosan valinnalla. Pin kirjaa toistot normaalisti, mutta tavoitetoistoja, automaattista lopetusta, VL-hälytyksiä ja päivän suositusta ei käytetä. Sarja tallennetaan merkinnällä *vapaa*, ja se on analysoitavissa jälkikäteen kuten muutkin.

### Poistetut näkymät (korvattu uusilla)

Epley-1RM asetuksissa, liikkeen voiman osa-alue -laatikko ja -merkinnät, live-palkkikaavion väriselite, "1. → viimeinen" -pudotusbanneri sekä tallennetun sarjan palkkikaavio ja osa-alueanalyysi. Tilalla: päivän VBT-e1RM ja %1RM, toistokäyrä VL-raja- ja MVT-viivoineen, RQI ja raakadata-analyysi.