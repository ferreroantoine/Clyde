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

### Chantier 3 — fait
- **Protocole** `clyde-file://workspace/<chemin>` (`main/services/file-protocol.ts`, testé) : ne sert que les fichiers du dossier ouvert (`resolveInside`, 403 sinon), répond aux requêtes partielles (206 / 416), aux `HEAD` et `OPTIONS`. Écart : il a fallu le privilège `corsEnabled` et des en-têtes CORS, la page étant un document `file://` (autre origine) : sans eux `fetch()` (pdf.js, Word, tableurs) était bloqué, alors que `<img>` et `<audio>` passaient. CSP : `img-src`, `media-src`, `connect-src` acceptent `clyde-file:`.
- **Choix par extension** (`lib/viewers.ts`, testé) ; l'onglet porte `viewer`, `hasText` et `mode`. Markdown, SVG, CSV/TSV et JSON s'ouvrent dans Monaco **et** en aperçu, avec un bouton Aperçu / Code dans la barre d'onglets (aperçu par défaut, sauf quand on ouvre le fichier sur une ligne précise : résultat de recherche). L'aperçu suit le texte modifié (150 ms après la frappe). Les autres formats ne passent plus par `fs:read` : un `fs:stat` donne taille et date, la visionneuse lit les octets elle-même. Chaque visionneuse est chargée à la demande (`React.lazy`) : pdf.js, mammoth et SheetJS ne pèsent pas sur le démarrage.
- **Visionneuses** (`features/viewers/`) : Markdown (le composant du chat, avec images relatives via `clyde-file://` qui s'agrandissent dans `ImageViewer`, liens vers les fichiers du dossier ouverts dans Clyde) ; images (ajustées, clic / molette pour zoomer, glisser, damier, dimensions et poids) et SVG (dessiné depuis le texte, dans un `<img>` : aucun script) ; PDF (`pdfjs-dist` 6 : pages dessinées à l'approche, zoom, ajuster à la largeur, couche de texte sélectionnable, recherche surlignée avec l'API CSS Custom Highlight) ; audio / vidéo (lecteur de Chromium ; si le format n'est pas lu : message et « Ouvrir avec l'application par défaut ») ; CSV/TSV (analyse RFC 4180 testée, `;` deviné pour les exports européens, grille virtualisée à en-tête fixe, tri numérique puis alphabétique ; au-delà de 100 000 lignes ou de 5 Mo, le début du fichier et un avertissement) ; JSON / JSONL (arbre repliable, erreur d'analyse → « Voir le code ») ; Word (mammoth → DOMPurify) ; Excel / ODS (SheetJS 0.20.3 depuis cdn.sheetjs.com, la version npm n'étant plus maintenue ; un onglet par feuille) ; autres → « Ce fichier ne peut pas être affiché » + « Ouvrir avec l'application par défaut » (`fs:openDefault` → `shell.openPath`) et « Afficher dans l'Explorateur ».
- La barre d'état ne montre plus ligne, colonne et langage hors de la vue code.
- Dépendances (en `devDependencies`, comme les autres bibliothèques du renderer, que Vite embarque) : `pdfjs-dist`, `mammoth`, `xlsx`, `dompurify` (l'override existant devient `$dompurify`). `licenses.json` régénéré.
- Limites connues : pdf.js tourne sans ses décodeurs wasm (images JPEG 2000 / JBIG2) ni ses polices standard et cartes CJK (polices non incluses remplacées par celles du système) ; les images du Markdown **du chat** restent affichées en texte alternatif.
- Vérifié dans l'app sur un dossier d'exemples généré (Markdown avec image, lien et formule ; PNG ; SVG ; PDF de deux pages avec texte ; WAV ; faux MKV ; CSV en `;` avec un champ entre guillemets ; JSON ; DOCX ; XLSX à deux feuilles ; binaire) : chaque visionneuse, bascule Aperçu / Code, recherche « visionneuse » dans le PDF (2 résultats, surlignés), tri du CSV par population.

### Chantier 4 — fait
- **Données** : migration 18, table `todos` (dossier du projet, texte, colonne, session, origine `user` / `agent`, clé du fournisseur, « en train de », position, `done_at`). Les tâches du tableau sont recopiées (à faire → À faire ; en cours et à valider → En cours ; terminé → Fait), puis l'ancienne table est supprimée. Les worktrees de tâches ni fusionnées ni abandonnées encore présents sur le disque font l'objet d'un avis unique (branche, chemin) : **Clyde ne les supprime pas**. Paramètres : migration v3 → v4, qui retire `agents.worktreesFolder` et `agents.deleteMergedWorktrees` et renomme la vue de démarrage `agents` en `tasks`. La vue mémorisée `agents` devient `tasks`.
- **Événement commun** `{ type: 'todos', items }` (liste entière). Claude Code : déduit de chaque appel `TodoWrite` dans le gestionnaire (sa liste à cocher dans le fil reste). Codex : `turn/plan/updated` sort de la sourdine. Boucle API : outil `update_todos` toujours proposé hors chat, sans demande d'autorisation ; il renvoie un accusé « 1/3 done, in progress: … ». Antigravity : serveur MCP local « clyde » (`mcp/clyde-server.ts`, HTTP streamable sans état sur 127.0.0.1, un jeton aléatoire par session dans l'URL, libéré à la fin de la session) ajouté à sa configuration ; ses règles autorisent `mcp(clyde/update_todos)` à tous les niveaux. Écart : la règle « Deny l'emporte sur Allow » d'agy obligeait à refuser les autres outils MCP un par un au lieu de `mcp(*)` aux niveaux bas. Les sessions de chat n'ont ni consigne, ni outil, ni tâches.
- **Le réflexe** (`todoReflex`) : une consigne courte qui nomme l'outil réel du fournisseur (TodoWrite, update_plan, update_todos, update_todos du serveur clyde), ajoutée au prompt de toute session de projet (Claude Code : `append`).
- **`TodoService`** (main) : les éléments retrouvent leur tâche par clé, sinon par texte (casse, espaces et point final ignorés). Une tâche retirée de la liste par l'agent disparaît, sauf si elle est faite ou si l'utilisateur l'avait écrite. Une tâche « Moi » non attribuée dont l'agent écrit le même texte est **reprise** par sa session (cas de « Confier à l'agent » sans session ouverte) au lieu d'être doublée. Logique pure `reconcile` testée, service testé sur une base SQLite en mémoire, migration testée depuis la v17.
- **Écran Tâches** (`features/tasks/`) : À faire / En cours / Fait ; cartes avec la session (pastille de couleur du compte, nom de l'agent enregistré sinon du compte) ou « Moi » ; tâche en cours d'un agent mise en avant avec « En train de : … ». Filtres Toutes / Mes tâches / une session, « Masquer les terminées », faites de plus de 7 jours repliées. Champ d'ajout en tête d'À faire, glisser-déposer entre colonnes et dans une colonne, double-clic pour modifier, menu (modifier, ouvrir la session, confier à l'agent, supprimer). Clic sur une carte d'agent → sa session dans le panneau de droite. Dans l'en-tête de session : « 1/3 · En cours : … », qui ouvre Tâches filtrée sur la session. Explorateur : « Ajouter aux tâches… » ; palette : « Nouvelle tâche… » met le focus sur le champ d'ajout.
- **Retirés** : `TaskService`, `services/worktrees.ts` (`parseNameStatus` déplacé dans `git/parse.ts`), relecture, fusion, IPC `tasks:*`, page « Agents » ; `DiffView` est passé dans `features/git`. Les agents enregistrés ont leur propre store (`stores/saved-agents.ts`).
- Vérifié dans l'app (faux serveur Ollama qui appelle `update_todos`) : la requête contient la consigne et l'outil ; trois cartes de l'agent dans les bonnes colonnes, avec « En train de : Correction de la faute » ; ajout d'une tâche « Moi » ; filtres « Mes tâches » et par session ; ligne « 1/3 » de l'en-tête → Tâches filtrée. **Non vérifié en vrai** : Claude Code (pas de session lancée), Codex (non installé), Antigravity (n'aurait été possible qu'avec un compte configuré et en consommant du quota). Leurs chemins sont couverts par des tests : `TodoWrite` via le faux SDK, traduction du plan Codex, serveur MCP clyde avec le client MCP officiel, règles agy. Que ces agents tiennent leur liste « par réflexe » reste à observer en usage réel.
