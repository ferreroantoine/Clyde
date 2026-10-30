# Itération 4 — demande et plan (30/10/2026)

> Mode de travail : comme l'itération 3 — les chantiers s'enchaînent, un commit (au moins) par chantier, `typecheck`, `lint` et `test` verts à chaque commit, vérification dans l'app. Écarts et choix faits en route : « Journal » en fin de fichier.
> Base : `dev` @ 19f6308 (0.2.0-beta.3 + espace Git).

## Demande

1. **Panneaux.** Les boutons en bas à droite (barre latérale, terminal, panneau agent) ouvrent un panneau mais ne le referment pas.
2. **Panneau agent façon chat.** Sans session, le panneau de droite montre un gros formulaire « Démarrer l'agent ». À la place : un petit chat classique. On écrit le premier message, et en haut on choisit l'agent qui répondra ; en haut aussi, on peut ajouter un agent et régler ses paramètres.
3. **Visionneuse de fichiers universelle.** Ouvrir le plus de fichiers possible : Markdown, images, PDF, audio/vidéo, tableaux, documents.
4. **Fenêtre de terminal qui clignote.** En choisissant un agent Antigravity (peut-être Codex aussi), une fenêtre de terminal apparaît une fraction de seconde. Elle ne doit pas se voir.
5. **Onglet « Agents » → « Tâches ».** Garder l'affichage en colonnes (à faire, en cours, fait), mais beaucoup plus simple : les agents qui tournent y mettent leur liste de tâches et indiquent ce qu'ils font en ce moment ; un clic suffit pour savoir où ils en sont. Les agents doivent s'en servir **par réflexe**, pas l'ignorer.
6. **Images en grand.** Aujourd'hui : cadre, bordures et croix. Voulu : l'image seule au milieu ; un clic zoome à l'endroit cliqué ; un clic en dehors ferme.

Réponses aux questions posées avant d'écrire ce plan :
- Tâches : **on retire** les worktrees, la relecture et la fusion des tâches. Le tableau devient une simple liste de tâches partagée entre l'utilisateur et les agents.
- Nom de l'onglet : **« Tâches »**.
- Choix en haut du panneau agent : **agents enregistrés + comptes** (chaque compte tel quel, avec son modèle par défaut) ; un « + » crée un agent.
- Visionneuse : **Markdown + images, PDF, audio/vidéo, tableaux et documents** (CSV/TSV, JSON, Word, Excel).

## Ce qui existe déjà (vérifié dans le code)

