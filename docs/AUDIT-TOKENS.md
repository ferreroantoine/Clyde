# Audit — ce qui part à chaque tour (avant optimisation)

Mesuré le 29/10/2026 sur le code du commit du chantier 7. Ordres de grandeur en tokens : caractères ÷ 4 (texte anglais/JSON ; le français compte un peu plus).

## Méthode

- **Claude Code** (binaire 2.1.312 fourni avec l'Agent SDK, celui que Clyde lance) et **Codex CLI** (0.165.0) : lancés contre un faux serveur API local qui enregistre le corps de chaque requête puis répond une erreur. On voit exactement ce que le CLI enverrait au premier tour d'un « hello ». HOME et dossier de config vides, pour ne pas compter de config personnelle.
- **Boucle API de Clyde** (Anthropic, OpenAI, Gemini, Ollama) et **Chat** : tailles mesurées sur le code (prompt système, définitions d'outils) et sur les serveurs MCP réels (chantier 7).
- **Antigravity** : non mesurable ici (pas de `agy` installable ni de compte). Voir « Limites ».

## Résultats

### Claude Code (abonnement ou clé, via l'Agent SDK)

| Partie | Taille | ≈ tokens |
| --- | --- | --- |
| Prompt système (3 blocs) | 6,3 k caractères | 1,6 k |
| Définitions d'outils (12 outils intégrés) | 30,4 k | 7,6 k |
| Contexte injecté (environnement, état git) | 9,7 k | 2,4 k |
| Message « hello » | 5 | ~0 |
| **Total avant la moindre réponse** | **≈ 46 k** | **≈ 11,6 k** |

- Le cache de prompt est **déjà utilisé** : `cache_control: ephemeral` sur deux blocs système. Les tours suivants relisent ce préfixe à prix réduit.
- `CLAUDE.md` (projet et utilisateur) et les outils MCP autorisés s'ajoutent ; l'historique et sa compaction automatique sont gérés par Claude Code.
- Ce que l'IDE voit : `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` et, par modèle, `contextWindow`. **Aujourd'hui Clyde additionne les trois entrées** : impossible d'afficher le taux de cache ni une jauge de contexte.
- Une partie des outils mesurés dépend de l'environnement (outils propres à ce build) : le chiffre exact varie un peu d'une machine à l'autre.

### Codex CLI (abonnement ChatGPT)

| Partie | Taille | ≈ tokens |
| --- | --- | --- |
| Instructions « developer » (6 blocs) | 28,2 k | 7 k |
| Contexte d'environnement | 0,5 k | 0,1 k |
| **Total avant réponse** | **≈ 28,7 k** | **≈ 7,2 k** |

- `prompt_cache_key` est envoyé : le cache de préfixe d'OpenAI est utilisé.
- Les définitions d'outils n'apparaissent pas avec un fournisseur personnalisé ; avec une connexion ChatGPT elles s'ajoutent (non mesurées ici).
- Codex rapporte `thread/tokenUsage/updated` : entrée, entrée en cache, écriture en cache, sortie, raisonnement, et **`modelContextWindow`**. Il a une compaction native (`thread/compact/start`). Clyde n'utilise aujourd'hui que les totaux.

### Boucle API de Clyde (Anthropic, OpenAI, Gemini, Ollama)

| Partie | Taille | ≈ tokens |
| --- | --- | --- |
| Prompt système | 449 caractères | 110 |
| 5 outils intégrés | 1,8 k | 450 |
| Outils MCP attribués (ex. Filesystem / Playwright) | 8 k / 17,6 k | 2 k / 4,4 k |
| Mémoire | — | 0 (rien n'est injecté) |
| **Historique** | **tout, sans limite** | voir ci-dessous |

- **Aucune mise en cache côté Anthropic** : pas de `cache_control`, chaque étape repaie tout le préfixe au prix plein. OpenAI et Gemini ont un cache automatique de préfixe, mais il ne joue qu'au-delà d'environ 1 024 tokens de préfixe stable.
- **Résultats d'outils** : chaque sortie est gardée jusqu'à 30 000 caractères (≈ 7,5 k tokens) et renvoyée **à chaque étape et chaque tour suivants**. Une session qui lit 10 gros fichiers traîne ≈ 75 k tokens dans toutes ses requêtes.
- **Pas de résumé** : au-delà de la fenêtre du modèle, la requête échoue.
- Usage rapporté : Anthropic additionne cache et entrée (même problème que Claude Code) ; OpenAI/Gemini envoient `cached_tokens`, ignoré.

### Chat

- Prompt système 311 caractères, outils de lecture seule (≈ 750 caractères), MCP seulement si l'interrupteur est actif.
- Quand une conversation reprend dans une nouvelle session (redémarrage, modification, régénération), **tout l'historique est renvoyé en un seul message**.

### Antigravity

Non mesuré. Il rapporte les tokens d'entrée et de sortie en fin de tour (stream-json). Sa compaction (`/compact`) n'a pas pu être vérifiée.

## Ce qui coûte le plus, par ordre

1. **Historique des résultats d'outils** dans la boucle API (croissance sans fin, renvoyé à chaque étape).
2. **Absence de cache Anthropic** dans la boucle API (préfixe repayé à chaque étape).
3. **Définitions d'outils MCP** (Playwright ≈ 4,4 k tokens à chaque requête si tout est coché).
4. Le préfixe des CLI (≈ 7 à 12 k tokens) : fixe, déjà mis en cache par les CLI ; on ne le touche pas.

## Ce que le chantier 8 change (suite de ce document)

- **Mesure** : entrée, lecture de cache, écriture de cache et sortie enregistrées séparément pour tous les fournisseurs ; fenêtre de contexte quand le fournisseur la donne ; répartition système / mémoire / outils / historique / résultats d'outils / réponse calculée pour la boucle API (les CLI ne donnent que les totaux).
- **Boucle API** : préfixe stable (système → mémoire → outils, ordre fixe), `cache_control` Anthropic sur le préfixe et la fin de l'historique ; résultats d'outils déjà lus réduits dans l'historique (début et fin gardés, contenu complet récupérable par un outil) ; résumé glissant au-delà d'un seuil, derniers tours intacts.
- **CLI** : boutons « Compacter » (mécanisme natif) et « Nouvelle session avec résumé », suggérés quand la jauge dépasse un seuil.
- **Mémoire** : noyau court sous budget (1 500 tokens par défaut), mis en cache avec le préfixe ; documents détaillés lus à la demande.
