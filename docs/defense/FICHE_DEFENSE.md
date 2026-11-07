# PromptLang : fiche de défense (entretien)

**1. Pourquoi, pour qui.** Dans le code TypeScript ou Python, les prompts LLM sont des chaînes sans types, sans tests ni versions : quand un prompt casse, c'est un utilisateur qui s'en aperçoit. Le paquet est publié sur npm (`@promptlang/core` 3.0.0). À ma connaissance, aucun utilisateur ne s'en sert en production.

**2. En une phrase.** Un langage typé pour les prompts : un fichier `.prompt` déclare types, prompts, tests et versions, et se compile en fonctions TypeScript ou Python.

**3. Trois décisions clés**

| Décision | Gain | Coût |
|---|---|---|
| Un langage compilé plutôt qu'une bibliothèque de templates | Les entrées sont typées à la compilation. Les réponses sont vérifiées à l'exécution contre le type déclaré, de la même façon en TypeScript et en Python (`docs/CLAIMS.md:31`). | Une syntaxe à apprendre. Deux compilateurs à garder alignés. Les types importés d'un autre fichier ne sont pas vérifiés. |
| Zéro dépendance tierce à l'exécution, donc SemVer écrit maison ([ADR 0001](../adr/0001-semver-in-house.md)) | Aucune dépendance externe à surveiller. Un test vérifie la promesse. | Seule une partie des intervalles de version est gérée (pas de `\|\|`). |
| Le montant approuvé sert de plafond, appliqué dans le code ([ADR 0004](../adr/0004-spending-cap.md), `src/testing/budget.ts:44`) | Un appel n'est pas envoyé si son estimation au pire cas (caractères ÷ 3, `max_tokens` complet) dépasse ce qui reste du budget. | Des appels qui auraient tenu sont refusés. L'estimation n'est pas une vraie borne : le plafond peut être un peu dépassé. |

**4. Chiffres** (une exécution réelle, claude-haiku-5-5, 3 nov. 2026)

| Chiffre | Source | Comment il a été mesuré |
|---|---|---|
| Rappel du linter IA : **44/45** défauts | `docs/SYSTEM_CARD.md:45` | `scripts/linter-eval.ts`. Mesuré sur la partie test : 60 des 120 cas synthétiques, que j'ai écrits et étiquetés moi-même. La 2e répétition donne 45/45. |
| Précision (relecture humaine pré-enregistrée) : **≈ 30 %**, IC 95 % 18–45 %, non distinguable de la borne basse **20,3 %** | `evals/linter/findings-review/score.json:4`, `docs/SYSTEM_CARD.md:45`, `:47` | 12/40 signalements tirés au hasard, protocole commité avant ma relecture ; un relecteur. Borne : 44/217 ; tout signaler : 12,5 % (IC qui se chevauchent). |
| Coût : **0,21 $** pour 240 appels | `runs/live/linter-eval-2026-11-03T08-39-28-817Z.json:12` | 120 cas × 2 répétitions. Tokens renvoyés par l'API multipliés par le tarif enregistré dans le fichier. Ce n'est pas une facture. |
| Score de mutation : **96,13 %** | `docs/mutation/README.md:28` | Stryker, mesuré en local le 2026-11-03 ; la CI le relance chaque semaine (`mutation.yml`). Ne porte que sur le lexer, le parser et SemVer (`stryker.config.json:5`). |

**5. Une erreur réelle attrapée par le process.** Un audit à froid (constat C1, `docs/audit/2026-11-03-f1-neutral-audit.md:35`) a montré qu'une réponse coupée à `max_tokens`, refusée ou vide était renvoyée comme un succès. Avec `max_tokens` à 1024 par défaut, un modèle qui « réfléchit » pouvait renvoyer une chaîne vide sans erreur. La correction ajoute `IncompleteResponseError` en TypeScript et en Python : [PR #23](https://github.com/matteogallo-ai/promptlang/pull/23), commits `1f8d314` et `89bf6bc`. Tests rouges avant la correction : section *Evidence* de la PR.

**6. Ce que je ferais autrement**
- Évaluer le linter IA **avant** de le livrer.
- Mettre dès le premier jour le contrôle CI qui relie chaque promesse du README à un test.
- Étendre le mutation testing au runtime, au compilateur et à la CLI.

**7. Questions pièges**
1. *« 30 % de précision, c'est inutilisable. »* → Pour bloquer une fusion, oui : 7 à 8 signalements sur 10 sont faux, et il alerte sur les 15 cas sans défaut. C'est une aide au relecteur, pas un gate : des avertissements, bloquants seulement avec `--strict` (`docs/SYSTEM_CARD.md`).
2. *« 96 % de mutation, donc c'est solide ? »* → Non. La plupart des constats majeurs de l'audit sont dans du code non muté (runtime, compilateur, CLI). Et le constat C6 est dans `semver/interface.ts`, muté à 99 %. Ce score montre que les tests détectent les changements de code, pas que la spécification est juste.
3. *« Qui l'utilise ? »* → Personne en production, à ma connaissance. C'est un projet publié, mesuré et audité, pas un produit qui a des clients.
4. *« Tu as écrit le code ? »* → J'ai dirigé des agents de code. Ma part : la spec, les critères de « done », les contrôles CI, et un relecteur à contexte neuf sur les PR de correction (par exemple la PR #23). Je peux expliquer `budget.ts` ligne par ligne.
5. *« Pourquoi pas un outil existant ? »* → Des outils proches existent : à ma connaissance, BAML est aussi un langage typé pour les prompts. PromptLang n'est pas unique. Il montre une méthode : promesses prouvées par des tests, chiffres mesurés, plafond de coût.
