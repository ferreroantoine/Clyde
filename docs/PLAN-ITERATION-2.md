# Itération 2 — plan (validé le 29/10/2026)

> Demande : `iteration-2.md` (8 chantiers). Validé tel quel, avec mes recommandations pour les questions ouvertes.
> Avancement : chantier 2 (fournisseurs) fait. Écarts constatés en route : voir « Journal » en fin de fichier.
> Base : `dev` @ fa29b55, schéma SQLite v6, 16,8 k lignes.

## 0. Faits vérifiés (oct. 2026) et écarts avec la demande

| Sujet | Vérifié | Conséquence |
|---|---|---|
| Claude Code `statusLine` | Doc officielle : stdin JSON `rate_limits.five_hour/seven_day.{used_percentage 0-100, resets_at epoch s}`, + `spend_limit` derrière un gateway. Présent seulement Pro/Max, après la 1re réponse ; chaque fenêtre peut manquer ; disparaît après `resets_at`. Réglage : `statusLine: {type:"command", command, refreshInterval?}`. | Le pont est faisable. **Risque** : la status line est une fonction du TUI ; l'IDE pilote Claude Code via l'Agent SDK (mode stream-json, sans TUI). Rien ne garantit qu'elle tourne en headless. À tester sur ta machine (je n'ai pas de compte Pro/Max ici). |
| Agent SDK 0.3.312 | `rate_limit_event` porte `rateLimitType` ∈ `five_hour, seven_day, seven_day_opus, seven_day_sonnet, …`, `utilization`, `resetsAt`. `Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` renvoie les lignes du serveur (`kind`, `group`, `percent`, `resets_at` ISO, `scope.model`). | Deux sources officielles **en plus** du pont, qui marchent en headless. Les limites « par modèle » (Opus/Sonnet hebdo) viennent de là. Je propose : pont status line + `rate_limit_event` + appel `usage_*` après chaque tour, la plus récente gagne. L'API `usage_*` est expérimentale : isolée dans un seul parseur testé. |
| Codex CLI | `codex exec --json` : `turn.completed.usage` (tokens) mais **pas de limites**. `codex app-server` (JSON-RPC stdio) : `account/rateLimits/read` + notification `account/rateLimits/updated` (fenêtres primaire/secondaire, `rateLimitsByLimitId` pour les buckets par modèle), approbations serveur→client, `turn/interrupt`, `thread/compact/start`, `model/list`. Les fichiers `$CODEX_HOME/sessions/**/*.jsonl` contiennent aussi des événements `token_count` avec `rate_limits`. | Je propose de piloter Codex via **`codex app-server`** (vraies approbations, limites en direct, compaction native) plutôt que `exec --json`. Repli limites : lecture des `.jsonl`. Schéma exact généré avec `codex app-server generate-json-schema` à l'implémentation. Fenêtre primaire absente → jauge 5 h « indisponible », pas 0 %. |
| Antigravity `agy` | Doc headless : `-p`, `--output-format stream-json` (événements `init`, `step_update`, `result` avec `usage` en tokens), `--input-format stream-json` (multi-tours), `--conversation <id>`, `--model`, `--dangerously-skip-permissions`, règles `permissions.allow` dans `~/.gemini/antigravity-cli/settings.json`. Mode par défaut `request-review` : un outil non autorisé est **refusé en silence**, pas d'appel d'approbation. `/compact` existe (1.3.5). `-p "/usage"` existe (1.2.15, sortie JSON possible). `GEMINI.md` et `AGENTS.md` sont lus. | (a) Pas de variable d'env documentée pour isoler la config → isolation par `HOME`/`USERPROFILE` par profil, **non garantie** (identifiants peut-être dans le trousseau Windows). (b) Pas d'approbation interactive → les niveaux de permission ne se mappent pas 1:1. (c) Limites : tenter `agy -p "/usage" --output-format json` ; sinon « indisponible ». Flags réels à confirmer avec `agy --help` (non installable ici de façon fiable). |
| Serveurs MCP | Toujours maintenus dans `modelcontextprotocol/servers` : filesystem, fetch, git. **Archivés** : GitHub (remplacé par `github/github-mcp-server`, officiel GitHub), SQLite (archivé + faille SQL connue, aucun successeur officiel). Playwright (`@playwright/mcp`, Microsoft), Context7 (`@upstash/context7-mcp`), Docker (MCP Toolkit / `docker mcp gateway run`, nécessite Docker Desktop) : à revérifier un par un au chantier 7. | **SQLite : je ne l'ajoute pas** sauf avis contraire (voir Q9). |

