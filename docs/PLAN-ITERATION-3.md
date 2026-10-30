# Itération 3 — demande et plan (30/10/2026)

> Mode de travail : les chantiers s'enchaînent sans arrêt, un commit (au moins) par chantier, `typecheck`, `lint` et `test` verts à chaque commit. Écarts et choix faits en route : « Journal » en fin de fichier.
> Base : `dev` @ 15ccbc7 (0.2.0-beta.2).

## Demande

1. **Arrière-plan et sessions conservées.** Fermer la fenêtre ne quitte pas Clyde : l'application reste ouverte en arrière-plan. Aujourd'hui, à la fermeture, les conversations des agents disparaissent, même en cours, et on ne les retrouve plus.
2. **Affichage « comme Claude ».** Voir ce que fait l'agent : sa réflexion entre chaque action, les outils qu'il utilise, les captures d'écran qu'il prend. Aujourd'hui les commandes s'enchaînent sans contexte ; il faut un affichage lisible où l'on comprend ce qui se passe.
3. **Reprise automatique et bascule entre comptes.** Quand la limite de 5 h est atteinte (par ex. sur « Claude Work ») : soit basculer la conversation sur un autre compte (« Claude Perso ») ou un autre agent et continuer, soit attendre la fin de la fenêtre et reprendre la tâche en cours automatiquement. Pouvoir aussi basculer à la main, à tout moment, une conversation vers un autre agent.
4. **Espace Git.** Un vrai panneau Git comme dans IntelliJ ou VS Code : voir l'état du dépôt, interagir avec. Et ce qu'on peut ajouter autour des agents IA.

## Ce qui existe déjà (vérifié dans le code)

| Sujet | État | Conséquence |
|---|---|---|
| Fermeture | `general.closeBehavior` (`quit` par défaut, `tray` en option) + `main/tray.ts`. | Passer `tray` par défaut, et rendre l'arrière-plan visible (icône, notification, quitter explicite). |
| Sessions | Chaque événement est enregistré (`session_events`), mais au démarrage `metrics.recover()` marque tout « arrêté » et le panneau agent ne liste que les sessions vivantes (`agent:list`). Les processus CLI sont tués à `will-quit`. | Recharger les sessions du projet dans le panneau, et les **reprendre** : Claude Code `resume: <session_id>` (SDK 0.3.312), Codex `thread/resume`, Antigravity `--conversation`, boucle API : historique reconstruit depuis les événements. |
| Réflexion | Aucun événement : les blocs `thinking` de Claude Code et le résumé de raisonnement de Codex sont ignorés. | Nouveaux événements `thinking_delta` / `thinking`. |
| Images | Un résultat d'outil image devient le texte `[image]`. | Images enregistrées sur disque (`userData/session-media`), référencées dans l'événement, affichées en vignette + visionneuse. |
| Limites | Lues par compte et par session (chantier 1 de l'itération 2) ; `turn_end` en erreur `rate_limit` ; `rate_limit` `rejected` avec `resetsAt`. | Déclencheur de la reprise / bascule. |
| Git | `services/worktrees.ts` lance `git` pour les tâches ; aucune vue Git. | Nouveau service `GitService` + vue Source. |

## Ordre

**1 → 2 → 3 → 4.** Le 3 a besoin de la reprise de session du 1 ; le 2 change le format des événements que le 1 recharge, donc il vient juste après pour que l'historique enregistré soit déjà riche.

## Chantier 1 — Arrière-plan et sessions conservées

- Fermeture : `closeBehavior` par défaut `tray` (migration des paramètres v2 → v3 : `quit` enregistré devient `tray` une fois, puisque l'ancien défaut n'était pas un choix). Première mise en arrière-plan : notification « Clyde continue en arrière-plan ». Menu de l'icône : afficher, agents en cours (nombre), quitter. Quitter alors que des agents travaillent : confirmation.
- Sessions : chaque session garde son identifiant côté CLI (`sessions.resume_id` : `session_id` Claude Code, `threadId` Codex, conversation Antigravity), son compte, modèle, niveau, outils MCP, prompt (`sessions.request_json`).
- Au démarrage : les sessions qui tournaient passent à `interrupted` (nouveau statut) au lieu de `stopped`. Le panneau agent charge les sessions récentes du projet ouvert (transcript depuis `session_events`), y compris arrêtées.
- **Reprendre** : `AgentManager.resume(id)` relance la même session Clyde (même id, `seq` continue) avec l'identifiant CLI ; à défaut (fichier de session absent, autre machine), démarrage avec le transcript en contexte. Option « Reprendre automatiquement les sessions interrompues au démarrage » (désactivée par défaut, avec message « continue là où tu t'es arrêté »).
- Panneau agent : liste des sessions (en cours, récentes) avec recherche, rouvrir une ancienne session, la reprendre.

