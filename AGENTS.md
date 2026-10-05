# AGENTS.md — Studio Converter Pro

Regole per chi lavora su questo progetto (assistente incluso).

## WORKFLOW DI LAVORO (dal 2026-09-29)

**Sviluppo locale, pubblicazione solo a lavoro finito.**

1. Le modifiche per la nuova versione si fanno **in locale**: si modifica,
   si testa (script in `F:\app Codici\opencode\`, screenshot, e2e), si corregge.
2. **NIENTE `git commit`, `git push` o deploy durante lo sviluppo**: se un
   test fallisce si corregge e si ritesta, sempre restando in locale.
3. **PRIMA del commit e del push va fatta verificare la cosa all'utente**:
   - far girare il tester (e2e/syntaxcheck/pixel) e mostrare i risultati;
   - presentare all'utente cosa è stato fatto e farlo verificare;
   - **aspettare la conferma esplicita dell'utente** ("va bene", "vai",
     "ok") PRIMA di `git commit` / `git push`.
   Niente commit/push "di sorpresa", anche se tutti i test sono verdi.
4. Solo dopo la conferma: commit → push → deploy → bump `build` →
   trigger notifica (checklist sotto).
5. Il sito live resta com'è finché non si pubblica: gli utenti vedono la
   versione precedente fino ad allora.

## REGOLA NOVITÀ HOME (obbligatoria)

**La sezione 📢 Novità nella home deve comparire SIA sul sito web SIA
nell'APK**: `news-section`/`news-list` sempre presente e popolata. A ogni
rilascio aggiornare `CURRENT_VERSION` + una nuova entry `NEWS` (in testa)
**sia in `index.html` del sito sia in `C:\My project\studiopro\www\index.html`**,
con la **stessa versione in entrambi** (se nell'app `CURRENT_VERSION` resta
vecchia, la home mostra novità obsolete e l'utente pensa che manchino).

## REGOLA DEPLOY COMBINATO (dal 6.0.0)

**Ogni deploy/rilascio vale SEMPRE sia per il sito web che per l'APK**:
stessa versione in `version.json` (`version` **e** `apk_version`) e in
`config.xml` (version + versionCode). Ciclo completo nell'ordine:
bump `config.xml` → `cordova build android --release` → upload APK sul
release tag `apk` **PRIMA** del push → `version.json` (entrambe le versioni
+ build +1 + changes) → commit → push → deploy → notify.
Niente rilasci del sito con un numero diverso dall'APK: l'utente riceve la
notifica, controlla l'app e non trova l'aggiornamento (si pensa a un bug).
Eccezione consentita: fix solo sito → `apk_version` invariato e title della
push automaticamente "novità" (gestito da `functions/notify.js`, chiave KV
`notify_apk`).

## REGOLA NOTIFICHE (obbligatoria)

**Ogni modifica visibile all'utente (sito o app) deve essere notificata con una push.**
"Visibile all'utente" = index.html, style.css, funzionalità, correzioni, versioni.
Non lo è = documenti interni come questo file.

Checklist da eseguire SEMPRE, nell'ordine:

1. `version.json` → aumentare `"build"` di 1 e aggiornare `"changes"`
   (è il testo che gli utente leggeranno nella notifica).
2. Se è una nuova versione → aggiornare `version` e la voce NEWS in `index.html`;
   `apk_version` solo se c'è un nuovo APK da rilasciare (altrimenti in app
   compare il modal di aggiornamento verso un APK inesistente).
3. `git add` + `git commit` + `git push origin main`.
4. Deploy: `npx wrangler@latest pages deploy . --project-name studioconverterpro --commit-dirty=true`
5. Trigger notifica: `POST https://studioconverterpro.pages.dev/notify`
   con body `{"check":true}` (nessun secret) → deve rispondere `"sent":true`.
   `"sent":false` significa che `build` non è cambiato → tornare al punto 1.
6. Controllo: una seconda chiamata deve dare `"sent":false` (antiduplicati OK).

**Il rilascio NON è completo finché il punto 5 non risponde `sent:true`.**
Non passare ad altro (né riepilogo all'utente, né "lavoro finito") prima
di aver eseguito tutti i punti 1-6: deploy e notifica sono obbligatori
anche per un piccolo fix.

Stato attuale della notifica in KV (`notify_state`): deve coincidere con
`version#build` di `version.json`.

## REGOLA POPUP (solo app, mai sito)

I popup `update-popup`, `notif-popup` e `whatsnew-popup` devono apparire
**solo nell'APK** (`inApp()` = `true`), **MAI sul sito web**:

- `checkForUpdates()`: nel ramo sito (`!isApp`) `show` deve restare
  `false` — nessun "Nuova versione disponibile" nel browser (il sito si
  aggiorna da solo via service worker).
- Sul sito, check manuale diverso → solo toast `toast.updNewSite`
  ("C'è un aggiornamento del sito"), mai il popup.
- Test di regressione obbligatorio prima di rilasciare un fix del genere:
  copia del sito + `version.json` finto diverso (es. 5.2.9) serviti con
  `testsrv.js`, poi Chrome `--dump-dom --virtual-time-budget=14000` →
  i tre `id="*-popup"` devono restare `style="display:none; ..."`.

## LIMITI DELLE NOTIFICHE

- Arrivano solo ai dispositivi con l'APK installato dal sito, sottoscritti al
  tema FCM `aggiornamenti`.
- Se l'APP È APERTA in primo piano, Android non mostra il banner di sistema:
  il contenuto va mostrato in-app da `onMessage` (vedi index.html, callback
  `fm.onMessage`). Se non lo si mostra, la notifica risulta "persa".

## REGOLE TECNICHE

- Lingua con l'utente: **italiano**; tono semplice e rilassato.
- **Mai stampare** secret: NOTIFY_SECRET, keystore, token GitHub/Wrangler,
  credenziali Firebase. Il secret notifiche è nei secret di Cloudflare Pages.
- Versione APK (`config.xml`): `versionCode = major*10000 + minor*100 + patch`
  (es. 5.2.5 → 50205). Deve salire a ogni rilascio APK.
- Rilascio APK: `cordova build android --release` in `C:\My project\studiopro`,
  poi caricare l'APK sul release GitHub tag `apk` **PRIMA** di fare push del
  sito con una nuova `apk_version` (altrimenti il link di aggiornamento è rotto).
- Keystore: `F:\app Codici\keystore-android\studio-converter-pro.p12` (alias `android`).
- Sincronizzazione `C:\My project\studiopro\www\` dopo ogni modifica al sito:
  `index.html`, `style.css`, `favicon.svg`, `icon-192.png`, `icon-512.png`,
  `manifest.json`, `privacy*.html` **e tutta la cartella `vendor/`**.
  Non copiare `sw.js`/`version.json` (solo sito).
  **Sync SELETTIVO**: dal 6.0.0 `index.html`/`style.css` del sito e di `www/`
  divergono deliberatamente (www = nav glass, doppia modalità home/studio,
  icone SVG nav; sito = nav classica con la sola lente). NON sovrascrivere
  `www/` con i file del sito: applicare solo i fix mirati (es. gate
  `applyUiGate`, bottone Desktop "coming soon", chiavi i18n).
- App **autonoma dal sito** (dal 5.2.7): `config.xml` ha
  `content src="index.html?app=cordova"` (contenuto locale incluso nell'APK).
  Controllo aggiornamenti in app: `https://raw.githubusercontent.com/pnx9-lab/studio-converter-pro/main/version.json`
  (vedi `UPDATE_URL_GH` in index.html); non usare l'URL del sito.
- ffmpeg.wasm usa il core **single-thread** (`vendor/ffmpeg-core.js/.wasm`,
  niente SharedArrayBuffer → nessun header COOP/COEP). `vendor/ffmpeg.min.js`
  è patchato a mano: `noExitRuntime:!0` nel config del core (senza, ogni secondo
  `ff.run()` muore con "Program terminated with exit(0)"). Se si riescarica il
  loader da npm, **riapplicare il patch** (stringa `r({mainScriptUrlOrBlob:n,`).
- Test end-to-end del sito: script in `F:\app Codici\opencode\`
  (`mkexttest.js`, `testsrv.js`, `rune2e.ps1`, `syntaxcheck.js`);
  Chrome headless con `--no-proxy-server` (altrimenti dà ERR_CONNECTION_REFUSED).
  `rune2e.ps1 -Upd` simula il popup di aggiornamento in app (`?app=cordova`,
  versione stub 5.2.4), `-Fmt flac|m4a|ogg|aac|webm -Src <file>` testa ffmpeg.
- **Screenshot store**: uno per volta con `shotone.ps1 -Name <n> -Qs <qs> -Port <p>`
  dopo `Stop-Process chrome,node` + cancellazione `shot-*.png`. Usare **sempre**
  l'early-exit `&shot=settings` (Impostazioni) oppure `&shot=home` (home):
  senza `shot=` parte il branch ui completo che cicla i temi e lo screenshot
  cattura uno stato transitorio. Lingua con `&lang=it`.
- **Il tool di lettura immagini a volte serve un'immagine CACHEATA diversa
  dal file richiesto** (falsi positivi/negativi): NON guardare il PNG per
  verificarlo. Verifica oggettiva con `chkshot.ps1` (pixel .NET: sfondo nero/
  chiaro/viola = tema) + dimensione file (famiglie: settings-default ~183k,
  settings-light ~137k, settings-dark ~75k, home-default ~214k, home-light
  ~162k, home-dark ~108k) + `postLang/postTab/postTheme` nel log
  `srv-<nome>.log` della run.
- `curl` sul sito: `studioconverterpro.pages.dev/index.html` risponde
  **308 redirect** → usare SEMPRE `curl -sL`, altrimenti il corpo è vuoto
  e i `Contains()` danno tutti `False` (falsi allarmi "non aggiornato").
- Netlify è stato rimosso del tutto: hosting solo Cloudflare Pages
  (progetto `studioconverterpro`, KV `CREDS` id `eb2a5f8b03cf47a58464e4b7b040ac81`).
