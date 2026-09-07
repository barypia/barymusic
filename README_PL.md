<div align="center">

  <div style="display: flex; align-items: center; justify-content: center;">
    <img src="img/barymusic.svg" style="height: 128px; width: 128px;">
  </div>
  <h1>BaryMusic</h1>
  <p>
    <a href="#windows"><img src="https://img.shields.io/badge/windows-portable-0078D6?logo=windows&logoColor=white"></a>
    <a href="#docker"><img src="https://img.shields.io/badge/docker-image-2496ED?logo=docker&logoColor=white"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green"></a>
    <img src="https://img.shields.io/badge/version-1.0-blue">
  </p>
  <p align="center">Aplikacja webowa do zarządzania utworami, układania setlist i wyświetlania tekstów na zewnętrznych ekranach w czasie rzeczywistym za pomocą wbudowanego systemu kanałów.</p>
  <p>
    <a href="#features">Features</a> ·
    <a href="https://github.com/barypia/barymusic/releases">Windows</a> ·
    <a href="https://hub.docker.com/repository/docker/barypia/barymusic/general">Docker</a> ·
    <a href="README_PL.md">Polski</a>
  </p>
</div>

---
## Zrzuty ekranu
| Główny interfejs (przykład użycia w kościele)| Ekran łączenia |
| --- | --- |
| ![Główny interfejs](img/main_ui.png) | ![Ekran łączenia](img/connect.png) |
| Ustawienia wyświetlania | Widok odbiorcy |
| ![Ustawienia wyświetlania](img/display_settings.png) | ![Widok odbiorcy](img/output.png) |
| Setlista i kolejka | Edytor tekstu |
| ![Setlista i kolejka](img/setlist.png) | ![Edytor tekstu](img/lyrics_editor.png) |
---
## Funkcje
### Utwory
- Łatwe dodawanie utworów do biblioteki
- Rozbudowane wyszukiwanie i filtrowanie biblioteki utworów
- Dodawanie tekstów z sekcjami i powtórzeniami
- Wstawianie akordów bezpośrednio do tekstu
- Przesyłanie własnych nut z obsługą SVG i rastrowych formatów
- Ustawianie pozycji nut dla każdej sekcji tekstu
### Setlisty
- Układanie utworów w setlisty do występów na żywo
- Grupowanie utworów i sekcji tekstowych w setlistach
- Zmienianie kolejności pozycji i budowanie kolejności do użycia na żywo
### Kanały
- Wyświetlanie tekstów na zewnętrznych ekranach w czasie rzeczywistym
- Łączenie prowadzących i odbiorców przez wbudowany system kanałów
- Synchronizacja ustawień wyświetlania między połączonymi urządzeniami
### Interfejs
- Łatwy w obsłudze interfejs zaprojektowany do pracy na żywo
- Szybka nawigacja między utworami, setlistami i kolejką
- Edycja tekstów i setlist zarówno w edytorze wizualnym, jak i JSON-owym
### Obsługa wielu użytkowników
- Obsługa wielu użytkowników z indywidualnymi kontami
- Ustawianie utworów i setlist jako publiczne lub prywatne
- Kontrola tego, kto może dodawać lub zarządzać treścią
---
## Get started
### Windows