## Chantier 2 — Affichage de l'activité de l'agent

- Événements : `thinking_delta` / `thinking` (clé par bloc, comme le texte) ; `tool_result.images: {id, mime}[]` (fichiers dans `userData/session-media/<session>/`, lus par IPC `agent:media`).
- Claude Code : blocs `thinking` (stream + message complet), images des résultats d'outils (MCP Playwright, `Read` d'une image, captures). Codex : `item/reasoning/summaryTextDelta`. Boucle API : contenu de raisonnement quand le fournisseur le renvoie (Ollama/compatibles `reasoning_content`) ; Anthropic : pas de réflexion étendue activée (l'historique ne garde pas les blocs).
- Interface (panneau agent et Supervision) :
  - « Réflexion » repliable entre les actions, ouverte pendant qu'elle s'écrit, avec durée.
  - Cartes d'outil en phrases (« Lit `src/a.ts` », « Exécute `npm test` », « Cherche `foo` dans `src` », « Ouvre https://… », « Capture d'écran »), icône par type, sortie au dépliage, diff pour les modifications.
  - Suites d'actions regroupées (« 6 actions — lit 3 fichiers, exécute 2 commandes ») avec la dernière visible pendant qu'elle tourne.
  - Captures en vignettes dans le fil, clic → visionneuse plein écran.
  - Liste de tâches de l'agent (`TodoWrite`) affichée comme une checklist.
  - Sous-agents imbriqués sous leur appel.

## Chantier 3 — Reprise automatique et bascule

- **Bascule manuelle** : bouton « Changer de compte / d'agent » dans l'en-tête de session → compte, modèle, niveau de réflexion. La nouvelle session prend la suite dans le même fil (lien `continued_from`, séparateur « Suite sur Claude Perso »).
  - Claude Code → Claude Code : copie du fichier de session (`<CLAUDE_CONFIG_DIR>/projects/<projet>/<id>.jsonl`) dans le dossier du compte cible et `resume` : **tout le contexte est gardé**.
  - Autres cas : résumé (modèle interne) + fin du transcript passés au nouvel agent, et la dernière demande en cours redonnée.
- **Limite atteinte** (`rate_limit` rejeté, ou fin de tour en erreur de limite) : bandeau dans la session avec le compte à rebours et trois choix : « Basculer sur … », « Attendre et reprendre à HH:MM », « Ne rien faire ». Paramètres › Agents : comportement par défaut (demander / attendre et reprendre / basculer), comptes de secours dans l'ordre.
- **Attendre et reprendre** : reprise planifiée enregistrée en base (survit au redémarrage, Clyde étant en arrière-plan), à `resetsAt` + 1 min : la session est reprise et reçoit « Continue la tâche en cours là où tu t'es arrêté. ». Les tâches du tableau suivent leur session.
- Bascule automatique : choisit le premier compte de secours qui n'est pas lui-même au-dessus de 95 % de sa fenêtre 5 h.

## Chantier 4 — Espace Git