## 1. Ordre et découpage proposés

L'ordre demandé a deux dépendances à l'envers :
- Le chantier 1 (limites Codex/Antigravity) a besoin des providers du chantier 2.
- Les chantiers 1 et 3 ont besoin du schéma de paramètres du chantier 4 (seuils, intensité des animations).

Proposition : **2 → 1 → 4 → 3 → 5 → 6 → 7 → 8**, et le schéma Zod v2 des paramètres (sans l'UI) posé dès le chantier 2. Arrêt après chaque chantier. Plusieurs commits par chantier si besoin (un par étape cohérente), le dernier marquant la fin.

## 2. Migrations de données

`Migration` gagne un champ optionnel `up(db)` (TS) en plus de `sql`, pour les migrations qui calculent quelque chose. Toujours en append-only, une transaction par version.

| v | Nom | Contenu |
|---|---|---|
| 7 | settings v2 | Rien en SQL : les paramètres passent d'une ligne par clé à un document unique `settings` `{schemaVersion: 2, general, appearance, agents, usage, editor, terminal, voice, mcp, memory, shortcuts, notifications, data}`. `up()` lit les anciennes clés (`theme`, `editorFontSize`, `terminalFontSize`, `terminalShell`, `claudeCodePath`, `recentWorkspaces`), les place, supprime les anciennes lignes. Ensuite les migrations de schéma de paramètres sont des fonctions `vN → vN+1` côté `SettingsService` (testées), indépendantes de `user_version`. |
| 8 | remove mistral | `up()` : compte les profils `kind='mistral'`, les supprime (cascade : secrets, **agents enregistrés liés**, `tasks.agent_id` → NULL), supprime les lignes `pricing` mistral, écrit une notice `{type:'mistral-removed', profiles:[noms], agents:[noms]}` dans `app_notices`. L'historique (`sessions.kind='mistral'`) est conservé, affiché « Mistral (retiré) ». Au démarrage le renderer affiche la notice une fois. |
| 9 | providers | Nouvelles valeurs de `kind` (`codex`, `antigravity`, `gemini`) : pas de DDL. Seeds `pricing` OpenAI + Gemini (tarifs vérifiés à l'implémentation). Colonne `profiles.config_version` pour suivre l'installation du pont status line. |
| 10 | usage limits | `limit_snapshots(id, profile_id, session_id NULL, at, source, window, used_pct, resets_at, raw_kind)` ; `session_limit_usage(session_id, window, window_resets_at, delta_pct, badge)` ; index `(profile_id, window, at)`. `rate_limit_events` reste en lecture seule pour l'historique, n'est plus alimentée. |
| 11 | app notices + alerts | `app_notices(id, type, payload, created_at, shown_at)` ; `limit_alerts(profile_id, window, window_resets_at, threshold)` pour ne pas réalerter dans la même fenêtre. |
| 12 | chat | `conversations(id, title, pinned, profile_id, model, agent_id, tools_enabled, session_id, created_at, updated_at)` ; `chat_messages(id, conversation_id, parent_id, role, content, attachments_json, status, created_at)` (parent_id → modifier/régénérer crée une branche) ; `chat_attachments(id, message_id, name, mime, size, path)` (fichiers copiés dans `userData/chat-files`). La conso passe par `sessions`/`usage_events` existants (une conversation = une session `kind` du profil, `title` = titre). |
| 13 | mcp catalog | `mcp_servers.preset_id TEXT NULL` ; `mcp_presets(id, name, description, publisher, transport, command, args_json, params_json, builtin, created_at)` pour mes presets ; seeds intégrés en code, pas en base. |
| 14 | memory + context | `memory_proposals(id, scope, project_root, session_id, diff, status, created_at)` ; `turn_context(session_id, turn, at, system, memory, tools, history, tool_results, output, cache_read, cache_write, window)` pour la jauge et « Où partent mes tokens ». |
| 15 | history search | `chat_chunks(id, conversation_id, message_id, text)` + table virtuelle `sqlite-vec` `vec_chat USING vec0(embedding float[N])`. Si l'extension ne charge pas, la fonction est désactivée avec un message, pas de crash. |

Rien n'est supprimé hors Mistral. Tests : chaque migration sur une base v6 remplie (profil Mistral + agent + tâche liés).

## 3. Fichiers impactés, par chantier

### Chantier 2 — Fournisseurs
- `shared/profiles.ts` : kinds `claude-code | anthropic | codex | openai | antigravity | gemini | ollama`, `KIND_AUTH`, groupes « Claude / ChatGPT / Gemini / Local », `isCliKind()`.
- `shared/pricing.ts`, `shared/settings.ts` (schéma v2), `main/services/settings.ts` (+ migrations de schéma), `main/services/db/{migrations,database}.ts`.
- Suppression Mistral : `main/agents/api/{clients,openai-compat}.ts`, `claude-code/runtime.ts` (regex d'env : retirer `MISTRAL_`, ajouter `CODEX_`, `GEMINI_`, `GOOGLE_`, `AGY_`), `renderer/features/accounts/*`, `settings/PricesSection.tsx`, tests, README. Pas de dépendance npm Mistral (passait par `openai`).
- Gemini API : `clients.ts` → `OpenAICompatAdapter` sur l'endpoint OpenAI-compatible de Gemini (cache implicite automatique). Le context caching explicite (SDK `@google/genai`) au chantier 8 seulement si l'audit le justifie.
- Nouveaux : `main/agents/codex/{app-server-client,provider,translate,runtime,limits}.ts` (+ tests sur flux enregistrés), `main/agents/antigravity/{provider,translate,runtime,limits}.ts` (via `node-pty`, nettoyage ANSI, NDJSON), `main/services/cli-detect.ts` (version de `claude`, `codex`, `agy`).
- `main/agents/manager.ts` : sélection du provider par kind (aujourd'hui binaire API/Claude Code) ; `main/services/profiles.ts` : dossier isolé par CLI (`claude-profiles/`, `codex-profiles/` = `CODEX_HOME`, `antigravity-profiles/` = `HOME` substitué) ; `main/ipc/profiles.ts` : login dans le terminal intégré (`codex login`, `agy` interactif).

### Chantier 1 — Usage et limites
- `shared/limits.ts` (nouveau) : `LimitWindow`, `LimitReading {pct, resetsAt, badge: 'official'|'estimated'|'unavailable'}`, attribution pure (`attributeDelta(snapshots, sessionsTokens)`), gestion des resets (delta négatif = nouvelle fenêtre).
- `main/limits/{service,claude-bridge,claude-sdk,codex,antigravity}.ts` : `LimitsService` (snapshots avant/après tour, alertes, rafraîchissement) ; pont Claude : script Node `statusline-bridge.cjs` copié dans chaque `CLAUDE_CONFIG_DIR`, `settings.json` du profil modifié en chaînant la status line existante (le pont appelle l'ancienne commande et renvoie sa sortie), fichier d'état `limits.json` surveillé avec chokidar. Aucun secret dans ce fichier (seulement pourcentages et dates).
- `main/agents/claude-code/translate.ts` : `rate_limit_event` → fenêtre ; appel `usage_*` après `turn_end`.
- `main/metrics/metrics.ts` + `shared/metrics.ts` : coût affiché seulement pour profils API (et Claude Code en clé API) ; abonnements → points de % par fenêtre.
- Renderer : `components/LimitGauge.tsx`, `components/UsageBadge.tsx`, `layout/StatusBar.tsx` (mini-jauges couleur du profil), `features/agents/AgentsPage.tsx` (carte agent), `features/agent-panel/SessionPane.tsx` (en-tête), `features/supervision/SupervisionPage.tsx` (jauges par profil, graphe 7 j des deux fenêtres, historique), `stores/limits.ts`, desktop `Notification` côté main + toast.

### Chantier 4 — Paramètres
- `features/settings/` réécrit : `SettingsPage.tsx` (nav latérale, recherche, reset par section), `registry.ts` (métadonnées des réglages pour la recherche), `sections/*.tsx` (14 sections).
- `features/accounts/*` et `features/mcp/*` deviennent des sections ; `layout/ActivityBar.tsx` perd Comptes et MCP ; `stores/layout.ts` (`CenterView`, intents redirigés vers les sections) ; `features/palette/commands.ts`.
- Raccourcis éditables : `lib/shortcuts.ts` lit les bindings des paramètres, détection de conflits (y compris avec les raccourcis Monaco connus).
- Comportement à la fermeture (barre système) : `main/window.ts`, `main/index.ts` (`Tray`).
- Données : export/import de la config sans secrets, purge, ouvrir le dossier des logs : `main/ipc/app.ts`.

### Chantier 3 — Animations
- Dépendance `motion`. `renderer/lib/motion.ts` (tokens : durées 150–300 ms, easings, ressorts, variants), `MotionConfig reducedMotion` piloté par le réglage (complètes / réduites / désactivées) + `prefers-reduced-motion`.
- `components/ui/{button,tabs,…}.tsx` (hover, scale 0.97, focus visible, état chargement), `layout/Toaster.tsx` (AnimatePresence, empilement), `features/agent-panel/{ToolCard,SessionPane,RichText}.tsx` (entrée en cascade, pulse/shimmer, coche/shake), `layout/Shell.tsx` (panneaux, vues), Kanban dans `AgentsPage.tsx` (`layout` + drag), `components/Skeleton.tsx`.

### Chantier 5 — Chat
- `main/chat/{service,store}.ts`, `main/ipc/chat.ts`, contrat IPC. Une conversation réutilise `AgentManager` avec un niveau de permission `chat` (lecture seule, aucun outil d'écriture ni shell ; MCP autorisés de l'agent seulement si l'interrupteur est actif) et un cwd dédié `userData/chat/<id>` (pas de projet).
- Renderer : `features/chat/{ChatView,ConversationList,MessageList,Composer,Markdown}.tsx`, `stores/chat.ts`, ActivityBar (Chat en tête), vue d'accueil.
- Markdown : `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` ; coloration via `monaco.editor.colorize` (déjà embarqué, pas de nouvelle lib de coloration).
- « Continuer dans le projet » : nouvelle session agent avec le résumé/transcript en premier message.

### Chantier 6 — Dictée
- `main/voice/{whisper,models,cleanup}.ts`, `main/ipc/voice.ts` ; renderer `components/MicButton.tsx`, `lib/audio/recorder.ts` (getUserMedia + AudioWorklet → PCM 16 kHz), intégration dans Composer du chat, panneau agent, création de tâche.
- whisper.cpp : binaire `whisper-cli` lancé depuis main (téléchargé à la demande, voir Q7), modèles ggml depuis Hugging Face avec taille et progression. Permission micro : `session.setPermissionRequestHandler`.
- `cleanup.ts` : retrait des hésitations par règles (mots entiers, insensible à la casse, ponctuation recollée), reformulation via Ollama optionnelle.

### Chantier 7 — Catalogue MCP
- `shared/mcp-catalog.ts` (presets vérifiés), `main/mcp/{hub,store}.ts` (preset_id, paramètres requis → `safeStorage`, test = démarrage + `listTools`), coût en contexte (nombre d'outils + tokens estimés des définitions JSON).

### Chantier 8 — Mémoire et tokens
- **Étape 1, audit seul** : instrumentation (`turn_context`) pour chaque type de provider, rapport présenté, arrêt.
- Ensuite : `main/memory/{store,sync,proposals,consolidate}.ts`, `main/context/{budget,rolling-summary,tool-truncation,cache}.ts`, adaptateurs API (`cache_control` Anthropic, ordre de préfixe stable), boutons Compacter / Nouvelle session avec résumé (Claude : `/compact` ; Codex : `thread/compact/start` ; Antigravity : `/compact`), routage local Ollama, `sqlite-vec` + embeddings Ollama, vue Supervision « Où partent mes tokens ».

## 4. Tests Vitest prévus
Attribution par session (seul / concurrent au prorata / reset de fenêtre / données manquantes), parseurs de limites (status line, `rate_limit_event`, `usage_*`, Codex app-server, `.jsonl` Codex, Antigravity), chaînage de la status line existante, migrations SQL v7–v15 sur base v6 remplie, migrations du schéma de paramètres, sync mémoire → `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, résumé glissant, nettoyage des hésitations. `npm run typecheck`, `lint`, `test` à chaque commit.

## 5. Limites de l'environnement
Je travaille dans un conteneur Linux sans compte Claude Pro/Max, ChatGPT ou Google. Je peux installer `codex` pour lire `--help` et générer le schéma app-server, mais pas me connecter. Tout ce qui demande un vrai compte (status line en headless, `usage_*`, limites Codex, `agy`) sera couvert par des tests sur flux enregistrés et un bouton « Diagnostic limites » dans Paramètres › Usage, que tu lances sur Windows et qui me dit quelles sources répondent.

## Journal

### Chantier 2 — fait
- Numérotation : les paramètres v2 migrent dans `SettingsService` (pas de migration SQL) ; la migration SQL 7 retire Mistral (+ table `app_notices`), la 8 ajoute les prix OpenAI/Gemini. Les numéros de la section 2 se décalent d'autant.
- Mistral : agents enregistrés liés supprimés avec le compte (message unique au démarrage).
- Codex : piloté via `codex app-server` (vérifié sur Codex CLI 0.165.0 : bindings `generate-ts` + exécution réelle sans compte). Approbations commandes / fichiers / permissions passées au moteur de permissions d'Atelier.
- Antigravity : `agy -p` en pty, un processus par message, `--conversation` pour enchaîner. **Non vérifié avec `agy --help`** (installation refusée dans mon conteneur) : flags tirés de la doc officielle. Identifiants dans le trousseau Windows → un seul compte Antigravity. Pas d'approbation possible en headless → niveaux traduits en règles (`permissions` dans le `settings.json` du HOME du profil).
- Gemini API : endpoint OpenAI-compatible ; `extra_content` des appels d'outils (signatures de pensée Gemini 3) conservé et renvoyé.
- Coût : Codex et Antigravity comptés à 0 $ (abonnement) en attendant le chantier 1.

### Chantier 1 — fait
- Claude : trois sources, la plus récente gagne. `usage_EXPERIMENTAL…()` du SDK après chaque tour (5 h, hebdo, Opus/Sonnet, limites par modèle) ; pont status line (script PowerShell sous Windows, sh ailleurs ; une status line existante est chaînée) ; `rate_limit_event` sert seulement de déclencheur (son échelle d'`utilization` n'est pas documentée).
- Codex : `account/rateLimits/read` après chaque tour et sur `account/rateLimits/updated` ; fenêtre identifiée par sa durée (300 min = 5 h, 10 080 min = hebdo).
- Antigravity : rien de lisible de façon fiable → « indisponible », bouton Diagnostic qui affiche la sortie brute de `agy -p "/usage"` pour la prochaine itération.
- Attribution : à chaque relevé, la hausse depuis le relevé précédent va aux sessions ayant tourné entre-temps (une seule → officiel ; plusieurs → prorata tokens, estimé). Une utilisation hors de l'IDE pendant ce temps (claude.ai dans le navigateur) est attribuée aux sessions : limite connue.
- Relevés en arrière-plan toutes les 10 min (réglable) pour les comptes sans agent actif, sans envoyer de prompt.

### Chantier 4 — fait
- Paramètres v2 : un document versionné (`shared/settings.ts`), sections typées, migrations depuis les clés plates v1, valeur invalide remplacée champ par champ, document plus récent laissé intact (lecture seule). Réinitialisation par section.
- Page Paramètres plein centre avec recherche (accents ignorés) ; Comptes et MCP y sont déplacés (barre d'activité allégée).
- i18n : clé = texte anglais, `t()` / `tn()` (pluriel français : 0 et 1 au singulier) / `tk()` ; dictionnaire `shared/i18n/fr.ts` complet (≈850 chaînes, interface + messages d'erreur du processus principal) ; un test vérifie que chaque chaîne utilisée a sa traduction. Les prompts et descriptions d'outils envoyés aux modèles restent en anglais.
- Export de configuration sans aucun secret (clés, jetons, variables MCP chiffrées non exportées, arguments masqués par `redactArgs`), import qui ajoute ce qui manque, purge de l'historique.
- Raccourcis : tous modifiables, conflits signalés (commandes entre elles et touches de l'éditeur Monaco).
- Barre d'état système (fermer = réduire, si choisi), notifications de bureau quand Atelier est en arrière-plan, sons.

### Chantier 3 — fait
- `motion` 14.2 (API `motion/react` vérifiée dans ses types : `MotionConfig reducedMotion/skipAnimations`, `AnimatePresence`, `LayoutGroup`, `layoutId`).
- Tokens dans `renderer/lib/motion.ts` (durées 150/200/300 ms, ease-out, ressorts amortis, variants) et leurs équivalents CSS (`--motion-*`) dans `globals.css`.
- Niveau effectif = réglage abaissé à « réduites » par `prefers-reduced-motion` ; `data-motion` sur `<html>` pour le CSS, `MotionConfig` pour motion. « Désactivées » coupe aussi transitions et animations CSS.
- Boutons, onglets, lignes, cartes : survol, enfoncement (0,97 ; 0,99 pour les lignes), focus visible ; `Button loading` (spinner dans le bouton, désactivé).
- Transcript : entrées en ressort, cascade plafonnée pour les éléments montés ensemble ; outil en cours = balayage lumineux, icône qui se transforme (cours → coche / erreur), secousse sur erreur (pas au chargement d'un historique) ; demande d'autorisation qui « pop » et luit deux fois ; curseur de frappe pendant le streaming ; défilement doux qui ne lâche le suivi que si l'utilisateur remonte.
- Toasts : entrée/sortie et empilement animés. Panneaux : transition sur `flex-grow` seulement lors d'une ouverture/fermeture (jamais pendant un redimensionnement à la souris). Vues centrales, onglets, sections de Paramètres : fondu croisé ; indicateurs actifs qui glissent (`layoutId`).
- Kanban : glisser-déposer HTML5 avec réorganisation animée (aperçu de l'emplacement, cartes qui glissent) ; ordre persistant (migration SQL 10, `tasks.position`, `tasks:reorder`) ; changement de colonne limité aux actions existantes (À faire → En cours = démarrer, À relire → Terminé = fusionner).
- Skeletons : comptes, serveurs MCP, supervision, tableau, revue de diff, arborescence.

### Chantier 5 — fait
- Une conversation répond via une session d'agent marquée `chatId` : lecture seule (lectures dans son dossier `userData/chat/<id>`, où sont les pièces jointes), aucune écriture ni commande, jamais de demande d'autorisation ; outils MCP de l'agent seulement si l'interrupteur est actif. Claude Code : outils d'écriture/shell désactivés en plus du hook ; boucle API : `read_file` et `list_files` seulement.
- Une seule session de chat vivante à la fois (pour ne pas prendre les places des agents du projet). Si elle n'existe plus (redémarrage, changement de compte/modèle/agent/outils, modification, régénération), le message suivant démarre une session avec l'historique en contexte.
- Modifier / régénérer remplacent la suite (pas de navigation entre branches) : plus simple, et c'est ce que montre l'interface.
- Images : envoyées telles quelles aux modèles API (Anthropic, OpenAI, Gemini, Ollama) ; les CLI les lisent dans leur dossier (Claude Code par `Read`, Codex par `view_image`). **Non vérifié pour Antigravity** (pas de compte).
- Markdown : `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` ; coloration par `monaco.editor.colorize`. Migration SQL 11 (`conversations`, `chat_messages`, `chat_sessions`) ; la conso vient des tables `sessions` / `session_limit_usage` existantes.
- « Continuer dans le projet » : session d'agent dans le dossier ouvert, conversation dans le prompt système (40 000 caractères au plus), aucun tour consommé.
- Vérifié de bout en bout avec un faux serveur compatible OpenAI : streaming, tableau, code, formule, pièces jointes (image envoyée en `image_url`), continuer dans le projet.

