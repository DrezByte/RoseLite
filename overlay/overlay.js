// Plugin loader + overlay navigation + i18n. ponytail: no router / no i18n lib.
// Chrome strings are bilingual (STR); game data (items/quests/recipes/guides/
// events) is English, loaded from RoseData via data.js. Items are the linking
// hub: any item name → clickable → its page in Objets (see openItemPage).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ipcRenderer, clipboard, shell, webFrame } = require('electron');
const D = require('./data.js');   // RoseData: items, quests, recipes, guides, events
const L = require('./logic.js');  // pure kings/gems logic, shared with the self-checks

const esc = (str) => String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Accent-insensitive search key: "epee" matches "Épée" and vice versa.
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
console.assert(fold('Épée') === 'epee' && fold('epee') === 'epee', 'fold: accent-insensitive');

// Persisted UI state is user data, not trusted input: browser migrations,
// interrupted writes, or manual edits must never prevent the renderer booting.
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function readJson(key, fallback, valid = () => true) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch (err) {
    console.warn(`[storage] ignored invalid ${key}:`, err.message || err);
    return fallback;
  }
}
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof window.requestCloudSync === 'function') window.requestCloudSync(key);
    return true;
  } catch (err) { console.warn(`[storage] could not save ${key}:`, err.message || err); return false; }
}

// ── Chrome strings (the UI language) ───────────────────────────────────────
const STR = {
  en: {
    home: 'Home', back: 'Back', playtime: 'Play time',
    quests: 'Quests', materials: 'Materials',
    strongVs: 'Strong against', weakVs: 'Weak against', active: 'Active', next: 'Next',
    search: 'Search…', usedIn: 'Used in', droppedBy: 'Dropped by', markDone: 'Mark completed', markTodo: 'Mark to do', questCompleted: 'Quest completed',
    achUnlocked: 'Achievement unlocked',
    achSecretUnlocked: 'Secret unlocked',
    achClaimHint: 'Reward ready to claim',
    ofMatches: 'of', refineSearch: 'refine search', noStats: 'No extra stats.', craftable: 'Craftable',
    npcPrice: 'NPC Price', marketPrice: 'Market Price', history: 'Price history', marketNA: 'Not on market', marketErr: 'Unavailable',
    copyLink: 'Copy item link', copyLoc: 'Copy shop location', copied: 'Copied!', pin: 'Pin item', pinned: 'Pinned',
    roseAccount: 'Market data (roseutils)', connectRose: 'Connect roseutils', connected: 'Connected ✓',
    fType: 'Type', fPlanet: 'Planet', fJob: 'Class', fLevel: 'Level', fCraftable: 'Craftable only', fTags: 'Tags', fStat: 'Stat bonus', filters: 'Filters', hideCompleted: 'Hide completed',
    language: 'Language', titleMap: 'Title screen', titleMapNA: 'rose.toml not found — set the ROSE AppData folder below.', skipCutscene: 'Skip planet cutscenes',
    accent: 'Accent color', bgColor: 'Background color', font: 'Font', uiScale: 'Interface size',
    gameDirLbl: 'ROSE Online folder', roseDataLbl: 'ROSE AppData folder', change: 'Change…',
    panelWidth: 'Panel width', refresh: 'Refresh',
    shoutName: 'Name (e.g. Selling DG)', shoutText: 'Message to paste later…', shoutSave: 'Save shout',
    shoutEmpty: 'No saved shouts. Add one above.',
    modRelaunch: 'Relaunch the game to apply changes.', modFiles: 'files',
    modsNone: 'No mods found in the mods/ folder.', modsBadDir: 'Game folder not found — set "gameDir" in config.json.',
    noEventDetail: 'Details coming soon.', emptyTitle: 'Pick a section', emptyBody: 'Choose a menu item above to see it here.',
    weekly: 'Weekly', calNote: 'Note', calNotePh: 'Write a note for this day…',
    feedVideo: 'Video', feedEvent: 'Event', feedPatch: 'Patch Notes',
    kingsNote: 'Tap a king when you kill it — the timer counts down to its respawn.', kingUp: 'is up!', kingsSearch: 'Filter kings…', kingsZone: 'By zone', kingsNext: 'Next spawn',
    kingRunning: 'respawning', kingArm: 'not timed', kingAction: 'Activate when killed', kingRestart: 'Restart timer', kingReset: 'Reset timer', kingArmed: 'Respawn timer started', kingCleared: 'Respawn timer cleared',
    monsterHelp: 'Toggle a monster to be alerted when it spawns near you.', monsterSpawn: 'Spawned nearby',
    spawnAlerts: 'Spawn alerts', mobDrops: 'Drops', mobNoDrops: 'No known drops.', fRank: 'Rank',
    liveOffTitle: 'Live data needed', liveOffBody: 'This section needs a live game-state source. RoseLite ships without one, so it stays empty for now.',
    alerts: 'Alerts', alertsEmpty: 'No alerts yet.', alertsClear: 'Clear', soundLbl: 'Alert sound',
    soundCustom: 'Custom', soundFolder: 'Custom sounds folder', openLbl: 'Open', storageErr: 'Could not save on this device. Check available disk space and try again.',
    tips: { settings: 'Settings', fullscreen: 'Fullscreen', dock: 'Dock window', collapse: 'Collapse', quit: 'Quit RoseLite', navHide: 'Hide menu', navShow: 'Show menu' },
    launcher: { title: 'Choose your account', sub: 'Each account keeps its own loot & mob history — shouts are shared.', add: 'Add', email: 'email@example.com', launch: 'Launch ROSE Online', empty: 'No account saved yet. Add one below.', pick: 'Select an account to launch.', err: 'Launch failed — check gameDir in config.json', play: 'Play', accounts: 'Accounts', news: 'News', settings: 'Settings', addTitle: 'Add account', editTitle: 'Edit account', emailLabel: 'Email', password: 'Password', pwKeep: 'Leave blank to keep current', save: 'Save', cancel: 'Cancel', del: 'Delete', errEmail: 'Enter a valid email.', errPw: 'Enter a password.', delConfirm: 'Delete this account?', nickname: 'Nickname', nickOpt: 'Nickname (optional)', icon: 'Class icon', iconNone: 'None', hideEmails: 'Hide emails', moreIcons: 'More icons…', iconSearch: 'Search all game icons…',
      updChecking: 'Checking files…', updDownloading: 'Downloading updates…', updVerifying: 'Verifying files…', updUpdater: 'Updating updater…', updDone: 'Game is up to date', updError: 'Update failed', updRetry: 'Retry', updRepair: 'Repair game files', updOld: "This updater can't update in the background", updOpenGui: 'Open official updater' },
    sec: { personnage: 'Character', quetes: 'Quests', recettes: 'Recipes', gems: 'Gems', objets: 'Items', marche: 'Market', evenements: 'Events', guides: 'Guides', cris: 'Shouts', butin: 'Loot', dps: 'DPS Meter', journaux: 'Dungeon Logs', tracker: 'Tracker', monstres: 'Monsters', rois: 'Kings', extensions: 'Add-ons', parametres: 'Settings' },
    group: { suivi: 'Tracking', reference: 'Reference', extras: 'Extras' },
    dl: { logTitle: 'Log a run', dungeon: 'Dungeon', duration: 'Duration', paste: 'Paste the scoreboard rows (one player per line)…', save: 'Save run',
      pickYou: 'Tap your row to mark it as yours', youAre: 'You', emptyTitle: 'No runs logged yet', emptyBody: 'Log a dungeon run above to start tracking your DPS and clear times.',
      badPaste: 'Couldn’t read any player rows — check the paste.', runs: 'runs', best: 'best', yourDps: 'your DPS', avgDps: 'avg DPS', logged: 'logged',
      cols: { name: 'Name', cls: 'Class', deaths: 'D', kills: 'K', dmgIn: 'Dmg', dmgRcv: 'Taken', healIn: 'Heal', healRcv: 'HealRcv', reflect: 'Refl', block: 'Blk', dps: 'DPS' } },
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  },
  fr: {
    home: 'Accueil', back: 'Retour', playtime: 'Temps de jeu',
    quests: 'Quêtes', materials: 'Matériaux',
    strongVs: 'Fort contre', weakVs: 'Faible contre', active: 'En cours', next: 'Prochain',
    search: 'Rechercher…', usedIn: 'Utilisé dans', droppedBy: 'Lâché par', markDone: 'Marquer terminée', markTodo: 'Marquer à faire', questCompleted: 'Quête terminée',
    achUnlocked: 'Succès débloqué',
    achSecretUnlocked: 'Secret débloqué',
    achClaimHint: 'Récompense à récupérer',
    ofMatches: 'sur', refineSearch: 'affinez la recherche', noStats: 'Aucune statistique.', craftable: 'Fabricable',
    npcPrice: 'Prix PNJ', marketPrice: 'Prix du marché', history: 'Historique des prix', marketNA: 'Pas sur le marché', marketErr: 'Indisponible',
    copyLink: 'Copier le lien', copyLoc: 'Copier l\'emplacement', copied: 'Copié !', pin: 'Épingler', pinned: 'Épinglés',
    roseAccount: 'Données de marché (roseutils)', connectRose: 'Se connecter à roseutils', connected: 'Connecté ✓',
    fType: 'Type', fPlanet: 'Planète', fJob: 'Classe', fLevel: 'Niveau', fCraftable: 'Fabricables', fTags: 'Tags', fStat: 'Bonus de stat', filters: 'Filtres', hideCompleted: 'Masquer les terminées',
    language: 'Langue', titleMap: 'Écran-titre', titleMapNA: 'rose.toml introuvable — définissez le dossier ROSE AppData ci-dessous.', skipCutscene: 'Passer les cinématiques de planète',
    accent: 'Couleur d\'accent', bgColor: 'Couleur de fond', font: 'Police', uiScale: 'Taille de l\'interface',
    gameDirLbl: 'Dossier ROSE Online', roseDataLbl: 'Dossier ROSE AppData', change: 'Changer…',
    panelWidth: 'Largeur du panneau', refresh: 'Rafraîchissement',
    shoutName: 'Nom (ex : Vente DG)', shoutText: 'Message à coller plus tard…', shoutSave: 'Enregistrer le cri',
    shoutEmpty: 'Aucun cri sauvegardé. Ajoutez-en un ci-dessus.',
    modRelaunch: 'Relancez le jeu pour appliquer les changements.', modFiles: 'fichiers',
    modsNone: 'Aucun mod dans le dossier mods/.', modsBadDir: 'Dossier du jeu introuvable — définissez "gameDir" dans config.json.',
    noEventDetail: 'Détails à venir.', emptyTitle: 'Choisissez une section', emptyBody: 'Sélectionnez un élément du menu ci-dessus pour l’afficher ici.',
    weekly: 'Hebdo', calNote: 'Note', calNotePh: 'Écrire une note pour ce jour…',
    feedVideo: 'Vidéo', feedEvent: 'Événement', feedPatch: 'Notes de patch',
    kingsNote: 'Tape un roi quand tu le tues — le compte à rebours démarre.', kingUp: 'est up !', kingsSearch: 'Filtrer les rois…', kingsZone: 'Par zone', kingsNext: 'Prochain spawn',
    kingRunning: 'réapparition', kingArm: 'non chronométré', kingAction: 'Activer après l’élimination', kingRestart: 'Redémarrer le timer', kingReset: 'Réinitialiser le timer', kingArmed: 'Timer de réapparition lancé', kingCleared: 'Timer de réapparition effacé',
    monsterHelp: 'Activez un monstre pour être alerté quand il apparaît près de vous.', monsterSpawn: 'Apparu à proximité',
    spawnAlerts: 'Alertes de spawn', mobDrops: 'Butin', mobNoDrops: 'Aucun butin connu.', fRank: 'Rang',
    liveOffTitle: 'Données live requises', liveOffBody: "Cette section a besoin d'une source de données de jeu en direct. RoseLite n'en fournit pas, elle reste donc vide pour le moment.",
    alerts: 'Alertes', alertsEmpty: 'Aucune alerte pour l’instant.', alertsClear: 'Effacer', soundLbl: 'Son des alertes',
    soundCustom: 'Perso', soundFolder: 'Dossier des sons perso', openLbl: 'Ouvrir', storageErr: 'Enregistrement impossible sur cet appareil. Vérifiez l’espace disque disponible et réessayez.',
    tips: { settings: 'Paramètres', fullscreen: 'Plein écran', dock: 'Réduire la fenêtre', collapse: 'Réduire', quit: 'Quitter RoseLite', navHide: 'Masquer le menu', navShow: 'Afficher le menu' },
    launcher: { title: 'Choisissez votre compte', sub: 'Chaque compte garde son propre butin et son historique de monstres — les cris sont partagés.', add: 'Ajouter', email: 'email@example.com', launch: 'Lancer ROSE Online', empty: 'Aucun compte enregistré. Ajoutez-en un ci-dessous.', pick: 'Sélectionnez un compte à lancer.', err: 'Échec du lancement — vérifiez gameDir dans config.json', play: 'Jouer', accounts: 'Comptes', news: 'Actualités', settings: 'Paramètres', addTitle: 'Ajouter un compte', editTitle: 'Modifier le compte', emailLabel: 'E-mail', password: 'Mot de passe', pwKeep: 'Laisser vide pour conserver', save: 'Enregistrer', cancel: 'Annuler', del: 'Supprimer', errEmail: 'Saisissez un e-mail valide.', errPw: 'Saisissez un mot de passe.', delConfirm: 'Supprimer ce compte ?', nickname: 'Pseudo', nickOpt: 'Pseudo (facultatif)', icon: 'Icône de classe', iconNone: 'Aucune', hideEmails: 'Masquer les e-mails', moreIcons: 'Plus d\'icônes…', iconSearch: 'Rechercher toutes les icônes…',
      updChecking: 'Vérification des fichiers…', updDownloading: 'Téléchargement des mises à jour…', updVerifying: 'Vérification des fichiers…', updUpdater: 'Mise à jour du lanceur…', updDone: 'Le jeu est à jour', updError: 'Échec de la mise à jour', updRetry: 'Réessayer', updRepair: 'Réparer les fichiers du jeu', updOld: 'Ce lanceur ne peut pas mettre à jour en arrière-plan', updOpenGui: 'Ouvrir le lanceur officiel' },
    sec: { personnage: 'Personnage', quetes: 'Quêtes', recettes: 'Recettes', gems: 'Gemmes', objets: 'Objets', marche: 'Marché', evenements: 'Événements', guides: 'Guides', cris: 'Cris', butin: 'Butin', dps: 'DPS', journaux: 'Journaux de donjon', tracker: 'Tracker', monstres: 'Monstres', rois: 'Rois', extensions: 'Extensions', parametres: 'Paramètres' },
    group: { suivi: 'Suivi', reference: 'Références', extras: 'Extras' },
    dl: { logTitle: 'Enregistrer un run', dungeon: 'Donjon', duration: 'Durée', paste: 'Collez les lignes du tableau (un joueur par ligne)…', save: 'Enregistrer',
      pickYou: 'Touchez votre ligne pour vous identifier', youAre: 'Vous', emptyTitle: 'Aucun run enregistré', emptyBody: 'Enregistrez un run de donjon ci-dessus pour suivre votre DPS et vos temps.',
      badPaste: 'Impossible de lire les lignes — vérifiez le collage.', runs: 'runs', best: 'record', yourDps: 'votre DPS', avgDps: 'DPS moyen', logged: 'le',
      cols: { name: 'Nom', cls: 'Classe', deaths: 'M', kills: 'K', dmgIn: 'Dgts', dmgRcv: 'Reçus', healIn: 'Soin', healRcv: 'SoinR', reflect: 'Refl', block: 'Blk', dps: 'DPS' } },
    months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  },
  // pt-BR / fil / th / ja: UI chrome only (like FR). Game data (items/quests/…) stays English.
  pt: {
    home: 'Início', back: 'Voltar', playtime: 'Tempo de jogo',
    quests: 'Missões', materials: 'Materiais',
    strongVs: 'Forte contra', weakVs: 'Fraco contra', active: 'Ativo', next: 'Próximo',
    search: 'Pesquisar…', usedIn: 'Usado em', markDone: 'Marcar como concluída', markTodo: 'Marcar como a fazer',
    ofMatches: 'de', refineSearch: 'refine a busca', noStats: 'Sem atributos extras.', craftable: 'Fabricável',
    npcPrice: 'Preço NPC', marketPrice: 'Preço de mercado', history: 'Histórico de preços', marketNA: 'Fora do mercado', marketErr: 'Indisponível',
    copyLink: 'Copiar link do item', copyLoc: 'Copiar local da loja', copied: 'Copiado!', pin: 'Fixar item', pinned: 'Fixados',
    roseAccount: 'Dados de mercado (roseutils)', connectRose: 'Conectar roseutils', connected: 'Conectado ✓',
    fType: 'Tipo', fPlanet: 'Planeta', fJob: 'Classe', fLevel: 'Nível', fCraftable: 'Só fabricáveis', fTags: 'Tags', hideCompleted: 'Ocultar concluídas',
    language: 'Idioma',
    panelWidth: 'Largura do painel', refresh: 'Atualização',
    shoutName: 'Nome (ex: Vendendo DG)', shoutText: 'Mensagem para colar depois…', shoutSave: 'Salvar grito',
    shoutEmpty: 'Nenhum grito salvo. Adicione um acima.',
    modRelaunch: 'Reinicie o jogo para aplicar as mudanças.', modFiles: 'arquivos',
    modsNone: 'Nenhum mod na pasta mods/.', modsBadDir: 'Pasta do jogo não encontrada — defina "gameDir" em config.json.',
    noEventDetail: 'Detalhes em breve.', emptyTitle: 'Escolha uma seção', emptyBody: 'Selecione um item do menu acima para vê-lo aqui.',
    kingsNote: 'Toque num rei ao matá-lo — a contagem até o respawn começa.',
    monsterHelp: 'Ative um monstro para ser alertado quando ele aparecer perto de você.', monsterSpawn: 'Apareceu por perto',
    launcher: { title: 'Escolha sua conta', sub: 'Cada conta guarda seu próprio loot e histórico de monstros — os gritos são compartilhados.', add: 'Adicionar', email: 'email@exemplo.com', launch: 'Iniciar ROSE Online', empty: 'Nenhuma conta salva. Adicione uma abaixo.', pick: 'Selecione uma conta para iniciar.', err: 'Falha ao iniciar — verifique gameDir em config.json' },
    sec: { personnage: 'Personagem', quetes: 'Missões', recettes: 'Receitas', gems: 'Gemas', objets: 'Itens', marche: 'Mercado', evenements: 'Eventos', guides: 'Guias', cris: 'Gritos', butin: 'Loot', dps: 'DPS', journaux: 'Registros de Masmorra', tracker: 'Tracker', monstres: 'Monstros', rois: 'Reis', extensions: 'Extensões', parametres: 'Configurações' },
    group: { suivi: 'Acompanhamento', reference: 'Referência', extras: 'Extras' },
    months: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  },
  fil: {
    home: 'Home', back: 'Bumalik', playtime: 'Oras ng laro',
    quests: 'Mga Quest', materials: 'Mga materyales',
    strongVs: 'Malakas laban sa', weakVs: 'Mahina laban sa', active: 'Aktibo', next: 'Susunod',
    search: 'Maghanap…', usedIn: 'Ginagamit sa', markDone: 'Markahang tapos', markTodo: 'Markahang gagawin',
    ofMatches: 'sa', refineSearch: 'pinuhin ang paghahanap', noStats: 'Walang karagdagang stats.', craftable: 'Puwedeng gawin',
    npcPrice: 'Presyo ng NPC', marketPrice: 'Presyo sa market', history: 'Kasaysayan ng presyo', marketNA: 'Wala sa market', marketErr: 'Hindi available',
    copyLink: 'Kopyahin ang link ng item', copyLoc: 'Kopyahin ang lokasyon ng tindahan', copied: 'Nakopya!', pin: 'I-pin ang item', pinned: 'Naka-pin',
    roseAccount: 'Data ng market (roseutils)', connectRose: 'Kumonekta sa roseutils', connected: 'Nakakonekta ✓',
    fType: 'Uri', fPlanet: 'Planeta', fJob: 'Klase', fLevel: 'Level', fCraftable: 'Puwedeng gawin lang', fTags: 'Mga tag', hideCompleted: 'Itago ang tapos na',
    language: 'Wika',
    panelWidth: 'Lapad ng panel', refresh: 'Pag-refresh',
    shoutName: 'Pangalan (hal. Nagbebenta ng DG)', shoutText: 'Mensaheng ipe-paste mamaya…', shoutSave: 'I-save ang shout',
    shoutEmpty: 'Walang naka-save na shout. Magdagdag sa itaas.',
    modRelaunch: 'I-relaunch ang laro para mag-apply ang mga pagbabago.', modFiles: 'na file',
    modsNone: 'Walang mod sa folder na mods/.', modsBadDir: 'Hindi mahanap ang folder ng laro — itakda ang "gameDir" sa config.json.',
    noEventDetail: 'Paparating na ang detalye.', emptyTitle: 'Pumili ng seksyon', emptyBody: 'Pumili ng item sa menu sa itaas para makita dito.',
    kingsNote: 'I-tap ang king kapag napatay — magbibilang pababa hanggang respawn.',
    monsterHelp: 'I-toggle ang isang monster para ma-alertuhan kapag lumitaw ito malapit sa iyo.', monsterSpawn: 'Lumitaw malapit',
    launcher: { title: 'Piliin ang iyong account', sub: 'Bawat account ay may sariling loot at mob history — shared ang mga shout.', add: 'Idagdag', email: 'email@halimbawa.com', launch: 'I-launch ang ROSE Online', empty: 'Wala pang naka-save na account. Magdagdag sa ibaba.', pick: 'Pumili ng account na ila-launch.', err: 'Nabigo ang launch — tingnan ang gameDir sa config.json' },
    sec: { personnage: 'Karakter', quetes: 'Mga Quest', recettes: 'Mga Recipe', gems: 'Mga Hiyas', objets: 'Mga Item', marche: 'Merkado', evenements: 'Mga Event', guides: 'Mga Gabay', cris: 'Mga Shout', butin: 'Loot', dps: 'DPS', journaux: 'Dungeon Logs', tracker: 'Tracker', monstres: 'Mga Monster', rois: 'Mga King', extensions: 'Mga Add-on', parametres: 'Mga Setting' },
    group: { suivi: 'Pagsubaybay', reference: 'Sanggunian', extras: 'Mga Extra' },
    months: ['Ene', 'Peb', 'Mar', 'Abr', 'May', 'Hun', 'Hul', 'Ago', 'Set', 'Okt', 'Nob', 'Dis']
  },
  th: {
    home: 'หน้าแรก', back: 'กลับ', playtime: 'เวลาเล่น',
    quests: 'เควส', materials: 'วัตถุดิบ',
    strongVs: 'แข็งแกร่งต่อ', weakVs: 'อ่อนแอต่อ', active: 'กำลังใช้งาน', next: 'ถัดไป',
    search: 'ค้นหา…', usedIn: 'ใช้ใน', markDone: 'ทำเครื่องหมายว่าเสร็จ', markTodo: 'ทำเครื่องหมายว่ายังไม่ทำ',
    ofMatches: 'จาก', refineSearch: 'ปรับการค้นหา', noStats: 'ไม่มีค่าสถานะเพิ่มเติม', craftable: 'คราฟต์ได้',
    npcPrice: 'ราคา NPC', marketPrice: 'ราคาตลาด', history: 'ประวัติราคา', marketNA: 'ไม่มีในตลาด', marketErr: 'ไม่พร้อมใช้งาน',
    copyLink: 'คัดลอกลิงก์ไอเทม', copyLoc: 'คัดลอกตำแหน่งร้าน', copied: 'คัดลอกแล้ว!', pin: 'ปักหมุดไอเทม', pinned: 'ปักหมุดแล้ว',
    roseAccount: 'ข้อมูลตลาด (roseutils)', connectRose: 'เชื่อมต่อ roseutils', connected: 'เชื่อมต่อแล้ว ✓',
    fType: 'ประเภท', fPlanet: 'ดาว', fJob: 'คลาส', fLevel: 'เลเวล', fCraftable: 'เฉพาะที่คราฟต์ได้', fTags: 'แท็ก', hideCompleted: 'ซ่อนที่เสร็จแล้ว',
    language: 'ภาษา',
    panelWidth: 'ความกว้างแผง', refresh: 'รีเฟรช',
    shoutName: 'ชื่อ (เช่น ขาย DG)', shoutText: 'ข้อความไว้วางทีหลัง…', shoutSave: 'บันทึกข้อความ',
    shoutEmpty: 'ยังไม่มีข้อความที่บันทึก เพิ่มด้านบน',
    modRelaunch: 'รีสตาร์ทเกมเพื่อใช้การเปลี่ยนแปลง', modFiles: 'ไฟล์',
    modsNone: 'ไม่พบม็อดในโฟลเดอร์ mods/', modsBadDir: 'ไม่พบโฟลเดอร์เกม — ตั้งค่า "gameDir" ใน config.json',
    noEventDetail: 'รายละเอียดเร็ว ๆ นี้', emptyTitle: 'เลือกหมวด', emptyBody: 'เลือกเมนูด้านบนเพื่อแสดงที่นี่',
    kingsNote: 'แตะบอสเมื่อฆ่ามัน — เริ่มนับถอยหลังจนกว่าจะเกิดใหม่',
    monsterHelp: 'เปิดสวิตช์มอนสเตอร์เพื่อรับแจ้งเตือนเมื่อมันเกิดใกล้คุณ', monsterSpawn: 'เกิดใกล้ ๆ',
    launcher: { title: 'เลือกบัญชีของคุณ', sub: 'แต่ละบัญชีเก็บของดรอปและประวัติมอนสเตอร์แยกกัน — ข้อความตะโกนใช้ร่วมกัน', add: 'เพิ่ม', email: 'email@example.com', launch: 'เปิด ROSE Online', empty: 'ยังไม่มีบัญชีที่บันทึก เพิ่มด้านล่าง', pick: 'เลือกบัญชีเพื่อเปิด', err: 'เปิดไม่สำเร็จ — ตรวจสอบ gameDir ใน config.json' },
    sec: { personnage: 'ตัวละคร', quetes: 'เควส', recettes: 'สูตรคราฟต์', gems: 'อัญมณี', objets: 'ไอเทม', marche: 'ตลาด', evenements: 'อีเวนต์', guides: 'ไกด์', cris: 'ตะโกน', butin: 'ของดรอป', dps: 'DPS', journaux: 'บันทึกดันเจียน', tracker: 'Tracker', monstres: 'มอนสเตอร์', rois: 'บอส', extensions: 'ส่วนเสริม', parametres: 'ตั้งค่า' },
    group: { suivi: 'ติดตาม', reference: 'ข้อมูลอ้างอิง', extras: 'อื่น ๆ' },
    months: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  },
  ja: {
    home: 'ホーム', back: '戻る', playtime: 'プレイ時間',
    quests: 'クエスト', materials: '素材',
    strongVs: '有利', weakVs: '不利', active: '開催中', next: '次回',
    search: '検索…', usedIn: '使用先', markDone: '完了にする', markTodo: '未完了にする',
    ofMatches: '/', refineSearch: '検索を絞り込む', noStats: '追加ステータスなし', craftable: '製作可能',
    npcPrice: 'NPC価格', marketPrice: '市場価格', history: '価格履歴', marketNA: '市場になし', marketErr: '利用不可',
    copyLink: 'アイテムリンクをコピー', copyLoc: '店舗の場所をコピー', copied: 'コピーしました！', pin: 'アイテムをピン', pinned: 'ピン留め',
    roseAccount: '市場データ (roseutils)', connectRose: 'roseutilsに接続', connected: '接続済み ✓',
    fType: 'タイプ', fPlanet: '惑星', fJob: 'クラス', fLevel: 'レベル', fCraftable: '製作可能のみ', fTags: 'タグ', hideCompleted: '完了を隠す',
    language: '言語',
    panelWidth: 'パネル幅', refresh: '更新間隔',
    shoutName: '名前（例：DG販売）', shoutText: '後で貼り付けるメッセージ…', shoutSave: 'シャウトを保存',
    shoutEmpty: '保存されたシャウトはありません。上から追加してください。',
    modRelaunch: '変更を適用するにはゲームを再起動してください。', modFiles: 'ファイル',
    modsNone: 'mods/ フォルダーにMODがありません。', modsBadDir: 'ゲームフォルダーが見つかりません — config.json の "gameDir" を設定してください。',
    noEventDetail: '詳細は近日公開。', emptyTitle: 'セクションを選択', emptyBody: '上のメニュー項目を選ぶとここに表示されます。',
    kingsNote: '倒したらボスをタップ — リポップまでカウントダウン。',
    monsterHelp: 'モンスターをオンにすると、近くに出現したとき通知されます。', monsterSpawn: '近くに出現',
    launcher: { title: 'アカウントを選択', sub: '各アカウントはドロップとモンスター履歴を個別に保持します — シャウトは共有されます。', add: '追加', email: 'email@example.com', launch: 'ROSE Onlineを起動', empty: '保存されたアカウントはありません。下から追加してください。', pick: '起動するアカウントを選択してください。', err: '起動に失敗 — config.json の gameDir を確認してください' },
    sec: { personnage: 'キャラクター', quetes: 'クエスト', recettes: 'レシピ', gems: 'ジェム', objets: 'アイテム', marche: '市場', evenements: 'イベント', guides: 'ガイド', cris: 'シャウト', butin: 'ドロップ', dps: 'DPS', journaux: 'ダンジョン記録', tracker: 'Tracker', monstres: 'モンスター', rois: 'ボス', extensions: 'アドオン', parametres: '設定' },
    group: { suivi: 'トラッキング', reference: 'リファレンス', extras: 'その他' },
    months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
  }
};
const LANGS = { en: 'EN', fr: 'FR', pt: 'PT-BR', fil: 'FIL', th: 'TH', ja: 'JA' };
const LOCALES = { en: 'en-US', fr: 'fr-FR', pt: 'pt-BR', fil: 'fil-PH', th: 'th-TH', ja: 'ja-JP' };
let lang = localStorage.getItem('roselite-lang') || 'en';
if (!LANGS[lang]) lang = 'en';
const locale = () => LOCALES[lang] || LOCALES.en;
const ONBOARD_STR = {
  en: {
    title: 'Your ROSE companion is almost ready',
    body: 'Launch the game from here and RoseLite will attach beside it, keeping timers, guides, market tools, and your progress within reach.',
    time: 'About 30 seconds · no client modifications',
    game: 'Find your ROSE installation', gameFound: 'ROSE Online found', gameMissing: 'Choose the folder that contains trose.exe', choose: 'Choose folder',
    account: 'Add the account you play on', accountBody: 'Saved securely on this device for one-click launch.', add: 'Add account',
    privacy: 'RoseLite stays outside the game client. No DLL injection or memory reading.'
  },
  fr: {
    title: 'Votre compagnon ROSE est presque prêt',
    body: 'Lancez le jeu depuis ici : RoseLite se placera à côté avec vos timers, guides, outils du marché et votre progression.',
    time: 'Environ 30 secondes · aucune modification du client',
    game: 'Trouver votre installation de ROSE', gameFound: 'ROSE Online détecté', gameMissing: 'Choisissez le dossier qui contient trose.exe', choose: 'Choisir le dossier',
    account: 'Ajouter votre compte de jeu', accountBody: 'Enregistré de façon sécurisée sur cet appareil pour le lancement en un clic.', add: 'Ajouter un compte',
    privacy: 'RoseLite reste hors du client de jeu. Aucune injection DLL ni lecture mémoire.'
  }
};
const onboardText = () => ({ ...ONBOARD_STR.en, ...(ONBOARD_STR[lang] || {}) });

