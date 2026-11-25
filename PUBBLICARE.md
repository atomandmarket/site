# The Atom & The Market — come funziona il sito

## Struttura

| Cartella / file | Cosa contiene |
|---|---|
| `content/site.yml` | Tutti i testi fissi: descrizione, About, biografia, principi, contatti, form beehiiv |
| `content/technologies/` | Gli articoli pubblicati, un file `.md` per articolo |
| `content/drafts/` | Le bozze: si vedono solo in anteprima e non vengono mai caricate online |
| `content/technologies/_template.md` | Il modello da copiare per un nuovo articolo |
| `static/` | Logo, foto, foglio di stile |
| `build.mjs` | Lo script che genera il sito |
| `dist/` | Il sito generato (si ricrea ogni volta, non va toccato) |
| `newsletter/` | Per ogni articolo: versione da incollare in beehiiv e testo per LinkedIn |

## Flusso per ogni articolo

1. Scegli e leggi il paper, poi lo discuti con Claude (pro e contro).
2. Scrivete insieme il commento. Claude lo salva in `content/drafts/AAAA-MM-GG-nome-breve.md`.
3. **Anteprima:** `npm run preview` (da questa cartella), poi apri l'anteprima del browser.
4. Quando è pronto, il file passa in `content/technologies/`.
5. **Pubblicazione:** commit e push su GitHub. Il sito si aggiorna da solo in 1–2 minuti.
6. **Newsletter:** apri `newsletter/<nome>.html` nel browser, copia tutto sotto la linea tratteggiata e incollalo in un nuovo post beehiiv, impostato come *email only*.
7. **LinkedIn:** il testo pronto è in `newsletter/<nome>-linkedin.txt`. Il link all'articolo va nel primo commento.

Se un articolo ha un errore (un voto mancante, una data sbagliata…), la generazione si ferma e spiega cosa correggere. Non va online niente.

## Configurazione una tantum (messa online)

### 1. GitHub
1. Crea un account gratuito su github.com.
2. Crea un repository, per esempio `atomandmarket-site`. Su piano gratuito GitHub Pages richiede un repository **pubblico**: il codice e gli articoli pubblicati sono comunque già pubblici sul sito. Le bozze restano in `content/drafts/`, che non viene mai caricata.
3. Claude carica i file e fa il primo push.
4. Nel repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### 2. Dominio (pannello Aruba → DNS)
Si aggiungono record, la posta resta com'è.

| Tipo | Nome | Valore |
|---|---|---|
| A | @ (atomandmarket.com) | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | `<tuo-utente-github>.github.io` |

Eventuali record A già presenti per `@` (pagina di cortesia Aruba) vanno tolti. **I record MX della posta non si toccano.**

Poi su GitHub: **Settings → Pages → Custom domain: atomandmarket.com**, attendi la verifica e attiva **Enforce HTTPS**.

### 3. beehiiv
1. In beehiiv: **Audience → Subscribe forms**. Crea un form con questi colori: sfondo `#030303`, testo `#efe8da`, pulsante `#c94d1c`.
2. Copia il codice "embed" e incollalo in `content/site.yml` alla voce `beehiiv.embed`.
3. Rendi privata o nascondi la pagina beehiiv, così resta un solo sito.