| Sujet | État | Conséquence |
|---|---|---|
| Panneaux | `layout/usePanelSync.ts` : le store commande `collapse()` / `expand()`, et `onResize` remet le store à jour d'après la taille **en pixels**. Reproduit dans l'app : après un clic sur « masquer le terminal », `terminalOpen` reste `true`. Pendant l'animation (transition CSS sur `flex-grow`, `data-panels-animating`), le panneau mesure encore plus de 0 px : `onResize` y voit une ouverture et rouvre. L'ouverture marche parce que les tailles intermédiaires disent la même chose. | Ignorer `onResize` pendant une bascule commandée, et lire `panel.isCollapsed()` plutôt que les pixels. |
| Panneau agent vide | `agent-panel/NewSession.tsx` (269 lignes) : formulaire compte, modèle et réflexion, permissions, outils MCP, prompt système, bouton « Démarrer l'agent ». Le texte écrit avant qu'une session existe est déjà gardé (`drafts['']` dans `stores/agents.ts`) et passe à la session au démarrage. | Remplacer le formulaire par le fil vide + la zone de saisie habituelle ; les réglages passent dans une barre en haut. |
| Agents enregistrés | Créés et modifiés dans la page « Agents » (`features/agents/AgentDialog.tsx`), stockés par `services/agent-definitions.ts` (compte, modèle, réflexion, prompt, permissions, outils MCP). | Le dialogue part dans le panneau agent (« + », modifier), et une liste reste dans Paramètres › Agents. |
| Fichiers | `services/files.ts` `readText` : plus de 5 Mo → `too-large`, binaire → `binary` ; l'éditeur affiche alors « Fichier binaire ». CSP : `img-src 'self' data: blob:`, pas de `media-src`. Déjà dans les dépendances : `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`. | Un protocole `clyde-file://` pour lire les octets (images, PDF, médias) sans base64, et un choix de visionneuse par type de fichier. |
| Antigravity | Toujours lancé dans un pseudo-terminal (`agents/cli/pty-process.ts`, node-pty 1.1.0, ConPTY) : sessions, relevé des limites (`agy -p /usage`, `limits/setup.ts`), détection de version (`agy --version`, `services/cli-detect.ts`). Choisir un compte Antigravity relance le relevé des limites. | Cause probable du clignotement : le ConPTY de Windows ouvre une console visible depuis une app sans console. Piste : `useConptyDll: true` (le conpty.dll fourni avec node-pty 1.1). À confirmer. |
| Codex | `codex app-server` lancé par `child_process.spawn` avec `windowsHide: true` (`agents/cli/process.ts`). | Si le clignotement existe aussi : vérifier le binaire résolu (un shim `codex.cmd` lance `node`, qui peut ouvrir sa propre console) et préférer le `codex.exe` du paquet. |
| Tableau « Agents » | `agents/tasks.ts` + `services/worktrees.ts` : une tâche = une branche `clyde/…` + un worktree + une session ; colonnes À faire / En cours / À valider / Terminé ; relecture (`ReviewView.tsx`), fusion. | Remplacé par « Tâches ». Les worktrees, la relecture et la fusion disparaissent. |
| Listes de tâches des agents | Claude Code : `TodoWrite`, déjà affiché en liste à cocher dans le fil (`lib/activity.ts` `todosOf`). Codex : `turn/plan/updated`, aujourd'hui **mis en sourdine** (`codex/session.ts`, `QUIET`). Boucle API (Ollama, OpenAI, Anthropic, Gemini) : aucun outil de liste. Antigravity : rien de documenté. | Un événement commun `todos`, alimenté par chaque fournisseur, qui nourrit à la fois le fil et la page Tâches. |
| Images en grand | `agent-panel/ToolImages.tsx` : `Dialog` + `DialogContent` (cadre, marge, bouton fermer). Les pièces jointes du chat (`chat/MessageList.tsx`) ne s'agrandissent pas. | Un composant commun `ImageViewer`, utilisé partout. |

## Ordre

**1 → 2 → 3 → 4.** Le 1 regroupe les corrections courtes (panneaux, console, visionneuse d'image) ; la visionneuse d'image sert ensuite au 3. Le 2 doit passer avant le 4 : la gestion des agents enregistrés quitte la page « Agents » avant que cette page soit remplacée par « Tâches ».

## Chantier 1 — Corrections : panneaux, console, images

- **Panneaux** : `usePanelSync` ignore `onResize` pendant une bascule venue du store (jusqu'à la fin de l'animation) et décide « ouvert / fermé » avec `panel.isCollapsed()`. Le glisser pour fermer reste synchronisé. Vérifié dans l'app : barre latérale, terminal et panneau agent, par les boutons et par les raccourcis, deux fois de suite chacun.
- **Console qui clignote** :
  - reproduire d'abord : choisir un compte Antigravity, puis Codex, en relevant les fenêtres qui apparaissent (script PowerShell sur `EnumWindows`, ou capture d'écran en rafale) ;
  - Antigravity : node-pty avec `useConptyDll: true` ; à défaut, `agy --version` hors pseudo-terminal (pas besoin de terminal pour lire une version), et le relevé `/usage` décalé tant que la fenêtre n'est pas utilisée ;
  - Codex : résoudre le vrai `codex.exe` quand le chemin trouvé est un shim `.cmd` / `.ps1` ;
  - les autres lancements (`claude auth status`, git, ripgrep, whisper) ont déjà `windowsHide` : à relire au passage.