const T = () => STR[lang];

// ── ROSE game accounts (launch targets) ────────────────────────────────────
// Progress (loot history, kills, quests) belongs to this INSTALL, not to a ROSE
// login — see foldLegacyAccountStorage below for the one-time upgrade from the
// old per-account-namespaced layout. `accounts()` is just the launcher's list of
// saved ROSE logins; `activeAccount` is only "which one Play spawns next".
const accounts = () => readJson('roselite-accounts', [], (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'));
let activeAccount = localStorage.getItem('roselite-account') || '';

// Per-account display metadata (nickname + class icon), keyed by email — kept
// apart from the email list so identity/namespacing stays the email. Icons are
// whatever image files sit in overlay/assets/classes/ — drop one in and it shows;
// the icon value stored per account is the filename without extension.
const CLASS_ICON_EXTS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg']);
// base name (no ext) → actual filename, scanned once at boot.
const CLASS_ICON_FILE = (() => {
  const m = {};
  try {
    for (const f of fs.readdirSync(path.join(__dirname, 'assets', 'classes')))
      if (CLASS_ICON_EXTS.has(path.extname(f).toLowerCase())) m[f.slice(0, -path.extname(f).length)] = f;
  } catch {}
  return m;
})();
const CLASS_ICONS = Object.keys(CLASS_ICON_FILE).sort();
const acctMeta = () => readJson('roselite-account-meta', {}, isRecord);
const saveAcctMeta = (m) => writeJson('roselite-account-meta', m);

// ── One-shot fold: pre-product builds namespaced progress per ROSE account
// (`key::email`). Progress now belongs to the RoseLite account, so every
// per-email store collapses into its bare key on first boot after the
// upgrade. Safe to union: sets, max-timestamps, and merged records.
const LEGACY_FOLD_DONE = 'roselite-fold-v2-done';
function foldLegacyAccountStorage() {
  if (localStorage.getItem(LEGACY_FOLD_DONE)) return;
  const emails = accounts();
  const suffixed = (base, email) => `${base}::${email}`;
  const setUnion = (base) => {
    const merged = new Set(readJson(base, [], Array.isArray));
    for (const email of emails) {
      for (const v of readJson(suffixed(base, email), [], Array.isArray)) merged.add(v);
      localStorage.removeItem(suffixed(base, email));
    }
    writeJson(base, [...merged]);
  };
  const recordMerge = (base) => {
    const merged = readJson(base, {}, isRecord);
    for (const email of emails) {
      Object.assign(merged, readJson(suffixed(base, email), {}, isRecord));
      localStorage.removeItem(suffixed(base, email));
    }
    writeJson(base, merged);
  };
  const kingsMerge = (base) => {
    const merged = readJson(base, {}, isRecord);
    for (const email of emails) {
      const incoming = readJson(suffixed(base, email), {}, isRecord);
      for (const [id, ts] of Object.entries(incoming)) {
        const cur = Number(merged[id]);
        if (!Number.isFinite(cur) || Number(ts) > cur) merged[id] = ts;
      }
      localStorage.removeItem(suffixed(base, email));
    }
    writeJson(base, merged);
  };
  const runsMerge = (base) => {
    const seen = new Set();
    const merged = [];
    const add = (run) => {
      const key = isRecord(run) && run.id !== undefined ? `id:${run.id}` : JSON.stringify(run);
      if (seen.has(key)) return;
      seen.add(key); merged.push(run);
    };
    readJson(base, [], Array.isArray).forEach(add);
    for (const email of emails) {
      readJson(suffixed(base, email), [], Array.isArray).forEach(add);
      localStorage.removeItem(suffixed(base, email));
    }
    writeJson(base, merged);
  };
  const lastNonEmptyString = (base) => {
    let value = localStorage.getItem(base) || '';
    for (const email of emails) {
      const v = localStorage.getItem(suffixed(base, email));
      if (v) value = v;
      localStorage.removeItem(suffixed(base, email));
    }
    if (value) localStorage.setItem(base, value);
  };
  const sumInt = (base) => {
    let total = +localStorage.getItem(base) || 0;
    for (const email of emails) {
      total += +localStorage.getItem(suffixed(base, email)) || 0;
      localStorage.removeItem(suffixed(base, email));
    }
    localStorage.setItem(base, String(total));
  };

  setUnion('roselite-items-pinned');
  setUnion('roselite-quests-done');
  kingsMerge('roselite-items-unpinned');
  kingsMerge('roselite-quests-undone');
  recordMerge('roselite.loot');
  recordMerge('roselite.dps');
  kingsMerge('roselite-kings');
  runsMerge('roselite-dungeon-runs');
  lastNonEmptyString('roselite-dungeon-me');
  sumInt('roselite.playtime');
  // No per-account history to combine for gem targets — keep the active
  // account's list (or the first one found) rather than concatenating lists.
  if (!localStorage.getItem('roselite-gem-targets')) {
    const pick = (activeAccount && localStorage.getItem(suffixed('roselite-gem-targets', activeAccount)))
      || emails.map((e) => localStorage.getItem(suffixed('roselite-gem-targets', e))).find(Boolean);
    if (pick) localStorage.setItem('roselite-gem-targets', pick);
  }
  for (const email of emails) localStorage.removeItem(suffixed('roselite-gem-targets', email));
  if (!localStorage.getItem('roselite-cards')) {
    const pick = (activeAccount && localStorage.getItem(suffixed('roselite-cards', activeAccount)))
      || emails.map((e) => localStorage.getItem(suffixed('roselite-cards', e))).find(Boolean);
    if (pick) localStorage.setItem('roselite-cards', pick);
  }
  for (const email of emails) localStorage.removeItem(suffixed('roselite-cards', email));

  localStorage.setItem(LEGACY_FOLD_DONE, '1');
}
foldLegacyAccountStorage();
const hideEmails = () => localStorage.getItem('roselite-hide-emails') === '1';
// Owner-recognisable but shoulder-surf-safe: keep the first char of user + domain.
const maskEmail = (e) => { const [u, d] = String(e).split('@'); return `${(u || '').slice(0, 1)}•••${d ? '@' + d.slice(0, 1) + '•••' : ''}`; };
console.assert(maskEmail('drez@gmail.com') === 'd•••@g•••', 'maskEmail hides the rest');
// Big label for an account: its nickname, else the email (masked when hiding is on).
const acctName = (email) => { const m = acctMeta()[email] || {}; return m.nick || (hideEmails() ? maskEmail(email) : email); };
// Tiny sub-line under the name: the raw email — only when a nickname is the big
// line AND email-hiding is off (otherwise there's nothing safe to show there).
const acctSub = (email) => { const m = acctMeta()[email] || {}; return (m.nick && !hideEmails()) ? email : ''; };
const acctIcon = (email) => (acctMeta()[email] || {}).icon || '';
// icon value stored per account is either a class-asset filename base, or (when it
// contains a '/') a path under RoseData/game-icons picked via "More icons…".
const classIconSrc = (icon) =>
  icon.includes('/') ? `../RoseData/game-icons/${icon}.png`
                     : `assets/classes/${CLASS_ICON_FILE[icon] || icon + '.png'}`;
// Lazy recursive scan of all game icons (relative path, no .png), cached on first use.
let GAME_ICONS = null;
function gameIcons() {
  if (GAME_ICONS) return GAME_ICONS;
  const root = path.join(__dirname, '..', 'RoseData', 'game-icons');
  const out = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name));
    else if (e.name.toLowerCase().endsWith('.png'))
      out.push(path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/').slice(0, -4));
  } };
  try { walk(root); } catch {}
  return (GAME_ICONS = out);
}

// ── Settings state (panel width + color) — persisted, applied on boot ───────
const CFG = require('../config.json');
// Live game state needs a data source, which this build ships without — main
// reports that (sendSync, resolved before first paint) and the three sections
// fed by it render disabled instead of empty/waiting.
const LIVE = ipcRenderer.sendSync('is-live');
const LIVE_SECTIONS = new Set(['personnage', 'butin', 'dps', 'tracker']);
let panelWidth = +localStorage.getItem('roselite-panel-width') || CFG.panelWidth || 260;
// User-configurable folders (picked via native dialog, persisted). Default to
// config.json / the standard AppData path. gameDir is also pushed to main so
// launch() uses the current value. ponytail: two localStorage strings, no schema.
// Auto-detect ROSE's standard install locations when nothing's been picked yet.
// Probe once and verify a marker file, so a wrong guess stays blank ('—') and
// the picker still shows. ponytail: two fixed default paths, no registry walk —
// add a `reg query` if the launcher ever installs somewhere non-default.
const detect = (dir, marker) => { try { return fs.existsSync(path.join(dir, marker)) ? dir : ''; } catch { return ''; } };
const defGameDir = detect('C:\\Program Files\\ROSE Online', '3DDATA');
const defAppData = detect(path.join(process.env.APPDATA || '', 'Rednim Games', 'ROSE Online'), 'config/rose.toml');
const gameDir = () => localStorage.getItem('roselite-game-dir') || CFG.gameDir || defGameDir;
const roseAppData = () => localStorage.getItem('roselite-rose-appdata') || defAppData;
// ── Custom colors — one picked hex per slot recolors the Lunar skin live.
// color-mix() derives every shade, and inline root styles beat the :root token
// block, so the override sticks until reset ('').
const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; };
console.assert(lum('#ffffff') > .99 && lum('#000000') === 0, 'lum broken');
const COLOR_SLOTS = {
  accent: { key: 'roselite-accent', probe: '--ember', vars: (c) => ({
    '--ember': c, '--questgold': c, '--chart': c, '--badge-text': c,
    '--questgold-ink': lum(c) > .55 ? '#241206' : '#fff',   // keep text-on-accent readable
    '--badge-bg': `color-mix(in srgb, ${c} 18%, transparent)`,
    '--frame-ring': `color-mix(in srgb, ${c} 50%, transparent)`,
    '--tile-sel': `linear-gradient(135deg, color-mix(in srgb, ${c} 30%, transparent), color-mix(in srgb, ${c} 14%, transparent))`,
    '--tile-sel-border': `color-mix(in srgb, ${c} 85%, transparent)`,
  }) },
  // The 93%/88% content steps are unchanged — measured at ~6 and ~11 ΔL* off any
  // picked bg, they already match the skins' card/hover depth. Only the chrome moved:
  // header/footer used to derive LIGHTER than the picked bg, which inverted the
  // chrome < field < card stack the moment anyone touched the picker.
  bg: { key: 'roselite-bg', probe: '--rosewood', vars: (c) => ({
    '--rosewood': c, '--rosewood-deep': `color-mix(in oklab, ${c} 88%, black)`,
    '--widget': `color-mix(in oklab, ${c} 93%, white)`, '--widget-hover': `color-mix(in oklab, ${c} 88%, white)`,
    '--header-grad': `linear-gradient(180deg, color-mix(in oklab, ${c} 94%, black), color-mix(in oklab, ${c} 86%, black))`,
    '--footer-grad': `linear-gradient(180deg, color-mix(in oklab, ${c} 94%, black), color-mix(in oklab, ${c} 86%, black))`,
    '--tile-off': `color-mix(in oklab, ${c} 93%, white)`, '--row-bg': `color-mix(in oklab, ${c} 93%, white)`,
    '--search-bg': `color-mix(in oklab, ${c} 90%, black)`,
  }) },
};
const customColor = (slot) => localStorage.getItem(COLOR_SLOTS[slot].key) || '';
const applyColor = (slot, hex) => {
  const s = COLOR_SLOTS[slot], st = document.documentElement.style;
  Object.keys(s.vars('#000')).forEach((k) => st.removeProperty(k));
  if (hex) Object.entries(s.vars(hex)).forEach(([k, v]) => st.setProperty(k, v));
  if (hex) localStorage.setItem(s.key, hex); else localStorage.removeItem(s.key);
};
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ── Font override — pairings of the bundled fonts (index.html @font-face);
// '' = the theme's own pairing. Buttons render in their font as the preview.
const FONTS = [
  { id: 'manrope',  name: 'Manrope',  body: "'Manrope', system-ui, sans-serif",          display: "'Fredoka', system-ui, sans-serif" },
  { id: 'garamond', name: 'Garamond', body: "'EB Garamond', Georgia, serif",             display: "'Cinzel', Georgia, serif" },
  { id: 'fredoka',  name: 'Fredoka',  body: "'Fredoka', system-ui, sans-serif",          display: "'Fredoka', system-ui, sans-serif" },
  { id: 'mono',     name: 'Mono',     body: "'JetBrains Mono', ui-monospace, monospace", display: "'JetBrains Mono', ui-monospace, monospace" },
];
let font = localStorage.getItem('roselite-font') || '';
const applyFont = (id) => {
  const f = FONTS.find((x) => x.id === id);
  font = f ? id : '';
  const st = document.documentElement.style;
  if (f) { st.setProperty('--font-body', f.body); st.setProperty('--font-display', f.display); }
  else { st.removeProperty('--font-body'); st.removeProperty('--font-display'); }
  if (font) localStorage.setItem('roselite-font', font); else localStorage.removeItem('roselite-font');
};


const countryName = (code) => {
  try { return new Intl.DisplayNames([lang === 'fr' ? 'fr' : 'en'], { type: 'region' }).of(code) || code; }
  catch { return code; }
};

// ── UI scale — Chromium zoom, so the whole panel scales (fixed px design).
let uiScale = +localStorage.getItem('roselite-scale') || 100;
const applyScale = (v) => { uiScale = v; webFrame.setZoomFactor(v / 100); localStorage.setItem('roselite-scale', v); };

// ── Sample data still awaiting a clean source (Dungeons, Elements) ─────────
const QICON = {
  todo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="4.6"/></svg>',
  done: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.3 8.4l3 3 6.4-7.2"/></svg>'
};
const ELEMENTS = [
  { name: 'Fire', strong: 'Wind', weak: 'Water' }, { name: 'Water', strong: 'Fire', weak: 'Earth' },
  { name: 'Wind', strong: 'Earth', weak: 'Fire' }, { name: 'Earth', strong: 'Water', weak: 'Wind' },
  { name: 'Light', strong: 'Dark', weak: 'Dark' }, { name: 'Dark', strong: 'Light', weak: 'Light' }
];
const DEFAULT_SHOUTS = [
  { name: 'LF DG', text: 'LF DG lvl 50+ — /w me' },
  { name: 'Selling', text: 'WTS [Iron short sword] x3 — /w for price' }
];

const CHEV = '<svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
const st = () => 'stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"';
// Settings glyph, shared by the section rail/grid, the header button and the launcher.
// 1.9 at a 24-viewBox reads the same weight as 1.6 at 20.
const WRENCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
const ICONS = {
  personnage: `<svg viewBox="0 0 20 20" ${st()}><circle cx="10" cy="6.4" r="3.1"/><path d="M4.4 16.6c0-3.1 2.5-5.2 5.6-5.2s5.6 2.1 5.6 5.2"/></svg>`,
  quetes:     `<svg viewBox="0 0 20 20" ${st()}><path d="M8 5h8M8 10h8M8 15h8"/><path d="M3.5 4.6l1 1 1.6-2M3.5 9.6l1 1 1.6-2M3.5 14.6l1 1 1.6-2"/></svg>`,
  donjons:    `<svg viewBox="0 0 20 20" ${st()}><path d="M4 5.5h12v11H4z"/><path d="M4 9.3h12M8 5.5v11M12 5.5v11"/></svg>`,
  recettes:   `<svg viewBox="0 0 20 20" ${st()}><path d="M8 2.5h4M9.4 2.5v4.2l-3.7 7.2A1.8 1.8 0 007.3 16.6h5.4a1.8 1.8 0 001.6-2.7l-3.7-7.2V2.5"/><path d="M6.6 12.4h6.8"/></svg>`,
  gems:       `<svg viewBox="0 0 20 20" ${st()}><path d="M6 3h8l3 4.5-7 9.5-7-9.5L6 3z"/><path d="M3 7.5h14M7.4 3l-2.4 4.5 5 9.5M12.6 3l2.4 4.5-5 9.5"/></svg>`,
  objets:     `<svg viewBox="0 0 20 20" ${st()}><path d="M10 2.5l6.5 3.6v7.8L10 17.5 3.5 13.9V6.1L10 2.5z"/><path d="M3.7 6.2L10 9.8l6.3-3.6M10 9.8v7.7"/></svg>`,
  marche:     `<svg viewBox="0 0 20 20" ${st()}><path d="M3.5 3.5v13h13"/><path d="M6.5 12l3-3 2.5 2.5 4-5"/><path d="M13 3.5h3v3"/></svg>`,
  elements:   `<svg viewBox="0 0 20 20" ${st()}><path d="M10 3s5 5.2 5 8.4a5 5 0 01-10 0C5 8.2 10 3 10 3z"/></svg>`,
  evenements: `<svg viewBox="0 0 20 20" ${st()}><rect x="3.5" y="4.5" width="13" height="12" rx="1.6"/><path d="M3.5 8.2h13M7 3v3M13 3v3"/></svg>`,
  guides:     `<svg viewBox="0 0 20 20" ${st()}><path d="M10 5.2C8.4 4.2 6 3.8 4 4.2v10.6c2-.4 4.4 0 6 1 1.6-1 4-1.4 6-1V4.2c-2-.4-4.4 0-6 1z"/><path d="M10 5.2v11.6"/></svg>`,
  cris:       `<svg viewBox="0 0 20 20" ${st()}><path d="M4 8.2v3.6l8.5 3.4V4.8L4 8.2z"/><path d="M4 8.2H2.7v3.6H4M13 7s2.6.6 2.6 3-2.6 3-2.6 3"/></svg>`,
  butin:      `<svg viewBox="0 0 20 20" ${st()}><path d="M6.5 3.5h7l3 4-6.5 9-6.5-9 3-4z"/><path d="M3 7.5h14M8 3.5l-2 4 4 9M12 3.5l2 4-4 9"/></svg>`,
  dps:        `<svg viewBox="0 0 20 20" ${st()}><path d="M3.5 16.5l9-9M11 3.5h5.5V9"/><path d="M16.5 16.5l-9-9M9 3.5H3.5V9"/></svg>`,
  monstres:   `<svg viewBox="0 0 20 20" ${st()}><path d="M4 9.3a6 5.6 0 1112 0c0 1.7-.8 2.5-.8 3.5 0 1.2.8 1.1.8 2.2 0 1.2-2.6 2-6 2s-6-.8-6-2c0-1.1.8-1 .8-2.2 0-1-.8-1.8-.8-3.5z"/><circle cx="8" cy="9.6" r="1.3"/><circle cx="12" cy="9.6" r="1.3"/></svg>`,
  tracker:    `<svg viewBox="0 0 20 20" ${st()}><circle cx="10" cy="10" r="6.4"/><circle cx="10" cy="10" r="2.4"/><path d="M10 1.6v2.2M10 16.2v2.2M1.6 10h2.2M16.2 10h2.2"/></svg>`,
  rois:       `<svg viewBox="0 0 20 20" ${st()}><path d="M3 6.5l3.2 3 3.8-5 3.8 5 3.2-3-1.6 9.3H4.6L3 6.5z"/><path d="M5 16.8h10"/></svg>`,
  extensions: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3.5" y="3.5" width="5.4" height="5.4" rx="1.2"/><rect x="11.1" y="3.5" width="5.4" height="5.4" rx="1.2"/><rect x="3.5" y="11.1" width="5.4" height="5.4" rx="1.2"/><rect x="11.1" y="11.1" width="5.4" height="5.4" rx="1.2"/></svg>`,
  parametres: WRENCH
};
ICONS.journaux = ICONS.donjons;   // same grid glyph
// donjons + elements are no longer top-level sections: Dungeon is dropped and
// Elements moved under Guides (see GUIDE_CATS). Their ICONS stay, reused by the
// Guides sub-menu (labels live in GUIDE_CATS). ponytail: ELEMENTS data kept.
// The grid's three groups, in panel order. Grouping is the hierarchy: sixteen
// identical tiles in one flat block ranked nothing, and reading order put rois
// and the mob sections — the job PRODUCT.md is actually for — near the bottom.
// `suivi` (time-sensitive, the reason the panel is docked) now leads.
// Named `suivi`/Tracking, not "Live": LIVE already means the live data source in
// this codebase, and four of these five are exactly the sections it gates.
// `monstres` sits in Références: it browses drop tables offline, nothing there
// moves. `tracker` is its live half — spawn alerts — and keeps the Suivi slot.
const SECTION_GROUPS = [
  { key: 'suivi',     ids: ['rois', 'tracker', 'personnage', 'butin', 'dps'] },
  { key: 'reference', ids: ['objets', 'marche', 'monstres', 'recettes', 'gems', 'quetes'] },
  { key: 'extras',    ids: ['guides', 'evenements', 'cris', 'journaux', 'extensions'] },
];
// Still the flat list every other consumer wants (views map, restore, filters).
// The docked group and rail order remain derived from SECTION_GROUPS.
const SECTION_IDS = [...SECTION_GROUPS.flatMap((g) => g.ids), 'parametres'];

// ── Navigation (home → section → detail) ───────────────────────────────────
const views = {};
for (const id of SECTION_IDS) views[id] = document.getElementById('view-' + id);
views.empty = document.getElementById('view-empty');   // bottom-pane default (nothing selected)
const homeEl = document.getElementById('view-home');   // top-pane menu, always visible
const backbar = document.getElementById('backbar');
const backDest = document.getElementById('back-dest');
const backTitle = document.getElementById('back-title');
const secLabel = (id) => T().sec[id] || STR.en.sec[id];

function showOnly(id) { for (const [k, el] of Object.entries(views)) el.hidden = k !== id; }
function resetDetail(v) {
  const body = v.querySelector('.view-body');
  const detail = v.querySelector('.view-detail');
  if (body) body.hidden = false;
  if (detail) detail.hidden = true;
}
let current = 'home';
// Cross-link return target: set when an item link jumps here from another section
// (guide/quest/loot) so Back returns to that exact page, not the Items list.
// detailReopen replays whatever detail is on screen; currentReturn() snapshots it.
let navBack = null;       // { restore } while on a cross-linked item page, else null
let detailReopen = null;  // replays the currently-shown detail (set by drill), else null
const setActiveTile = (id) => homeEl.querySelectorAll('.tile').forEach((t) => t.classList.toggle('tile--active', t.dataset.id === id));
function goHome() { current = 'home'; document.body.classList.remove('section-open'); showOnly('empty'); backbar.hidden = true; setActiveTile(null); navBack = null; detailReopen = null; renderNews(); resetHomeSearch(); }
// Hidden sections used to build their full DOM at startup. Quests alone creates
// ~750 nodes and Extensions ~300; defer static views until the player opens them.
// Function declarations are hoisted, so this registry can stay beside navigation.
const LAZY_SECTIONS = new Map([
  ['quetes', renderQuests], ['recettes', renderRecipes], ['gems', renderGems],
  ['objets', renderItems], ['evenements', renderEvents], ['guides', renderGuides],
  ['monstres', renderMonsters], ['tracker', renderTracker], ['extensions', renderExtensions], ['parametres', renderSettings],
]);
const readySections = new Set();
function ensureSection(id) {
  const render = LAZY_SECTIONS.get(id);
  if (render && !readySections.has(id)) { render(); readySections.add(id); }
}
function openSection(id) {
  current = id; document.body.classList.add('section-open'); showOnly(id); resetDetail(views[id]); setActiveTile(id);
  navBack = null; detailReopen = null;
  ensureSection(id);
  if (id === 'marche') renderMarche();   // re-render each open: fresh pins + live prices
  if (id === 'journaux') renderDungeons();   // re-render each open: reflects newly logged runs
  if (id === 'rois') renderKings();   // re-render each open: fresh sort + relative times
  backDest.textContent = T().back; backTitle.textContent = secLabel(id); backbar.hidden = false;
  views[id].scrollTop = 0;
}
function drill(title, build) {
  const sec = current;
  const v = views[sec];
  const body = v.querySelector('.view-body');
  const detail = v.querySelector('.view-detail');
  detail.innerHTML = ''; detail.classList.remove('art-bg'); detail.style.removeProperty('--tile-art'); build(detail);
  body.hidden = true; detail.hidden = false; v.scrollTop = 0;
  backDest.textContent = T().back; backTitle.textContent = title;
  detailReopen = () => { current = sec; showOnly(sec); setActiveTile(sec); backbar.hidden = false; drill(title, build); };
}
document.getElementById('settings-btn').addEventListener('click', () => openSection('parametres'));
document.querySelector('.hdr-wordmark').addEventListener('click', goHome);   // wordmark → home
// Fullscreen sidebar collapse (header burger). Only fullscreen has a sidebar, but
// the class is set on <body> unconditionally so the state survives a trip through
// the docked panel and back. localStorage, not the synced progress store: which
// width this one window's nav sits at is a device preference, not progress.
const NAV_COLLAPSED_KEY = 'roselite-nav-collapsed';
const navBtn = document.getElementById('nav-btn');
function applyNavCollapsed(on) {
  document.body.classList.toggle('nav-collapsed', on);
  navBtn.setAttribute('aria-expanded', String(!on));
  const tips = T().tips || STR.en.tips;
  const label = on ? (tips.navShow || STR.en.tips.navShow) : (tips.navHide || STR.en.tips.navHide);
  navBtn.title = label;
  navBtn.setAttribute('aria-label', label);
}
applyNavCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
navBtn.addEventListener('click', () => {
  const on = !document.body.classList.contains('nav-collapsed');
  applyNavCollapsed(on);
  try { localStorage.setItem(NAV_COLLAPSED_KEY, on ? '1' : '0'); } catch { /* private mode / quota — the class still applies */ }
});

document.getElementById('quit-btn').addEventListener('click', () => ipcRenderer.send('quit'));
document.getElementById('back-btn').addEventListener('click', () => {
  if (navBack) { const restore = navBack.restore; navBack = null; restore(); return; }   // cross-linked item page → previous page
  const v = views[current];
  const detail = v && v.querySelector('.view-detail');
  if (detail && !detail.hidden) { resetDetail(v); backDest.textContent = T().back; backTitle.textContent = secLabel(current); detailReopen = null; }
  else { goHome(); }
});

