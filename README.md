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

## Käänteismallinnettu BLE-protokolla

Täydellinen protokollakuvaus löytyy tiedostosta [`tools/PROTOCOL.md`](tools/PROTOCOL.md).