- **Visionneuse d'image** (`components/ImageViewer.tsx`) :
  - plein écran, fond sombre semi-transparent, **sans cadre, sans bordure, sans croix** ;
  - l'image est centrée à la taille de l'écran ; un clic sur l'image zoome (×2,5) **centré sur le point cliqué**, un second clic revient à l'ajustement ; molette pour zoomer, glisser pour se déplacer une fois zoomé ;
  - clic en dehors de l'image ou Échap → fermé.
  - Utilisée pour les images des outils (`ToolImages`), les pièces jointes du chat, les images du Markdown et la visionneuse de fichiers (chantier 3).

## Chantier 2 — Panneau agent façon chat

- Sans session ouverte, le panneau montre **le fil vide** (une ligne d'accueil : « Nouvelle session avec ‹agent› ») et **la même zone de saisie** que dans une session (mentions `@fichier`, dictée). Envoyer le premier message démarre la session avec l'agent choisi et lui envoie le message ; le formulaire `NewSession` disparaît.
- **Barre du haut** :
  - **sélecteur d'agent** :
    - section « Agents » : les agents enregistrés (nom, couleur du compte, modèle) ;
    - section « Comptes » : chaque compte utilisable, avec son modèle par défaut ;
    - le dernier choix est retenu par projet ;
  - à côté : modèle et réflexion (`ModelPicker` existant), permissions, outils MCP, prompt système — en petites puces / un popover « Réglages », valables pour la prochaine session ;
  - **« + Nouvel agent »** ouvre le dialogue d'agent (déplacé depuis la page « Agents ») ; un crayon dans la liste modifie un agent ; la suppression reste dans le dialogue ;
  - le sélecteur de sessions (en cours / récentes) reste à sa place.
- Paramètres › Agents : liste des agents enregistrés (créer, modifier, supprimer), pour ne pas dépendre du panneau.
- La palette de commandes (« Nouvel agent… ») et les actions de l'explorateur (« Ajouter à la session », « Expliquer ce fichier ») continuent de fonctionner : elles remplissent la zone de saisie du fil vide.

## Chantier 3 — Visionneuse de fichiers universelle

- **Lecture des octets** : protocole `clyde-file://` (déclaré `standard`, `secure`, `stream`, `supportFetchAPI`) qui ne sert que des fichiers du dossier ouvert (`resolveInside`) et répond aux requêtes partielles (`Range`) pour l'audio et la vidéo. CSP : `img-src`, `media-src` et `connect-src` acceptent `clyde-file:`.
- **Choix de la visionneuse par type**, dans l'onglet de l'éditeur ; pour les formats textuels, un bouton **Aperçu / Code** dans l'en-tête de l'onglet (on peut toujours modifier le texte, et l'aperçu suit) :

| Type | Extensions | Affichage |
|---|---|---|
| Markdown | `.md`, `.markdown`, `.mdx` (texte) | Aperçu par défaut : `react-markdown` + GFM + KaTeX (déjà là), images relatives via `clyde-file://`, liens vers d'autres fichiers ouverts dans Clyde, blocs de code colorés (coloration Monaco). |
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.ico`, `.svg` | Ajustée à l'onglet, zoom (clic, molette), déplacement, damier sous la transparence ; dimensions et poids en bas. SVG : aperçu / code. |
| PDF | `.pdf` | `pdfjs-dist` : pages, zoom, recherche, texte sélectionnable. Le lecteur PDF intégré de Chromium demanderait `plugins: true` et suivrait mal le thème. |
| Audio / vidéo | `.mp3`, `.wav`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.opus`, `.mp4`, `.webm`, `.mov`, `.mkv` | Lecteur intégré. Formats que Chromium ne lit pas : message clair et « Ouvrir avec l'application par défaut ». |
| Tableaux | `.csv`, `.tsv` | Tableau à en-tête fixe, lignes virtualisées, tri par colonne ; au-delà de la limite, les N premières lignes et un avertissement. Aperçu / code. |
| JSON | `.json`, `.jsonl`, `.geojson` | Arbre repliable, aperçu / code. |
| Word | `.docx` | `mammoth` → HTML nettoyé (DOMPurify), lecture seule. |
| Excel / tableur | `.xlsx`, `.xls`, `.ods` | SheetJS (édition communautaire, Apache-2.0) : un onglet par feuille, lecture seule. |
| Autres binaires | — | « Ce fichier ne peut pas être affiché » + « Ouvrir avec l'application par défaut » (`shell.openPath`) et « Afficher dans l'Explorateur ». |

- Les fichiers texte ordinaires restent dans Monaco ; la limite de 5 Mo ne concerne plus que le texte.
- Licences des nouvelles dépendances ajoutées à `licenses.json` (`npm run` du script existant).

## Chantier 4 — « Tâches » (remplace l'onglet « Agents »)

### Ce que voit l'utilisateur
- Onglet **Tâches** dans la barre d'activité (à la place de « Agents ») : trois colonnes **À faire / En cours / Fait**, pour le projet ouvert.
- Chaque carte : le texte de la tâche, la session qui s'en occupe (point de couleur du compte, nom de l'agent) ou « Moi ». La tâche en cours d'un agent est mise en avant (pastille animée, texte « en train de… » quand le fournisseur le donne, comme `activeForm` de Claude Code).
- Filtre en haut : toutes, une session, mes tâches ; « masquer les terminées » (les tâches faites de plus de 7 jours sont repliées).
- **Clic sur une carte d'agent → sa session** s'ouvre dans le panneau de droite. Dans l'en-tête de la session, une ligne **« 3/7 · En cours : … »** ouvre Tâches filtrée sur cette session.
- L'utilisateur peut ajouter une tâche (« Moi »), la déplacer (glisser-déposer, comme aujourd'hui), la modifier, la supprimer, et **« Confier à l'agent »** : la tâche est envoyée à la session active (ou laissée dans la zone de saisie de la prochaine), avec la consigne de l'ajouter à sa liste. La carte passe alors à cette session.
- Explorateur : « Créer une tâche d'agent… » devient « Ajouter aux tâches… ».

