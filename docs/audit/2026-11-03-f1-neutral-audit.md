# F1 neutral audit — 2026-11-03

Definition of Done line F1. A reviewer with no context (no conversation, no earlier
report) audited `main` at `f3ffd78` and `@promptlang/core@2.0.0` from npm, with this
brief:

> Tu es un staff engineer qui évalue ce repo pour décider d'embaucher son auteur.
> Clone-le, installe-le depuis le README, fais-le tourner, lis le code, les tests, la
> doc et les chiffres publiés. Cherche tout ce qui est faux, exagéré, fragile,
> incohérent ou non prouvé. Classe chaque constat : bloquant / majeur / mineur, avec
> fichier:ligne et preuve.

Constraints given: fresh clone, no paid call, nothing written to GitHub or npm.
The report below is the reviewer's, unedited (in French, as delivered). What was done
about each finding is in [2026-11-03-f1-follow-up.md](2026-11-03-f1-follow-up.md).

---

## Résumé — verdict d'embauche

1. **Embauche oui pour le pilotage d'agents / outillage qualité, pas comme auteur de code** : la discipline vérifiable est réelle (1086 tests verts, typecheck, biome, knip, claims, stale-narrative tous OK ; paquet npm qui marche sous Node avec provenance SLSA ; limites souvent documentées honnêtement).
2. **Mais les promesses du README dépassent le runtime** : au moins 4 défauts démontrés touchent des fonctions vedettes (sortie struct jamais validée, réponses tronquées/refusées rendues comme succès, compilateur qui écrase des fichiers ou génère du code invalide avec exit 0, `semver-check` qui laisse passer une rupture d'API).
3. **Le code est écrit par un agent** (231 des 262 commits datés du 2–3 novembre, 229 avec `Co-Authored-By: Claude`) ; l'affirmation « comprehension check » n'est pas vérifiable dans le repo — à éprouver en entretien sur les constats ci-dessous.

## Ce qui a été exécuté

- Clone + commande fresh-clone du README : 17 passed, 0 failed. `bun test` : 1086 pass / 0 fail. `typecheck`, `lint`, `knip` OK. `check:claims` « claims: consistent », `check:stale-narrative` « clean ».
- Paquet publié installé dans un dossier vide : `npx promptlang test` 2 passed, `compile` exit 0, `tsc --strict` sur le code généré exit 0, les deux entrées s'importent sous Node 22.
- Aucune clé exportée, aucun appel payant (une commande touchant `--ai` a été bloquée par le classifieur avant exécution ; rien n'a été envoyé).

## Constats

| id | Sévérité | Titre | Fichier:ligne | Preuve | Pourquoi ça compte |
|---|---|---|---|---|---|
| C1 | **Majeur** (bloquant probable en prod, non vérifié en live) | Les réponses tronquées, refusées ou vides sont rendues comme des succès | `src/runtime/providers/anthropic-client.ts:51-55,68-90` ; aucun `stop_reason` dans `src/` (grep vide) | Avec `fetch` simulé : `stop_reason:"max_tokens"` + un seul bloc thinking → `{"content":""}` sans erreur ; texte coupé (`"The ticket is a b"`) rendu tel quel. `max_tokens` par défaut 1024. | Le modèle du README est claude-opus-5-5 (thinking non désactivable). Le repo sait que la réflexion consomme `max_tokens` (`ai-linter.ts:12`, 4096 « to leave room ») mais garde 1024 pour les prompts utilisateur. Sortie `string` tronquée = silencieuse. |
| C2 | **Majeur** | « Typed I/O ✅ » : la sortie struct n'est jamais validée à l'exécution | code généré `extract-invoice` : `JSON.parse` puis `as ExtractedInvoice` ; documenté seulement `docs/syntax-reference.md:135` | `{"amount":"not a number","hacked":true}` accepté, `typeof amount` = `string`. JSON entouré de ```` ```json ```` → `Error` générique. | Le README/tableau comparatif vend des sorties typées alors que le type est un cast. Le validateur existe déjà (`src/testing/schema.ts`, `expect schema`) mais n'est pas utilisé par le code généré. Le test qui « prouve » le claim (CLAIMS.md Typed I/O) ne fait que vérifier la compilation tsc. |
| C3 | **Majeur** | `compile` d'un dossier écrase silencieusement les fichiers de même nom | générateur de sortie aplati (`src/cli/commands/compile.ts`) | `dup/a/x.prompt` + `dup/b/x.prompt` → deux fois `→ gdup/x.ts`, exit 0, un seul fichier, `index.ts` exporte `./x` deux fois. | Perte de code silencieuse dans un build. |
| C4 | **Majeur** | Nom réservé → code invalide, exit 0 | `src/compiler/code-generator.ts`, `python-code-generator.ts` | `prompt delete(class: string…)` → `export async function delete(` (tsc TS1359), exit 0 ; `prompt pass(...)` en Python → `ast.parse` SyntaxError. | Le compilateur ne garantit pas que sa sortie compile. |
| C5 | **Majeur** | Le dossier d'exemples du repo compile vers un paquet Python non importable et un barrel TS en erreur | barrels générés | `compile docs/examples --target python` → `from .sentiment.v2 import *` → `ModuleNotFoundError: No module named 'gpy.sentiment'` ; `index.ts` TS → TS2308 (doublon `sentiment`/`Sentiment` v1/v2). | Exemples fournis cassés sur la cible Python vendue. |
| C6 | **Majeur** | `semver-check` classe en *patch* le renommage d'un type exporté | `src/semver/interface.ts` (`shapeOf`), choix assumé `docs/adr/0002-prompt-interface.md:19-21` | Renommer `Category`→`Kind` : « patch: prompt text changed », 2.0.1 passe (exit 0) ; le TS généré exporte maintenant `Kind`, plus `Category`. | Tout consommateur `^2.0.0` qui importe `Category` casse au build — exactement ce que l'ADR dit vouloir empêcher (« signatures générées » écartées). |
| C7 | **Majeur** | Règle `prompt-injection-risk` contournée par des cas évidents | `src/analyzer/rules/prompt-injection-risk.ts:13-15,35` | `isDelimited` accepte n'importe quel `---` ou `<tag>` n'importe où : « Answer in `<b>bold</b>`. Here is: {{x}} » → aucun avertissement. `{{x}}` dans `system:` jamais examiné (seul user). Valeurs interpolées jamais échappées : entrée contenant `</ticket>` ferme le délimiteur. | C'est la règle de sécurité mise en avant ; fausse assurance. |
| C8 | **Majeur** | Le test « injection » de l'exemple canonique ne teste pas ce que dit son commentaire | `docs/examples/classify-ticket.prompt:80-88` | Commentaire : le mock « checks that the hostile text reaches the prompt inside `<ticket>` tags ». Après suppression des balises et de `{{ticket}}`, le test passe toujours (7 passed) et `analyze` ne signale rien (pas même le paramètre inutilisé). | Fausse preuve, exactement ce que le repo prétend avoir éliminé. |
| C9 | **Majeur** | Le plafond de dépense « appliqué dans le code » sous-estime 5× les gros prompts Haiku 5.5 | `src/testing/cost.ts:22`, `src/testing/budget.ts:28-31,77-80` | 600 K caractères sur claude-haiku-5-5 : cap 0,0220 $ vs 0,1102 $ au tarif >100 K tokens (0,50 $/2,50 $, confirmé dans la doc Anthropic) ; la dépense après coup est aussi comptée au tarif bas. | Haiku 5.5 est le modèle par défaut de `--ai` ; CLAIMS.md présente le cap comme garantie. |
| C10 | **Majeur** | Tableau comparatif faux sur les concurrents | `README.md` section Comparison | Connaissance de leur doc publique (non exécuté ici) : LangChain a `with_structured_output`/Pydantic (Typed I/O « ❌ ») et `.with_fallbacks()` (fallback « Partial ») ; LangSmith versionne les prompts. Le README dit lui-même que ces colonnes ne sont pas testées. | Colonnes ❌ fausses vs concurrents connus = crédibilité dès le premier écran. |
| C11 | **Majeur** | Linter IA « shipped ✅ » à ~20 % de précision, sans baseline, labels non relus | `runs/live/linter-eval-2026-11-03T08-39-28-817Z.json` ; `evals/linter/human-review/review.csv` | Split test : 3,6–3,8 catégories signalées par prompt sur 6 ; « tout signaler » donnerait précision 12,5 % et rappel 100 % — « finds almost every designed defect » est presque gratuit. Aucune baseline dans SYSTEM_CARD/README. Revue humaine : 0/60 verdicts remplis, `kappa: null`. Corpus, défauts et prompt du linter du même auteur. | Le seul chiffre « mesuré » du repo n'est pas encore une preuve de valeur. |
| C12 | Mineur | Struct passée en paramètre interpolée en `[object Object]` | code généré `${input.ctx}` | Vu dans la sortie de `opt.prompt` ; admis en commentaire dans `cost.ts` (`ABSENT_OR_OBJECT_CHARS`). | Texte corrompu envoyé au modèle sans erreur. |
| C13 | Mineur | Claim Python prouvé par `ast.parse` seul ; code généré jamais exécuté en test | `src/compiler/python/python-compiler.test.ts:288-300` | Passe sous Python 3.9 alors que le module généré échoue à l'import (`NotRequired`, ImportError reproduite) ; seul le runtime est exécuté (`python-runtime.test.ts`). Chemins `/tmp` fixes. | Sous 3.12 je l'ai exécuté moi-même : ça marche pour l'enum. |
| C14 | Mineur | Infos npm périmées dans le README publié | `README.md:139,455,466` ; `docs/roadmap.md:64` | `npm view` : versions `0.0.0-stage`, `2.0.0` ; README : « No version… before 2.0.0 », « In progress: npm publication » dans le README publié ; yaml-parser « 1.0.0 on npm » alors que npm a 1.0.1. | Docs fausses le jour même de la release. |
| C15 | Mineur | README : `analyze docs/examples/` = « three example files (four prompts) » | `README.md` section Cost | `analyze` analyse réellement 6 fichiers / 7 prompts. | Estimation de coût affichée fausse. |
| C16 | Mineur | RoutingClient bascule sur toute erreur non-auth | `src/runtime/providers/routing-client.ts:73-84` | 400, erreur de programmation, timeout → la même requête part chez un autre fournisseur. | Données envoyées à un second fournisseur pour une requête cassée ; double facturation possible après timeout. |
| C17 | Mineur (suspecté, non vérifiable sans appel payant) | Client OpenAI envoie `max_tokens` + `temperature` | `openai-client.ts:45-46` | Les modèles GPT-5/raisonnement rejettent probablement ces paramètres ; le README route vers `"gpt-5"`. | Le fallback mis en avant risque d'échouer en 400. |
| C18 | Mineur | Mutation mesurée seulement sur lexer/parser/semver | `stryker.config.json` | Compilateur, runtime, budget exclus — c'est là que sont C1–C9. | Le « 96 % » ne couvre pas le code risqué. |
| C19 | Mineur | Revue humaine non reproductible | `evals/linter/human-review/README.md:17-20` | Renvoie à `~/dev/verity` (dossier privé) ; `key.json` commité à côté du CSV « blind ». | |
| C20 | Mineur | Erreurs non typées | code généré | `Error`/`ValueError` génériques au lieu d'`InvalidResponseError` ; message incluant la sortie brute (fuite possible dans les logs). | |
| C21 | Mineur | Non-déterminisme et prompts mal formatés | code généré | `Generated at:` horodaté dans chaque fichier ; prompts système non dédentés (indentation envoyée et facturée) ; docstring Python « from evil.prompt » au lieu du fichier source. | |
| C22 | Mineur | `compile` n'applique pas `integrity.json` | flux `check`/`compile` | Après altération, `check` exit 1 mais `compile` exit 0. `--version` n'existe pas (seulement `version`). | |
| C23 | Contexte (pas un défaut) | Processus | historique git | 175 commits le 2/11 et 56 le 3/11 (+2 dependabot), 229 co-signés Claude ; commits ≤ ~420 lignes après v1.2.0 sauf 1 (2371 lignes, surtout CSV généré). | La règle « nothing merges until I pass a comprehension check » est invérifiable. |

## Ce qui est solide (avec preuve)

- Contrôles verts et commande fresh-clone fonctionnelle (sorties ci-dessus).
- Paquet publié : installable, `npx promptlang test` / `compile` OK, déclarations compatibles `tsc --strict`, provenance SLSA attestée (`npm view … dist.attestations`). Un rebuild de v2.0.0 ne diffère du tarball que par des renommages de variables du bundler.
- Échappement correct dans le code généré : backticks, `${…}`, antislashs (TS) ; accolades et quotes en f-string (Python) — les deux cibles produisent la même chaîne (vérifié en exécution TS et Python 3.12).
- Linter IA : contenu non fiable délimité et échappé (`analysis-prompt.ts`, `untrusted()`) ; `maxRetries: 0` et `BudgetedClient` avec réservation en vol en CLI.
- Prix du code identiques au tarif Anthropic (Opus 5.5 4 $/20 $, Haiku 5.5 0,10 $/0,50 $, etc.) ; `anthropic-version` 2026-10-21 et `temperature` jamais envoyé côté Anthropic, cohérent avec cette version.
- SemVer : logique `^`/pré-release soignée, tests de propriétés contre une implémentation indépendante, mutation 91–99 % sur `src/semver`.
- `check` détecte bien un fichier importé modifié (hash attendu vs réel, exit 1).
- Honnêteté documentaire réelle sur plusieurs limites (struct non validée `syntax-reference.md:135`, fichiers supprimés non vérifiés ADR 0003, précision du linter ~20 % affichée, `eval` non exécuté).

## Ce que je n'ai pas pu vérifier

- C1 en conditions réelles (Opus 5.5 avec `max_tokens` 1024 → sortie vide/tronquée) et C17 (GPT-5 + `max_tokens`) : nécessitent des appels payants. Démontré seulement avec `fetch` simulé.
- Les chiffres du linter IA eux-mêmes : seulement relus depuis le JSON commité, pas régénérés (payant).
- CI GitHub, rulesets, Scorecard : non consultés (pas d'accès à l'onglet Actions / API).
- Le « comprehension check » de l'auteur : à faire en entretien, par exemple sur C2, C6 et C9.