- `main/git/{service,parse}.ts` : `git` en ligne de commande (`status --porcelain=v2 -z`, `diff`, `log` avec graphe, `branch`, `stash`, `fetch/pull/push`), parseurs testés sur sorties réelles. Surveillance de `.git` pour rafraîchir.
- Vue **Source** (barre d'activité) :
  - Modifications : indexé / non indexé / non suivi / conflits ; indexer, désindexer, annuler (avec confirmation) par fichier ou tout ; ouvrir le diff (éditeur de diff Monaco, côte à côte) ; indexer une partie (hunks) depuis le diff.
  - Commit : message, « Modifier le dernier commit », commit + push.
  - Branche : actuelle, avance/retard, changer, créer, supprimer, fusionner ; fetch, pull, push (avec publication de branche).
  - Historique : graphe des commits, détail d'un commit (fichiers, diff), copier le hash, checkout, revert, cherry-pick, créer une branche ici.
  - Remises (stash) : créer, appliquer, supprimer.
  - Décorations Git dans l'explorateur (fichier modifié / nouveau / ignoré) et branche dans la barre d'état.
- **Autour des agents** :
  - « Générer le message de commit » depuis le diff indexé (modèle interne, sinon compte choisi), en Conventional Commits si l'historique les utilise.
  - « Relire mes modifications » : une session d'agent reçoit le diff et commente.
  - « Expliquer ce commit » et « Résoudre les conflits avec un agent ».
  - Chaque fichier modifié montre quelle session d'agent l'a touché (d'après les appels d'outils d'écriture enregistrés), avec lien vers la session.
  - Point de restauration : avant qu'un agent écrive dans le projet ouvert, Clyde peut créer un `stash`/commit fantôme (`git stash create`) pour annuler tout ce qu'il a fait d'un clic.

## Tests

Parseurs Git (status v2, log graphe, diff hunks), migration des paramètres v3, statut `interrupted` et reprise (faux SDK / faux app-server), copie de session Claude Code entre comptes, planification de reprise (horloge simulée), réducteur du transcript (réflexion, images, regroupement).

## Journal

### Chantier 1 — fait
- Fermer la fenêtre la cache dans la barre système (nouveau défaut ; paramètres v3 : un `quit` enregistré devient `tray` une fois). Icône présente dès le démarrage, menu avec le nombre d'agents au travail ; notification la première fois ; quitter pendant que des agents travaillent demande confirmation (icône, ou fermeture en mode « Quitter »). Une deuxième instance de Clyde réaffiche la fenêtre cachée.
- Statut `interrupted` (partagé : `ENDED_STATUSES`, `isBusy`) : à la sortie, les sessions occupées sont interrompues, les autres arrêtées ; après un plantage, `recover()` fait la même chose.
- Migration SQL 15 : `sessions.request_json`, `resume_id`, `chat_id`. L'identifiant CLI arrive dans l'événement `init` (`resumeId`) : `session_id` Claude Code, thread Codex, conversation agy (émis à la fin du premier tour).
- `AgentManager.resume(id)` : même identifiant Clyde, `seq` qui continue, préfixe `r<seq>-` sur les clés de texte et identifiants d'outils de la nouvelle exécution (la boucle API et agy renumérotent à partir de 1). Claude Code : `resume` du SDK si le fichier `projects/*/<id>.jsonl` existe dans le dossier du compte ; Codex : `thread/resume` (schéma vérifié avec `codex app-server generate-ts`, 0.165.0) ; agy : `--conversation` ; boucle API : historique reconstruit depuis les événements (appels coupés → résultat « interrompu »). Sinon : fin du transcript dans le prompt système, signalé dans le fil.
- Événements d'une ancienne exécution du même identifiant ignorés (entrée comparée par identité).
- Panneau agent : sessions récentes du projet dans le sélecteur ; une session terminée s'ouvre avec son transcript, un bandeau propose « Reprendre » (et « Reprendre et continuer » si elle a été interrompue) ; écrire dans une session terminée la reprend d'abord. Paramètres › Agents : reprise automatique au démarrage (sessions interrompues de moins de 24 h).
- Tâches du tableau : la session est gardée au redémarrage ; une demande de modifications reprend la conversation de l'agent au lieu d'en démarrer une nouvelle.
- Vérifié dans l'app avec un faux serveur Ollama : agent occupé → quitter → relancer → session « Interrompue » dans la liste → « Reprendre et continuer » → le modèle reçoit l'historique puis la consigne de continuer.
- Non vérifié avec de vrais comptes : la reprise Claude Code, Codex et agy (testée sur faux SDK / schéma seulement).

### Chantier 2 — fait
- Événements `thinking_delta` / `thinking` (non stockés en flux, comme le texte) ; `tool_result.images` : la session donne les octets (ou un fichier), le gestionnaire les range dans `userData/session-media/<session>/<sha256>.<ext>` et ne transmet que l'identifiant ; `agent:media` les relit. Purge de l'historique : images supprimées avec.
- Claude Code : blocs `thinking` (flux et message complet, clés comme le texte) avec `thinking: { type: 'adaptive', display: 'summarized' }` (les modèles récents n'affichent rien sinon) ; images des résultats d'outils (`Read` d'image, MCP navigateur). Codex : `item/reasoning/summaryTextDelta` (n'est plus en sourdine) et item `reasoning` complet ; images MCP ; item `imageView` (fichier lu par Clyde). Boucle API : `reasoning_content` / `reasoning` des serveurs compatibles OpenAI (Ollama, DeepSeek…), images renvoyées par les serveurs MCP. Antigravity : rien de documenté pour la réflexion.
- Les images restent pour l'affichage : l'historique de la boucle API ne les renvoie pas au modèle (texte seulement, valable pour tous les adaptateurs).
- Fil de l'agent : « Réflexion » ouverte pendant l'écriture puis repliée sur sa première ligne ; cartes d'outil en phrases (« Lit », « Exécute », « Fait une capture d'écran », « Clique »…, outils MCP inconnus en `serveur › outil`), icône par type ; commande en `$ …`, modifications en diff rouge/vert ; captures en vignettes toujours visibles, clic → plein écran ; liste de tâches (`TodoWrite`) en checklist ; 3 actions ou plus d'affilée repliées en « N actions — 2 fichiers lus, 1 commande » (l'action en cours et les captures restent visibles). Même rendu dans Supervision.
- Vérifié dans l'app (faux serveur Ollama + serveur MCP de test renvoyant un PNG) : réflexion en flux, regroupement, carte « Fait une capture d'écran » avec la vignette, visionneuse.
- Non vérifié avec un vrai compte : l'affichage du résumé de réflexion de Claude Code et de Codex.