// ── Renderers ──────────────────────────────────────────────────────────────
function renderHome() {
  // title, not just the label: the fullscreen sidebar collapses to icons only,
  // where display:none takes the label out of the a11y tree too.
  const tile = (id) =>
    `<button class="tile${!LIVE && LIVE_SECTIONS.has(id) ? ' tile--off' : ''}" data-id="${id}" title="${esc(secLabel(id))}">${ICONS[id]}<span class="tile-label">${secLabel(id)}</span></button>`;
  homeEl.innerHTML =
    `<div class="home-groups">${SECTION_GROUPS.map((g) =>
      `<section class="home-group"><h2 class="home-group-title">${esc(T().group[g.key])}</h2>` +
      `<div class="home-grid">${g.ids.map(tile).join('')}</div></section>`).join('')}</div>`;
  homeEl.querySelectorAll('.tile').forEach((el) => el.addEventListener('click', () => openSection(el.dataset.id)));
}
// ── Home news feed (the default pane when nothing is selected) ──────────────
// One tagged stream: ongoing events (or the single next one if none is live),
// the latest forum patch note (main's 'feed-patchnote'), then latest YouTube
// uploads (main's 'feed-youtube' — keyless channel RSS, cached 15 min). Video
// and patch-note cards are <a href> so the global click delegate opens them in
// the system browser; event cards route into their existing section detail, so
// Back behaves like everywhere else. Offline → local-only feed.
let ytItems = [];
let pnItem = null;   // latest forum patch note (main's 'feed-patchnote')
function nextStart(ev, today = new Date()) {
  const d = new Date(today.getFullYear(), ev.start[0] - 1, ev.start[1]);
  return d < today ? new Date(today.getFullYear() + 1, ev.start[0] - 1, ev.start[1]) : d;
}
// Official site/socials — always shown at the foot of the home feed. Static
// <a href> so the global click delegate opens them in the browser. Brand
// glyphs are inline single-path SVG (simple-icons), currentColor for theming;
// no CDN. ponytail: a flat list, not a plugin — these don't change.
const SOCIALS = [
  { name: 'Discord',  url: 'https://discord.gg/roseonline',          icon: 'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z' },
  { name: 'Reddit',   url: 'https://www.reddit.com/r/roseonline/',   icon: 'M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-6.994 4.87-3.865 0-6.994-2.176-6.994-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z' },
  { name: 'Twitch',   url: 'https://www.twitch.tv/rednimgames',      icon: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z' },
  { name: 'X',        url: 'https://x.com/roseonlinemmo',            icon: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z' },
  { name: 'Facebook', url: 'https://www.facebook.com/roseonlinemmo', icon: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
];
const socialsBar = () => `<div class="feed-socials">${SOCIALS.map((s) =>
  `<a class="social-btn" href="${s.url}" title="${s.name}" aria-label="${s.name}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${s.icon}"/></svg></a>`).join('')}</div>`;
// The tagged card list (events + latest patch note + latest videos). Shared by
// the in-game home pane and the launcher's center feed, so both stay identical.
function feedBody() {
  const d = T();
  const tag = (k) => `<span class="tag">${d[k] || STR.en[k]}</span>`;   // en fallback, like liveOff
  const fmtDay = (ms) => new Date(ms).toLocaleDateString(lang,
    { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
  // Ongoing events (both if two overlap); only if none is live, show the single
  // next upcoming one.
  const active = D.eventsIndex.filter((ev) => eventActive(ev));
  const events = active.length ? active
    : D.eventsIndex.filter((ev) => !eventActive(ev)).sort((a, b) => nextStart(a) - nextStart(b)).slice(0, 1);
  // Live → green pill; otherwise this is the single next-up event → amber pill + its dates.
  const evCard = (ev, act) => `<button class="feed-card${act ? ' feed-card--live' : ' feed-card--next'}" data-ev="${esc(ev.name)}"><span class="feed-main">
      <span class="feed-top">${tag('feedEvent')}${act ? `<span class="pill pill--live">${d.active}</span>` : `<span class="pill pill--next">${d.next}</span><span class="feed-date">${fmtRange(ev)}</span>`}</span>
      <span class="feed-title">${esc(ev.name)}</span></span></button>`;
  const pnCard = (p) => `<a class="feed-card" href="${esc(p.url)}"><span class="feed-main">
      <span class="feed-top">${tag('feedPatch')}<span class="feed-date">${fmtDay(p.date)}</span></span>
      <span class="feed-title">${esc(p.title)}</span></span></a>`;
  const vidCard = (v) => `<a class="feed-card" href="${esc(v.url)}"><img class="feed-thumb" src="${esc(v.thumb)}" loading="lazy" alt=""><span class="feed-main">
      <span class="feed-top">${tag('feedVideo')}<span class="feed-date">${fmtDay(v.date)}</span></span>
      <span class="feed-title">${esc(v.title)}</span></span></a>`;
  const cards = [
    ...events.map((ev) => evCard(ev, active.length > 0)),
    ...(pnItem ? [pnCard(pnItem)] : []),
    ...ytItems.slice(0, 8).map(vidCard),
  ];
  return cards.length
    ? `<div class="feed">${cards.join('')}</div>`
    : `<div class="empty"><strong>${d.emptyTitle}</strong>${d.emptyBody}</div>`;
}
// Refresh the cached feed sources (main caches 15 min, so mostly a no-op); only
// re-render when a value actually changed — breaks the render→fetch loop, and
// lets whoever's showing the feed (home pane or launcher) repaint itself.
function pullFeed(rerender) {
  ipcRenderer.invoke('feed-youtube').then((v) => {
    if (v && v.length && v.map((x) => x.url).join() !== ytItems.map((x) => x.url).join()) { ytItems = v; rerender(); }
  }).catch(() => {});
  ipcRenderer.invoke('feed-patchnote').then((p) => {
    if (p && p.url !== (pnItem && pnItem.url)) { pnItem = p; rerender(); }
  }).catch(() => {});
}
function renderNews() {
  const d = T();
  // Persistent home shell: a global search bar over items+quests+guides sits above
  // the feed. Only .home-feed repaints on data refresh, so a search-in-progress
  // survives (see wireHomeSearch / resetHomeSearch).
  let feed = views.empty.querySelector('.home-feed');
  if (!feed) {
    views.empty.innerHTML = `<div class="feed-home">` +
      `<input class="inp search home-search" placeholder="${esc(d.search)}">` +
      `<ul class="rows home-results" hidden></ul><p class="section-note home-note" hidden></p>` +
      `<div class="home-feed"></div></div>`;
    feed = views.empty.querySelector('.home-feed');
    wireHomeSearch();
  }
  views.empty.querySelector('.home-search').placeholder = d.search;
  feed.innerHTML = `${feedBody()}${socialsBar()}`;
  feed.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => {
    openSection('evenements'); openEvent(D.eventsIndex.find((x) => x.name === b.dataset.ev));
  }));
  pullFeed(renderNews);
}
// Global home search: one box → items (name), quests (name), guides (title), each
// row tagged with its section and self-routing via the item/quest/guide click
// delegate. Guides+quests first (the hard-to-find few), then items fill to CAP.
// Bound once; the input survives feed repaints because only .home-feed repaints.
function wireHomeSearch() {
  const si = views.empty.querySelector('.home-search');
  const res = views.empty.querySelector('.home-results');
  const note = views.empty.querySelector('.home-note');
  const feed = views.empty.querySelector('.home-feed');
  const CAP = 40;
  // Names never change during a page load. Fold them once instead of normalizing
  // the entire ~20k-row catalog on every keypress.
  const GUIDES = D.guidesIndex.map((value, index) => ({ value, index, key: fold(value.title) }));
  const QUESTS = D.quests.map((value) => ({ value, key: fold(value.name) }));
  const ITEMS = [...D.itemsById.values()].map((value) => ({ value, key: fold(value.name) }));
  const hit = (attr, name, tag, icon = '') =>
    `<li><button class="row${icon ? ' item-row' : ''}" ${attr}>${icon}<span class="row-name">${esc(name)}</span>` +
    `<span class="row-meta"><span class="tag">${esc(tag)}</span></span></button></li>`;
  const paint = () => {
    const q = fold(si.value.trim());
    if (!q) { feed.hidden = false; res.hidden = note.hidden = true; res.innerHTML = ''; return; }
    const rows = [];
    let count = 0;
    const add = (row) => { if (count++ < CAP) rows.push(row()); };
    for (const { value: g, index, key } of GUIDES)
      if (key.includes(q)) add(() => hit(`data-guide="${index}"`, g.title, secLabel('guides')));
    for (const { value: qq, key } of QUESTS)
      if (key.includes(q)) add(() => hit(`data-q="${qq.game_quest_id}"`, qq.name, secLabel('quetes')));
    for (const { value: it, key } of ITEMS)
      if (key.includes(q)) add(() => hit(`data-item-id="${it.id}"`, it.name, secLabel('objets'), D.itemImg(it, 'row-icon')));
    res.innerHTML = rows.join('');
    note.textContent = count > CAP ? `${CAP} ${T().ofMatches} ${count} — ${T().refineSearch}` : `${count}`;
    feed.hidden = true; res.hidden = note.hidden = false;
  };
  si.addEventListener('input', paint);
}
// Clear the home search when returning home (goHome), so a stale query/result set
// doesn't linger over the feed. No-op before the shell exists.
function resetHomeSearch() {
  const si = views.empty.querySelector('.home-search');
  if (!si) return;
  si.value = '';
  views.empty.querySelector('.home-results').hidden = true;
  views.empty.querySelector('.home-note').hidden = true;
  views.empty.querySelector('.home-feed').hidden = false;
}
console.assert(nextStart({ start: [1, 7] }, new Date(2026, 6, 7)).getFullYear() === 2027, 'nextStart: past date rolls to next year');
console.assert(nextStart({ start: [12, 13] }, new Date(2026, 6, 7)).getMonth() === 11, 'nextStart: future date stays this year');
// Disabled-section notice for the live-fed sections in a build without a data
// source (see LIVE). Falls back to EN for the langs that don't carry the strings.
function liveOff(el) {
  const d = T();
  el.innerHTML = `<div class="empty"><strong>${d.liveOffTitle || STR.en.liveOffTitle}</strong>${d.liveOffBody || STR.en.liveOffBody}</div>`;
}
// Collapsed on-top icon rail: same sections as the home grid, plus a Settings
// glyph. Clicking expands the window to the full panel (rail-open) then opens
// the section. ponytail: reuses ICONS/SECTION_IDS — no separate icon set.
function renderRail() {
  const rail = document.getElementById('rail');
  const expandGlyph = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l-5 5 5 5"/></svg>';
  rail.innerHTML =
    `<button class="rail-icon rail-toggle" data-expand data-tip="${esc(T().home)}" aria-label="${esc(T().home)}">${expandGlyph}</button>` +
    `<span class="rail-sep"></span>` +
    SECTION_IDS.filter((id) => id !== 'parametres').map((id) =>
      `<button class="rail-icon${!LIVE && LIVE_SECTIONS.has(id) ? ' rail-icon--off' : ''}" data-id="${id}" data-tip="${esc(secLabel(id))}" aria-label="${esc(secLabel(id))}">${ICONS[id]}</button>`).join('') +
    `<span class="rail-sep"></span>` +
    `<button class="rail-icon" data-id="parametres" data-tip="${esc(secLabel('parametres'))}" aria-label="${esc(secLabel('parametres'))}">${ICONS.parametres}</button>`;
  const expand = (id) => { ipcRenderer.send('set-layout', 'panel'); id ? openSection(id) : goHome(); };
  rail.querySelector('[data-expand]').addEventListener('click', () => expand(null));
  rail.querySelectorAll('.rail-icon[data-id]').forEach((el) => el.addEventListener('click', () => expand(el.dataset.id)));
  // Custom hover tooltip drawn into the transparent gutter (see #rail-tip CSS).
  const tip = document.getElementById('rail-tip');
  rail.querySelectorAll('.rail-icon').forEach((el) => {
    const show = () => {
      const r = el.getBoundingClientRect();
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      tip.style.top = `${r.top + r.height / 2}px`;
      requestAnimationFrame(() => tip.classList.add('show'));
    };
    const hide = () => { tip.classList.remove('show'); tip.hidden = true; };
    el.addEventListener('mouseenter', show); el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide);
  });
}
function renderList(view, items, rowHtml, onClick) {
  const body = view.querySelector('.view-body');
  body.innerHTML = `<ul class="rows">${items.map(rowHtml).join('')}</ul>`;
  [...body.querySelectorAll('.row')].forEach((r, i) => r.addEventListener('click', () => onClick(items[i])));
}
const nameRow = (name, meta = '') =>
  `<li><button class="row"><span class="row-name">${name}</span><span class="row-meta">${meta || CHEV}</span></button></li>`;

// Searchable, capped, filterable list for the large datasets (items, quests,
// guides). Repaints innerHTML on input; item/quest rows carry data-* attrs
// handled by the global click delegate (so no rebinding) — lists without those
// attrs pass opts.onClick and get rows rebound per paint. ponytail: cap render,
// search + filters narrow — no virtual scroll until a list actually feels slow.
//
// opts.filters: each narrows the matched set and self-hides when it has nothing
// to offer (chips with <2 distinct values, a flat range). Values/bounds are
// derived from the data, so the same filter is relevant only where it applies.
//   { type:'chips',  label, get(item)->value|[values] }   multi-select, OR within
//   { type:'range',  label, get(item)->number|null }      min/max sliders; null kept
//   { type:'toggle', label, keep(item)->bool }            when on, keep only keep()
function searchListInto(container, items, rowHtml, opts = {}) {
  const d = T(), CAP = 120;
  const { head = '', filters = [], name = (i) => i.name, onClick, collapsible = false } = opts;
  // Derive control state from the data, then drop filters with nothing to offer.
  const active = filters.map((f) => {
    if (f.type === 'chips') {
      const vals = new Set();
      for (const it of items) { const v = f.get(it); if (v == null) continue; (Array.isArray(v) ? v : [v]).forEach((x) => vals.add(String(x))); }
      const values = [...vals].sort();   // alphabetical, then a fixed order (e.g. planets) if given
      if (f.order) values.sort((a, b) => (f.order.indexOf(a) + 1 || 999) - (f.order.indexOf(b) + 1 || 999));
      return { f, values, sel: new Set() };
    }
    if (f.type === 'range') {
      let lo = Infinity, hi = -Infinity;
      for (const it of items) { const v = f.get(it); if (v == null) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
      return { f, min: lo, max: hi, lo, hi };
    }
    return { f, on: false };
  }).filter((s) => (s.f.type === 'chips' ? s.values.length > 1 : s.f.type === 'range' ? s.max > s.min : true));

  const filtHtml = active.map((s, i) => {
    if (s.f.type === 'chips') {
      const chips = `<div class="chips" data-fi="${i}">` +
        s.values.map((v) => `<button class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join('') + `</div>`;
      // Long value lists (item stat bonuses: ~40) fold shut; the summary shows
      // the active-selection count so a closed fold still betrays its filter.
      return s.f.fold
        ? `<details class="filt filt-fold"><summary><span class="filt-lbl">${esc(s.f.label)} <span class="filt-val" data-fc="${i}"></span></span></summary>${chips}</details>`
        : `<div class="filt"><span class="filt-lbl">${esc(s.f.label)}</span>${chips}</div>`;
    }
    if (s.f.type === 'range')
      return `<div class="filt"><span class="filt-lbl">${esc(s.f.label)} <span class="filt-val" data-fi="${i}">${s.lo}–${s.hi}</span></span>` +
        `<div class="range" data-fi="${i}"><input type="range" class="rmin" min="${s.min}" max="${s.max}" value="${s.lo}">` +
        `<input type="range" class="rmax" min="${s.min}" max="${s.max}" value="${s.hi}"></div></div>`;
    return `<label class="filt filt--tgl"><input type="checkbox" data-fi="${i}"><span>${esc(s.f.label)}</span></label>`;
  }).join('');

  // Folded filters are a narrow-panel affordance; fullscreen shows them open in
  // the left rail (where the CSS expects a bare .filters).
  const folded = collapsible && !document.body.classList.contains('fullscreen');
  container.innerHTML = `${head}<input class="inp search" placeholder="${d.search}">` +
    (filtHtml ? (folded
      ? `<details class="filters-fold"><summary>${esc(d.filters || 'Filters')}</summary><div class="filters">${filtHtml}</div></details>`
      : `<div class="filters">${filtHtml}</div>`) : '') +
    `<ul class="rows" id="sl"></ul><p class="section-note" id="sl-note"></p>`;
  const ul = container.querySelector('#sl'), note = container.querySelector('#sl-note');
  // This index is local to the rendered list, so it is discarded with the view.
  // It removes repeated Unicode normalization while users type or drag filters.
  const searchKeys = new Map(items.map((item) => [item, fold(name(item))]));
  let q = '';
  const paint = () => {
    let m = q ? items.filter((i) => searchKeys.get(i).includes(q)) : items;
    for (const s of active) {
      if (s.f.type === 'chips' && s.sel.size)
        m = m.filter((it) => { const v = s.f.get(it); if (v == null) return !!s.f.keepNull; return (Array.isArray(v) ? v : [v]).some((x) => s.sel.has(String(x))); });
      else if (s.f.type === 'range')
        m = m.filter((it) => { const v = s.f.get(it); return v == null || (v >= s.lo && v <= s.hi); });
      else if (s.f.type === 'toggle' && s.on)
        m = m.filter(s.f.keep);
    }
    ul.innerHTML = m.slice(0, CAP).map(rowHtml).join('');
    note.textContent = m.length > CAP ? `${CAP} ${d.ofMatches} ${m.length} — ${d.refineSearch}` : `${m.length}`;
    if (onClick) [...ul.querySelectorAll('.row')].forEach((r, i) => r.addEventListener('click', () => onClick(m[i])));
  };
  container.querySelector('.search').addEventListener('input', (e) => { q = fold(e.target.value.trim()); paint(); });
  container.querySelectorAll('.chips').forEach((box) => {
    const s = active[+box.dataset.fi];
    const count = container.querySelector(`.filt-val[data-fc="${box.dataset.fi}"]`);
    box.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
      if (s.sel.has(c.dataset.v)) s.sel.delete(c.dataset.v); else s.sel.add(c.dataset.v);
      c.classList.toggle('chip--on');
      if (count) count.textContent = s.sel.size ? `(${s.sel.size})` : '';
      paint();
    }));
  });
  container.querySelectorAll('.range').forEach((box) => {
    const s = active[+box.dataset.fi], lo = box.querySelector('.rmin'), hi = box.querySelector('.rmax');
    const valEl = container.querySelector(`.filt-val[data-fi="${box.dataset.fi}"]`);
    const upd = (e) => {
      s.lo = +lo.value; s.hi = +hi.value;
      if (s.lo > s.hi) {                       // keep thumbs from crossing: push the idle one
        if (e.target === lo) { s.hi = s.lo; hi.value = s.hi; } else { s.lo = s.hi; lo.value = s.lo; }
      }
      valEl.textContent = `${s.lo}–${s.hi}`; paint();
    };
    lo.addEventListener('input', upd); hi.addEventListener('input', upd);
  });
  container.querySelectorAll('input[type="checkbox"][data-fi]').forEach((cb) => {
    const s = active[+cb.dataset.fi];
    cb.addEventListener('change', () => { s.on = cb.checked; paint(); });
  });
  paint();
}
// A clickable item row (icon + name); routes through openItemPage via data-item-id.
const itemRow = (item, meta = '') =>
  `<li><button class="row item-row" data-item-id="${item.id}">${D.itemImg(item, 'row-icon')}` +
  `<span class="row-name">${esc(item.name)}</span><span class="row-meta">${meta || CHEV}</span></button></li>`;

// Item stat blocks vary by type (weapon/accessory/material…): scalars → rows,
// arrays (Effect, Set Stats) → sub-lists, empties skipped.
function renderStatBlock(stats) {
  if (!stats) return '';
  const parts = [];
  let grid = [];                                            // scalar rows accumulate into one aligned grid
  const flush = () => { if (grid.length) { parts.push(`<div class="stat-grid">${grid.join('')}</div>`); grid = []; } };
  for (const [k, v] of Object.entries(stats)) {
    if (Array.isArray(v)) {
      if (!v.length) continue;
      flush();
      if (k === 'Bonus')                                    // blue bracketed lines, like the game
        parts.push(`<div class="detail-label">${esc(k)}</div><ul class="stat-bonus">${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
      else
        parts.push(`<div class="detail-label">${esc(k)}</div><ul class="stat-list">${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    } else if (v != null && v !== '') {
      const req = k === 'Stat Req' ? '--req' : '';          // requirement shows green in-game
      grid.push(`<span class="stat-k stat-k${req}">${esc(k)}</span><span class="stat-v stat-v${req}">${esc(v)}</span>`);
    }
  }
  flush();
  return parts.join('');
}
const fmtZ = (n) => new Intl.NumberFormat(locale()).format(Number(n) || 0) + ' z';
// Relative "x days ago" from an ISO date, localised. Intl.RelativeTimeFormat is
// built into Chromium — no dep. Used for market last_updated freshness.
const fmtAgo = (s) => {
  const diff = Date.now() - new Date(s).getTime();
  if (!isFinite(diff)) return '';
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (diff < 36e5) return rtf.format(-Math.round(diff / 6e4) || 0, 'minute');
  if (diff < 864e5) return rtf.format(-Math.round(diff / 36e5), 'hour');
  return rtf.format(-Math.round(diff / 864e5), 'day');
};

// NPC price (from the catalog) + live market price (roseutils, async — filled by
// loadMarket once fetched). Only shown when the item carries a market identity.
// Chart + history live in a separate aside (see priceAside) so fullscreen can
// float them to the right of the stats.
function priceBlock(it, d) {
  const npc = it.item_stat && it.item_stat.price;
  const tradable = it.item_type_id != null && it.game_item_id != null;
  if (npc == null && !tradable) return '';
  return `<div class="stat-grid">` +
    (npc != null ? `<span class="stat-k">${d.npcPrice}</span><span class="stat-v">${fmtZ(Math.round(npc / 2.5))}</span>` : '') +
    (tradable ? `<span class="stat-k">${d.marketPrice}</span><span class="stat-v" data-market>…</span>` : '') +
    `</div>`;
}
// Chart + daily history, filled by loadMarket. Rendered only for tradable items.
function priceAside(it, d) {
  if (it.item_type_id == null || it.game_item_id == null) return '';
  return `<div class="item-aside"><div data-chart hidden></div>` +
    `<details class="spoiler" data-history hidden><summary>${d.history}</summary><div class="stat-grid"></div></details></div>`;
}
// roseutils market history → latest avg as the market price + full daily list.
// Fetched by main over IPC (dodges the file:// CORS wall + carries the login
// cookie). 401 → prompt to connect in Settings.
async function loadMarket(el, it) {
  if (it.item_type_id == null || it.game_item_id == null) return;
  const mk = el.querySelector('[data-market]');
  const box = el.querySelector('[data-history]');
  let r;
  try { r = await ipcRenderer.invoke('market', it.item_type_id, it.game_item_id); }
  catch { r = { ok: false, status: 0, data: null }; }
  if (!el.isConnected) return;                          // navigated away mid-fetch
  if (r.status === 401) { if (mk) mk.textContent = T().connectRose; return; }
  const h = r.ok && r.data && r.data.history;
  if (!h || !h.length) { if (mk) mk.textContent = r.ok ? T().marketNA : T().marketErr; return; }
  const latest = h[h.length - 1];
  const when = latest.updated_at || latest.date;
  if (mk) mk.innerHTML = fmtZ(Math.round(latest.min_price)) + (when ? `<span class="mk-upd">${MK().updated} ${fmtAgo(when)}</span>` : '');
  mkActual.set(`${it.item_type_id}:${it.game_item_id}`, Math.round(latest.min_price));   // seed the market section's price cache
  // Cheapest seller's shop location → copyable in-game map link. Coords are on
  // Junon Polis (map 2). ponytail: map hard-coded; switch to a field if the API adds one.
  const loc = el.querySelector('[data-loc]');
  if (loc && latest.min_price_x != null && latest.min_price_y != null) {
    wireCopy(loc, () => mapLink(2, latest.min_price_x, latest.min_price_y), '📍', T().copyLoc, T());
    loc.hidden = false;
  }
  // Same chart component as the market section's featured pane: y-ticks, dated
  // x-axis, hover crosshair. Exact per-day numbers stay in the spoiler below.
  const chart = el.querySelector('[data-chart]');
  if (chart && h.length >= 2) {
    const opts = { key: 'min_price', fmt: fmtZ, kind: 'line' };
    chart.innerHTML = bigChart(h, opts);
    wireChartHover(chart.querySelector('.pchart'), h, opts);
    chart.hidden = false;
  }
  if (box) {
    box.querySelector('.stat-grid').innerHTML = [...h].reverse()
      .map((e) => `<span class="stat-k">${esc(e.date)}</span><span class="stat-v">${fmtZ(Math.round(e.min_price))}</span>`).join('');
    box.hidden = false;
  }
}
// In-game chat item link: [&<base64>] where the payload is
// [0x07][3-byte LE (game_item_id<<5 | item_type_id)][4 zero bytes].
// The trailing bytes carry a real item's instance data (durability/life/etc);
// a plain reference link leaves them zero. Verified against known links:
// Wooly Mammoth Effigy (12/1562) → [&B0zDAAAAAAA=], Knight Killer (8/917) → B6hy…,
// Ether (12/63) → [&B+wHAAAAAAA=]. A stack link adds a 9th byte: the count sits at
// bit 4 of byte 6 with bit 3 as its flag, i.e. (count << 4) | 8 written LE across
// bytes 6-8 — verified on Ether 2× (0x28) and Bullet 3×/5× (0x38/0x58). Count 1 keeps
// the plain 8-byte reference form.
function itemLink(it, count) {
  const v = ((it.game_item_id << 5) | it.item_type_id) >>> 0;
  const bytes = [7, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, 0, 0, 0, 0];
  if (count > 1) {
    const q = ((count << 4) | 8) >>> 0;
    bytes[6] = q & 0xff; bytes[7] = (q >> 8) & 0xff; bytes.push((q >> 16) & 0xff);
  }
  return '[&' + btoa(String.fromCharCode(...bytes)) + ']';
}
// In-game map-location link: [&<base64>] of [0x03][map_id u32 LE][x f32 LE][y f32 LE].
// The floats are ROSE world units = displayed coord × 100 (verified: Junon 5501:5501
// → [&AwIAAAAlTwZJR1EGSQ==], floats 550130/550164). roseutils' min_price_x/y may be
// stored either as display coord (~5501) or world units (~550130); the two ranges are
// 100× apart, so scale up only the small form. ponytail: numeric heuristic, fix if
// roseutils ever reports coords ≥ 20000 in display units.
const worldCoord = (c) => (c < 20000 ? c * 100 : c);
function mapLink(mapId, x, y) {
  const dv = new DataView(new ArrayBuffer(13));
  dv.setUint8(0, 3);
  dv.setUint32(1, mapId, true);
  dv.setFloat32(5, worldCoord(x), true);
  dv.setFloat32(9, worldCoord(y), true);
  let s = ''; for (const b of new Uint8Array(dv.buffer)) s += String.fromCharCode(b);
  return '[&' + btoa(s) + ']';
}

// Collapsible list block for the item page's long tails (Used in · Dropped by):
// a common material is used in 60 recipes and dropped by 70 mobs, which buried
// the price block. Closed by default, count in the summary, rows capped like
// before — the summary still tells the truth about how many there are.
const FOLD_CAP = 60;
function foldBlock(label, rows, rowHtml) {
  if (!rows.length) return '';
  return `<details class="fold"><summary class="detail-label">${esc(label)} <span class="fold-n">${rows.length}</span></summary>` +
    `<ul class="rows">${rows.slice(0, FOLD_CAP).map(rowHtml).join('')}</ul></details>`;
}

// The item page — target of every item link in the app.
function buildItemDetail(el, it) {
  const d = T();
  const stats = renderStatBlock(D.displayStats(it));
  const rec = it.is_craftable ? D.recipeFor(it.id) : null;
  const mats = rec && rec.materials.length
    ? `<div class="detail-label">${d.materials}</div><ul class="rows">${rec.materials.map((m) => itemRow(m, `×${m.amount}`)).join('')}</ul>` : '';
  const used = D.usedIn(it.id);
  const usedHtml = foldBlock(d.usedIn, used, (u) => itemRow(u));
  const drops = D.droppedBy(it.id);
  const dropHtml = foldBlock(d.droppedBy || STR.en.droppedBy, drops, mobRow);
  const canLink = it.item_type_id != null && it.game_item_id != null;
  const star = `<button class="item-hero-copy" data-pin title="${d.pin}" aria-label="${d.pin}">${pinned.has(it.id) ? '★' : '☆'}</button>`;
  const actions = `<div class="item-hero-actions">${star}` +
    (canLink
      ? `<button class="item-hero-copy" data-copy title="${d.copyLink}" aria-label="${d.copyLink}">🔗</button>` +
        `<button class="item-hero-copy" data-loc title="${d.copyLoc}" aria-label="${d.copyLoc}" hidden>📍</button>` : '') +
    `</div>`;
  const bottom = (mats || usedHtml || dropHtml) ? `<div class="item-bottom">${mats}${usedHtml}${dropHtml}</div>` : '';
  el.innerHTML =
    `<div class="item-hero">${D.itemImg(it, 'item-hero-icon')}<div class="item-hero-meta">` +
    `<div class="item-hero-name">${esc(it.name)}</div>${it.is_craftable ? `<span class="tag tag--good">${d.craftable}</span>` : ''}</div>${actions}</div>` +
    `<div class="item-page">` +
    `<div class="item-top">${stats || `<p class="section-note">${d.noStats}</p>`}${priceBlock(it, d)}</div>` +
    `${priceAside(it, d)}${bottom}</div>`;
  wireCopy(el.querySelector('[data-copy]'), () => itemLink(it), '🔗', d.copyLink, d);
  const pinBtn = el.querySelector('[data-pin]');
  pinBtn.addEventListener('click', () => {
    if (pinned.has(it.id)) { pinned.delete(it.id); stampRemoved('roselite-items-unpinned', it.id); }
    else { pinned.add(it.id); clearRemoved('roselite-items-unpinned', it.id); }
    savePinned();
    pinBtn.textContent = pinned.has(it.id) ? '★' : '☆';
    renderPinned();
  });
  loadMarket(el, it);
}
// Copy-to-clipboard button behaviour: flash ✓ + "Copied" for 1.2s, then restore.
function wireCopy(btn, getLink, icon, title, d) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    clipboard.writeText(getLink());
    btn.textContent = '✓'; btn.title = d.copied;
    setTimeout(() => { btn.textContent = icon; btn.title = title; }, 1200);
  });
}
// Just the top of the item page (hero + stats), no price/recipe/usedIn —
// what the hover preview shows.
function itemPreviewHtml(it) {
  const d = T();
  const stats = renderStatBlock(D.displayStats(it));
  return `<div class="item-hero">${D.itemImg(it, 'item-hero-icon')}<div class="item-hero-meta">` +
    `<div class="item-hero-name">${esc(it.name)}</div>${it.is_craftable ? `<span class="tag tag--good">${d.craftable}</span>` : ''}</div></div>` +
    `${stats || `<p class="section-note">${d.noStats}</p>`}`;
}
// Snapshot the current page so Back can return to it (the visible detail, or the
// bare section for widget views like Loot that don't drill).
function currentReturn() {
  const sec = current, v = views[sec];
  const detail = v && v.querySelector('.view-detail');
  const restore = current === 'home' ? goHome                          // home feed origin (global search)
    : (detail && !detail.hidden && detailReopen) || (() => openSection(sec));
  return { restore };
}
// Same-section jump (a list → an item/quest page): keep the live DOM and scroll
// position of the page we're leaving, so Back lands exactly where you were —
// replaying the build would reset the scroll, the search box and the filters.
function stashReturn() {
  const sec = current, v = views[sec], detail = v.querySelector('.view-detail');
  const open = detail && !detail.hidden;
  const kept = open ? document.createDocumentFragment() : null;
  if (open) kept.append(...detail.childNodes);   // detach before drill() clears it — listeners ride along
  const title = backTitle.textContent, reopen = detailReopen, scroll = v.scrollTop;
  return { restore() {
    current = sec; showOnly(sec); setActiveTile(sec); backbar.hidden = false;
    if (open) {
      detail.innerHTML = ''; detail.classList.remove('art-bg'); detail.style.removeProperty('--tile-art');
      detail.append(kept);
      v.querySelector('.view-body').hidden = true; detail.hidden = false;
    } else resetDetail(v);
    backDest.textContent = T().back; backTitle.textContent = title;
    detailReopen = reopen;
    v.scrollTop = scroll;
  } };
}
function openItemPage(id) {
  const it = D.itemsById.get(id);
  if (!it) return;
  const from = current !== 'objets' ? currentReturn() : stashReturn();   // capture origin before we leave it
  if (current !== 'objets') openSection('objets');              // resets navBack/detailReopen
  navBack = from;                                               // set after openSection so drill shows "Back"
  drill(it.name, (el) => buildItemDetail(el, it));
}

// Removal tombstones (id -> removedAt) for itemsPinned/questsDone: those are
// bare-id arrays with no per-add timestamp, so a plain union merge (see
// progressstore.js mergeData) can't tell "removed here" from "never added on
// the other device" — the resurrected id would come right back. Same pattern
// as roselite-accounts-deleted. Stamp on removal, clear on re-add so a fresh
// pin/mark-done isn't fighting its own old tombstone.
function stampRemoved(key, id) {
  const tomb = readJson(key, {}, isRecord);
  tomb[id] = Date.now();
  writeJson(key, tomb);
}
function clearRemoved(key, id) {
  const tomb = readJson(key, {}, isRecord);
  if (!(id in tomb)) return;
  delete tomb[id];
  writeJson(key, tomb);
}

// Pinned items: the 5-ish items a player looks up constantly (their gear, farm
// targets). Per-account Set of item ids, one localStorage key. Surfaced as a
// strip atop Objets + a star on the item hero. ponytail: a Set, no schema.
let pinned = new Set(readJson('roselite-items-pinned', [], (v) => Array.isArray(v) && v.every(Number.isFinite)));
const savePinned = () => writeJson('roselite-items-pinned', [...pinned]);
let pinnedEl = null;   // the strip; set by renderItems, refilled by renderPinned
function renderPinned() {
  if (!pinnedEl) return;
  const items = [...pinned].map((id) => D.itemsById.get(id)).filter(Boolean);
  pinnedEl.hidden = items.length === 0;
  pinnedEl.innerHTML = items.length
    ? `<div class="detail-label">${T().pinned}</div><ul class="rows">${items.map((it) => itemRow(it)).join('')}</ul>` : '';
}

// Quest progress: personal, localStorage-backed. Marked automatically from the
// data source's 'quest' frames (see api.on('quest') below), manually otherwise —
// the manual toggle stays, live data is off in the shipped build.
let questDone = new Set(readJson('roselite-quests-done', [], (v) => Array.isArray(v) && v.every(Number.isFinite)));
const saveQuestDone = () => { writeJson('roselite-quests-done', [...questDone]); };

// Mark a quest done + every earlier step of its chain (completing step 5 implies
// 1–4). Returns false if it was already done, so callers can skip the noise.
function markQuestDone(q) {
  if (!q || questDone.has(q.game_quest_id)) return false;
  questDone.add(q.game_quest_id);
  clearRemoved('roselite-quests-undone', q.game_quest_id);
  if (q.chain_quests) for (const gid of q.chain_quests) {
    const cq = D.questsByGameId.get(+gid);
    if (cq) { questDone.add(cq.game_quest_id); clearRemoved('roselite-quests-undone', cq.game_quest_id); }
    if (cq && cq.game_quest_id === q.game_quest_id) break;
  }
  saveQuestDone();
  renderQuests();
  return true;
}
function openQuest(q) {
  if (!q) return;
  const d = T();
  const from = current !== 'quetes' ? currentReturn() : stashReturn();   // capture origin (e.g. home search) before we leave it
  if (current !== 'quetes') openSection('quetes');              // resets navBack/detailReopen
  navBack = from;                                               // set after openSection so Back returns to origin
  drill(q.name, (el) => {
    const done = questDone.has(q.game_quest_id);
    const desc = q.description ? `<p class="prose">${D.linkifyItems(esc(q.description))}</p>` : '';
    const badges = `<div class="badges"><span class="tag">${esc(q.type)}</span>${q.repeatable ? `<span class="tag tag--good">↻</span>` : ''}</div>`;
    let chain = '';
    if (q.chain_quests && q.chain_quests.length) {
      chain = `<div class="detail-label">${esc(q.chain_name || '')}</div><div class="chain">${q.chain_quests.map((gid) => {
        const cq = D.questsByGameId.get(+gid);
        const cur = cq && cq.game_quest_id === q.game_quest_id;
        const state = cur ? 'current' : (cq && questDone.has(cq.game_quest_id) ? 'done' : 'todo');
        return `<div class="step step--${state}"${cq ? ` data-q="${cq.game_quest_id}"` : ''}><span class="step-node"></span><span class="step-name">${esc(cq ? cq.name : '#' + gid)}</span></div>`;
      }).join('')}</div>`;
    }
    el.innerHTML = `${badges}${desc}${chain}<button class="btn quest-toggle">${done ? d.markTodo : d.markDone}</button>`;
    const toggle = el.querySelector('.quest-toggle');
    toggle.addEventListener('click', () => {   // update in place — re-drilling would reset the scroll position
      if (questDone.has(q.game_quest_id)) {
        questDone.delete(q.game_quest_id);
        stampRemoved('roselite-quests-undone', q.game_quest_id);
        saveQuestDone();
      } else markQuestDone(q);
      toggle.textContent = questDone.has(q.game_quest_id) ? d.markTodo : d.markDone;
      el.querySelectorAll('.chain .step[data-q]').forEach((s) => {
        if (s.classList.contains('step--current')) return;
        const isDone = questDone.has(+s.dataset.q);
        s.classList.toggle('step--done', isDone);
        s.classList.toggle('step--todo', !isDone);
      });
      renderQuests();
    });
  });
}

function questRow(q) {
  const done = questDone.has(q.game_quest_id);
  return `<li><button class="row qrow" data-q="${q.game_quest_id}">` +
    `<span class="qicon" style="color:${done ? 'var(--jade)' : 'var(--faded)'}">${QICON[done ? 'done' : 'todo']}</span>` +
    `<span class="row-name">${esc(q.name)}</span>${q.repeatable ? '<span class="tag">↻</span>' : ''}</button></li>`;
}
function renderQuests() {
  D.ensurePlanets();   // lazy: only this section's planet filter needs it
  const d = T();
  const done = D.quests.filter((q) => questDone.has(q.game_quest_id)).length, total = D.quests.length;
  const head = `<div class="summary"><span class="summary-title">${d.quests}</span><span class="summary-count">${done} / ${total}</span></div>
     <div class="progress"><div class="progress-fill" style="width:${Math.round(done / total * 100)}%"></div></div>`;
  searchListInto(views.quetes.querySelector('.view-body'), D.quests, questRow, {
    head,
    filters: [
      { type: 'chips', label: d.fType, get: (q) => q.type },
      { type: 'chips', label: d.fPlanet, get: (q) => q.planet, order: ['Junon', 'Luna', 'Eldeon', 'Orlo'] },
      { type: 'toggle', label: d.hideCompleted, keep: (q) => !questDone.has(q.game_quest_id) },
    ],
  });
}
function renderItems() {
  const d = T();
  const openCat = (c) => drill(c.label, (el) => searchListInto(el, c.items, (it) => itemRow(it), {
    filters: [
      { type: 'range', label: d.fLevel, get: (it) => D.itemLevel(it) },
      { type: 'chips', label: d.fJob, get: (it) => D.itemJob(it), keepNull: true },
      { type: 'chips', label: d.fStat || STR.en.fStat, fold: true,
        get: (it) => (it.item_stat && it.item_stat.options || []).map((o) => o.type_name) },
      { type: 'toggle', label: d.fCraftable, keep: (it) => it.is_craftable },
    ],
  }));
  renderList(views.objets, D.categories, (c) => nameRow(esc(c.label), `<span class="row-count">${c.items.length}</span>`), openCat);
  // Search box on the section home: type a name → matches across the whole
  // catalog (rows self-route via data-item-id); empty → back to category browse.
  const body = views.objets.querySelector('.view-body'), cats = body.querySelector('.rows'), CAP = 120;
  const search = document.createElement('input');
  search.className = 'inp search'; search.placeholder = d.search;
  pinnedEl = document.createElement('div'); pinnedEl.className = 'pinned-strip';
  const results = document.createElement('ul'); results.className = 'rows'; results.hidden = true;
  const note = document.createElement('p'); note.className = 'section-note'; note.hidden = true;
  body.prepend(pinnedEl); body.prepend(search); cats.after(results); results.after(note);
  renderPinned();
  // Folded once per item rather than per keystroke — with ~19.5k items, refolding
  // every name on every input event visibly lags the docked panel.
  const ALL = [...D.itemsById.values()].map((it) => ({ it, key: fold(it.name) }));
  search.addEventListener('input', () => {
    const q = fold(search.value.trim());
    if (!q) { cats.hidden = false; renderPinned(); results.hidden = note.hidden = true; return; }
    const m = ALL.filter((entry) => entry.key.includes(q)).map((entry) => entry.it);
    results.innerHTML = m.slice(0, CAP).map((it) => itemRow(it)).join('');
    note.textContent = m.length > CAP ? `${CAP} ${d.ofMatches} ${m.length} — ${d.refineSearch}` : `${m.length}`;
    cats.hidden = true; pinnedEl.hidden = true; results.hidden = note.hidden = false;
  });
}
// ── Market ──────────────────────────────────────────────────────────────────
// Price-first section over the roseutils market snapshot (/api/market/prices —
// one request → all ~3.2k listed items, each with min/max/avg price, quantity,
// last_updated and a min_change_pct/trend). Everything on screen (the priced
// board, trending movers, the watchlist prices) comes from that single snapshot;
// only the featured chart pulls an item's 90-day history on demand. Two-pane in
// fullscreen (browse + big chart left, watchlist + trending right); single column
// when docked. ponytail: en/fr strings, others fall back to en (GEMSTR pattern).
const MKSTR = {
  en: { watch: 'Watchlist', watchEmpty: 'Pin items (☆ on their page) to watch their price.',
        trending: 'Trending', browse: 'Market', find: 'Search an item…', pickChart: 'Select an item to chart its price.',
        sortChange: 'Movers', sortPrice: 'Price', sortUpdated: 'Recent', sortQty: 'Qty', sortName: 'Name',
        updated: 'updated', d7: '7d', d30: '30d', d90: '90d', tLine: 'Price', tQty: 'Quantity', retry: 'Try again',
        qty: 'qty', sellers: 'sellers', offline: 'Market data is unavailable. Check your connection or roseutils token, then try again.' },
  fr: { watch: 'Liste de suivi', watchEmpty: 'Épinglez des objets (☆ sur leur page) pour suivre leur prix.',
        trending: 'Tendances', browse: 'Marché', find: 'Chercher un objet…', pickChart: 'Sélectionnez un objet pour afficher son prix.',
        sortChange: 'Variation', sortPrice: 'Prix', sortUpdated: 'Récents', sortQty: 'Qté', sortName: 'Nom',
        updated: 'màj', d7: '7j', d30: '30j', d90: '90j', tLine: 'Prix', tQty: 'Quantité', retry: 'Réessayer',
        qty: 'qté', sellers: 'vendeurs', offline: 'Les données du marché sont indisponibles. Vérifiez votre connexion ou le token roseutils, puis réessayez.' },
};
const MK = () => MKSTR[lang] || MKSTR.en;

// Snapshot cache: the whole market in one fetch, reused for 5 min (like the feeds).
// Returns the rows array, '401' when the token is rejected, or null on failure.
let mkSnap = null, mkSnapAt = 0;
async function mkLoad() {
  if (mkSnap && Date.now() - mkSnapAt < 300000) return mkSnap;
  let r;
  try { r = await ipcRenderer.invoke('market-prices'); }
  catch { return null; }
  if (r.status === 401) return '401';
  if (!r.ok || !r.data || !Array.isArray(r.data.data)) return null;
  // Folded once per refresh (every 5 min at most) rather than per keystroke —
  // ~3.2k rows refolded on every search input event was visible lag.
  mkSnap = r.data.data.filter((row) => row.is_selling).map((row) => ({ ...row, _key: fold(row.item_name) }));
  mkSnapAt = Date.now();
  return mkSnap;
}
// Join a snapshot row to our catalog item (for the icon + item-page link). The
// two sources swap names: roseutils item_id == our game_item_id (and roseutils
// game_item_id == our id), so the key is our item_type_id:game_item_id ↔ the
// row's item_type:item_id — the same pairing the item page's market fetch uses.
// The row's own item_type/item_id also drive the history route: no catalog dep
// for prices/charts, only for the local icon + full item-page link.
let mkCatalog = null;
function mkCatItem(row) {
  if (!mkCatalog) {
    mkCatalog = new Map();
    for (const it of D.itemsById.values())
      if (it.item_type_id != null && it.game_item_id != null) mkCatalog.set(`${it.item_type_id}:${it.game_item_id}`, it);
  }
  return mkCatalog.get(`${row.item_type}:${row.item_id}`) || null;
}
const mkIcon = (row) => { const it = mkCatItem(row); return it ? D.itemImg(it, 'row-icon') : '<span class="row-icon"></span>'; };
const mkPct = (row) => Math.round(+row.min_change_pct || 0);
console.assert(mkPct({ min_change_pct: '163.2' }) === 163 && mkPct({ min_change_pct: -8.4 }) === -8, 'mkPct: rounds string/number pct');
// Absolute zuly moved (|current − prior|), derived from price + change%. Ranks
// trending/movers by real value shifted, so a 1z item at +9999900% (thin-market
// noise) sinks below a 150k item at +14900%. Guards prior→∞ when pct ≤ −99%.
const mkDelta = (row) => {
  const cur = +row.min_price || 0, f = 1 + (+row.min_change_pct || 0) / 100;
  return Math.abs(cur - (f > 0.01 ? cur / f : 0));
};
console.assert(mkDelta({ min_price: 150000, min_change_pct: 14900 }) > mkDelta({ min_price: 1, min_change_pct: 9999900 }), 'mkDelta: value-weighted beats dust');
const mkChg = (row) => { const p = mkPct(row), dir = p > 0 ? 'up' : p < 0 ? 'down' : ''; return `<span class="mk-chg mk-chg--${dir}">${p > 0 ? '▲ ' : p < 0 ? '▼ ' : ''}${Math.abs(p)}%</span>`; };
// The "actual" price shown everywhere is the latest daily min from the history
// route (what the item page shows), NOT the snapshot's min_price — that's a
// long-window minimum (often a stale cheap listing, e.g. a 100k backpack whose
// current listing is 4.2M). The snapshot can't give per-item latest for all ~3.2k
// items, and the prices endpoint ignores date params, so each price cell renders
// '…' and lazily upgrades when it scrolls into view. Cached per session + coalesced
// by roseGet, so sorts/searches/re-opens reuse it. ponytail: ~visible-rows history
// requests per market open — a shared cache/proxy (config.roseutilsBase) if it bites.
const mkActual = new Map();   // "item_type:item_id" -> latest min price (number)
const mkPriceCell = (row) => {
  const key = `${row.item_type}:${row.item_id}`, v = mkActual.get(key);
  return `<span class="mk-z" data-price="${key}" data-tt="${row.item_type}" data-ti="${row.item_id}" data-fb="${Math.round(row.min_price)}">${v != null ? fmtZ(v) : '…'}</span>`;
};
let mkPriceObs = null;
function mkObservePrices(scope) {
  if (!mkPriceObs) mkPriceObs = new IntersectionObserver((ents) => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      const el = en.target; mkPriceObs.unobserve(el);
      const key = el.dataset.price;
      if (mkActual.has(key)) { el.textContent = fmtZ(mkActual.get(key)); continue; }
      ipcRenderer.invoke('market', +el.dataset.tt, +el.dataset.ti).then((r) => {
        const h = r.ok && r.data && r.data.history;
        const p = (h && h.length) ? Math.round(+h[h.length - 1].min_price) : +el.dataset.fb;   // fall back to snapshot min on no history
        mkActual.set(key, p);
        if (el.isConnected) el.textContent = fmtZ(p);
      }).catch(() => { if (el.isConnected) el.textContent = fmtZ(+el.dataset.fb); });
    }
  }, { rootMargin: '120px' });
  scope.querySelectorAll('[data-price]').forEach((el) => {
    const key = el.dataset.price;
    if (mkActual.has(key)) el.textContent = fmtZ(mkActual.get(key)); else mkPriceObs.observe(el);
  });
}
// Compact clickable row (watchlist + trending sidebar). data-mk = item_type:item_id.
const mkMini = (row) => `<button class="mk-mini" data-mk="${row.item_type}:${row.item_id}">${mkIcon(row)}` +
  `<span class="mk-name">${esc(row.item_name)}</span><span class="mk-r">${mkPriceCell(row)}${mkChg(row)}</span></button>`;
const mkListRow = (row) => `<li><button class="row mk-lrow" data-mk="${row.item_type}:${row.item_id}">${mkIcon(row)}` +
  `<span class="row-name">${esc(row.item_name)}</span><span class="mk-r">${mkPriceCell(row)}${mkChg(row)}</span></button></li>`;

let mkSort = 'change';   // session-only sort of the market board
async function renderMarche() {
  const m = MK();
  const body = views.marche.querySelector('.view-body');
  // Skeleton first (survives the await), then fill once the snapshot resolves.
  body.innerHTML =
    `<div class="mk"><div class="mk-main">` +
      `<input class="inp search mk-q" placeholder="${esc(m.find)}">` +
      `<div class="mk-featured"><p class="section-note">${esc(m.pickChart)}</p></div>` +
      `<div class="mk-browse"></div></div>` +
      `<aside class="mk-side">` +
        `<div class="detail-label">${esc(m.watch)}</div><div class="mk-watch"></div>` +
        `<div class="detail-label">${esc(m.trending)}</div><div class="mk-trend"></div>` +
      `</aside></div>`;
  // First open (nothing cached yet): breathing-logo loader until the snapshot lands.
  if (!mkSnap) body.querySelector('.mk-browse').innerHTML = `<div class="mk-loading"><img src="assets/roselite-logo-ui.png" alt=""><span>${esc(m.browse)}…</span></div>`;
  const snap = await mkLoad();
  if (!views.marche.querySelector('.mk-browse')) return;   // navigated away mid-fetch
  const browse = body.querySelector('.mk-browse');
  if (snap === '401' || !snap) {
    const unauthorized = snap === '401';
    body.querySelector('.mk-q').hidden = true;
    body.querySelector('.mk-featured').hidden = true;
    body.querySelector('.mk-side').hidden = true;
    browse.innerHTML = `<div class="mk-error" role="alert"><p class="section-note">${unauthorized ? esc(T().connectRose) : esc(m.offline)}</p>` +
      `<button class="lang-btn mk-retry" type="button">${esc(unauthorized ? (T().tips || STR.en.tips).settings : m.retry)}</button></div>`;
    browse.querySelector('.mk-retry').addEventListener('click', () => {
      if (unauthorized) openSection('parametres');
      else { mkSnap = null; mkSnapAt = 0; renderMarche(); }
    });
    return;
  }
  // Keyed by item_type:item_id — the same pairing as our catalog item_type_id:
  // game_item_id (the sources swap the two id names), so the watchlist join works.
  const byId = new Map(snap.map((r) => [`${r.item_type}:${r.item_id}`, r]));

  // Watchlist: pinned items that are currently on the market.
  const watch = [...pinned].map((id) => D.itemsById.get(id)).filter(Boolean)
    .map((it) => byId.get(`${it.item_type_id}:${it.game_item_id}`)).filter(Boolean);
  const watchEl = body.querySelector('.mk-watch');
  watchEl.innerHTML = watch.length ? watch.map(mkMini).join('') : `<p class="section-note">${esc(m.watchEmpty)}</p>`;
  mkObservePrices(watchEl);

  // Trending: biggest movers by value shifted, ignoring thin/dust markets (few
  // samples or sub-1k prices make change% pure noise). ponytail: sample_count>=3
  // and min_price>=1000 floors, tune if too strict.
  const trend = snap.filter((r) => r.sample_count >= 3 && r.min_price >= 1000 && mkPct(r) !== 0)
    .sort((a, b) => mkDelta(b) - mkDelta(a)).slice(0, 12);
  const trendEl = body.querySelector('.mk-trend');
  trendEl.innerHTML = trend.map(mkMini).join('') || '<p class="section-note">—</p>';
  mkObservePrices(trendEl);

  // Browse board: search + sort over the whole snapshot (cap the render like the
  // other big lists). Sort re-paints in place; search filters by folded name.
  const d = T(), CAP = 120;
  const SORTS = [['change', m.sortChange], ['price', m.sortPrice], ['updated', m.sortUpdated], ['qty', m.sortQty], ['name', m.sortName]];
  // ponytail: sorts run on snapshot fields (min_price is the window min, not the
  // lazily-fetched actual price) — sorting by actual would need all ~3.2k fetched.
  const cmp = {
    change: (a, b) => mkDelta(b) - mkDelta(a),
    price: (a, b) => b.min_price - a.min_price,
    updated: (a, b) => new Date(b.last_updated) - new Date(a.last_updated),
    qty: (a, b) => (b.latest_quantity || 0) - (a.latest_quantity || 0),
    name: (a, b) => a.item_name.localeCompare(b.item_name),
  };
  browse.innerHTML =
    `<div class="chips mk-sort">${SORTS.map(([k, l]) => `<button class="chip${k === mkSort ? ' chip--on' : ''}" data-sort="${k}">${esc(l)}</button>`).join('')}</div>` +
    `<ul class="rows mk-list"></ul><p class="section-note mk-note"></p>`;
  const listEl = browse.querySelector('.mk-list'), noteEl = browse.querySelector('.mk-note'), qEl = body.querySelector('.mk-q');
  let q = '';
  const paint = () => {
    body.querySelector('.mk').classList.toggle('mk--searching', !!q);   // results replace the chart while typing
    const mm = (q ? snap.filter((r) => r._key.includes(q)) : snap.slice()).sort(cmp[mkSort] || cmp.change);
    listEl.innerHTML = mm.slice(0, CAP).map(mkListRow).join('');
    noteEl.textContent = mm.length > CAP ? `${CAP} ${d.ofMatches} ${mm.length} — ${d.refineSearch}` : `${mm.length}`;
    mkObservePrices(listEl);   // lazily fill each visible row's actual price
  };
  qEl.addEventListener('input', () => { q = fold(qEl.value.trim()); paint(); });
  browse.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    mkSort = b.dataset.sort; browse.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('chip--on', x === b)); paint();
  }));
  paint();

  // Row clicks (board + sidebar minis). The .mk container is rebuilt every render,
  // so this listener never accumulates across opens.
  body.querySelector('.mk').addEventListener('click', (e) => {
    const el = e.target.closest('[data-mk]');
    if (el) mkOpen(byId.get(el.dataset.mk));
  });
  // Feature the top mover on open so the fullscreen chart pane isn't empty.
  if (trend[0] && document.body.classList.contains('fullscreen')) mkFeature(trend[0]);
}
// Docked → open the rich item page (recipe/usedIn/link). Fullscreen (or no catalog
// match) → load the inline featured chart, keeping you on the market screen.
function mkOpen(row) {
  if (!row) return;
  const it = mkCatItem(row);
  if (it && !document.body.classList.contains('fullscreen')) openItemPage(it.id);
  else mkFeature(row);
}
// Featured pane: header (icon, name, price, change, qty, sellers, freshness) + a
// big interactive chart pulled on demand: line/bar toggle, 7/30/90-day range, and
// hover-to-read prices. Guards against a slower earlier fetch landing after a
// newer click via the item key; caches the fetched history so toggles re-render
// without re-fetching.
let mkFeatHist = null, mkFeatQty = null, mkChartType = 'line', mkChartRange = 90;
function mkFeature(row) {
  const box = views.marche.querySelector('.mk-featured');
  if (!box) return;
  const m = MK(), key = `${row.item_type}:${row.item_id}`;
  box.closest('.mk')?.classList.remove('mk--searching');   // a clicked result unhides the chart
  box.dataset.key = key;
  mkFeatHist = null;
  mkFeatQty = null;
  const it = mkCatItem(row);
  const name = it ? `<span class="mk-feat-name item-link" data-item-id="${it.id}">${esc(row.item_name)}</span>`
    : `<span class="mk-feat-name">${esc(row.item_name)}</span>`;
  const upd = row.last_updated ? ` · ${m.updated} ${fmtAgo(row.last_updated)}` : '';
  box.innerHTML = `<div class="mk-feat-head">${mkIcon(row)}<div class="mk-feat-meta">${name}` +
    `<div class="mk-feat-sub">${mkChg(row)} · ${row.latest_quantity ?? '—'} ${m.qty} · ${row.sample_count} ${m.sellers}${upd}</div></div>` +
    `<div class="mk-feat-price">${fmtZ(Math.round(row.min_price))}</div></div>` +
    `<div class="mk-feat-chart"><p class="section-note">…</p></div>`;
  box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });   // clicking a list row jumps back to the chart
  ipcRenderer.invoke('market', row.item_type, row.item_id).then((r) => {
    if (box.dataset.key !== key) return;   // a newer feature click won
    const h = r.ok && r.data && r.data.history;
    if (!(h && h.length >= 2)) {
      box.querySelector('.mk-feat-chart').innerHTML = `<p class="section-note">${r.status === 401 ? T().connectRose : T().marketNA}</p>`;
      return;
    }
    mkFeatHist = h;
    // Header price mirrors the item page exactly — the latest daily min from the
    // same history route, not the snapshot ask — so "big" and the item page agree.
    const pe = box.querySelector('.mk-feat-price'), latest = h[h.length - 1];
    if (latest.min_price != null) { const p = Math.round(+latest.min_price); if (pe) pe.textContent = fmtZ(p); mkActual.set(key, p); }
    paintFeatChart(box);
  }).catch(() => {
    if (box.dataset.key === key) box.querySelector('.mk-feat-chart').innerHTML = `<p class="section-note">${esc(T().marketErr)}</p>`;
  });
}
// Two views of the featured item: 'line' = daily min-price area+line (mkFeatHist),
// 'quantity' = daily listed-quantity bars (mkFeatQty, fetched lazily on first
// toggle from the separate quantity-history route). Renders the range/type
// controls + chart; re-paints in place on toggle.
const fmtQty = (v) => new Intl.NumberFormat(locale()).format(Math.round(v));
function paintFeatChart(box) {
  const h = mkFeatHist; if (!h) return;
  const m = MK(), wrap = box.querySelector('.mk-feat-chart');
  const ranges = [[7, m.d7], [30, m.d30], [90, m.d90]], types = [['line', m.tLine], ['quantity', m.tQty]];
  const ctl =
    `<div class="mk-chart-ctl">` +
      `<div class="chips mk-range">${ranges.map(([k, l]) => `<button class="chip${k === mkChartRange ? ' chip--on' : ''}" data-range="${k}">${esc(l)}</button>`).join('')}</div>` +
      `<div class="chips mk-ctype">${types.map(([k, l]) => `<button class="chip${k === mkChartType ? ' chip--on' : ''}" data-ctype="${k}">${esc(l)}</button>`).join('')}</div>` +
    `</div>`;
  const wire = () => {
    wrap.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => { mkChartRange = +b.dataset.range; paintFeatChart(box); });
    wrap.querySelectorAll('[data-ctype]').forEach((b) => b.onclick = () => { mkChartType = b.dataset.ctype; paintFeatChart(box); });
  };
  if (mkChartType === 'quantity') {
    if (mkFeatQty === null) {                          // fetch the quantity series once, then re-paint
      wrap.innerHTML = ctl + `<p class="section-note">…</p>`; wire();
      const key = box.dataset.key, [t, id] = key.split(':');
      ipcRenderer.invoke('market-quantity', +t, +id).then((r) => {
        if (box.dataset.key !== key) return;           // a newer feature click won
        mkFeatQty = (r.ok && r.data && r.data.history) || [];
        if (mkChartType === 'quantity') paintFeatChart(box);
      }).catch(() => {
        if (box.dataset.key !== key) return;
        mkFeatQty = [];
        if (mkChartType === 'quantity') paintFeatChart(box);
      });
      return;
    }
    const qs = mkFeatQty.slice(-mkChartRange);
    if (qs.length < 2) { wrap.innerHTML = ctl + `<p class="section-note">${T().marketNA}</p>`; wire(); return; }
    wrap.innerHTML = ctl + bigChart(qs, { key: 'quantity', fmt: fmtQty, kind: 'bar' }); wire();
    wireChartHover(wrap.querySelector('.pchart'), qs, { key: 'quantity', fmt: fmtQty });
    return;
  }
  const hs = h.slice(-mkChartRange);
  wrap.innerHTML = ctl + bigChart(hs, { key: 'min_price', fmt: fmtZ, kind: 'line' }); wire();
  wireChartHover(wrap.querySelector('.pchart'), hs, { key: 'min_price', fmt: fmtZ });
}
// Big chart for the featured pane, over one series. opts: { key, fmt, kind } —
// kind 'line' = filled area + line (min-price), 'bar' = daily bars (quantity).
// Both fill a taller box with value + date axes; bars baseline at the window min
// so small variation stays visible. hs ≥ 2 points.
function bigChart(hs, opts) {
  const { key, fmt, kind } = opts;
  const vals = hs.map((e) => +e[key]);
  const W = 600, H = 200, pad = 6;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i) => pad + i * (W - 2 * pad) / (hs.length - 1);
  const y = (v) => pad + (H - 2 * pad) * (1 - (v - lo) / span);
  const fd = (s) => { const dt = new Date(s); return `${dt.getDate()} ${T().months[dt.getMonth()]}`; };
  let body;
  if (kind === 'bar') {
    const bw = Math.max(1, (W - 2 * pad) / hs.length * 0.72);
    body = vals.map((v, i) => `<rect class="pchart-bar" x="${(x(i) - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad - y(v)).toFixed(1)}"/>`).join('');
  } else {
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${x(0).toFixed(1)},${(H - pad).toFixed(1)} ${pts} ${x(hs.length - 1).toFixed(1)},${(H - pad).toFixed(1)}`;
    body = `<polygon class="pchart-area" points="${area}"/><polyline class="pchart-line" points="${pts}"/>` +
      `<circle class="pchart-dot" cx="${x(hs.length - 1).toFixed(1)}" cy="${y(vals[hs.length - 1]).toFixed(1)}" r="2.4"/>`;
  }
  const mid = hs[Math.floor((hs.length - 1) / 2)];
  // Evenly-spaced y-axis ticks (hi → lo) so the price scale reads gradually,
  // not just top/bottom. .pchart-scale is space-between, matching the y mapping.
  const TICKS = 5, ticks = Array.from({ length: TICKS }, (_, i) => fmt(hi - (hi - lo) * i / (TICKS - 1)));
  return `<div class="pchart pchart--big"><svg class="pchart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${body}</svg>` +
    `<div class="pchart-scale">${ticks.map((t) => `<span>${t}</span>`).join('')}</div>` +
    `<div class="pchart-xaxis"><span>${fd(hs[0].date)}</span><span>${fd(mid.date)}</span><span>${fd(hs[hs.length - 1].date)}</span></div></div>`;
}
{ const _t = [{ date: '2026-01-01', min_price: 10, quantity: 3 }, { date: '2026-01-02', min_price: 15, quantity: 1 }];
  console.assert(bigChart(_t, { key: 'quantity', fmt: fmtQty, kind: 'bar' }).includes('pchart-bar')
    && bigChart(_t, { key: 'min_price', fmt: fmtZ, kind: 'line' }).includes('pchart-line'), 'bigChart: bar vs line branch'); }
// Hover crosshair + tooltip over a .pchart: maps the cursor x to the nearest data
// point and reads out its date + value (opts.key formatted by opts.fmt). Px-based
// (survives the SVG's non-uniform stretch); one layer appended, cleaned up on the
// next re-paint.
function wireChartHover(root, hs, opts) {
  if (!root || hs.length < 2) return;
  const svg = root.querySelector('.pchart-svg');
  const layer = document.createElement('div');
  layer.className = 'pchart-hover';
  layer.innerHTML = `<div class="pchart-cross"></div><div class="pchart-tip"></div>`;
  root.appendChild(layer);
  const cross = layer.querySelector('.pchart-cross'), tip = layer.querySelector('.pchart-tip'), mo = T().months;
  root.addEventListener('mousemove', (ev) => {
    const rr = root.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (ev.clientX - sr.left) / sr.width));
    const i = Math.round(frac * (hs.length - 1)), e = hs[i];
    const px = (sr.left - rr.left) + (i / (hs.length - 1)) * sr.width;
    cross.style.left = tip.style.left = px + 'px';
    cross.style.top = (sr.top - rr.top) + 'px';
    cross.style.height = sr.height + 'px';
    const dt = new Date(e.date);
    tip.innerHTML = `<b>${dt.getDate()} ${mo[dt.getMonth()]}</b> · ${opts.fmt(Math.round(+e[opts.key]))}`;
    layer.classList.add('on');
  });
  root.addEventListener('mouseleave', () => layer.classList.remove('on'));
}
// Craftables grouped by craft skill. Lazy: triggers the all_recipes parse, so
// it's rendered on first open of the section, not at boot (see openSection).
function renderRecipes() {
  const groups = D.recipesBySkill();
  // Global search across every craftable, with a craft-skill filter that stands
  // in for the old per-skill drill. Clicks route through the item-row delegate.
  const all = groups.flatMap(([skill, items]) => items.map((it) => ({ ...it, _skill: skill })));
  const body = views.recettes.querySelector('.view-body');
  searchListInto(body, all, (it) => itemRow(it), {
    filters: [{ type: 'chips', label: lang === 'fr' ? 'Compétence' : 'Craft skill', get: (it) => it._skill }],
    collapsible: true,
  });
}
// ── Gem crafting calculator ────────────────────────────────────────────────
// Gems form a recipe tree (Ruby[9] = 2× Ruby[8] + raws + Chemical, all the way
// down). Pick target gems + quantities, declare the lower-rank gems you already
// own, and get the flat shopping list of base materials. Walks D.recipeFor
// recursively; a material is a sub-gem to expand iff its recipe is Gem Cutting,
// otherwise it's a leaf (Chemical, Red Crystal…) that lands in the list.
// ponytail: en/fr labels only (owner is FR/EN) — other langs fall back to en.
const GEMSTR = {
  en: { pick: 'Search a gem to craft…', have: 'Already have', mats: 'Materials needed',
        none: 'Search a gem above to start.', nomats: 'Nothing left to craft — you have enough.', copyList: 'Copy shopping list' },
  fr: { pick: 'Cherchez une gemme à fabriquer…', have: 'J’ai déjà', mats: 'Matériaux nécessaires',
        none: 'Cherchez une gemme ci-dessus pour commencer.', nomats: 'Rien à fabriquer — vous en avez assez.', copyList: 'Copier la liste' },
};
const G = () => GEMSTR[lang] || GEMSTR.en;
let gemData = null;                 // { items, byType: Map(base -> [{rank,item}]) }  (lazy)
const gemEntry = (item, qty = 1, owned = {}) => {
  const m = item.name.match(/^(.+?)\s*\[(\d+)\]$/);
  return { item, base: m ? m[1] : item.name, rank: m ? +m[2] : 1, qty, owned };
};
// Targets persist per account (ids only, rehydrated from the catalog) so a
// half-built shopping list survives reloads and relaunches.
const gemStoreKey = () => 'roselite-gem-targets';
const saveGemTargets = () => writeJson(gemStoreKey(),
  gemTargets.map((t) => ({ id: t.item.id, qty: t.qty, owned: t.owned })));
let gemTargets = readJson(gemStoreKey(), [], Array.isArray).map((entry) => {
  if (!isRecord(entry)) return null;
  const { id, qty, owned } = entry;
  const item = D.itemsById.get(id);
  return item ? gemEntry(item, Math.max(1, qty | 0), isRecord(owned) ? owned : {}) : null;
}).filter(Boolean);
function gemCatalog() {
  if (gemData) return gemData;
  const grp = D.recipesBySkill().find(([skill]) => skill === 'Gem Cutting');
  const items = grp ? grp[1] : [];
  gemData = { items, byType: L.gemTypes(items) };
  return gemData;
}
// Expansion → shopping list; the tree walk lives in logic.js so
// gems-calc.test.js checks the real code.
const gemExpand = (targets) => L.gemExpand(targets, gemCatalog().byType, D.recipeFor);
function renderGems() {
  const body = views.gems.querySelector('.view-body');
  body.innerHTML =
    `<input class="inp search gem-search" placeholder="${esc(G().pick)}">` +
    `<ul class="rows gem-matches" hidden></ul>` +
    `<div class="gem-cards"></div>` +
    `<div class="gem-output"></div>`;
  const search = body.querySelector('.gem-search');
  const matches = body.querySelector('.gem-matches');
  search.addEventListener('input', () => {
    const q = fold(search.value.trim());
    if (!q) { matches.hidden = true; return; }
    // Sort by base name then rank so "Ruby [1]…[10]" list in numeric order.
    const parse = (n) => { const m = n.match(/^(.+?)\s*\[(\d+)\]$/); return m ? [m[1], +m[2]] : [n, 0]; };
    const hits = gemCatalog().items.filter((it) => fold(it.name).includes(q))
      .sort((a, b) => { const [ba, ra] = parse(a.name), [bb, rb] = parse(b.name); return ba.localeCompare(bb) || ra - rb; })
      .slice(0, 20);
    matches.innerHTML = hits.map((it) => `<li><button class="row">${D.itemImg(it, 'row-icon')}<span class="row-name">${esc(it.name)}</span></button></li>`).join('');
    matches.querySelectorAll('.row').forEach((r, i) => r.addEventListener('click', () => addGemTarget(hits[i])));
    matches.hidden = false;
  });
  paintGemCards(); paintGemOutput();
}
function addGemTarget(item) {
  if (gemTargets.some((t) => t.item.id === item.id)) return;   // already added
  gemTargets.push(gemEntry(item));
  saveGemTargets();
  const body = views.gems.querySelector('.view-body');
  body.querySelector('.gem-search').value = '';
  body.querySelector('.gem-matches').hidden = true;
  paintGemCards(); paintGemOutput();
}
function paintGemCards() {
  const box = views.gems.querySelector('.gem-cards');
  box.innerHTML = gemTargets.map((t, i) => {
    const lower = (gemCatalog().byType.get(t.base) || []).filter((r) => r.rank < t.rank);
    const owned = lower.length
      ? `<div class="detail-label">${esc(G().have)}</div><div class="owned-grid">` +
        lower.map((r) => `<label class="owned-cell"><span>[${r.rank}]</span>` +
          `<input class="inp gem-own" type="number" min="0" placeholder="0" data-i="${i}" data-rank="${r.rank}" ` +
          `value="${t.owned[r.rank] || ''}"></label>`).join('') + `</div>`
      : '';
    return `<div class="gem-card"><div class="gem-top">${D.itemImg(t.item, 'row-icon')}` +
      `<a class="item-link row-name" data-item-id="${t.item.id}">${esc(t.item.name)}</a>` +
      `<input class="inp gem-qty" type="number" min="1" value="${t.qty}" data-i="${i}">` +
      `<button class="gem-rm" data-i="${i}" aria-label="remove">×</button></div>${owned}</div>`;
  }).join('');
  box.querySelectorAll('.gem-qty').forEach((el) => el.addEventListener('input', () => {
    gemTargets[+el.dataset.i].qty = Math.max(1, parseInt(el.value, 10) || 1); saveGemTargets(); paintGemOutput();
  }));
  box.querySelectorAll('.gem-own').forEach((el) => el.addEventListener('input', () => {
    gemTargets[+el.dataset.i].owned[+el.dataset.rank] = Math.max(0, parseInt(el.value, 10) || 0); saveGemTargets(); paintGemOutput();
  }));
  box.querySelectorAll('.gem-rm').forEach((el) => el.addEventListener('click', () => {
    gemTargets.splice(+el.dataset.i, 1); saveGemTargets(); paintGemCards(); paintGemOutput();
  }));
}
function paintGemOutput() {
  const out = views.gems.querySelector('.gem-output');
  if (!gemTargets.length) { out.innerHTML = `<p class="section-note">${esc(G().none)}</p>`; return; }
  const raws = gemExpand(gemTargets);
  if (!raws.length) { out.innerHTML = `<p class="section-note">${esc(G().nomats)}</p>`; return; }
  out.innerHTML = `<div class="detail-label">${esc(G().mats)}` +
    `<button class="gem-copy" data-copy title="${esc(G().copyList)}" aria-label="${esc(G().copyList)}">🛒</button></div><ul class="rows">` +
    raws.map((r) => { const it = D.itemsById.get(r.id);
      const name = it ? `<a class="item-link row-name" data-item-id="${it.id}">${esc(r.name)}</a>`
                      : `<span class="row-name">${esc(r.name)}</span>`;
      return `<li><div class="row row--static">${D.itemImg(it, 'row-icon')}` +
        `${name}<span class="qty">${r.count.toLocaleString()}</span></div></li>`; }).join('') +
    `</ul>`;
  // List to paste to a vendor alt / clan mate: one in-game item link per line, count
  // carried by the link itself. ponytail: no cap on count — a shopping list can ask for
  // more than a stack holds; cap at 999 if the game renders those links wrong.
  wireCopy(out.querySelector('[data-copy]'), () => raws.map((r) => {
    const it = D.itemsById.get(r.id);
    return it && it.game_item_id != null ? itemLink(it, r.count) : `${r.count}× ${r.name}`;
  }).join('\n'), '🛒', G().copyList, T());
}

// Guides open onto a sub-menu (a tile grid like the home menu) of fixed
// sections. A guide lands in a section by its tags (index.json), never a
// hard-coded list — add a tag, it moves. Empty sections show the teaching
// empty state. ponytail: en/fr labels, other langs fall back to en (like the
// gem calc); icons reuse the home ICONS set.
const GUIDE_CATS = [
  { id: 'clan',     tag: 'clan',     icon: 'rois',       en: 'Clan',          fr: 'Clan' },
  { id: 'crafting', tag: 'crafting', icon: 'recettes',   en: 'Crafting',      fr: 'Artisanat' },
  { id: 'vending',  tag: 'vending',  icon: 'cris',       en: 'Vending',       fr: 'Vente' },
  { id: 'map',      tag: 'map',      icon: 'evenements', en: 'Planets / Map', fr: 'Planètes / Carte' },
  { id: 'classes',  tag: 'classes',  icon: 'personnage', en: 'Classes',       fr: 'Classes' },
  { id: 'leveling', tag: 'leveling', icon: 'gems',       en: 'Leveling',      fr: 'Niveau' },
  { id: 'dungeon',  tag: 'dungeon',  icon: 'donjons',    en: 'Dungeon',       fr: 'Donjon' },
  { id: 'elements', tag: 'elements', icon: 'elements',   en: 'Elements',      fr: 'Éléments' },
  { id: 'pvp',      tag: 'pvp',      icon: 'rois',       en: 'PVP / Honor',   fr: 'PVP / Honneur' },
  { id: 'pvm',      tag: 'pvm',      icon: 'monstres',   en: 'PVM / Valor',   fr: 'PVM / Valeur' },
  { id: 'party',    tag: 'party',    icon: 'personnage', en: 'Party System',  fr: 'Groupe' },
  { id: 'quests',   tag: 'quest',    icon: 'quetes',     en: 'Quests',        fr: 'Quêtes' },
  { id: 'faq',      tag: 'faq',      icon: 'guides',     en: 'FAQ',           fr: 'FAQ' },
];
const guideCatLabel = (c) => (lang === 'fr' ? c.fr : c.en);
// A section tile shows a faded background image if assets/guides/<id>.<ext>
// exists (named by category id). ponytail: filename convention, no manifest —
// drop a file, it appears. Scanned once at boot (the dir doesn't change live).
const GUIDE_ART_DIR = path.join(__dirname, 'assets', 'guides');
const guideArtBy = (() => {
  const by = {};
  try { for (const f of fs.readdirSync(GUIDE_ART_DIR)) { const m = f.match(/^(.+)\.(png|jpe?g|webp)$/i); if (m) by[m[1].toLowerCase()] = 'assets/guides/' + f; } } catch {}
  return by;
})();
function openGuide(g, art) {
  if (!g) return;
  const from = currentReturn();                      // origin: guide category list, or the home search feed
  if (current !== 'guides') openSection('guides');   // home search → switch section first (drill needs a section view)
  navBack = from;                                    // set after openSection so Back restores the origin
  drill(g.title, (el) => {
    if (art) { el.classList.add('art-bg'); el.style.setProperty('--tile-art', `url(${art})`); }
    el.innerHTML = `<div class="prose">${D.linkifyItems(D.loadFragment('guides', g.file))}</div>`;
  });
}
// Elements moved under Guides: the 'elements' tile shows the type-advantage
// chart instead of a tag-filtered guide list (no guides carry an elements tag).
// ponytail: element data is fixed sample; drop this branch if it ever becomes
// tag-driven guides like the others.
function openElement(e) {
  navBack = currentReturn();
  drill(e.name, (el) => {
    el.innerHTML = `<div class="rel"><span class="rel-label">${T().strongVs}</span><span class="tag tag--good">${e.strong}</span></div>
      <div class="rel"><span class="rel-label">${T().weakVs}</span><span class="tag tag--bad">${e.weak}</span></div>`;
  });
}
function renderGuides() {
  const d = T();
  const body = views.guides.querySelector('.view-body');
  body.innerHTML = `<div class="home-grid">${GUIDE_CATS.map((c) => {
    const art = guideArtBy[c.id];
    return `<button class="tile${art ? ' tile--art' : ''}" data-cat="${c.id}"${art ? ` style="--tile-art:url(${art})"` : ''}>` +
      `${ICONS[c.icon]}<span class="tile-label">${esc(guideCatLabel(c))}</span></button>`;
  }).join('')}</div>`;
  body.querySelectorAll('.tile').forEach((el) => el.addEventListener('click', () => {
    const c = GUIDE_CATS.find((x) => x.id === el.dataset.cat);
    drill(guideCatLabel(c), (host) => {
      const art = guideArtBy[c.id];
      if (art) { host.classList.add('art-bg'); host.style.setProperty('--tile-art', `url(${art})`); }
      if (c.id === 'elements') {
        host.innerHTML = `<ul class="rows">${ELEMENTS.map((e) => nameRow(esc(e.name))).join('')}</ul>`;
        [...host.querySelectorAll('.row')].forEach((r, i) => r.addEventListener('click', () => openElement(ELEMENTS[i])));
        return;
      }
      const list = D.guidesIndex.filter((g) => (g.tags || []).includes(c.tag));
      if (!list.length) { host.innerHTML = `<div class="empty"><strong>${d.emptyTitle}</strong>${d.emptyBody}</div>`; return; }
      searchListInto(host, list, (g) => nameRow(esc(g.title)), {
        name: (g) => g.title,
        filters: [{ type: 'chips', label: d.fTags, get: (g) => g.tags || [] }],
        onClick: (g) => openGuide(g, guideArtBy[c.id]),
      });
    });
  }));
}
// Active when today falls in the yearly range (handles Dec→Jan wrap).
function eventActive(ev, today = new Date()) {
  const t = (today.getMonth() + 1) * 100 + today.getDate();
  const a = ev.start[0] * 100 + ev.start[1], b = ev.end[0] * 100 + ev.end[1];
  return a <= b ? (t >= a && t <= b) : (t >= a || t <= b);
}
console.assert(eventActive({ start: [12, 15], end: [1, 2] }, new Date(2026, 11, 20)), 'wrap: active in Dec');
console.assert(!eventActive({ start: [6, 21], end: [7, 15] }, new Date(2026, 7, 1)), 'range: inactive in Aug');
const fmtRange = (ev) => `${ev.start[1]} ${T().months[ev.start[0] - 1]} – ${ev.end[1]} ${T().months[ev.end[0] - 1]}`;

// Recurring weekly bosses (getDay(): 0=Sun … 6=Sat), scheduled in Paris
// wall-clock time — the same instant for every player, wherever they are.
// Super Boss: Sunday 15h. Kepris: Saturday, alternating each week between 15h
// and 12 hours earlier (3h); anchored on 2026-07-11, an early week.
// ponytail: hardcoded list; promote to data.js / RoseData if the schedule grows.
const mod2 = (n) => ((Math.round(n) % 2) + 2) % 2;
const KEPRIS_ANCHOR = Date.UTC(2026, 6, 11);   // Saturday on the 3h rotation
const RECURRING = [
  { day: 6, name: 'Kepris', hour: (utcMidnight) => (mod2((utcMidnight - KEPRIS_ANCHOR) / 6048e5) ? 15 : 3) },
  { day: 0, name: 'Super Boss', hour: () => 15 },
];
// Europe/Paris ↔ UTC without a tz library: Intl already knows the DST rules.
// ponytail: the offset is sampled at the guessed instant, so a boss scheduled
// inside the 1h DST switch window would be off by an hour. None are.
const parisParts = (t) => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  .formatToParts(t).reduce((o, p) => (o[p.type] = +p.value, o), {});
const parisOffset = (t) => { const p = parisParts(t); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - t; };
const parisMs = (y, m, d, h) => { const g = Date.UTC(y, m, d, h); return g - parisOffset(g); };
// Next occurrence of a weekly boss, as a UTC timestamp.
function nextBoss(r, from = Date.now()) {
  for (let i = 0; i < 9; i++) {                                   // today, then up to a full week ahead
    const p = parisParts(from + i * 864e5);
    const midnight = Date.UTC(p.year, p.month - 1, p.day);
    if (new Date(midnight).getUTCDay() !== r.day) continue;
    const t = parisMs(p.year, p.month - 1, p.day, r.hour(midnight));
    if (t > from) return t;
  }
}
console.assert(nextBoss(RECURRING[0], parisMs(2026, 6, 10, 12)) === parisMs(2026, 6, 11, 3), 'Kepris: this week is 12h early');
console.assert(nextBoss(RECURRING[0], parisMs(2026, 6, 11, 4)) === parisMs(2026, 6, 18, 15), 'Kepris: alternates back to 15h');
console.assert(nextBoss(RECURRING[1], parisMs(2026, 6, 10, 12)) === parisMs(2026, 6, 12, 15), 'Super Boss: Sunday 15h');

const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), days = Math.floor(s / 86400);
  const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  return days ? `${days}${lang === 'fr' ? 'j' : 'd'} ${hms}` : hms;
};
// Countdown pair above the calendar. Subtitle is the player's own local time,
// since only the Paris instant is fixed server-side.
function bossTimersHTML() {
  return `<div class="boss-timers" id="boss-timers">${RECURRING.map((r) => {
    const t = nextBoss(r);
    const when = new Date(t).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `<div class="boss-timer">
      <span class="boss-name">${esc(r.name)}</span>
      <span class="boss-cd" data-at="${t}">${esc(fmtCountdown(t - Date.now()))}</span>
      <span class="boss-when">${esc(when)}</span>
    </div>`;
  }).join('')}</div>`;
}
setInterval(() => {
  // Nothing here notifies, so there is no reason to sweep the document once a
  // second for a section the player has not opened (Événements renders lazily —
  // for most sessions this selector matched nothing, forever). A rollover that
  // happens while it's closed is picked up on the first tick after it reopens.
  if (current !== 'evenements') return;
  for (const el of document.querySelectorAll('#boss-timers .boss-cd')) {
    const left = +el.dataset.at - Date.now();
    if (left <= 0) { renderEvents(); return; }     // rolled over → recompute the next one
    el.textContent = fmtCountdown(left);
  }
}, 1000);
// Per-day user notes, keyed 'Y-M-D', persisted in localStorage (same store the
// rest of the overlay uses; no backend). ponytail: one flat object, not a DB.
let calNotes = readJson('roselite-cal-notes', {}, isRecord);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
let calCursor = (() => { const d = new Date(); d.setDate(1); return d; })();
// Everything happening on a date: recurring weeklies + any active seasonal event.
function eventsOn(date) {
  const out = RECURRING.filter((r) => r.day === date.getDay()).map((r) => ({ name: r.name, kind: 'rec' }));
  for (const ev of D.eventsIndex) if (eventActive(ev, date)) out.push({ name: ev.name, kind: 'season', ev });
  return out;
}
console.assert(eventsOn(new Date(2026, 6, 11)).some((e) => e.name === 'Kepris'), 'eventsOn: Kepris on a Saturday');
console.assert(!eventsOn(new Date(2026, 6, 8)).some((e) => e.kind === 'rec'), 'eventsOn: no weekly on a Wednesday');

// Month calendar (WoW-style grid). Month/weekday names come from Intl so we don't
// duplicate locale tables; the week is Monday-first (FR/EU audience).
function renderEvents() {
  const body = views.evenements.querySelector('.view-body');
  const year = calCursor.getFullYear(), month = calCursor.getMonth();
  const title = calCursor.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  const startPad = (new Date(year, month, 1).getDay() + 6) % 7;   // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const wd = Array.from({ length: 7 }, (_, i) =>   // 2024-01-01 was a Monday
    new Date(2024, 0, 1 + i).toLocaleDateString(lang, { weekday: 'narrow' }));
  let cells = '';
  for (let i = 0; i < startPad; i++) cells += `<div class="cal-cell cal-cell--pad"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const evs = eventsOn(date);
    const labels = evs.map((e) =>
      `<span class="cal-ev cal-ev--${e.kind}" title="${esc(e.name)}">${esc(e.name)}</span>`).join('');
    const note = calNotes[dayKey(date)] ? '<span class="cal-dot cal-dot--note"></span>' : '';
    const isToday = date.toDateString() === today.toDateString();
    cells += `<button class="cal-cell${isToday ? ' cal-cell--today' : ''}" data-day="${day}">
      <span class="cal-num">${day}${note}</span>${labels}</button>`;
  }
  body.innerHTML = `
    ${bossTimersHTML()}
    <div class="cal-head">
      <button class="cal-nav" data-nav="-1" aria-label="Prev">‹</button>
      <span class="cal-title">${esc(title)}</span>
      <button class="cal-nav" data-nav="1" aria-label="Next">›</button>
    </div>
    <div class="cal-grid cal-wd">${wd.map((w) => `<span class="cal-wd-cell">${esc(w)}</span>`).join('')}</div>
    <div class="cal-grid cal-days">${cells}</div>`;
  body.querySelectorAll('.cal-nav').forEach((b) => b.addEventListener('click', () => {
    calCursor = new Date(year, month + (+b.dataset.nav), 1); renderEvents();
  }));
  body.querySelectorAll('.cal-cell[data-day]').forEach((c) =>
    c.addEventListener('click', () => openDay(new Date(year, month, +c.dataset.day))));
}
// Day detail: what's on + a free-text note. Note saves live to localStorage and
// syncs the calendar cell's note dot (the grid stays in the DOM behind us).
function openDay(date) {
  const key = dayKey(date), d = T();
  const title = date.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
  drill(title, (el) => {
    const evs = eventsOn(date);
    const list = evs.length ? `<ul class="rows">${evs.map((e) => e.kind === 'season'
      ? `<li><button class="row erow erow--active" data-ev="${esc(e.ev.name)}"><span class="erow-top"><span class="row-name">${esc(e.name)}</span><span class="pill pill--live">${d.active}</span></span><span class="erow-date">${fmtRange(e.ev)}</span></button></li>`
      : `<li><div class="row erow"><span class="erow-top"><span class="row-name">${esc(e.name)}</span><span class="pill pill--rec">${d.weekly || 'Weekly'}</span></span></div></li>`).join('')}</ul>`
      : `<p class="section-note">${d.noEventDetail}</p>`;
    el.innerHTML = `${list}
      <div class="detail-label" style="margin-top:14px">${d.calNote || 'Note'}</div>
      <textarea class="inp cal-note" rows="4" placeholder="${esc(d.calNotePh || 'Write a note for this day…')}">${esc(calNotes[key] || '')}</textarea>`;
    const ta = el.querySelector('.cal-note');
    ta.addEventListener('input', () => {
      if (ta.value.trim()) calNotes[key] = ta.value; else delete calNotes[key];
      writeJson('roselite-cal-notes', calNotes);
      const cell = views.evenements.querySelector(`.cal-cell[data-day="${date.getDate()}"] .cal-dots`);
      let dot = cell && cell.querySelector('.cal-dot--note');
      if (cell && ta.value.trim() && !dot) cell.insertAdjacentHTML('beforeend', '<span class="cal-dot cal-dot--note"></span>');
      else if (dot && !ta.value.trim()) dot.remove();
    });
    el.querySelectorAll('[data-ev]').forEach((b) =>
      b.addEventListener('click', () => openEvent(D.eventsIndex.find((x) => x.name === b.dataset.ev))));
  });
}
function openEvent(ev) {
  drill(ev.name, (el) => {
    const body = ev.file
      ? `<div class="prose">${D.linkifyItems(D.loadFragment('events', ev.file))}</div>`
      : `<p class="section-note">${T().noEventDetail}</p>`;
    el.innerHTML = `<p class="meta-line">${fmtRange(ev)}${eventActive(ev) ? ` · <span style="color:var(--jade)">${T().active}</span>` : ''}</p>${body}`;
  });
}
// ── Title-screen map (rose.toml → [game].title_map_id) ─────────────────────
// The client reads this once at startup to pick the login/title-screen map, and
// rewrites rose.toml on exit — so the effective place to change it is the
// launcher (game closed). We only swap the one numeric value; no TOML parser for
// a 48KB file whose key is unique. ponytail: regex over the single line, insert
// under [game] only if a config somehow lacks it.
const titleMapPath = () => path.join(roseAppData(), 'config', 'rose.toml');
const TITLE_MAPS = [
  { id: 0, label: 'Random' },
  { id: 4, label: 'Treehouse' },        // evo
  { id: 7, label: 'Adventure Plains' }, // narose
  { id: 16, label: 'Castle' },          // irose
];
const getMapFromToml = (t) => { const m = t.match(/^title_map_id\s*=\s*(\d+)/m); return m ? +m[1] : null; };
const setMapInToml = (t, id) =>
  /^title_map_id\s*=\s*\d+/m.test(t)
    ? t.replace(/^(title_map_id\s*=\s*)\d+/m, `$1${id}`)
    : t.replace(/^\[game\][^\n]*\r?\n/m, (h) => `${h}title_map_id = ${id}\n`);
console.assert(getMapFromToml(setMapInToml('[game]\r\ntitle_map_id = 0\r\n', 16)) === 16, 'title_map: replace');
console.assert(getMapFromToml(setMapInToml('[game]\r\nfoo = 1\r\n', 7)) === 7, 'title_map: insert under [game]');
const getTitleMap = () => { try { return getMapFromToml(fs.readFileSync(titleMapPath(), 'utf8')); } catch { return null; } };
const setTitleMap = (id) => fs.writeFileSync(titleMapPath(), setMapInToml(fs.readFileSync(titleMapPath(), 'utf8'), id));

// skip_planet_cutscene: same [game] block, boolean. Same single-line regex approach.
const getBoolFromToml = (t) => { const m = t.match(/^skip_planet_cutscene\s*=\s*(true|false)/m); return m ? m[1] === 'true' : null; };
const setBoolInToml = (t, on) =>
  /^skip_planet_cutscene\s*=\s*(true|false)/m.test(t)
    ? t.replace(/^(skip_planet_cutscene\s*=\s*)(true|false)/m, `$1${on}`)
    : t.replace(/^\[game\][^\n]*\r?\n/m, (h) => `${h}skip_planet_cutscene = ${on}\n`);
console.assert(getBoolFromToml(setBoolInToml('[game]\r\nskip_planet_cutscene = false\r\n', true)) === true, 'cutscene: replace');
console.assert(getBoolFromToml(setBoolInToml('[game]\r\nfoo = 1\r\n', true)) === true, 'cutscene: insert under [game]');
const getCutscene = () => { try { return getBoolFromToml(fs.readFileSync(titleMapPath(), 'utf8')); } catch { return null; } };
const setCutscene = (on) => fs.writeFileSync(titleMapPath(), setBoolInToml(fs.readFileSync(titleMapPath(), 'utf8'), on));

// Folder pickers (game install + ROSE AppData). Native dialog runs in main
// ('pick-dir'); result persists to localStorage. Mounted in Settings and the
// launcher (a wrong gameDir blocks launch, so it must be fixable pre-game).
function renderPaths(container) {
  if (!container) return;
  const d = T();
  const rows = [
    { act: 'game', label: d.gameDirLbl || 'ROSE Online folder', cur: gameDir() },
    { act: 'appdata', label: d.roseDataLbl || 'ROSE AppData folder', cur: roseAppData() },
  ];
  container.innerHTML = rows.map((r) =>
    `<div class="detail-label">${r.label}</div>` +
    `<div class="path-row"><span class="path-cur" title="${esc(r.cur)}">${esc(r.cur || '—')}</span>` +
    `<button class="lang-btn path-btn" data-act="${r.act}">${d.change || 'Change…'}</button></div>`).join('');
  container.querySelectorAll('.path-btn').forEach((b) => b.addEventListener('click', async () => {
    const dir = await ipcRenderer.invoke('pick-dir');
    if (!dir) return;
    if (b.dataset.act === 'game') { localStorage.setItem('roselite-game-dir', dir); ipcRenderer.send('game-dir', dir); }
    else localStorage.setItem('roselite-rose-appdata', dir);
    renderPaths(container);
    // Repaint dependents that read these paths. The shared settings component is
    // mounted in either the launcher or overlay, never both.
    renderTitleMap(document.getElementById('set-titlemap'));
    renderExtensions();
  }));
}

// Reusable title-screen picker (mounted in Settings and in the launcher).
function renderTitleMap(container) {
  if (!container) return;
  const d = T(), cur = getTitleMap(), ok = cur !== null;
  container.innerHTML = `<div class="detail-label">${d.titleMap || 'Title screen'}</div>` +
    (ok ? `<div class="lang-toggle">${TITLE_MAPS.map((m) =>
        `<button class="lang-btn${cur === m.id ? ' active' : ''}" data-map="${m.id}">${esc(m.label)}</button>`).join('')}</div>`
        : `<p class="section-note">${d.titleMapNA || 'rose.toml not found.'}</p>`);
  container.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => {
    try { setTitleMap(+b.dataset.map); } catch { return; }
    container.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('active', x === b));
  }));
}

// ── Progress mirror (renderer localStorage → main → cloud) ────────────────
// The canonical portable copy lives in the main process and, once signed in,
// the cloud. This flat allowlist is the only thing that crosses that boundary.
// ROSE passwords, game paths and other machine-local state never enter it.
function progressPayload() {
  const meta = acctMeta();
  return {
    accounts: accounts().map((email) => ({ email, nick: meta[email]?.nick || '', icon: meta[email]?.icon || '', addedAt: meta[email]?.addedAt || 0 })),
    data: {
      itemsPinned: readJson('roselite-items-pinned', [], Array.isArray),
      // id -> removedAt: lets an un-pin/un-mark-done survive a merge with a
      // stale copy elsewhere that still lists the id (see mergeData).
      itemsUnpinned: readJson('roselite-items-unpinned', {}, isRecord),
      questsDone: readJson('roselite-quests-done', [], Array.isArray),
      questsUndone: readJson('roselite-quests-undone', {}, isRecord),
      gemTargets: readJson('roselite-gem-targets', [], Array.isArray),
      kings: readJson('roselite-kings', {}, isRecord),
      // email -> deletion timestamp; makes a delete win over another device's
      // stale copy on merge instead of being unioned back (see sync-server merge).
      accountsDeleted: readJson('roselite-accounts-deleted', {}, isRecord),
      dungeonRuns: readJson('roselite-dungeon-runs', [], Array.isArray),
      dungeonMe: localStorage.getItem('roselite-dungeon-me') || '',
      loot: readJson('roselite.loot', {}, isRecord),
      dps: readJson('roselite.dps', {}, isRecord),
      calendarNotes: readJson('roselite-cal-notes', {}, isRecord),
      shouts: readJson('roselite-shouts', [], Array.isArray),
    }
  };
}

// Applies a server-merged envelope back into localStorage. Returns whether
// anything actually changed, so the caller only reloads when it must.
function restoreProgressEnvelope(envelope) {
  const data = envelope.data || {};
  let changed = false;
  const setJsonIfChanged = (key, value) => {
    const next = JSON.stringify(value);
    if (localStorage.getItem(key) === next) return;
    changed = true; writeJson(key, value);
  };
  const setStringIfChanged = (key, value) => {
    if (localStorage.getItem(key) === String(value)) return;
    changed = true; localStorage.setItem(key, String(value));
  };
  setJsonIfChanged('roselite-items-pinned', data.itemsPinned || []);
  // Tombstones arrive already server-merged — same pure-overwrite treatment as
  // achievements below, not a second local merge pass.
  setJsonIfChanged('roselite-items-unpinned', data.itemsUnpinned || {});
  setJsonIfChanged('roselite-quests-done', data.questsDone || []);
  setJsonIfChanged('roselite-quests-undone', data.questsUndone || {});
  setJsonIfChanged('roselite-gem-targets', data.gemTargets || []);
  setJsonIfChanged('roselite-kings', data.kings || {});
  setJsonIfChanged('roselite-dungeon-runs', data.dungeonRuns || []);
  if (typeof data.dungeonMe === 'string') setStringIfChanged('roselite-dungeon-me', data.dungeonMe);
  setJsonIfChanged('roselite.loot', data.loot || {});
  setJsonIfChanged('roselite.dps', data.dps || {});
  setJsonIfChanged('roselite-cal-notes', data.calendarNotes || {});
  setJsonIfChanged('roselite-shouts', data.shouts || []);
  // Merge delete tombstones first (email -> ts, latest wins) so the present
  // filter below can drop accounts that were deleted on another device.
  const incomingDeleted = isRecord(data.accountsDeleted) ? data.accountsDeleted : {};
  const tomb = readJson('roselite-accounts-deleted', {}, isRecord);
  for (const [rawEmail, ts] of Object.entries(incomingDeleted)) {
    const email = String(rawEmail).trim().toLowerCase();
    const n = Number(ts);
    if (email && Number.isFinite(n) && (!(email in tomb) || n > Number(tomb[email]))) tomb[email] = n;
  }
  setJsonIfChanged('roselite-accounts-deleted', tomb);

  const metadata = acctMeta();
  const emails = accounts();
  const knownBefore = new Set(emails);
  const incomingAccounts = Array.isArray(envelope.accounts) ? envelope.accounts : [];
  for (const account of incomingAccounts) {
    const email = typeof account?.email === 'string' ? account.email.trim().toLowerCase() : '';
    if (!email) continue;
    const isNewAccount = !knownBefore.has(email);
    if (isNewAccount) emails.push(email);
    const addedAt = Number(account.addedAt) || metadata[email]?.addedAt || 0;
    // A synced account arriving on a new device has no local password yet.
    const nextMeta = {
      nick: typeof account.nick === 'string' ? account.nick : '',
      icon: typeof account.icon === 'string' ? account.icon : '',
      ...(isNewAccount || metadata[email]?.needsPassword ? { needsPassword: true } : {}),
      ...(addedAt ? { addedAt } : {}),
    };
    if (!nextMeta.nick && !nextMeta.icon && !nextMeta.needsPassword && !nextMeta.addedAt) {
      if (metadata[email]) { delete metadata[email]; changed = true; }
    } else if (JSON.stringify(metadata[email] || null) !== JSON.stringify(nextMeta)) {
      metadata[email] = nextMeta; changed = true;
    }
  }
  // Drop accounts whose tombstone is at least as new as their addedAt — i.e.
  // deleted on another device. A later re-add (addedAt > tombstone) survives.
  const present = emails.filter((email) => {
    const deletedAt = tomb[email];
    return !Number.isFinite(Number(deletedAt)) || (metadata[email]?.addedAt || 0) > Number(deletedAt);
  });
  for (const email of emails) if (!present.includes(email)) delete metadata[email];
  setJsonIfChanged('roselite-accounts', present);
  setJsonIfChanged('roselite-account-meta', metadata);
  // The selected account may have just been removed by a remote delete.
  if (activeAccount && !present.includes(activeAccount)) {
    activeAccount = present[0] || '';
    if (activeAccount) localStorage.setItem('roselite-account', activeAccount);
    else localStorage.removeItem('roselite-account');
    changed = true;
  }
  return { changed };
}

const PROGRESS_RESUME_SECTION = 'roselite-progress-resume-section';
function reloadAfterProgressRestore() {
  if (current !== 'home' && SECTION_IDS.includes(current)) sessionStorage.setItem(PROGRESS_RESUME_SECTION, current);
  else sessionStorage.removeItem(PROGRESS_RESUME_SECTION);
  setTimeout(() => location.reload(), 250);
}

// ── Local backup (export / import) ──────────────────────────────────────────
// RoseLite is local-only: progress lives in this machine's localStorage and the
// main process's copy, and nothing leaves the machine. A reinstall would
// otherwise lose everything, so the one thing the account used to buy — carrying
// progress to another PC — is a file you write and read yourself.
// ponytail: a Blob download and a file input, not a save dialog over IPC.
const BACKUP_FORMAT = 'roselite-backup';
const backupName = () => `roselite-backup-${new Date().toISOString().slice(0, 10)}.json`;
function exportProgress() {
  const file = { format: BACKUP_FORMAT, appVersion: require('../package.json').version, exportedAt: Date.now(), ...progressPayload() };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = backupName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// Restores through the same merge the progress store uses, so an import UNIONS
// with what is already here (pins, kills, quests) rather than replacing it —
// the same rule two devices used to meet under.
async function importProgress(file, status) {
  try {
    const envelope = JSON.parse(await file.text());
    if (!isRecord(envelope) || envelope.format !== BACKUP_FORMAT || !isRecord(envelope.data)) throw new Error('not a RoseLite backup');
    const { changed } = restoreProgressEnvelope(envelope);
    await ipcRenderer.invoke('progress-sync-local', progressPayload());
    if (changed) reloadAfterProgressRestore();
    else status.textContent = lang === 'fr' ? 'Rien de nouveau dans ce fichier.' : 'Nothing new in that file.';
  } catch (err) {
    status.textContent = (lang === 'fr' ? 'Import impossible : ' : "Couldn't import: ") + (err.message || err);
  }
}
function renderBackup(container) {
  const fr = lang === 'fr';
  container.innerHTML = `<div class="backup-box">
    <p class="section-note">${fr ? 'Votre progression reste sur ce PC. Exportez-la pour la sauvegarder ou la transférer sur une autre machine.' : 'Your progress stays on this PC. Export it to back it up or carry it to another machine.'}</p>
    <div class="backup-actions"><button class="lang-btn" data-backup-export>${fr ? 'Exporter' : 'Export'}</button><button class="lang-btn" data-backup-import>${fr ? 'Importer' : 'Import'}</button></div>
    <p class="section-note" data-backup-status role="status" aria-live="polite"></p>
    <input type="file" accept="application/json,.json" hidden data-backup-file></div>`;
  const file = container.querySelector('[data-backup-file]');
  const status = container.querySelector('[data-backup-status]');
  container.querySelector('[data-backup-export]').addEventListener('click', exportProgress);
  container.querySelector('[data-backup-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => { if (file.files[0]) importProgress(file.files[0], status); file.value = ''; });
}


function renderSettingsInto(container, { launcher = false } = {}) {
  if (!container) return;
  // The launcher and overlay shells coexist in the DOM. Keep only one settings
  // component mounted so shared control IDs remain unique across mode changes.
  const other = container === views.parametres ? document.getElementById('lch-settings-content') : views.parametres;
  if (other) other.innerHTML = '';
  const d = T(), fr = lang === 'fr';
  const launchD = { ...STR.en.launcher, ...d.launcher };
  const s = fr ? {
    intro: 'Personnalisez RoseLite sans interrompre votre partie. Les changements sont appliqués immédiatement.',
    general: 'Général', generalNote: 'Choisissez la langue utilisée dans l’interface.',
    appearance: 'Apparence', appearanceNote: 'Adaptez le style du compagnon à votre jeu.',
    layout: 'Fenêtre et lisibilité', layoutNote: 'Ajustez l’espace occupé à côté du client ROSE.',
    game: 'ROSE Online', gameNote: 'Options et dossiers liés à cette installation du jeu.',
    alerts: 'Alertes', alertsNote: 'Contrôlez les sons utilisés pour les événements importants.',
    data: 'Progression et sauvegarde', dataNote: 'Gardez une copie portable de vos comptes et de leur progression.',
    panelHelp: 'Largeur du panneau lorsqu’il est attaché au jeu.', scaleHelp: 'Agrandit toute l’interface, texte et commandes compris.',
    useTheme: 'Selon thème', soundHelp: 'Jouer un son pour les alertes et les timers.', soundFolderHelp: 'Ajoutez vos propres fichiers audio dans ce dossier.',
    hideEmailsHelp: 'Masquer les adresses e-mail dans le sélecteur de compte.', repairHelp: launcher ? 'Vérifie et retélécharge les fichiers du jeu endommagés.' : 'Disponible lorsque le jeu est fermé.',
    narrow: 'Étroit', wide: 'Large', small: 'Petit', large: 'Grand',
  } : {
    intro: 'Make RoseLite yours without interrupting play. Changes apply immediately.',
    general: 'General', generalNote: 'Choose the language used throughout the interface.',
    appearance: 'Appearance', appearanceNote: 'Match the companion’s look to your game.',
    layout: 'Window & readability', layoutNote: 'Control how much space RoseLite uses beside the game.',
    game: 'ROSE Online', gameNote: 'Options and folders tied to this game installation.',
    alerts: 'Alerts', alertsNote: 'Control sounds used for important events.',
    data: 'Progress & backup', dataNote: 'Keep a portable copy of your accounts and progress.',
    panelHelp: 'Width of the panel while it is docked beside the game.', scaleHelp: 'Scales the whole interface, including text and controls.',
    useTheme: 'Use theme', soundHelp: 'Play a sound for alerts and timers.', soundFolderHelp: 'Add your own audio files to this folder.',
    hideEmailsHelp: 'Hide email addresses in the account switcher.', repairHelp: launcher ? 'Checks and redownloads damaged game files.' : 'Available when the game is closed.',
    narrow: 'Narrow', wide: 'Wide', small: 'Small', large: 'Large',
  };
  const groupHead = (title, note) => `<summary class="settings-group-head"><span class="settings-group-heading"><span class="settings-group-title">${title}</span><span class="settings-group-note">${note}</span></span></summary>`;
  container.innerHTML =
    `<div class="settings-page">
      <p class="settings-intro">${s.intro}</p>
      <div class="settings-groups">
        <details class="settings-group" open>
          ${groupHead(s.general, s.generalNote)}
          <div class="settings-group-body"><div class="settings-field">
            <div class="detail-label" id="set-language-label">${d.language}</div>
            <div class="lang-toggle" role="group" aria-labelledby="set-language-label">${Object.entries(LANGS).map(([code, label]) =>
              `<button class="lang-btn${lang === code ? ' active' : ''}" data-l="${code}" aria-pressed="${lang === code}">${label}</button>`).join('')}</div>
          </div>
          <ul class="rows settings-toggle-list"><li class="mod-row"><label class="settings-toggle-copy" for="set-hide-emails"><span class="row-name">${launchD.hideEmails}</span><span class="settings-toggle-note">${s.hideEmailsHelp}</span></label><input type="checkbox" class="switch" id="set-hide-emails"${hideEmails() ? ' checked' : ''}></li></ul></div>
        </details>
        <details class="settings-group">
          ${groupHead(s.appearance, s.appearanceNote)}
          <div class="settings-group-body">
          <div class="settings-color-grid">
            <div class="set-color-field"><div class="detail-label" id="set-accent-label">${d.accent || STR.en.accent}</div><div class="set-color-row">
              <input type="color" class="set-color" data-slot="accent" value="${customColor('accent') || cssVar('--ember')}" aria-labelledby="set-accent-label">
              <button class="lang-btn" data-reset="accent">${s.useTheme}</button>
            </div></div>
            <div class="set-color-field"><div class="detail-label" id="set-bg-label">${d.bgColor || STR.en.bgColor}</div><div class="set-color-row">
              <input type="color" class="set-color" data-slot="bg" value="${customColor('bg') || cssVar('--rosewood')}" aria-labelledby="set-bg-label">
              <button class="lang-btn" data-reset="bg">${s.useTheme}</button>
            </div></div>
          </div>
          <div class="settings-field" style="margin-top:14px">
            <div class="detail-label" id="set-font-label">${d.font || STR.en.font}</div>
            <div class="lang-toggle" role="group" aria-labelledby="set-font-label">
              <button class="lang-btn${!font ? ' active' : ''}" data-font="" aria-pressed="${!font}">${s.useTheme}</button>${FONTS.map((f) =>
                `<button class="lang-btn${font === f.id ? ' active' : ''}" data-font="${f.id}" aria-pressed="${font === f.id}" style="font-family:${f.body}">${f.name}</button>`).join('')}
            </div>
          </div></div>
        </details>
        <details class="settings-group">
          ${groupHead(s.layout, s.layoutNote)}
          <div class="settings-group-body"><div class="settings-field">
            <label class="detail-label" for="set-width">${d.panelWidth}</label><p class="settings-control-note">${s.panelHelp}</p>
            <div class="set-slider-row"><input type="range" class="set-slider" id="set-width" min="200" max="440" value="${panelWidth}"><output class="set-val" id="width-val" for="set-width">${panelWidth} px</output></div>
            <div class="set-range-ends" aria-hidden="true"><span>${s.narrow}</span><span>${s.wide}</span></div>
          </div>
          <div class="settings-field">
            <label class="detail-label" for="set-scale">${d.uiScale || STR.en.uiScale}</label><p class="settings-control-note">${s.scaleHelp}</p>
            <div class="set-slider-row"><input type="range" class="set-slider" id="set-scale" min="80" max="130" step="5" value="${uiScale}"><output class="set-val" id="scale-val" for="set-scale">${uiScale} %</output></div>
            <div class="set-range-ends" aria-hidden="true"><span>${s.small}</span><span>${s.large}</span></div>
          </div></div>
        </details>
        <details class="settings-group">
          ${groupHead(s.game, s.gameNote)}
          <div class="settings-group-body"><div class="settings-field" id="set-titlemap"></div>
          ${getCutscene() !== null ? `<ul class="rows settings-toggle-list"><li class="mod-row"><label class="settings-toggle-copy" for="set-cutscene"><span class="row-name">${d.skipCutscene || STR.en.skipCutscene}</span></label><input type="checkbox" class="switch" id="set-cutscene"${getCutscene() ? ' checked' : ''}></li></ul>` : ''}
          <div class="settings-field" id="set-paths" style="margin-top:14px"></div>
          <div class="settings-field"><p class="settings-control-note">${s.repairHelp}</p><button class="lang-btn" id="set-repair"${launcher ? '' : ' disabled'}>${launchD.updRepair}</button></div></div>
        </details>
        <details class="settings-group">
          ${groupHead(s.alerts, s.alertsNote)}
          <div class="settings-group-body"><ul class="rows settings-toggle-list"><li class="mod-row"><label class="settings-toggle-copy" for="set-sound"><span class="row-name">${d.soundLbl || STR.en.soundLbl}</span><span class="settings-toggle-note">${s.soundHelp}</span></label><input type="checkbox" class="switch" id="set-sound"${soundOn ? ' checked' : ''}></li></ul>
          <div class="settings-field" style="margin-top:14px"><div class="detail-label">${d.soundFolder || STR.en.soundFolder}</div><p class="settings-control-note">${s.soundFolderHelp}</p>
            <div class="path-row"><span class="path-cur" title="${esc(SOUND_DIR)}">${esc(SOUND_DIR)}</span><button class="lang-btn path-btn" id="set-sound-dir">${d.openLbl || STR.en.openLbl}</button></div>
          </div></div>
        </details>
        <details class="settings-group">
          ${groupHead(s.data, s.dataNote)}
          <div class="settings-group-body"><div id="set-backup"></div></div>
        </details>
      </div>
      <p class="settings-version">RoseLite v${require('../package.json').version}</p>
    </div>`;
  renderTitleMap(container.querySelector('#set-titlemap'));
  renderPaths(container.querySelector('#set-paths'));
  renderBackup(container.querySelector('#set-backup'));
  container.querySelectorAll('.lang-btn[data-l]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.l)));
  container.querySelector('#set-hide-emails').addEventListener('change', (e) => {
    localStorage.setItem('roselite-hide-emails', e.target.checked ? '1' : '0');
    if (launcher) {
      const openIndex = [...container.querySelectorAll('.settings-group')].findIndex((group) => group.open);
      renderLauncher();
      const groups = document.querySelectorAll('#lch-settings-content .settings-group');
      if (openIndex >= 0 && groups[openIndex]) groups[openIndex].open = true;
    }
  });
  // Panel width — live: persist + tell main to re-dock next track() tick.
  const wS = container.querySelector('#set-width'), wV = container.querySelector('#width-val');
  wS.addEventListener('input', () => {
    panelWidth = +wS.value; wV.textContent = `${panelWidth} px`;
    localStorage.setItem('roselite-panel-width', panelWidth);
    ipcRenderer.send('panel-width', panelWidth);
  });
  container.querySelector('#set-sound').addEventListener('change', (e) => {
    soundOn = e.target.checked; localStorage.setItem('roselite-sound', soundOn ? '1' : '0');
  });
  container.querySelector('#set-sound-dir').addEventListener('click', () => {
    try { fs.mkdirSync(SOUND_DIR, { recursive: true }); } catch {}   // gone/never shipped → recreate so the folder always opens
    shell.openPath(SOUND_DIR);
  });
  // Game rewrites rose.toml on exit, so this only sticks while the game is closed (like title map).
  container.querySelector('#set-cutscene')?.addEventListener('change', (e) => {
    try { setCutscene(e.target.checked); } catch {}
  });
  container.querySelector('#set-repair').addEventListener('click', () => {
    if (!launcher) return;
    document.getElementById('lch-settings').classList.remove('open');
    ipcRenderer.send('update-run', true);
  });
  // Custom colors — live while dragging inside the native picker; Auto = back to skin.
  container.querySelectorAll('.set-color[data-slot]').forEach((inp) =>
    inp.addEventListener('input', () => applyColor(inp.dataset.slot, inp.value)));
  container.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => {
    applyColor(b.dataset.reset, '');
    container.querySelector(`.set-color[data-slot="${b.dataset.reset}"]`).value = cssVar(COLOR_SLOTS[b.dataset.reset].probe);
  }));
  // Font — live: inline --font-body/--font-display beat the skin's pairing.
  container.querySelectorAll('.lang-btn[data-font]').forEach((b) => b.addEventListener('click', () => {
    applyFont(b.dataset.font);
    container.querySelectorAll('[data-font]').forEach((x) => {
      const active = x === b;
      x.classList.toggle('active', active);
      x.setAttribute('aria-pressed', String(active));
    });
  }));
  // UI scale — live zoom.
  const zS = container.querySelector('#set-scale'), zV = container.querySelector('#scale-val');
  zS.addEventListener('input', () => { applyScale(+zS.value); zV.textContent = `${uiScale} %`; });
}
function renderSettings() { renderSettingsInto(views.parametres); }

// ── Monster Tracker: toggle a curated boss list → api.notify on spawn ───────
// npcId = list_npc.json row (the id a 'spawn' frame carries).
// Verified 2026-07-05 against the regenerated table. ponytail: 7 fixed entries;
// edit this list to change the roster — no UI to add arbitrary mobs yet.
const MONSTER_WATCH = [
  { name: 'Junon Chest', npcId: 4401 },
  { name: 'Luna Chest', npcId: 4402 },
  { name: 'Eldeon Chest', npcId: 4403 },
  { name: 'Orlo Chest', npcId: 4404 },
  { name: 'Orlo Dragon', npcId: 3124 },
  { name: 'Lunar Dragon', npcId: 3122 },
  { name: 'Eldeon Dragon', npcId: 3123 },
];
const monsterNames = new Map(MONSTER_WATCH.map((m) => [m.npcId, m.name]));
// Persisted set of watched npcIds (default: all on).
let monsterWatch = new Set(readJson('roselite-monster-watch', MONSTER_WATCH.map((m) => m.npcId), (v) => Array.isArray(v) && v.every(Number.isFinite)));
const saveMonsterWatch = () => writeJson('roselite-monster-watch', [...monsterWatch]);
let monsterSound = localStorage.getItem('roselite-monster-sound') || 'chime';   // pickable spawn-alert sound

// Browse every mob that drops something (RoseData/drops.json → D.mobs()) and
// tap one for its loot; drop rows are plain item rows, so they route to the item
// page like everywhere else. Offline — the spawn-alert switches above are the
// only part that needs live data, so they fold in only when LIVE.
function openMob(m) {
  if (!m) return;
  const d = T();
  const from = current !== 'monstres' ? currentReturn() : stashReturn();   // capture origin (e.g. an item page) before we leave it
  if (current !== 'monstres') openSection('monstres');           // resets navBack/detailReopen
  navBack = from;                                                // set after openSection so Back returns to origin
  drill(m.name, (el) => {
    el.innerHTML =
      `<div class="badges">${m.level != null ? `<span class="tag">${d.fLevel} ${m.level}</span>` : ''}` +
      `${m.rank ? `<span class="tag">${esc(m.rank)}</span>` : ''}</div>` +
      `<div class="detail-label">${d.mobDrops || STR.en.mobDrops}</div>` +
      (m.items.length
        ? `<ul class="rows">${m.items.map((it) => itemRow(it)).join('')}</ul>`
        : `<p class="section-note">${d.mobNoDrops || STR.en.mobNoDrops}</p>`);
  });
}
// A clickable mob row (name + level + drop count); routes through openMob via
// data-mob-id, the same delegate item and quest rows use.
const mobRow = (m) =>
  `<li><button class="row" data-mob-id="${m.id}"><span class="row-name">${esc(m.name)}</span>` +
  `<span class="row-meta">${m.level != null ? `Lv ${m.level} · ` : ''}${m.items.length}${CHEV}</span></button></li>`;

function renderMonsters() {
  const d = T(), body = views.monstres.querySelector('.view-body');
  const mobs = D.mobs();
  if (!mobs.length) return liveOff(body);   // drops.json not synced → nothing to browse
  searchListInto(body, mobs, mobRow, {
    collapsible: true,
    filters: [
      { type: 'range', label: d.fLevel, get: (m) => m.level },
      { type: 'chips', label: d.fRank || STR.en.fRank, fold: true, get: (m) => m.rank },
    ],
  });
}

// Tracker — the live half of mobs: pick which ones toast when they spawn near
// you. Fed by the live data source, so it shows the disabled notice in the
// shipped build; Monstres beside it browses drop tables and needs none of that.
function renderTracker() {
  const d = T(), body = views.tracker.querySelector('.view-body');
  if (!LIVE) return liveOff(body);
  body.innerHTML = `<p class="section-note" style="margin:2px 0 10px">${d.monsterHelp}</p>` +
    `<div class="detail-label" style="margin-top:0">${d.soundLbl || STR.en.soundLbl}</div>` +
    `<div data-role="msound" style="margin-bottom:12px"></div>` +
    `<ul class="rows">${MONSTER_WATCH.map((m) =>
      `<li class="mod-row"><span class="row-name" style="flex:1;padding-left:2px">${esc(m.name)}</span>` +
      `<input type="checkbox" class="switch" data-npc="${m.npcId}"${monsterWatch.has(m.npcId) ? ' checked' : ''}></li>`).join('')}</ul>`;
  body.querySelector('[data-role="msound"]').appendChild(
    soundSelect(monsterSound, (v) => { monsterSound = v; localStorage.setItem('roselite-monster-sound', v); }));
  body.querySelectorAll('.switch').forEach((cb) => cb.addEventListener('change', () => {
    const id = +cb.dataset.npc;
    if (cb.checked) monsterWatch.add(id); else monsterWatch.delete(id);
    saveMonsterWatch();
  }));
}

// A data source emits {type:'spawn',entityId,npcId} for every monster; alert only
// on watched ones, debounced per npcId so one appearance = one toast (a boss
// re-sends spawns as it/you move in and out of view).
const lastMonsterAlert = new Map();
function onMonsterSpawn(f) {
  const id = f.npcId | 0;
  if (!monsterWatch.has(id)) return;
  const now = Date.now();
  if (now - (lastMonsterAlert.get(id) || 0) < 30000) return;   // 30s cooldown per mob
  lastMonsterAlert.set(id, now);
  api.notify({ title: monsterNames.get(id) || D.npcName(id) || `#${id}`, body: T().monsterSpawn, tone: 'gold', sound: monsterSound });
}

// ── Kings (rois) — offline Respawn Board ───────────────────────────────────
// Compact king-respawn tracker. Each king has a fixed respawn interval (secs,
// baked from the Respawn Board export in kings.json). Tap a row when you kill
// it → it counts down to respawn, pings when up. State is one per-account
// localStorage map { id: killedAtMs }; everything else is derived. No network.
const KINGS = require('./kings.json');
let kingKills = Object.fromEntries(Object.entries(readJson('roselite-kings', {}, isRecord))
  .filter(([, at]) => Number.isFinite(Number(at))));
const saveKingKills = () => { writeJson('roselite-kings', kingKills); };
// Don't replay a storm of stale alerts after a long-closed session. Existing due
// kings remain visibly UP; only timers that cross zero while this session runs alert.
const kingNotified = new Set(KINGS.filter((k) => {
  const killed = Number(kingKills[k.id]);
  return Number.isFinite(killed) && killed + k.secs * 1000 <= Date.now();
}).map((k) => k.id));
let kingFilter = '';

// due/format/order live in logic.js so kings.test.js checks the real code.
// due(king) = when it respawns, or null if never killed. state: idle|running|up.
const kingDue = (k) => L.kingDue(kingKills, k);
const { kFmt, kWhen } = L;

function kingRowLabel(k, state, time) {
  const d = T();
  const status = state === 'up' ? 'UP' : state === 'running' ? `${d.kingRunning || STR.en.kingRunning}, ${time}` : d.kingArm || STR.en.kingArm;
  const action = state === 'idle' ? d.kingAction || STR.en.kingAction : d.kingRestart || STR.en.kingRestart;
  return `${k.name}, ${k.map}. ${status}. ${action}`;
}
function kingRow(k) {
  const d = T(), due = kingDue(k), now = Date.now();
  const up = due !== null && due <= now;
  const state = due === null ? 'idle' : (up ? 'up' : 'running');
  const pill = state === 'up' ? 'pill--ready' : state === 'running' ? 'pill--armed' : 'pill--idle';
  const label = state === 'up' ? 'UP' : state === 'running' ? d.kingRunning || STR.en.kingRunning : d.kingArm || STR.en.kingArm;
  const time = due === null ? kFmt(k.secs) : (up ? 'UP' : kFmt(Math.ceil((due - now) / 1000)));
  const when = state === 'running' ? kWhen(due) : '';
  return `<li class="king-row king-row--${state}" data-id="${k.id}">
    <button class="king-arm" type="button" data-role="arm" aria-label="${esc(kingRowLabel(k, state, time))}">
      <span class="king-main"><span class="king-name">${esc(k.name)}</span><span class="king-loc">${esc(k.map)} · ${esc(k.planet)}</span></span>
      <span class="king-when"><span class="king-time" data-role="time" role="timer" aria-live="off">${time}</span><span class="king-due" data-role="due">${when}</span></span>
      <span class="pill ${pill}" data-role="status">${esc(label)}</span>
    </button>
    <button class="king-clear" type="button" data-role="clear" title="${esc(d.kingReset || STR.en.kingReset)}" aria-label="${esc(`${d.kingReset || STR.en.kingReset}: ${k.name}`)}"${due === null ? ' hidden' : ''}>×</button>
  </li>`;
}

let kingView = 'zone';             // 'zone' (planet→map, collapsable) | 'next' (flat, soonest spawn)
const kingCollapsed = new Set();   // group keys the user closed (in-memory: planet, or "planet/map")
const PLANET_ORDER = ['Junon', 'Luna', 'Eldeon', 'Orlo'];

// kingFilter holds what the user typed, raw — folding happens here, so the
// search box never echoes a lowercased/deaccented version of their own text.
const kingsFiltered = () => {
  const q = fold(kingFilter.trim());
  if (!q) return KINGS;
  return KINGS.filter((k) => fold(k.name).includes(q) || fold(k.map).includes(q) || fold(k.planet).includes(q));
};

// "Next spawn" order (L.kingCompare): up first, then running by soonest, then
// idle alpha. Sorts on render only (kill/clear/open) — the 1s tick just updates
// text, never reorders.

// "By zone" view: <details> per planet, each holding <details> per map. Native
// collapse; open/closed persisted in kingCollapsed. Badge shows up-count (gold)
// else total — it goes stale between full renders (ponytail: the tick doesn't
// touch it; a kill/clear/reopen refreshes it, which is enough here).
function kingZoneHtml(list) {
  const now = Date.now();
  const upN = (arr) => arr.filter((k) => { const d = kingDue(k); return d !== null && d <= now; }).length;
  const badge = (arr) => { const u = upN(arr); return u ? `<span class="king-grp-up">${u} up</span>` : `<span class="king-grp-n">${arr.length}</span>`; };
  const byPlanet = new Map();
  for (const k of list) {
    if (!byPlanet.has(k.planet)) byPlanet.set(k.planet, new Map());
    const maps = byPlanet.get(k.planet);
    if (!maps.has(k.map)) maps.set(k.map, []);
    maps.get(k.map).push(k);
  }
  const ord = (p) => { const i = PLANET_ORDER.indexOf(p); return i < 0 ? 99 : i; };
  const planets = [...byPlanet.keys()].sort((a, b) => ord(a) - ord(b) || a.localeCompare(b));
  return planets.map((planet) => {
    const maps = byPlanet.get(planet);
    const all = [...maps.values()].flat();
    const open = kingCollapsed.has(planet) ? '' : ' open';
    const mapsHtml = [...maps.keys()].sort((a, b) => a.localeCompare(b)).map((map) => {
      const arr = maps.get(map).slice().sort((a, b) => a.name.localeCompare(b.name));
      const mKey = planet + '/' + map;
      const mOpen = kingCollapsed.has(mKey) ? '' : ' open';
      return `<details class="king-group king-group--map" data-key="${esc(mKey)}"${mOpen}>
        <summary class="king-grp-sum"><span class="king-grp-name">${esc(map)}</span>${badge(arr)}</summary>
        <ul class="rows king-rows">${arr.map(kingRow).join('')}</ul>
      </details>`;
    }).join('');
    return `<details class="king-group king-group--planet" data-key="${esc(planet)}"${open}>
      <summary class="king-grp-sum"><span class="king-grp-name">${esc(planet)}</span>${badge(all)}</summary>
      ${mapsHtml}
    </details>`;
  }).join('');
}

// The rows only. Typing re-renders this, never the shell — rebuilding the
// search input mid-keystroke is what used to drop focus after every character.
function renderKingRows(focusId = '') {
  const host = document.getElementById('king-rows');
  if (!host) return;
  const list = kingsFiltered();
  host.innerHTML = kingView === 'next'
    ? `<ul class="rows king-rows">${list.slice().sort(L.kingCompare(kingKills, Date.now())).map(kingRow).join('')}</ul>`
    : kingZoneHtml(list);
  host.querySelectorAll('.king-group').forEach((det) =>
    det.addEventListener('toggle', () => { det.open ? kingCollapsed.delete(det.dataset.key) : kingCollapsed.add(det.dataset.key); }));
  host.querySelectorAll('.king-row').forEach((row) => {
    const k = KINGS.find((x) => String(x.id) === row.dataset.id);
    row.querySelector('[data-role="arm"]').addEventListener('click', () => {
      kingKills[row.dataset.id] = Date.now(); kingNotified.delete(row.dataset.id); saveKingKills();
      announce(`${k.name}. ${T().kingArmed || STR.en.kingArmed}: ${kFmt(k.secs)}`);
      renderKingRows(row.dataset.id);
    });
    row.querySelector('[data-role="clear"]').addEventListener('click', () => {
      delete kingKills[row.dataset.id]; kingNotified.delete(row.dataset.id); saveKingKills();
      announce(`${k.name}. ${T().kingCleared || STR.en.kingCleared}`);
      renderKingRows(row.dataset.id);
    });
  });
  if (focusId) host.querySelector(`.king-row[data-id="${CSS.escape(focusId)}"] .king-arm`)?.focus();
}

function renderKings(focusId = '') {
  const d = T(), host = document.getElementById('widgets');
  host.innerHTML = `<p class="section-note" style="margin:2px 0 8px">${d.kingsNote}</p>` +
    `<div class="chips king-views">` +
      `<button class="chip${kingView === 'zone' ? ' chip--on' : ''}" data-view="zone">${esc(d.kingsZone || STR.en.kingsZone)}</button>` +
      `<button class="chip${kingView === 'next' ? ' chip--on' : ''}" data-view="next">${esc(d.kingsNext || STR.en.kingsNext)}</button>` +
    `</div>` +
    `<input type="search" class="king-search" placeholder="${esc(d.kingsSearch || STR.en.kingsSearch)}" value="${esc(kingFilter)}">` +
    `<div id="king-rows"></div>`;
  host.querySelectorAll('.king-views .chip').forEach((btn) =>
    btn.addEventListener('click', () => { kingView = btn.dataset.view; renderKings(); }));   // full re-render: the chips' own on-state moves
  host.querySelector('.king-search').addEventListener('input', (e) => { kingFilter = e.target.value; renderKingRows(); });
  renderKingRows(focusId);
}

// One clock for every king: fires "up" toasts even when the section is closed,
// and (when open) updates each running row's time/pill without reordering.
setInterval(() => {
  const now = Date.now(), open = current === 'rois';
  for (const k of KINGS) {
    const due = kingDue(k);
    if (due === null) continue;
    if (due <= now && !kingNotified.has(k.id)) {
      kingNotified.add(k.id);
      showToast({ title: k.name, body: `${k.map} — ${T().kingUp || STR.en.kingUp}`, tone: 'gold', sound: true });
      if (open) { const r = document.querySelector(`.king-row[data-id="${k.id}"]`); if (r) { r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 650); } }
    }
    if (open) {
      const r = document.querySelector(`.king-row[data-id="${k.id}"]`);
      if (!r) continue;
      const up = due <= now;
      const time = up ? 'UP' : kFmt(Math.ceil((due - now) / 1000));
      r.querySelector('[data-role="time"]').textContent = time;
      r.querySelector('[data-role="due"]').textContent = up ? '' : kWhen(due);
      r.querySelector('[data-role="arm"]').setAttribute('aria-label', kingRowLabel(k, up ? 'up' : 'running', time));
      if (up) { r.className = 'king-row king-row--up'; r.querySelector('[data-role="status"]').className = 'pill pill--ready'; r.querySelector('[data-role="status"]').textContent = 'UP'; }
    }
  }
}, 1000);

// ── Dungeon Logs (journaux) — Warcraft-Logs-style run tracker ──────────────
// The game will eventually push an end-of-run scorecard; until then players paste
// it. One card per dungeon type (best time · your DPS), each drilling to every
// logged run with its full party leaderboard, your row highlighted. DPS is a
// single point: damage inflicted / run seconds. Runs persist per account.
// ponytail: DUNGEONS is a plain list the owner extends. Logo is the section glyph
// for now — swap dlLogo to an <img src="assets/dungeons/<key>.png"> when art lands.
const DUNGEONS = [
  { key: 'oblivion-140', name: 'Halls of Oblivion (140-170)' },
  { key: 'ulverick-120', name: 'Cave of Ulverick (120-150)' },
  { key: 'dawn-160', name: 'Sea of Dawn (160-190)' },
  { key: 'oblivion-210', name: 'Halls of Oblivion (210-250)' },
  { key: 'ulverick-210', name: 'Cave of Ulverick (210-250)' },
  { key: 'dawn-210', name: 'Sea of Dawn (210-250)' },
  { key: 'catacombs-210', name: 'Sikuku Catacombs (210-250)' },
  { key: 'other', name: 'Other' },
];
const dlName = (key) => (DUNGEONS.find((x) => x.key === key) || {}).name || key;
const dl = () => T().dl || STR.en.dl;
const dlLogo = () => ICONS.journaux;   // ponytail: section glyph until per-dungeon art exists
const dlRuns = readJson('roselite-dungeon-runs', [],
  (v) => Array.isArray(v) && v.every((r) => isRecord(r) && Array.isArray(r.rows)));
const saveDlRuns = () => { writeJson('roselite-dungeon-runs', dlRuns); };
let dlMe = localStorage.getItem('roselite-dungeon-me') || '';   // remembered character name → auto-highlights your row

const dlSeconds = (m, s) => (Math.max(0, m | 0) * 60) + Math.max(0, s | 0);
const fmtDur = (sec) => `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
const dlDps = (row, sec) => sec > 0 ? Math.round(row.dmgIn / sec) : 0;
const parseDur = (text) => { const m = text.match(/(\d+)\s*m\s*(\d+)\s*s/i); return m ? (+m[1] * 60 + +m[2]) : 0; };
const nf = (n) => new Intl.NumberFormat(locale()).format(n || 0);

// Parse a pasted scoreboard: one player per line. Strip commas, split on whitespace,
// drop trailing duration tokens (04m / 17s), take name + class as the leading
// non-numeric tokens and the 8 stat columns in header order. Lines without a name
// and ≥3 numbers are skipped. ponytail: tolerant tokenizer, not a strict format —
// the future scorecard replaces this parser wholesale.
const DL_COLS = ['deaths', 'kills', 'dmgIn', 'dmgRcv', 'healIn', 'healRcv', 'reflect', 'block'];
function parseScoreboard(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const toks = line.replace(/,/g, '').trim().split(/\s+/).filter(Boolean)
      .filter((t) => !/^\d+[ms]$/i.test(t));   // drop 04m / 17s duration tokens
    const nums = [], head = [];
    for (const t of toks) (/^-?\d+$/.test(t) ? nums : head).push(t);
    if (!head.length || nums.length < 3) continue;
    const row = { name: head[0], cls: head.slice(1).join(' ') || '—' };
    DL_COLS.forEach((c, i) => row[c] = +nums[i] || 0);
    out.push(row);
  }
  return out;
}
console.assert(parseScoreboard('meerminman Raider 0 0 225,551 20,226 0 0 0 0 04m 17s')[0].dmgIn === 225551, 'parseScoreboard: dmg column + comma strip');

const youRow = (run) => run.rows.find((r) => r.name === run.me) || null;
const youDps = (run) => { const r = youRow(run); return r ? dlDps(r, run.seconds) : 0; };

function renderDungeons() {
  const body = views.journaux.querySelector('.view-body');
  const d = dl();
  const meLine = dlMe ? `${d.youAre}: <b>${esc(dlMe)}</b>` : d.pickYou;
  body.innerHTML =
    `<details class="dl-log">
       <summary>${d.logTitle}</summary>
       <div class="dl-form">
         <select class="inp" id="dl-dungeon">${DUNGEONS.map((x) => `<option value="${x.key}">${esc(x.name)}</option>`).join('')}</select>
         <div class="dl-dur">${d.duration}: <input class="inp" id="dl-min" type="number" min="0" placeholder="04"> m <input class="inp" id="dl-sec" type="number" min="0" max="59" placeholder="17"> s</div>
         <textarea class="inp" id="dl-paste" rows="5" placeholder="${esc(d.paste)}"></textarea>
         <span class="dl-me">${meLine}</span>
         <p class="section-note" id="dl-err" hidden></p>
         <button class="btn" id="dl-save">${d.save}</button>
       </div>
     </details>
     <div class="dl-grid" id="dl-grid"></div>`;
  body.querySelector('#dl-save').addEventListener('click', dlSave);
  renderDlGrid(body.querySelector('#dl-grid'));
}

function renderDlGrid(grid) {
  const d = dl();
  const byType = {};
  for (const r of dlRuns) (byType[r.dungeon] ||= []).push(r);
  const keys = Object.keys(byType);
  if (!keys.length) { grid.innerHTML = `<div class="empty"><strong>${d.emptyTitle}</strong>${d.emptyBody}</div>`; return; }
  keys.sort((a, b) => Math.max(...byType[b].map((r) => r.at)) - Math.max(...byType[a].map((r) => r.at)));   // most recently played first
  grid.innerHTML = keys.map((key) => {
    const runs = byType[key];
    const bestTime = Math.min(...runs.map((r) => r.seconds));
    const dpsList = runs.map(youDps).filter((n) => n > 0);
    const bestDps = dpsList.length ? Math.max(...dpsList) : 0;
    return `<button class="dl-card" data-key="${key}">
        <span class="dl-logo">${dlLogo(key)}</span>
        <span class="dl-card-name">${esc(dlName(key))}</span>
        <span class="dl-card-stats">
          <span>${d.best} <b>${fmtDur(bestTime)}</b></span>
          ${bestDps ? `<span>${d.yourDps} <b>${nf(bestDps)}</b></span>` : ''}
          <span><b>${runs.length}</b> ${d.runs}</span>
        </span></button>`;
  }).join('');
  grid.querySelectorAll('.dl-card').forEach((b) => b.addEventListener('click', () => openDungeon(b.dataset.key)));
}

// Drill: every run of one dungeon, newest first, each with its full party table.
// Tapping any row re-marks it as "you" (the manual-pick fallback) and remembers
// that character name so future pastes auto-highlight it.
function openDungeon(key) {
  const d = dl();
  const runs = dlRuns.filter((r) => r.dungeon === key).sort((a, b) => b.at - a.at);
  drill(dlName(key), (host) => {
    host.innerHTML = runs.map((run) => dlRunHtml(run, d)).join('') || `<div class="empty"><strong>${d.emptyTitle}</strong></div>`;
    host.querySelectorAll('.dl-del').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = dlRuns.findIndex((r) => r.id === +b.dataset.id);
      if (i >= 0) { dlRuns.splice(i, 1); saveDlRuns(); openDungeon(key); }
    }));
    host.querySelectorAll('.dl-tbl tbody tr').forEach((tr) => tr.addEventListener('click', () => {
      const run = runs.find((r) => r.id === +tr.dataset.run);
      run.me = tr.dataset.name; dlMe = tr.dataset.name;
      localStorage.setItem('roselite-dungeon-me', dlMe); saveDlRuns(); openDungeon(key);
    }));
  });
}

function dlRunHtml(run, d) {
  const you = youRow(run), c = d.cols;
  const yDps = you ? dlDps(you, run.seconds) : 0;
  const day = new Date(run.at).toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' });
  const head = `<tr><th>${c.name}</th><th>${c.cls}</th><th>${c.dps}</th><th>${c.dmgIn}</th><th>${c.dmgRcv}</th><th>${c.kills}</th><th>${c.deaths}</th><th>${c.healIn}</th><th>${c.reflect}</th><th>${c.block}</th></tr>`;
  const body = [...run.rows].sort((a, b) => b.dmgIn - a.dmgIn).map((r) =>
    `<tr class="${you && r.name === you.name ? 'dl-you' : ''}" data-run="${run.id}" data-name="${esc(r.name)}">` +
    `<td>${esc(r.name)}</td><td>${esc(r.cls)}</td><td>${nf(dlDps(r, run.seconds))}</td><td>${nf(r.dmgIn)}</td><td>${nf(r.dmgRcv)}</td>` +
    `<td>${r.kills}</td><td>${r.deaths}</td><td>${nf(r.healIn)}</td><td>${r.reflect}</td><td>${r.block}</td></tr>`).join('');
  return `<div class="dl-run">
      <div class="dl-run-head">
        <span>${day} · ${fmtDur(run.seconds)}</span>
        <span>${yDps ? `<span class="dl-run-dps">${nf(yDps)} ${d.yourDps}</span> · ` : ''}<button class="dl-del" data-id="${run.id}" aria-label="delete">×</button></span>
      </div>
      <div style="overflow-x:auto"><table class="dl-tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    </div>`;
}

function dlSave() {
  const body = views.journaux.querySelector('.view-body'), d = dl();
  const err = body.querySelector('#dl-err'), paste = body.querySelector('#dl-paste').value;
  const rows = parseScoreboard(paste);
  if (!rows.length) { err.textContent = d.badPaste; err.hidden = false; return; }
  const seconds = dlSeconds(+body.querySelector('#dl-min').value, +body.querySelector('#dl-sec').value) || parseDur(paste);
  // "you" = remembered name if present in this scoreboard, else top-damage row (tap to fix in the run view).
  const me = dlMe && rows.some((r) => r.name === dlMe) ? dlMe : [...rows].sort((a, b) => b.dmgIn - a.dmgIn)[0].name;
  dlRuns.push({ id: Date.now(), dungeon: body.querySelector('#dl-dungeon').value, at: Date.now(), seconds, me, rows });
  saveDlRuns();
  if (dlMe !== me) { dlMe = me; localStorage.setItem('roselite-dungeon-me', me); }
  renderDungeons();
}

// ── Extensions (mod manager: loose-file overrides in the game's 3DDATA) ────
const MODS = require('./mods.js');
let modRelaunch = false;   // a toggle happened this session → remind to relaunch
function renderExtensions() {
  const d = T(), body = views.extensions.querySelector('.view-body');
  const GAME_DIR = gameDir();
  if (!GAME_DIR || !fs.existsSync(path.join(GAME_DIR, '3DDATA'))) {
    body.innerHTML = `<div class="empty"><strong>${secLabel('extensions')}</strong>${d.modsBadDir}</div>`;
    return;
  }
  const mods = MODS.listMods(GAME_DIR);
  if (!mods.length) {
    body.innerHTML = `<div class="empty"><strong>${secLabel('extensions')}</strong>${d.modsNone}</div>`;
    return;
  }
  body.innerHTML = `<ul class="rows">${mods.map((m, i) => {
    // A mod with a mod.json exposes per-item switches: header row (name → guide,
    // caret → collapse the option list) + one collapsed-by-default row per option.
    // Otherwise, the classic single all-or-nothing switch.
    if (m.options) return `<li class="mod-row"><button class="row" data-i="${i}"><span class="row-name">${esc(m.name)}</span>` +
      `<span class="row-count">${m.options.length}</span></button>` +
      `<button class="mod-caret" data-hd="${i}" aria-label="${esc(m.name)}">${CHEV}</button></li>` +
      m.options.map((o, j) =>
        `<li class="mod-row mod-opt" data-p="${i}" hidden><span class="row-name" style="flex:1;padding-left:14px;opacity:.85">${esc(o.label)}</span>` +
        `<input type="checkbox" class="switch" data-i="${i}" data-j="${j}"${o.enabled ? ' checked' : ''}></li>`).join('');
    return `<li class="mod-row"><button class="row" data-i="${i}"><span class="row-name">${esc(m.name)}</span>` +
      `<span class="row-meta"><span class="row-count">${m.files.length} ${d.modFiles}</span>${CHEV}</span></button>` +
      `<input type="checkbox" class="switch" data-i="${i}"${m.enabled ? ' checked' : ''}></li>`;
  }).join('')}</ul>` +
    `<p class="section-note" id="mod-note">${modRelaunch ? d.modRelaunch : ''}</p>`;
  const note = body.querySelector('#mod-note');
  body.querySelectorAll('.switch').forEach((cb) => cb.addEventListener('change', () => {
    const m = mods[+cb.dataset.i];
    const target = cb.dataset.j !== undefined ? m.options[+cb.dataset.j] : m;   // per-item option or whole mod
    try { MODS.setEnabled(GAME_DIR, target, cb.checked); }
    catch (e) { cb.checked = !cb.checked; note.textContent = `${m.name} — ${e.message}`; return; }
    modRelaunch = true; note.textContent = d.modRelaunch;
  }));
  body.querySelectorAll('button.row').forEach((b) => b.addEventListener('click', () => openModGuide(mods[+b.dataset.i])));
  // Caret toggles the collapsed option rows of an options mod (default collapsed).
  body.querySelectorAll('.mod-caret').forEach((b) => b.addEventListener('click', () => {
    b.classList.toggle('open');
    body.querySelectorAll(`.mod-opt[data-p="${b.dataset.hd}"]`).forEach((r) => { r.hidden = !r.hidden; });
  }));
}
// Row click → the mod's README.html (its guide) in the drill view; falls back
// to the raw file list for a mod that ships without one.
function openModGuide(m) {
  const readme = path.join(m.dir, 'README.html');
  const html = fs.existsSync(readme)
    ? fs.readFileSync(readme, 'utf8')
    : `<ul>${m.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
  drill(m.name, (el) => { el.innerHTML = `<div class="prose">${html}</div>`; });
}

// ── Cris (saved shouts: persisted, copy to clipboard) ──────────────────────
let shouts = readJson('roselite-shouts', DEFAULT_SHOUTS,
  (v) => Array.isArray(v) && v.every((s) => isRecord(s) && typeof s.name === 'string' && typeof s.text === 'string' && (s.channel == null || typeof s.channel === 'string')));
const saveShouts = () => writeJson('roselite-shouts', shouts);
function renderShouts() {
  const list = document.getElementById('shout-list');
  if (!shouts.length) { list.innerHTML = `<p class="section-note">${T().shoutEmpty}</p>`; return; }
  list.innerHTML = shouts.map((sh, i) =>
    `<li class="shout">
       <button class="shout-copy" data-i="${i}" title="${T().copied}"><span class="row-name">${esc(sh.name)}</span><span class="shout-preview">${esc((sh.channel || '') + sh.text)}</span></button>
       <button class="shout-del" data-i="${i}" aria-label="delete">×</button>
     </li>`).join('');
  list.querySelectorAll('.shout-copy').forEach((b) => b.addEventListener('click', () => {
    const p = b.querySelector('.shout-preview'), prev = p.textContent;
    const sh = shouts[+b.dataset.i]; clipboard.writeText((sh.channel || '') + sh.text);
    p.textContent = T().copied; p.classList.add('copied');
    setTimeout(() => { p.textContent = prev; p.classList.remove('copied'); }, 1200);
  }));
  list.querySelectorAll('.shout-del').forEach((b) => b.addEventListener('click', () => { shouts.splice(+b.dataset.i, 1); saveShouts(); renderShouts(); }));
}
function initShouts() {
  const nameEl = document.getElementById('shout-name'), textEl = document.getElementById('shout-text');
  const chanRow = document.getElementById('shout-channel');
  const setChan = (v) => chanRow.querySelectorAll('.chip').forEach((c) => c.classList.toggle('chip--on', c.dataset.v === v));
  chanRow.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) setChan(b.dataset.v); });
  document.getElementById('shout-save').addEventListener('click', () => {
    const name = nameEl.value.trim(), text = textEl.value.trim();
    if (!name || !text) return;
    shouts.push({ name, text, channel: chanRow.querySelector('.chip--on').dataset.v }); saveShouts();
    nameEl.value = ''; textEl.value = ''; setChan(''); renderShouts(); nameEl.focus();
  });
  renderShouts();
}

// ── Home launcher (shown by main.js when no game is running) ───────────────
function renderLauncher() {
  const d = { ...STR.en.launcher, ...T().launcher };   // en defaults, current-lang overrides
  document.getElementById('acc-add-btn').textContent = d.add;
  document.getElementById('lch-acc-eyebrow').textContent = d.accounts || 'Accounts';
  document.getElementById('lch-news-eyebrow').textContent = accounts().length ? (d.news || 'News') : (lang === 'fr' ? 'Premiers pas' : 'Get started');
  document.getElementById('lch-set-eyebrow').textContent = d.settings || 'Settings';
  document.getElementById('launch-hint').textContent = '';
  renderSettingsInto(document.getElementById('lch-settings-content'), { launcher: true });
  renderLauncherFeed();

  const list = document.getElementById('acc-list');
  const accs = accounts();
  if (!accs.length) { list.innerHTML = `<p class="section-note">${d.empty}</p>`; return; }
  const gear = WRENCH;
  list.innerHTML = accs.map((e) => {
    const icon = acctIcon(e);
    const av = icon
      ? `<img class="acc-av" src="${esc(classIconSrc(icon))}" alt="" onerror="this.style.visibility='hidden'">`
      : `<span class="acc-av"></span>`;
    const needsPassword = !!(acctMeta()[e] || {}).needsPassword;
    const sub = needsPassword
      ? `${acctSub(e) ? acctSub(e) + ' · ' : ''}${lang === 'fr' ? 'Mot de passe requis' : 'Password required'}`
      : acctSub(e);
    return `<li class="acc" draggable="true" data-e="${esc(e)}">${av}<span class="acc-id">` +
      `<span class="acc-name" title="${esc(acctName(e))}">${esc(acctName(e))}</span>` +
      (sub ? `<span class="acc-sub">${esc(sub)}</span>` : '') + `</span>` +
      `<button class="acc-play" data-e="${esc(e)}">▶ ${d.play || 'Play'}</button>` +
      `<button class="acc-cog" data-e="${esc(e)}" aria-label="settings">${gear}</button></li>`;
  }).join('');
  list.querySelectorAll('.acc-play').forEach((b) => b.addEventListener('click', () => launchAccount(b.dataset.e)));
  list.querySelectorAll('.acc-cog').forEach((b) => b.addEventListener('click', () => openAccountModal(b.dataset.e)));
  applyUpdGate();   // a full re-render (lang/theme) must respect an in-flight update
  // Drag to re-arrange: native HTML5 DnD moves the live node so the drag survives,
  // then persists the resulting DOM order on drop. No mid-drag repaint.
  let dragLi = null;
  list.querySelectorAll('.acc').forEach((li) => {
    li.addEventListener('dragstart', () => { dragLi = li; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging'); dragLi = null;
      const order = [...list.querySelectorAll('.acc')].map((x) => x.dataset.e);
      writeJson('roselite-accounts', order);
    });
    li.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      if (!dragLi || li === dragLi) return;
      const after = ev.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
      list.insertBefore(dragLi, after ? li.nextSibling : li);
    });
  });
}
// The launcher's center feed reuses the exact home cards; refresh repaints in place.
function renderLauncherFeed() {
  const el = document.getElementById('lch-feed');
  if (!el) return;
  if (!accounts().length) {
    const o = onboardText();
    const ready = !!detect(gameDir(), '3DDATA');
    const check = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l3.5 3.5L16 5.5"/></svg>';
    const shield = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2.8l6 2.3v4.6c0 3.8-2.5 6.2-6 7.5-3.5-1.3-6-3.7-6-7.5V5.1l6-2.3z"/><path d="M7.2 10l1.8 1.8 3.9-4"/></svg>';
    el.innerHTML = `<section class="lch-onboard"><div class="lch-onboard-mark">${ICONS.rois}</div>` +
      `<h1>${esc(o.title)}</h1><p class="lch-onboard-intro">${esc(o.body)}</p><p class="lch-onboard-time">${esc(o.time)}</p>` +
      `<ol class="lch-steps"><li class="lch-step${ready ? ' done' : ''}"><span class="lch-step-num">${ready ? check : '1'}</span>` +
      `<span class="lch-step-copy"><strong>${esc(o.game)}</strong><span title="${esc(gameDir())}">${esc(ready ? o.gameFound : o.gameMissing)}</span></span>` +
      (ready ? '' : `<button class="lang-btn" id="onboard-game">${esc(o.choose)}</button>`) + `</li>` +
      `<li class="lch-step"><span class="lch-step-num">2</span><span class="lch-step-copy"><strong>${esc(o.account)}</strong><span>${esc(o.accountBody)}</span></span>` +
      `<button class="lang-btn acc-modal-save" id="onboard-account">${esc(o.add)}</button></li></ol>` +
      `<p class="lch-privacy">${shield}<span>${esc(o.privacy)}</span></p></section>`;
    const game = document.getElementById('onboard-game');
    if (game) game.addEventListener('click', async () => {
      const dir = await ipcRenderer.invoke('pick-dir');
      if (!dir) return;
      localStorage.setItem('roselite-game-dir', dir); ipcRenderer.send('game-dir', dir);
      renderLauncher();
    });
    document.getElementById('onboard-account').addEventListener('click', () => openAccountModal(null));
    return;
  }
  el.innerHTML = `${feedBody()}${socialsBar()}`;   // event cards are static here (no section to route to under the launcher)
  pullFeed(renderLauncherFeed);
}

// One-click Play: make this account the launch target, then launch (launchSelected
// reloads first if it differs from load time, so per-account stores re-namespace).
function launchAccount(email) {
  activeAccount = email;
  localStorage.setItem('roselite-account', email);
  if ((acctMeta()[email] || {}).needsPassword) {
    openAccountModal(email);
    const pw = document.getElementById('acc-modal-pw');
    pw.placeholder = lang === 'fr' ? 'Requis sur ce PC' : 'Required on this PC';
    pw.focus();
    return;
  }
  launchSelected();
}
// Selecting = set the launch target in-place + persist. Used by the modal save.
function selectAccount(email) {
  activeAccount = email;
  localStorage.setItem('roselite-account', email);
  renderLauncher();
}
function removeAccount(email) {
  const accs = accounts().filter((x) => x !== email);
  if (!writeJson('roselite-accounts', accs)) { showToast({ title: T().storageErr || STR.en.storageErr, tone: 'bad' }); return; }
  // Tombstone the delete so sync can't resurrect it from another device's stale
  // copy (account merge is union — a bare local removal comes straight back).
  const tomb = readJson('roselite-accounts-deleted', {}, isRecord);
  tomb[email.trim().toLowerCase()] = Date.now();
  writeJson('roselite-accounts-deleted', tomb);
  const meta = acctMeta(); delete meta[email]; saveAcctMeta(meta);   // drop nickname/icon too
  ipcRenderer.send('account-remove', email);           // drop the stored (encrypted) password too
  if (email === activeAccount) {                       // dropped the selected one → fall back to the first, or none
    activeAccount = accs[0] || '';
    if (activeAccount) localStorage.setItem('roselite-account', activeAccount);
    else localStorage.removeItem('roselite-account');
  }
  renderLauncher();
}

// ── Account add/edit modal ─────────────────────────────────────────────────
// One <dialog> for both add and edit. editingEmail = the account being edited,
// or null for add. Passwords never round-trip to the renderer: the field is
// empty on open, and a blank field on save means "keep the current password"
// (main carries the ciphertext across a rename). ponytail: emails in localStorage,
// secrets in main's keychain-encrypted store — the two never mix.
let editingEmail = null;
let modalIcon = '';   // class icon chosen in the open modal
const iconCell = (icon, none) => icon
  ? `<button class="acc-icon${modalIcon === icon ? ' active' : ''}" data-icon="${esc(icon)}" title="${esc(icon)}"><img src="${esc(classIconSrc(icon))}" alt="${esc(icon)}" loading="lazy" onerror="this.parentNode.textContent='${esc(path.basename(icon))}'"></button>`
  : `<button class="acc-icon${modalIcon === '' ? ' active' : ''}" data-icon="">${esc(none)}</button>`;
function renderModalIcons() {
  const d = { ...STR.en.launcher, ...T().launcher };
  const box = document.getElementById('acc-modal-icons');
  // Class assets + None, plus the chosen game icon (if any) so it shows as active.
  const list = ['', ...CLASS_ICONS];
  if (modalIcon && !list.includes(modalIcon)) list.splice(1, 0, modalIcon);
  box.innerHTML = list.map((i) => iconCell(i, d.iconNone)).join('')
    + `<button class="acc-icon acc-icon--more" data-more title="${esc(d.moreIcons)}">＋</button>`;
  box.querySelectorAll('.acc-icon[data-icon]').forEach((b) => b.addEventListener('click', () => {
    modalIcon = b.dataset.icon; renderModalIcons();
  }));
  box.querySelector('[data-more]').addEventListener('click', toggleIconSearch);
}
// "More icons…" opens a search over every file in RoseData/game-icons (capped).
function toggleIconSearch() {
  const inp = document.getElementById('acc-modal-icon-search');
  const res = document.getElementById('acc-modal-icon-results');
  const open = inp.hidden;
  inp.hidden = res.hidden = !open;
  if (!open) return;
  inp.placeholder = { ...STR.en.launcher, ...T().launcher }.iconSearch;
  renderIconSearch(inp.value);
  inp.focus();
}
function renderIconSearch(q) {
  const res = document.getElementById('acc-modal-icon-results');
  const d = { ...STR.en.launcher, ...T().launcher };
  const needle = fold(q.trim());
  const hits = (needle ? gameIcons().filter((i) => fold(i).includes(needle)) : gameIcons()).slice(0, 60);
  res.innerHTML = hits.map((i) => iconCell(i, d.iconNone)).join('');
  res.querySelectorAll('.acc-icon').forEach((b) => b.addEventListener('click', () => {
    modalIcon = b.dataset.icon; renderModalIcons(); renderIconSearch(q);
  }));
}
function openAccountModal(email) {
  editingEmail = email || null;
  const meta = acctMeta()[editingEmail] || {};
  const d = { ...STR.en.launcher, ...T().launcher };
  const dlg = document.getElementById('acc-modal');
  document.getElementById('acc-modal-title').textContent = editingEmail ? d.editTitle : d.addTitle;
  document.getElementById('acc-modal-nick-lbl').textContent = d.nickOpt;
  document.getElementById('acc-modal-email-lbl').textContent = d.emailLabel;
  document.getElementById('acc-modal-pw-lbl').textContent = d.password;
  document.getElementById('acc-modal-icon-lbl').textContent = d.icon;
  document.getElementById('acc-modal-save').textContent = d.save;
  document.getElementById('acc-modal-cancel').textContent = d.cancel;
  const del = document.getElementById('acc-modal-del');
  del.textContent = d.del; del.hidden = !editingEmail;
  document.getElementById('acc-modal-err').textContent = '';
  document.getElementById('acc-modal-nick').value = meta.nick || '';
  document.getElementById('acc-modal-email').value = editingEmail || '';
  const pw = document.getElementById('acc-modal-pw');
  pw.value = ''; pw.placeholder = editingEmail ? d.pwKeep : '';
  modalIcon = meta.icon || '';
  const iconSearch = document.getElementById('acc-modal-icon-search');
  iconSearch.value = ''; iconSearch.hidden = true;
  document.getElementById('acc-modal-icon-results').hidden = true;
  renderModalIcons();
  dlg.showModal();
  document.getElementById('acc-modal-nick').focus();
}
function saveAccountModal() {
  const d = { ...STR.en.launcher, ...T().launcher };
  const err = document.getElementById('acc-modal-err');
  const nick = document.getElementById('acc-modal-nick').value.trim();
  const emailEl = document.getElementById('acc-modal-email');
  const pwEl = document.getElementById('acc-modal-pw');
  const email = emailEl.value.trim();
  const password = pwEl.value;   // no trim: passwords may have edge whitespace
  emailEl.setAttribute('aria-invalid', 'false'); pwEl.setAttribute('aria-invalid', 'false');
  if (!email || !emailEl.validity.valid) { emailEl.setAttribute('aria-invalid', 'true'); err.textContent = d.errEmail; emailEl.focus(); return; }
  if (!editingEmail && !password) { pwEl.setAttribute('aria-invalid', 'true'); err.textContent = d.errPw; pwEl.focus(); return; }   // new accounts need a password
  const accs = accounts();
  if (editingEmail && editingEmail !== email) {        // rename: replace in place, preserving order
    const i = accs.indexOf(editingEmail);
    if (i >= 0) accs[i] = email; else accs.push(email);
  } else if (!accs.includes(email)) {
    accs.push(email);
  }
  if (!writeJson('roselite-accounts', accs)) { err.textContent = T().storageErr || STR.en.storageErr; return; }
  const meta = acctMeta();
  const prevMeta = meta[editingEmail || email] || {};
  const needsPassword = !!prevMeta.needsPassword && !password;
  if (editingEmail && editingEmail !== email) delete meta[editingEmail];   // move metadata on rename
  // Stamp addedAt on a fresh add (new, or re-adding a previously-deleted one, whose
  // meta was cleared) so it beats any lingering delete tombstone; keep it otherwise.
  const addedAt = prevMeta.addedAt || Date.now();
  meta[email] = { nick, icon: modalIcon, ...(needsPassword ? { needsPassword: true } : {}), addedAt };
  saveAcctMeta(meta);
  ipcRenderer.send('account-set', { email, password, oldEmail: editingEmail || undefined });
  if (editingEmail && editingEmail === activeAccount) { activeAccount = email; }
  document.getElementById('acc-modal').close();
  selectAccount(email);   // the added/edited account becomes the selected one
}
function deleteAccountFromModal() {
  const d = { ...STR.en.launcher, ...T().launcher };
  if (!editingEmail || !confirm(d.delConfirm)) return;
  document.getElementById('acc-modal').close();
  removeAccount(editingEmail);
}
function launchSelected() {
  if (!activeAccount) return;
  ipcRenderer.send('launch', activeAccount);
}
// Game-update UI (fed by main's headless updater via 'update-progress'). Play is
// gated only *while a run is active*: locked on the first progress frame, unlocked
// on any terminal event — an update failure must never strand an offline player.
let updGate = false;
const UPD_STAGE = { 'fetching-metadata': 'updChecking', 'checking-files': 'updChecking',
  'downloading-updates': 'updDownloading', 'verifying-files': 'updVerifying', 'updating-updater': 'updUpdater' };
function applyUpdGate() { document.querySelectorAll('.acc-play').forEach((b) => { b.disabled = updGate; }); }
function onUpdate(evt) {
  const d = { ...STR.en.launcher, ...T().launcher };
  const box = document.getElementById('lch-update');
  if (!box) return;
  const status = document.getElementById('upd-status');
  const fill = document.getElementById('upd-fill');
  const action = document.getElementById('upd-action');
  action.hidden = true; action.onclick = null;

  if (evt.event === 'start' || evt.event === 'progress') {
    updGate = true; applyUpdGate();   // 'start' arrives before the child's first frame: Play locks instantly
    box.hidden = false;
    status.textContent = d[UPD_STAGE[evt.stage] || 'updChecking'];
    const pct = evt.max > 0 ? Math.max(0, Math.min(100, Math.round(evt.current / evt.max * 100))) : 0;
    fill.style.width = pct + '%';
    return;
  }
  updGate = false; applyUpdGate();   // all terminal events unlock Play
  if (evt.event === 'done') {
    fill.style.width = '100%'; status.textContent = d.updDone;
    setTimeout(() => { if (!updGate) box.hidden = true; }, 2500);
  } else if (evt.event === 'error') {
    box.hidden = false;
    status.textContent = `${d.updError}${evt.message ? ' — ' + evt.message : ''}`;
    action.hidden = false; action.textContent = d.updRetry;
    action.onclick = () => ipcRenderer.send('update-run', false);
  } else if (evt.event === 'unsupported') {
    box.hidden = false; status.textContent = d.updOld;
    action.hidden = false; action.textContent = d.updOpenGui;
    action.onclick = () => ipcRenderer.send('update-gui');
  } else {
    box.hidden = true;   // 'missing' → no updater installed, behave like before
  }
}
function initLauncher() {
  document.getElementById('acc-add-btn').addEventListener('click', () => openAccountModal(null));
  document.getElementById('acc-modal-save').addEventListener('click', saveAccountModal);
  document.getElementById('acc-modal-del').addEventListener('click', deleteAccountFromModal);
  document.getElementById('acc-modal-cancel').addEventListener('click', () => document.getElementById('acc-modal').close());
  document.getElementById('acc-modal-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveAccountModal(); });
  document.getElementById('acc-modal-icon-search').addEventListener('input', (e) => renderIconSearch(e.target.value));

  document.getElementById('lch-min').addEventListener('click', () => ipcRenderer.send('minimize'));
  document.getElementById('lch-quit').addEventListener('click', () => ipcRenderer.send('quit'));
  const drawer = document.getElementById('lch-settings');
  document.getElementById('lch-gear').addEventListener('click', () => drawer.classList.toggle('open'));
  document.getElementById('lch-set-close').addEventListener('click', () => drawer.classList.remove('open'));
  ipcRenderer.on('launch-error', (_e, msg) => { document.getElementById('launch-hint').textContent = `${T().launcher.err}${msg ? ' — ' + msg : ''}`; });
  ipcRenderer.on('update-progress', (_e, evt) => onUpdate(evt));
  ipcRenderer.on('mode', (_e, m) => {
    panelMode = m;   // gate play time: only accumulate in game mode
    const isLauncher = m === 'launcher';
    document.getElementById('launcher').hidden = !isLauncher;
    document.getElementById('panel').hidden = isLauncher;   // hide the docked panel (and its hover events) behind the launcher
    if (isLauncher) document.getElementById('rail').hidden = true;
    if (isLauncher) {
      // Lock Play *before* requesting the file check, so there's no window to
      // click through; the check's terminal event unlocks. Requested from here
      // (not main's showLauncher) because renderer IPC is ordered: 'game-dir'
      // (sent at boot, overlay.js bottom) is guaranteed to land before
      // 'update-run', so main checks the right folder. updaterBusy dedupes
      // repeat entries while a run is in flight.
      updGate = true;
      renderLauncher();
      ipcRenderer.send('update-run', false);
    }
    updateResizable();
  });
  renderLauncher();
}

function positionPopup(menu, btn) {
  const r = btn.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 6)}px`;
  menu.style.left = `${Math.max(6, Math.min(r.left, window.innerWidth - menu.offsetWidth - 6))}px`;
}
function closeNotifMenu(restoreFocus = false) {
  const menu = document.getElementById('notif-menu'), btn = document.getElementById('notif-btn');
  menu.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) btn.focus();
}

