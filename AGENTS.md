# AGENTS.md — Studio Converter Pro

Regole per chi lavora su questo progetto (assistente incluso).

## WORKFLOW DI LAVORO (dal 2026-09-29)

**Sviluppo locale, pubblicazione solo a lavoro finito.**

1. Le modifiche per la nuova versione si fanno **in locale**: si modifica,
   si testa (script in `%TEMP%\opencode\`, screenshot, e2e), si corregge.
2. **NIENTE `git commit`, `git push` o deploy durante lo sviluppo**: se un
   test fallisce si corregge e si ritesta, sempre restando in locale.
3. Si pubblica **solo quando tutto è verificato e perfetto**:
   commit → push → deploy → bump `build` → trigger notifica (checklist sotto).
4. Il sito live resta com'è finché non si pubblica: gli utenti vedono la
   versione precedente fino ad allora.

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

Stato attuale della notifica in KV (`notify_state`): deve coincidere con
`version#build` di `version.json`.

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
- Keystore: `F:\app Codici\keystore-android\studio-converter-pro.p12` (alias `android`).
- Dopo ogni modifica a `index.html`/`style.css` copiarli anche in
  `C:\My project\studiopro\www\` (contenuto dell'app Cordova).
- Test end-to-end del sito: script in `%TEMP%\opencode\`
  (`mkexttest.js`, `testsrv.js`, `rune2e.ps1`, `syntaxcheck.js`);
  Chrome headless con `--no-proxy-server` (altrimenti dà ERR_CONNECTION_REFUSED).
- Netlify è stato rimosso del tutto: hosting solo Cloudflare Pages
  (progetto `studioconverterpro`, KV `CREDS` id `eb2a5f8b03cf47a58464e4b7b040ac81`).