### Comment les agents la remplissent
- Nouvel événement commun : `{ type: 'todos', items: [{ key, text, status: 'pending' | 'in_progress' | 'completed', active?: string }] }`. C'est **la liste entière** à chaque fois, comme les outils des fournisseurs.
  - **Claude Code** : chaque appel `TodoWrite` produit un événement `todos` (sa liste à cocher dans le fil reste).
  - **Codex** : `turn/plan/updated` sort de la sourdine → `todos`.
  - **Boucle API** (Ollama, OpenAI, Anthropic, Gemini) : nouvel outil `update_todos` (même forme que `TodoWrite`), toujours disponible, sans demande d'autorisation.
  - **Antigravity** : pas d'outil de liste connu. Clyde lui fournit un serveur MCP local « clyde » avec `update_todos` (il reçoit déjà des serveurs MCP). Le même serveur sert de secours à tout agent sans outil natif.
- **Le réflexe** : chaque session reçoit dans son prompt système une consigne courte et ferme, du type « Pour toute demande de plus d'une étape : écris ta liste de tâches avant de commencer, mets une seule tâche "en cours", marque-la faite dès qu'elle l'est, ajoute ce que tu découvres en route. L'utilisateur suit ton avancement dans cette liste. » (Claude Code : ajoutée au prompt par défaut, `append`). Vérifié avec chaque fournisseur disponible : l'agent tient sa liste sans qu'on le lui demande.
- Côté main : un `TodoService` reçoit les événements `todos`, fait correspondre les éléments d'une même session (par `key`, sinon par texte), et met à jour la table : création, changement de colonne, `done_at`. Il diffuse `todos:changed`. Une tâche retirée de la liste par l'agent disparaît, sauf si elle était faite (l'historique reste).

### Ce qui disparaît
- Worktrees de tâches, branches `clyde/…`, relecture, fusion : `services/worktrees.ts` (sauf ce dont Git a besoin), `ReviewView.tsx`, `DiffView` déplacé dans `features/git`, IPC `tasks:start|requestChanges|changes|fileDiff|merge|abandon`, réglages `agents.worktreesFolder` et `agents.deleteMergedWorktrees` (migration des paramètres).
- Migration SQL : la table `tasks` devient la table des tâches (`todo` → À faire, `in_progress` et `review` → En cours, `done` → Fait), colonnes de worktree abandonnées. Si des worktrees ou des branches `clyde/…` non fusionnées existent encore, un avis unique les liste (chemin, branche) : **Clyde ne les supprime pas**.

## Tests

`usePanelSync` (bascule commandée sans rebond, glisser pour fermer), choix de la visionneuse par extension, protocole `clyde-file://` (refus hors du dossier, requêtes `Range`), analyse CSV/TSV, conversion des listes en `todos` (TodoWrite, `turn/plan/updated`, `update_todos`), `TodoService` (correspondance par clé et par texte, changement de colonne, tâche retirée, tâche faite gardée), migration de `tasks` et des paramètres, outil `update_todos` de la boucle API (faux serveur).

Vérifications dans l'app : panneaux ; console (aucune fenêtre visible en choisissant Antigravity ou Codex) ; visionneuse d'image ; panneau agent vide → premier message → session ; chaque format de la visionneuse sur des fichiers d'exemple ; une session (faux serveur Ollama) qui tient sa liste → cartes qui avancent dans Tâches.

## Journal

### Chantier 1 — fait
- **Panneaux** : la logique passe dans `layout/panel-sync.ts` (`PanelSync`, testé sans DOM) : pendant une bascule venue du store (260 ms, la durée de l'animation) les `onResize` sont ignorés, et ouvert / fermé se lit avec `panel.isCollapsed()`. Cause confirmée dans `react-resizable-panels` 4.15 : `onResize` vient d'un `ResizeObserver` qui mesure `offsetWidth` / `offsetHeight` pendant la transition CSS. Vérifié dans l'app : barre latérale (vue Explorateur ; dans la vue Chat elle reste masquée, c'est voulu), terminal et panneau agent, quatre bascules de suite par le bouton puis par `Ctrl+B`, `Ctrl+J`, `Ctrl+Alt+B` ; terminal fermé en le glissant, puis rouvert en un clic.
- **Console qui clignote** : reproduite avec une petite app Electron lancée sans console (comme Clyde) et un relevé `EnumWindows`. `agy --version` et `agy models` n'ouvrent rien ; **`agy -p …`** (le relevé `/usage` déclenché par le choix d'un compte Antigravity, et chaque tour de session) ouvre une fenêtre **Windows Terminal** une fraction de seconde : `agy -p` lance un processus annexe, et Windows confie sa console au terminal par défaut. Correction : `useConptyDll: true` dans `agents/cli/pty-process.ts` (le conpty.dll + OpenConsole fournis avec node-pty, déjà dans `asarUnpack`). Revérifié : `-p /usage` et un vrai tour `--output-format stream-json` sans aucune fenêtre, sortie JSON intacte. Lancer agy hors pseudo-terminal (`windowsHide`) corrigeait aussi, mais les sessions ont besoin du pty.
- **Codex** : rien à changer. `resolveCodexBinary` remplace déjà le shim `codex.cmd` par le `codex.exe` du paquet, lancé avec `windowsHide`. Codex n'est pas installé sur la machine de test : clignotement non reproduit, non vérifié.
- Autres lancements relus (`claude auth status`, git, ripgrep, whisper, `taskkill`, shell de la boucle API, `where.exe`) : tous en `windowsHide`.
- **Visionneuse d'image** : `components/ImageViewer.tsx` (Radix Dialog sans `DialogContent` : focus, Échap, portail) + calculs dans `lib/image-zoom.ts` (testés). L'image est ajustée à l'écran mais jamais agrandie au-delà de sa taille réelle. Un clic zoome ×2,5 en **gardant sous le curseur le point cliqué** (borné : l'image ne quitte pas l'écran) ; molette jusqu'à ×8 ; glisser pour se déplacer une fois zoomé. Branchée sur les images des outils (`ToolImages`) et les pièces jointes du chat (qui ne s'agrandissaient pas). Les images du Markdown viendront avec l'aperçu Markdown du chantier 3 : le chat n'affiche aujourd'hui que leur texte alternatif (CSP). Vérifié dans l'app (compte Ollama sans serveur, image jointe à un message) : ouverture sans cadre ni croix, zoom à l'endroit cliqué, retour à l'ajustement, fermeture par clic à côté et par Échap.
- Tests : `npm test` a chaque fois un échec dû à l'environnement, et pas le même selon le shell, avec ou sans ces changements : sous Git Bash, `voice.test.ts` (le `tar` GNU lit `C:\…` comme un hôte distant) ; sous PowerShell, `claude-bridge.test.ts` (pas de `sh` dans le PATH). Tout le reste passe.

### Avant le chantier 2 — barre latérale
- Demandé en route : l'explorateur de gauche ne s'affiche plus que dans la vue Explorateur (et Source, qui partage la barre). Paramètres, Supervision, Agents et Chat le masquent. Le bouton de la barre d'état et `Ctrl+B` ramènent l'Explorateur depuis ces vues au lieu de ne rien faire. Vérifié dans l'app, vue par vue.

### Chantier 2 — fait
- Sans session, le panneau montre une barre, le fil vide (« Nouvelle session avec ‹agent› », modèle, permission, dossier) et la zone de saisie habituelle (`agent-panel/Composer.tsx`, extraite de `SessionPane` : mentions par glisser-déposer, dictée). Le premier message démarre la session puis lui est envoyé (`startWith` dans `stores/agents.ts`) ; s'il ne part pas, il attend dans la zone de saisie de la session.
- Barre : `AgentPicker` (sections « Agents » avec un crayon par agent, « Comptes » avec le modèle par défaut, « + Nouvel agent »), `ModelPicker`, et un bouton « Réglages » (popover : permissions, outils MCP, prompt système). Choisir un agent reprend tous ses réglages ; on peut les retoucher pour cette session seulement. Le choix est retenu par projet (`stores/next-session.ts`, `localStorage`) ; si l'agent ou le compte a disparu, on repart du premier compte utilisable (`lib/next-session.ts`, testé).
- Un seul dialogue d'agent pour toute l'app (`agent-panel/AgentDialog.tsx` + `stores/agent-dialog.ts`, monté dans `Shell`), la suppression comprise (deux clics). Un agent créé depuis le panneau ou la palette devient le choix du projet. L'intent `new-agent` du store de mise en page disparaît.
- Paramètres › Agents : liste des agents enregistrés (créer, modifier ; la suppression passe par le dialogue).
- La page « Agents » garde sa liste jusqu'au chantier 4, branchée sur le même dialogue.
- Écart : l'en-tête d'une session montre toujours le compte, pas le nom de l'agent (inchangé).
- Vérifié dans l'app (faux serveur Ollama, dossier de démo) : fil vide, sélecteur, création de « Relecteur » avec un prompt (choisi tout de suite), popover Réglages, premier message → session, réponse en flux ; la requête reçue contient le prompt de l'agent et le message ; « Nouvelle session » revient au fil vide avec « Relecteur » retenu ; Paramètres › Agents liste l'agent.