// ── Alert history (header bell): the last 10 toasts, so a missed beep is
// recoverable. Same fixed-dropdown popup shell (.acct-menu) as the old
// account switcher, still shared for that reason. ───────────────────────────
function initNotifLog() {
  const btn = document.getElementById('notif-btn');
  const menu = document.getElementById('notif-menu');
  const hhmm = (t) => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
  const open = (focusFirst = false) => {
    const d = T();
    menu.innerHTML = notifLog.length
      ? notifLog.map((n) => `<div class="notif-item"><span class="notif-time">${esc(hhmm(n.at))}</span>` +
          `<span dir="auto">${esc(n.title)}${n.body ? ` <span class="notif-body">— ${esc(n.body)}</span>` : ''}</span></div>`).join('') +
          `<div class="notif-clear-row"><button class="notif-clear" type="button">${esc(d.alertsClear || STR.en.alertsClear)}</button></div>`
      : `<div class="notif-item"><span class="notif-body">${esc(d.alertsEmpty || STR.en.alertsEmpty)}</span></div>`;
    const clear = menu.querySelector('.notif-clear');
    if (clear) clear.addEventListener('click', () => {
      notifLog = []; writeJson(NOTIF_KEY, notifLog); closeNotifMenu(true);
    });
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    positionPopup(menu, btn);
    if (focusFirst) menu.querySelector('button')?.focus();
  };
  btn.addEventListener('click', (e) => menu.hidden ? open(e.detail === 0) : closeNotifMenu());
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !menu.hidden) closeNotifMenu();
    else if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); closeNotifMenu(true); }
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') closeNotifMenu();
    else if (e.key === 'Escape') { e.preventDefault(); closeNotifMenu(true); }
  });
  document.addEventListener('focusin', (e) => { if (e.target !== btn && !menu.contains(e.target)) closeNotifMenu(); }, true);
  document.addEventListener('click', (e) => { if (!e.target.closest('#notif-btn,#notif-menu')) closeNotifMenu(); });
}

