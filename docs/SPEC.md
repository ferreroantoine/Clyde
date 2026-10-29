# Projet : « Atelier » — IDE desktop centré sur les agents IA, multi-comptes et multi-fournisseurs

> Cahier des charges d'origine, tel que fourni par l'auteur du projet. Le plan d'implémentation validé est dans [PLAN.md](PLAN.md).

## Contexte
Je veux une application desktop (cible principale : Windows) qui sert d'IDE pour travailler avec des agents IA. Elle doit permettre d'utiliser plusieurs comptes et fournisseurs IA en parallèle, de lancer plusieurs agents sur un même projet, de superviser leur activité, et de donner aux agents accès à des outils via MCP (comme Claude Desktop).

Avant d'écrire du code : passe en mode plan, propose l'architecture et l'arborescence du projet, liste les points ambigus sous forme de questions, et attends ma validation. Ensuite, avance phase par phase (voir Roadmap), avec un commit par étape cohérente, et arrête-toi à la fin de chaque phase pour que je teste.

## Stack imposée
- Electron + React + TypeScript (strict), bundler Vite (electron-vite ou équivalent)
- UI : Tailwind CSS + composants shadcn/ui, icônes Lucide
- Éditeur : Monaco Editor (onglets, coloration, diff side-by-side)
- Terminal : xterm.js + node-pty
- Persistance : SQLite (better-sqlite3) pour sessions, historique, métriques
- Secrets : stockage chiffré via `safeStorage` d'Electron, jamais en clair sur disque ni dans les logs
- Git : simple-git pour branches, worktrees et diffs
- Agents Claude : Claude Agent SDK (TypeScript)
- Autres fournisseurs : clients Anthropic API, OpenAI, Mistral, et Ollama via son API compatible OpenAI
- MCP : SDK officiel @modelcontextprotocol/sdk côté client

Sépare clairement process main (accès système, agents, secrets) et renderer (UI), avec une API IPC typée exposée via preload. Le renderer n'a aucun accès direct à Node.

## Architecture des agents
Crée une interface commune `Provider` (démarrer une session, envoyer un message, streamer la réponse, exposer des outils, arrêter, remonter l'usage) avec deux familles d'implémentation :

1. **ClaudeCodeProvider** : pilote Claude Code via l'Agent SDK. Chaque profil de compte Claude a son propre dossier de configuration isolé (vérifie dans la doc officielle de Claude Code la variable d'environnement prévue pour ça, ex. `CLAUDE_CONFIG_DIR`). La connexion à chaque compte se fait par le flux de login officiel de Claude Code, l'IDE ne manipule jamais les identifiants.
2. **ApiProvider** : boucle d'agent implémentée par l'IDE pour les fournisseurs API (Anthropic, OpenAI, Mistral, Ollama). Outils de base : lire/écrire un fichier du projet, lister l'arborescence, exécuter une commande, plus les outils MCP activés.

Un **Agent** = un nom, un provider + profil de compte, un modèle, un prompt système, une liste d'outils MCP autorisés, un niveau de permission, et un dossier de travail (worktree).

Permissions : par défaut, toute écriture de fichier et toute commande shell demande validation dans l'UI. Modes configurables par agent : « tout valider », « fichiers auto / commandes validées », « autonome dans son worktree ».

## Gestion des comptes
- Écran « Comptes » : ajouter / renommer / supprimer un profil (Claude perso, Claude pro, clé Anthropic API, OpenAI, Mistral, Ollama local avec URL configurable)
- Chaque profil a une couleur et une étiquette, reprises partout dans l'UI (cartes d'agents, onglets, barre de statut) pour savoir d'un coup d'œil quel compte travaille
- Test de connexion par profil, et liste des modèles disponibles
- Pas de bascule automatique entre comptes : le choix du compte est toujours explicite

## MCP
- Écran de gestion des serveurs MCP (stdio et HTTP), avec import d'un fichier au format `claude_desktop_config.json`
- État de chaque serveur (connecté, erreur, outils exposés)
- Activation par agent : chaque agent ne voit que les outils qui lui sont autorisés

## Fonctionnalités de l'IDE
1. **Espace de travail** : ouvrir un dossier/repo, arborescence, onglets Monaco, recherche dans les fichiers
2. **Panneau agent** (à droite) : conversation en streaming avec l'agent actif, affichage des appels d'outils repliables, demandes de validation inline
3. **Terminal intégré** (en bas) : terminaux classiques + un terminal en lecture seule par agent montrant ce qu'il exécute en direct
4. **Agents en parallèle** : vue Kanban (À faire → En cours → À valider → Terminé). Créer une tâche = choisir un agent, l'IDE crée une branche + git worktree dédiés. Colonne « À valider » : diff complet dans Monaco, boutons fusionner / demander des corrections / abandonner
5. **Supervision** : tableau de bord par compte — sessions actives, tokens consommés, coût estimé pour les fournisseurs API, historique, et les informations d'usage/limites que Claude Code remonte quand elles sont disponibles. Graphiques simples (recharts)

## Design
- Interface moderne, claire et aérée, thème clair par défaut + mode sombre, inspiration Linear / Zed / Raycast
- Layout : barre d'activité à gauche (Explorateur, Agents, Comptes, MCP, Supervision, Réglages), zone centrale éditeur, panneau agent à droite, terminal en bas, tous redimensionnables et repliables
- Palette de commandes (Ctrl+K) pour toutes les actions
- Typographie : Inter pour l'UI, JetBrains Mono pour le code
- Animations discrètes, états vides soignés, aucune fenêtre surchargée

## Roadmap
- **Phase 1** : squelette Electron, layout complet, thèmes, explorateur, Monaco, terminal
- **Phase 2** : gestion des profils et des secrets, ClaudeCodeProvider, chat avec un agent unique dans le panneau de droite, système de permissions
- **Phase 3** : ApiProvider (Anthropic, OpenAI, Mistral, Ollama), boucle d'agent maison, intégration MCP
- **Phase 4** : agents parallèles, worktrees, Kanban, revue de diff et fusion
- **Phase 5** : supervision, métriques, palette de commandes, finitions

## Règles de travail
- Code TypeScript strict, modules courts, pas de logique métier dans les composants React
- Tests unitaires (Vitest) sur la couche Provider, la gestion des worktrees et les permissions
- Gestion d'erreurs visible dans l'UI (process agent crashé, serveur MCP injoignable, clé invalide)
- README avec installation sous Windows (prérequis de compilation pour node-pty inclus)
- Si une API ou un comportement de Claude Code / de l'Agent SDK n'est pas certain, vérifie dans la documentation plutôt que de supposer