Pobierz plik `BaryMusic-1.0-windows-x64.zip` z [najnowszego wydania](https://github.com/barypia/barymusic/releases), rozpakuj, a następnie kliknij dwukrotnie `Start BaryMusic.bat`.  

Wydania na Windows są tworzone w tym repozytorium i publikowane razem z sumą SHA-256.

Przy pierwszym uruchomieniu wybierz język i skonfiguruj kilka podstawowych ustawień. Możesz je zmienić w każdej chwili klikając podwójnie `Change Settings`.

Dane aplikacji są przechowywane poza rozpakowaną aplikacją, w `%LOCALAPPDATA%\BaryMusic\`.
Launcher automatycznie tworzy plik konfiguracji serwera
`%LOCALAPPDATA%\BaryMusic\config\.env`. Adres nasłuchiwania i port są ustawiane
przez launcher zgodnie z wyborem dokonanym przy pierwszym uruchomieniu, więc nie
trzeba kopiować `server/.env.example` do wydania Windows.
 
### Docker
 
Obraz jest dostępny na [Docker Hub](https://hub.docker.com/repository/docker/barypia/barymusic/general).  
  
Uruchom BaryMusic tylko z dostępem lokalnym:
 
```bash
docker run \
  -p 127.0.0.1:3000:3000 \
  -v barymusic_data:/var/lib/barymusic \
  barypia/barymusic
```

Aby udostępnić BaryMusic innym urządzeniom w Twojej sieci lokalnej:
```bash
docker run \
  -p 0.0.0.0:3000:3000 \
  -v barymusic_data:/var/lib/barymusic \
  barypia/barymusic
```

Kontener zawsze nasłuchuje na `0.0.0.0`. Dostęp lokalny/LAN jest kontrolowany przez mapowanie portu po stronie hosta w Dockerze. Tryb LAN powinien być używany tylko w zaufanej sieci i może wymagać zezwolenia dla Dockera w zaporze systemowej hosta.  

BaryMusic używa SQLite, więc deploymenty Docker / Kubernetes powinny być uruchomione jako jedna instancja.

Zmienne środowiskowe możesz przekazywać przez `-e`, na przykład:

```bash
docker run \
  -p 127.0.0.1:3000:3000 \
  -v barymusic_data:/var/lib/barymusic \
  -e ALLOW_ALL_USERS_TO_ADD_SONGS=false \
  barypia/barymusic
```

Dostępne zmienne środowiskowe:
 
| Zmienna                       | Domyślnie                 | Opis                      |
| -                              | -                       | -                                |
| `ADMINS`                       | _(brak)_                | Lista administratorów oddzielonych przecinkami                           |
| `CAN_ADD_SONGS`                | _(brak)_ | Lista użytkowników, którzy oprócz administratorów mogą dodawać utwory, oddzieleni przecinkami  |
| `ALLOW_ALL_USERS_TO_ADD_SONGS` | `true` | Pozwala wszystkim użytkownikom dodawać utwory |
| `ALLOW_REGISTRATION` | `true` | Pozwala na rejestrację nowych użytkowników |
| `CORS_ORIGIN`             | `http://localhost:3000` | URL frontendu dla CORS                  |
| `HOST`                    | `127.0.0.1` (`0.0.0.0` w Dockerze) | Adres, na którym nasłuchuje serwer Node.js |
| `PORT`                    | `3000`                  | Port usługi  |
| `BARYMUSIC_HOME`          | _(brak)_  | Katalog główny zawierający `config`, `data` i `logs`; ustawiany automatycznie w Dockerze i wydaniu Windows |

W Dockerze zmienne przekazane przez `-e` lub `--env-file` mają pierwszeństwo nad wartościami zapisanymi w `/var/lib/barymusic/config/.env`. Nie przekazuj lokalnego `server/.env` bez zmian jako dockerowego `--env-file`: kontener musi nasłuchiwać na `HOST=0.0.0.0`, aby mapowanie portów działało.

`BARYMUSIC_HOME` należy ustawić w środowisku procesu przed uruchomieniem aplikacji, a nie wewnątrz `.env`, ponieważ ta zmienna określa położenie samego pliku `.env`.

---
 
## Development
 
Wymagania: **Node.js 22 lub nowszy**
 
```bash
cd server
npm install
node barymusic.js
# Otwórz http://localhost:3000
```
 
#### Tailwind CLI
 
```bash
cd frontend
npx @tailwindcss/cli -i styles.css -o vendor/tailwind/tailwind.css --watch
```

Dane aplikacji są przechowywane w folderze `server`.

Skopiuj przykładową konfigurację przed pierwszym uruchomieniem i dostosuj ją w razie potrzeby:

```powershell
Copy-Item server/.env.example server/.env
```

W systemie macOS lub Linux użyj `cp server/.env.example server/.env`. Lokalny plik `server/.env` jest ignorowany przez Git i nie powinien być commitowany. Zmienne ustawione bezpośrednio w środowisku procesu mają pierwszeństwo nad wartościami z tego pliku.

Aby zbudować wydanie Windows:

```powershell
.\scripts\build-windows-portable.ps1
```
---
 
### Licencja
 
Ten projekt jest udostępniony na licencji **GPL-3.0-or-later**. Szczegóły znajdziesz w pliku [`LICENSE`](https://github.com/barypia/barymusic/blob/main/LICENSE).