// ── Play time (RoseLite account) ───────────────────────────────────────────
// Accumulates one second at a time while the game overlay is actually on screen
// (game mode + window visible), persisted for the RoseLite account so it
// survives reloads, relaunches, and switching which ROSE account is playing.
// ponytail: one localStorage int of seconds, no session log, no server beyond
// the play-session mirror in progressstore. Display is h/m; the second-level
// count is just accuracy.
let panelMode = 'launcher';
const PLAYTIME_KEY = 'roselite.playtime';
const loadPlaytime = () => +localStorage.getItem(PLAYTIME_KEY) || 0;
let playtimeSeconds = loadPlaytime();
const fmtPlaytime = (s) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
// The footer reads `0h 00m`, so 59 of every 60 writes changed nothing — and each
// one was a synchronous localStorage write plus a layout of the footer, once a
// second for the whole session. Persist on the minute (and on the way out, so a
// crash costs at most 59 seconds of playtime, same as before rounding).
const renderPlaytime = () => {
  const el = document.getElementById('play-time');
  const next = fmtPlaytime(playtimeSeconds);
  if (el.textContent !== next) el.textContent = next;
};
const savePlaytime = () => localStorage.setItem(PLAYTIME_KEY, playtimeSeconds);
setInterval(() => {
  if (panelMode !== 'game' || document.hidden) return;   // playtime keeps its existing visible-overlay rule
  playtimeSeconds++;
  if (playtimeSeconds % 60 === 0) savePlaytime();
  renderPlaytime();
}, 1000);
window.addEventListener('pagehide', savePlaytime);
console.assert(fmtPlaytime(0) === '0h 00m' && fmtPlaytime(3661) === '1h 01m' && fmtPlaytime(600) === '0h 10m', 'fmtPlaytime');

// ── Language: chrome that isn't rebuilt by a render fn ─────────────────────
function updateChrome() {
  const d = T();
  document.documentElement.lang = locale();
  document.getElementById('footer-label').textContent = d.playtime;
  const alertsLabel = d.alerts || STR.en.alerts;
  document.getElementById('notif-btn').title = alertsLabel;
  document.getElementById('notif-btn').setAttribute('aria-label', alertsLabel);
  const tips = d.tips || STR.en.tips;
  applyNavCollapsed(document.body.classList.contains('nav-collapsed'));   // re-label the burger
  document.getElementById('settings-btn').title = tips.settings;
  document.getElementById('settings-btn').setAttribute('aria-label', tips.settings);
  document.getElementById('collapse-btn').title = tips.collapse;
  document.getElementById('collapse-btn').setAttribute('aria-label', tips.collapse);
  document.getElementById('quit-btn').title = tips.quit;
  document.getElementById('quit-btn').setAttribute('aria-label', tips.quit);
  fullBtn.title = curPlacement === 'full' ? tips.dock : tips.fullscreen;
  fullBtn.setAttribute('aria-label', fullBtn.title);
  document.getElementById('shout-name').placeholder = d.shoutName;
  document.getElementById('shout-text').placeholder = d.shoutText;
  document.getElementById('shout-save').textContent = d.shoutSave;
  // butin is owned by loot-tracker.js (mounts into #loot-widgets) — don't clobber it.
}
function applyLang() {
  renderHome(); renderRail(); renderNews(); renderShouts(); renderLauncher(); updateChrome();
  renderLiveSections();
  // Hidden lazy views can keep their old DOM until reopened; the active view is
  // rebuilt immediately below so changing language still feels synchronous.
  readySections.clear();
  if (current !== 'home') openSection(current);   // refresh titles/labels in the new language
}
function setLang(x) { if (!LANGS[x] || x === lang) return; lang = x; localStorage.setItem('roselite-lang', x); applyLang(); }

// ── Plugins ─────────────────────────────────────────────────────────────────
// Widget mount points, keyed by slot. 'widgets' (Kings) is the default; a plugin
// passes another slot to render elsewhere (e.g. player-hud → 'character').
const roots = { widgets: document.getElementById('widgets'), character: document.getElementById('char-widgets'), butin: document.getElementById('loot-widgets'), dps: document.getElementById('dps-widgets') };
// Data-source events. Frames arrive from main.js as {type, ...};
// plugins subscribe via api.on(type, cb). ponytail: a Map + a switchless
// dispatch, no event-emitter dependency.
const subs = new Map();
ipcRenderer.on('gamedata', (_e, f) => (subs.get(f.type) || []).forEach((cb) => cb(f)));

// ── Notifications (api.notify) ──────────────────────────────────────────────
// A transient toast stacked at the top of the panel. Reusable by any feature or
// plugin (spawn alerts today; drop/timer alerts later) — callers pass content,
// the overlay owns presentation, same decoupling bet as the data events.
//   api.notify({ title, body?, tone?, timeout?, sound?, onClick? })
// tone: '' | 'gold' | 'bad'. timeout ms (default 6000). sound → named WebAudio
// alert (see SOUNDS; true = 'ping'). ponytail: DOM toast only; add OS
// notifications / a history log here if a feature needs them.
const toastRoot = document.getElementById('toasts');
const statusLive = document.getElementById('status-live');
const alertLive = document.getElementById('alert-live');
const livePending = new Map([[statusLive, []], [alertLive, []]]);
const liveScheduled = new Set();
function announce(message, urgent = false) {
  const target = urgent ? alertLive : statusLive;
  if (!target || !message) return;
  livePending.get(target).push(String(message));
  if (liveScheduled.has(target)) return;
  liveScheduled.add(target);
  // Clear first so an identical repeated alert is announced again. Coalesce every
  // message arriving in this frame so simultaneous king spawns don't overwrite
  // one another before the accessibility tree observes them.
  target.textContent = '';
  requestAnimationFrame(() => setTimeout(() => {
    target.textContent = livePending.get(target).splice(0).join('. ');
    liveScheduled.delete(target);
  }, 20));
}
let soundOn = localStorage.getItem('roselite-sound') !== '0';   // master Settings switch; default on
let audioCtx = null;
// Named alert sounds — short WebAudio patterns (no asset/CDN), distinct enough
// to tell two features apart by ear. Each is a list of notes
// {f:hz, t?:waveform, at?:start s, d?:dur s}. Add an entry to grow the picker.
const SOUNDS = {
  ping:  { label: 'Ping',  notes: [{ f: 880 }] },
  chime: { label: 'Chime', notes: [{ f: 784 }, { f: 1175, at: 0.11 }] },
  coin:  { label: 'Coin',  notes: [{ f: 988, d: 0.07 }, { f: 1319, at: 0.06, d: 0.13 }] },
  alarm: { label: 'Alarm', notes: [{ f: 660, t: 'square', d: 0.1 }, { f: 660, t: 'square', at: 0.15, d: 0.1 }] },
  bell:  { label: 'Bell',  notes: [{ f: 1047, t: 'triangle', d: 0.45 }] },
  thud:  { label: 'Thud',  notes: [{ f: 165, t: 'square', d: 0.1 }, { f: 120, t: 'square', at: 0.09, d: 0.12 }] },
  drop:  { label: 'Drop',  notes: [{ f: 200, t: 'sine', d: 0.07, g: 0.04 }, { f: 150, t: 'sine', at: 0.03, d: 0.08, g: 0.04 }] },   // soft Reels-tumble landing; fires every cascade, so quiet
};
// Player-supplied alert sounds: any audio file dropped in sounds/ (see its
// README) joins the pickers below the built-ins, keyed 'file:<name.ext>'.
// ponytail: scanned once at boot — restart to pick up new files.
const SOUND_DIR = path.join(__dirname, '../sounds');
const fileSounds = (() => {
  try {
    return Object.fromEntries(fs.readdirSync(SOUND_DIR)
      .filter((f) => /\.(mp3|ogg|wav|m4a|flac|webm)$/i.test(f))
      .sort()
      .map((f) => [`file:${f}`, { label: f.replace(/\.[^.]+$/, ''), file: path.join(SOUND_DIR, f) }]));
  } catch { return {}; }   // no folder / unreadable → built-ins only
})();
// `rate` multiplies every pitch (>1 = higher) — used to climb the scale as a
// Reels cascade chains. Clamped so a long chain can't screech.
function playSound(name = 'ping', rate = 1) {
  if (!soundOn) return;
  rate = Math.min(3, Math.max(0.5, Number(rate) || 1));
  const snd = fileSounds[name] || SOUNDS[name] || SOUNDS.ping;
  if (snd.file) {
    try {
      const a = new Audio(pathToFileURL(snd.file).href);
      a.volume = 0.6;
      a.playbackRate = rate;
      a.play().catch(() => {});   // file deleted/undecodable — stay silent
    } catch { /* same */ }
    return;
  }
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (const n of snd.notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      const t0 = audioCtx.currentTime + (n.at || 0), dur = n.d || 0.15;
      o.type = n.t || 'sine'; o.frequency.value = n.f * rate;
      g.gain.setValueAtTime(n.g || 0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + dur);
    }
  } catch { /* audio blocked — the toast (if any) still shows */ }
}
// A <select> of the sound list; previews the picked sound on change. Reused by
// the Monster Tracker and (via api.soundSelect) the loot plugin's drop alert.
function soundSelect(current, onChange) {
  const sel = document.createElement('select');
  sel.className = 'inp';
  const opts = (list) => list.map(([id, s]) =>
    `<option value="${id}"${id === current ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const custom = Object.entries(fileSounds);
  sel.innerHTML = opts(Object.entries(SOUNDS))
    + (custom.length ? `<optgroup label="${esc(STR[lang]?.soundCustom || STR.en.soundCustom)}">${opts(custom)}</optgroup>` : '');
  sel.addEventListener('change', () => { onChange(sel.value); playSound(sel.value); });
  return sel;
}
// Last 10 alerts, persisted (globally — alerts aren't per-account) so "what just
// beeped?" survives even the account-switch reload. Shown by the header bell.
const NOTIF_KEY = 'roselite-notif-log';
let notifLog = readJson(NOTIF_KEY, [],
  (v) => Array.isArray(v) && v.every((n) => isRecord(n) && Number.isFinite(Number(n.at)) && typeof n.title === 'string' && (n.body == null || typeof n.body === 'string')));
function showToast({ title, body = '', tone = '', timeout = 6000, sound = false, onClick } = {}) {
  title = String(title || ''); body = String(body || '');
  tone = tone === 'gold' || tone === 'bad' ? tone : '';
  timeout = Number.isFinite(+timeout) ? Math.max(1000, +timeout) : 6000;
  notifLog.unshift({ at: Date.now(), title, body });
  notifLog = notifLog.slice(0, 10);
  writeJson(NOTIF_KEY, notifLog);
  announce([title, body].filter(Boolean).join('. '), true);
  if (sound) playSound(sound === true ? 'ping' : sound);
  // Ask main for the over-the-game toast layer (top-center of the ROSE window).
  // It bounces the toast back as 'toast-panel' when that layer isn't up (launcher,
  // or the player alt-tabbed away). ponytail: onClick only works on the panel
  // toast — the over-game layer is click-through by design, and the header bell
  // still logs the alert. Give it a click target only if a feature needs one.
  const id = ++toastSeq;
  if (onClick) {
    toastClicks.set(id, onClick);
    setTimeout(() => toastClicks.delete(id), timeout + 1000);   // over-game toasts never claim it
  }
  ipcRenderer.send('toast', { id, title, body, tone, timeout });
}
// onClick can't cross IPC — park it here and pick it back up if the toast bounces
// back into the panel. Dropped when it goes over the game (click-through layer).
let toastSeq = 0;
const toastClicks = new Map();
ipcRenderer.on('toast-panel', (_e, t) => panelToast(t));
function panelToast({ id, title, body = '', tone = '', timeout = 6000 } = {}) {
  const onClick = toastClicks.get(id);
  toastClicks.delete(id);
  tone = tone === 'gold' || tone === 'bad' ? tone : '';
  timeout = Number.isFinite(+timeout) ? Math.max(1000, +timeout) : 6000;
  const el = document.createElement('div');
  el.className = `toast${tone ? ' toast--' + tone : ''}${onClick ? ' toast--link' : ''}`;
  el.innerHTML = `<div class="toast-title" dir="auto">${esc(title || '')}</div>` +
    (body ? `<div class="toast-body" dir="auto">${esc(body)}</div>` : '');
  if (onClick) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
  while (toastRoot.children.length >= 3) toastRoot.firstElementChild.remove();
  toastRoot.appendChild(el);
  let removed = false;
  const kill = () => { if (removed) return; removed = true; el.classList.add('toast--out'); setTimeout(() => el.remove(), 200); };
  const activate = () => { if (onClick) onClick(); kill(); };
  el.addEventListener('click', activate);
  el.addEventListener('keydown', (e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(); } });
  setTimeout(kill, timeout);
}


const api = {
  addWidget(html, slot = 'widgets') {
    const el = document.createElement('div');
    el.innerHTML = html;
    const widget = el.firstElementChild;
    (roots[slot] || roots.widgets).appendChild(widget);
    return widget;
  },
  every(ms, fn) { setInterval(fn, ms); },
  on(type, cb) { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(cb); },
  notify(opts) { showToast(opts); },
  sound(name) { playSound(name); },   // play a named alert with no toast
  soundSelect,                         // build a sound-picker <select> (previews on change)
  // roseutils market price lookup, proxied through main (renderer is file://,
  // main dodges CORS). Plugins go through this, never ipcRenderer directly —
  // when the official API ships, this is the one seam that has to move.
  market(itemTypeId, gameItemId) { return ipcRenderer.invoke('market', itemTypeId, gameItemId); },
};
api.on('spawn', onMonsterSpawn);   // Monster Tracker: alert on watched-mob spawns
// Quest auto-tracking: a 'quest' frame with result 3 = removed from the journal.
// markQuestDone back-fills the chain and re-renders the list.
api.on('quest', ({ result, questId }) => {
  if (result !== 3) return;
  const q = D.questsByGameId.get(questId);
  if (!markQuestDone(q)) return;   // unknown id, or we already had it marked
  showToast({ title: q.name, body: T().questCompleted || STR.en.questCompleted, tone: 'gold', onClick: () => openQuest(q) });
});
function showError(name, message) {
  roots.widgets.insertAdjacentHTML('beforeend',
    `<div class="widget widget--error"><div class="widget-head"><span class="widget-title">Plugin error</span></div><div class="widget-msg">${esc(name)} — ${esc(message)}</div></div>`);
}
const pluginDir = path.join(__dirname, '../plugins');
// Live-fed plugins: skipped when live data is off so their sections show the
// disabled notice instead of a widget stuck on "waiting" (see renderLiveSections).
const LIVE_PLUGINS = new Set(['player-hud.js', 'loot-tracker.js', 'dps-meter.js']);
for (const file of fs.readdirSync(pluginDir).filter((f) => f.endsWith('.js'))) {
  if (!LIVE && LIVE_PLUGINS.has(file)) continue;
  try { require(path.join(pluginDir, file))(api); }
  catch (err) { console.error(`plugin failed: ${file}`, err); showError(file, err.message || String(err)); }
}
// Personnage / Butin / DPS are mounted by the skipped plugins above — fill their
// now-empty containers with the disabled notice. Monstres is handled in renderMonsters.
function renderLiveSections() { if (!LIVE) { liveOff(roots.character); liveOff(roots.butin); liveOff(roots.dps); } }
renderLiveSections();

// ── Boot ───────────────────────────────────────────────────────────────────
const panel = document.getElementById('panel');
// On-top collapsed mode: main dictates whether we're the docked panel, the icon
// rail, or the expanded on-top panel. Rail is its own hover-interactive surface.
const rail = document.getElementById('rail');
// Hover → interactive handshake. A plain mouseenter/mouseleave pair desyncs:
// clicking into the game swallows the mouseleave (and main resets the window
// to click-through on blur), so the DOM still thinks we're hovered, mouseenter
// never re-fires on return, and the panel becomes unclickable. Instead: dedupe
// what we sent, clear it on window blur (mirrors main's blur reset), re-assert
// from mousemove (forwarded even while click-through).
let sentInteractive = false;
const sendInteractive = (on) => {
  if (sentInteractive === on) return;
  sentInteractive = on;
  ipcRenderer.send('interactive', on);
};
window.addEventListener('blur', () => { sentInteractive = false; });

// ── Ambient motion only runs for someone who is looking at it ───────────────
// RoseLite sits on top of a game, so "visible but not focused" is most of a
// session — and Chromium's own throttling never fires, because an always-on-top
// overlay is never occluded. Measured on the fullscreen Bazaar: 15–23% of a CPU
// core (50–65% across processes) with the ambient set running, 1–3% without. The
// player is mid-fight; those are frames stolen from ROSE to animate lamps nobody
// is watching.
// Only `infinite` animations are paused — a pack reveal or a slot tumble is a
// one-shot whose `animationend` a state machine is waiting on, and freezing one
// mid-flight would hang it. ponytail: no marker class, the timing IS the tell.
let ambientPaused = false;
function setAmbient(paused) {
  ambientPaused = paused;
  for (const a of document.getAnimations()) {
    if (a.effect?.getTiming?.().iterations !== Infinity) continue;
    if (paused) a.pause();
    else if (a.playState === 'paused') a.play();
  }
}
window.addEventListener('blur', () => setAmbient(true));
window.addEventListener('focus', () => setAmbient(false));
// A re-render while blurred (a sync landing, a timer rolling over) starts fresh
// animations that missed the sweep; catch them as they start rather than polling.
document.addEventListener('animationstart', () => { if (ambientPaused) setAmbient(true); }, true);
if (!document.hasFocus()) setAmbient(true);   // launched behind the game window
for (const el of [panel, rail]) {
  el.addEventListener('mousemove', () => sendInteractive(true));
  el.addEventListener('mouseleave', () => sendInteractive(false));
}
panel.addEventListener('mouseleave', () => hidePreview());   // lazy: hidePreview is a const defined further down
// Fullscreen only: double-click the (drag-region) header to fill the work area / restore.
document.querySelector('.panel-header').addEventListener('dblclick', (e) => {
  if (!document.body.classList.contains('fullscreen') || e.target.closest('.hdr-btn, .hdr-play')) return;
  ipcRenderer.send('toggle-maximize');
});
// Three user layouts: docked/on-top panel, icon rail, and fullscreen standalone
// window (placement 'docked'|'ontop'|'rail'|'full', chosen by main).
let curPlacement = null;
const FULL_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/></svg>';
const DOCK_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v4H4M12 16v-4h4M8 4l-4 4M12 16l4-4"/></svg>';
const fullBtn = document.getElementById('full-btn');
ipcRenderer.on('placement', (_e, p) => {
  curPlacement = p;
  rail.hidden = p !== 'rail';
  panel.hidden = p === 'rail';
  document.body.classList.toggle('fullscreen', p === 'full');
  recettesReady = false;   // its filters render folded or open depending on the layout — rebuild on next open
  // Animate the incoming surface (CSS .pop) — the window itself just snapped.
  const surf = p === 'rail' ? rail : panel;
  surf.classList.remove('pop'); void surf.offsetWidth; surf.classList.add('pop');
  fullBtn.innerHTML = p === 'full' ? DOCK_SVG : FULL_SVG;
  fullBtn.title = p === 'full' ? (T().tips || STR.en.tips).dock : (T().tips || STR.en.tips).fullscreen;
  updateResizable();
});
// Fullscreen toggle: expand to the standalone window, or dock back to the panel.
fullBtn.addEventListener('click', () => ipcRenderer.send('set-layout', curPlacement === 'full' ? 'panel' : 'full'));

// Edge-drag resize: enable the grips for the two resizable windows (launcher and
// fullscreen), and drive main's setBounds from absolute screen mouse positions.
function updateResizable() {
  const on = document.body.classList.contains('fullscreen') || !document.getElementById('launcher').hidden;
  document.body.classList.toggle('win-resizable', on);
}
document.querySelectorAll('.wgrip').forEach((g) => {
  const edges = g.dataset.edges.split(',');
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    ipcRenderer.send('resize-start', { edges, x: e.screenX, y: e.screenY });
  });
  g.addEventListener('pointermove', (e) => {
    if (!g.hasPointerCapture(e.pointerId)) return;
    ipcRenderer.send('resize-move', { x: e.screenX, y: e.screenY });
  });
  const end = (e) => { if (g.hasPointerCapture(e.pointerId)) { g.releasePointerCapture(e.pointerId); ipcRenderer.send('resize-end'); } };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
});
// Minimize the fullscreen standalone window to the taskbar (Windows/macOS).
document.getElementById('min-btn').addEventListener('click', () => ipcRenderer.send('minimize'));
// Collapse chevron (panel header, any layout): shrink to the icon rail.
document.getElementById('collapse-btn').addEventListener('click', () => {
  goHome();
  ipcRenderer.send('set-layout', 'rail');
});

// External links open in the system browser — never navigate the panel itself.
// Treat every href as untrusted because the feed is remote content; escaping HTML
// does not make a javascript: URL safe.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault();
  try {
    const url = new URL(a.href);
    if (url.protocol === 'https:' || url.protocol === 'http:') shell.openExternal(url.href);
  } catch { /* malformed links do nothing */ }
});

// Single delegate for all item/quest navigation — the whole cross-linking
// mechanism. Item links in quest/guide/event prose route here too.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-item-id],[data-q],[data-guide],[data-mob-id]');
  if (!t) return;
  hidePreview();
  if (t.dataset.itemId) openItemPage(+t.dataset.itemId);
  else if (t.dataset.mobId) openMob(D.mobs().find((m) => m.id === +t.dataset.mobId));
  else if (t.dataset.q) openQuest(D.questsByGameId.get(+t.dataset.q));
  else openGuide(D.guidesIndex[+t.dataset.guide]);
});

// Hover preview for inline item links. Follows the cursor, anchored to its
// left; clamped to stay inside the narrow overlay window. Click still navigates.
const preview = document.getElementById('item-preview');
let previewId = null;
const hidePreview = () => { preview.hidden = true; previewId = null; };
function positionPreview(x, y) {
  let right = Math.min(window.innerWidth - x + 14, window.innerWidth - preview.offsetWidth - 6);
  preview.style.right = Math.max(6, right) + 'px';
  preview.style.top = Math.max(6, Math.min(y - 12, window.innerHeight - preview.offsetHeight - 6)) + 'px';
}
document.addEventListener('mousemove', (e) => {
  const link = e.target.closest('.item-link,.loot-slot--link');
  if (!link) { if (!preview.hidden) hidePreview(); return; }
  const id = +link.dataset.itemId;
  if (id !== previewId) {
    const it = D.itemsById.get(id);
    if (!it) return hidePreview();
    previewId = id; preview.innerHTML = itemPreviewHtml(it); preview.hidden = false;
  }
  positionPreview(e.clientX, e.clientY);
});

// Apply persisted panel width/colors/font/scale before first paint.
Object.keys(COLOR_SLOTS).forEach((s) => applyColor(s, customColor(s)));
applyFont(font);
if (uiScale !== 100) applyScale(uiScale);
document.getElementById('hdr-ver').textContent = 'v' + require('../package.json').version;   // fullscreen top-bar wordmark
ipcRenderer.send('panel-width', panelWidth);
ipcRenderer.send('game-dir', gameDir());   // launch() uses the persisted folder, if any

renderHome(); renderRail();   // home feed renders via goHome() below
// Section bodies are populated by ensureSection() on first open.
initShouts(); initLauncher(); initNotifLog(); updateChrome(); renderPlaytime();
// Seed the main process's canonical copy of local progress — it survives a
// localStorage wipe, and it is what an export writes from.
ipcRenderer.invoke('progress-sync-local', progressPayload())
  .catch((err) => console.warn('[progress] local sync failed:', err.message || err));
const resumeSection = sessionStorage.getItem(PROGRESS_RESUME_SECTION);
sessionStorage.removeItem(PROGRESS_RESUME_SECTION);
if (resumeSection && SECTION_IDS.includes(resumeSection)) openSection(resumeSection);
else goHome();   // recettes renders lazily on first open (see openSection)
