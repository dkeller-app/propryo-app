/**
 * core/assistant-aide.js — ASSISTANT D'AIDE : moteur LOCAL et SOUVERAIN de réponse à une question
 * sur l'UTILISATION de l'app (comment / où faire un geste). Décisions figées par Didier :
 *  - périmètre : l'app seulement (pas de questions générales) ;
 *  - moteur : correspondance de mots-clés + synonymes + flou léger, quelques Ko, dans le navigateur ;
 *    AUCUN appel réseau, AUCUNE donnée envoyée, AUCUN modèle lourd (pas d'embeddings) ;
 *  - garde-fous : hors base → « je ne sais pas → support » ; question de DROIT / FISCALITÉ
 *    (préavis, plafonds, dépôt de garantie, délais légaux…) → renvoi vers la loi citée dans l'écran
 *    ou le support, JAMAIS de réponse inventée.
 *
 * Module PUR : ni DB globale ni DOM. `repondre(question, corpus)` est déterministe et exportée pour
 * les tests ; l'UI (js/app/assistant-aide-app.js) l'appelle et affiche la fiche. Pattern identique à
 * core/premiers-pas.js : exports ESM nommés, importés par l'app-glue et par la suite de tests.
 */

// ─────────────────────────── Normalisation ───────────────────────────
// NFD + suppression des diacritiques (accents) : « créer » et « creer » tombent sur la même forme.
// On ne garde que lettres/chiffres ; tout le reste devient une espace (ponctuation, apostrophes…).
export function normaliser(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Mots sans valeur discriminante : retirés avant le calcul du score (sinon « comment » ou « faire »
// matcheraient partout). On garde length > 2 ET hors de cette liste.
export const MOTS_VIDES = new Set([
  'comment', 'quel', 'quelle', 'quels', 'quelles', 'faire', 'fait', 'faut', 'voir', 'aller',
  'mettre', 'trouve', 'trouver', 'puis', 'peut', 'peux', 'veux', 'veut', 'dois', 'doit',
  'pour', 'avec', 'sur', 'dans', 'par', 'une', 'des', 'les', 'mon', 'mes', 'ses', 'son',
  'nos', 'leur', 'cette', 'est', 'sont', 'suis', 'etre', 'avoir', 'cela', 'donc',
  'mais', 'plus', 'tout', 'tous', 'toute', 'toutes', 'aussi', 'bien', 'chez', 'vers',
  'quoi', 'qui', 'que', 'quand', 'pas', 'ici', 'app', 'propryo',
])

// Synonymes : un mot de l'utilisateur ajoute un mot « canonique » présent dans les mots-clés des fiches.
// Léger et borné : un mot → un terme canonique (jamais une fiche entière, pour préserver le seuil ≥2).
export const SYNONYMES = {
  appartement: 'logement', appart: 'logement', studio: 'logement', maison: 'logement',
  bien: 'logement', lot: 'logement', immeuble: 'logement', local: 'logement', appartements: 'logement',
  creer: 'ajouter', nouveau: 'ajouter', nouvelle: 'ajouter', ajout: 'ajouter', enregistrer: 'ajouter', saisir: 'ajouter',
  banque: 'releve', bancaire: 'releve', compte: 'releve', fichier: 'releve', ofx: 'releve', qfx: 'releve', xlsx: 'releve',
  recu: 'quittance', recus: 'quittance', quittances: 'quittance',
  augmenter: 'revision', augmentation: 'revision', indexer: 'revision', indexation: 'revision',
  indice: 'revision', reviser: 'revision', irl: 'revision',
  regulariser: 'regularisation', regul: 'regularisation', decompte: 'regularisation', provisions: 'regularisation',
  edl: 'etatdeslieux', constat: 'etatdeslieux',
  associe: 'partage', inviter: 'partage', invitation: 'partage', collaborer: 'partage', collaborateur: 'partage',
  sombre: 'theme', clair: 'theme', nuit: 'theme', couleur: 'theme', affichage: 'theme', apparence: 'theme',
  sauvegarde: 'export', sauvegarder: 'export', exporter: 'export', zip: 'export', comptable: 'export',
  retard: 'impaye', impayes: 'impaye', impayees: 'impaye', du: 'impaye', doivent: 'impaye',
  signer: 'signature', signe: 'signature', signatures: 'signature', parapher: 'signature',
  conge: 'depart', resiliation: 'depart', partir: 'depart', quitter: 'depart', sortie: 'depart',
  artisan: 'incident', plombier: 'incident', electricien: 'incident', panne: 'incident',
  reparation: 'incident', travaux: 'incident', depannage: 'incident', fuite: 'incident',
  candidat: 'candidature', candidats: 'candidature', dossier: 'candidature', postuler: 'candidature',
  mail: 'email', mails: 'email', emails: 'email', courriel: 'email', message: 'email',
  rappel: 'agenda', rappels: 'agenda', echeance: 'agenda', echeances: 'agenda', calendrier: 'agenda',
  '2044': 'finances', fiscal: 'finances', fiscalite: 'finances', impots: 'finances', impot: 'finances',
  rentabilite: 'finances', cashflow: 'finances', resultat: 'finances',
  locataires: 'locataire', bailleur: 'logement', equipement: 'incident', equipements: 'incident',
}

// ─────────────────────────── Garde juridique ───────────────────────────
// Mots sans ambiguïté possible : une question qui les contient est une question de DROIT / FISCALITÉ.
// Elle n'appelle JAMAIS une fiche — on renvoie vers la loi citée dans l'écran ou le support (court-circuit).
export const STRONG_LEGAL = new Set([
  'preavis', 'encadrement', 'penalite', 'penalites', 'vetuste', 'prescription',
  'legal', 'legale', 'legaux', 'legales', 'legalement', 'juridique', 'juridiques',
  'loi', 'litige', 'illegal', 'droit', 'droits', 'obligatoire', 'obligation', 'obligations',
])
// Marqueurs plus faibles : ne décident que si AUCUNE fiche ne répond clairement (score < 2).
export const LEGAL_MARKERS = new Set([
  'preavis', 'delai', 'delais', 'loi', 'legal', 'legale', 'droit', 'obligation', 'obligatoire',
  'plafond', 'plafonds', 'encadrement', 'penalite', 'vetuste', 'prescription', 'litige',
  'caution', 'garantie', 'depot', 'fiscal', 'fiscalite', 'impot', 'impots', 'taxe', 'taxes',
])

// ─────────────────────────── Écrans cibles (go) ───────────────────────────
// Libellés RÉELS des onglets (vérifiés dans go()) : utilisés par le bouton « → aller à l'écran ».
export const LABELS = Object.freeze({
  accueil: 'Accueil', import: 'Import de données', mouvements: 'Mouvements', loyers: 'Loyers',
  agenda: 'Agenda', equipements: 'Équipements', baux: 'Locataires', candidats: 'Candidats',
  regul: 'Charges', edl: 'États des lieux', emails: 'E-mails', biens: 'Logements',
  finances: 'Finances', params: 'Réglages', export: 'Sauvegarde & export',
})

// ─────────────────────────── Corpus d'aide (borné, rédigé) ───────────────────────────
// Chaque fiche : { id, motsCles (mots-clés + variantes + synonymes, séparés par une espace),
//   reponse (courte ; <b> autorisé), cible (identifiant d'onglet réel de go()) }.
// Rien n'est inventé : les fiches décrivent OÙ et COMMENT faire un geste, et renvoient à l'écran.
export const CORPUS = Object.freeze([
  { id: 'logement', cible: 'biens',
    motsCles: 'logement ajouter nouveau adresse acte notarie dpe rattacher sci bailleur',
    reponse: 'Onglet <b>Logements</b> → <b>« + Ajouter »</b>. Le fil guidé part de l’adresse ou de l’acte notarié en PDF (risques et DPE retrouvés). Le logement se rattache à une SCI ou reste en nom propre.' },
  { id: 'bail', cible: 'baux',
    motsCles: 'bail locataire ajouter nouveau louer entrer loyer charges meuble vide bailmobilite etudiant',
    reponse: 'Onglet <b>Locataires</b> → <b>« Nouveau bail »</b> sur le logement concerné. Le fil crée le locataire, les dates, le loyer et les charges au contrat type, puis propose la signature.' },
  { id: 'bail-repris', cible: 'baux',
    motsCles: 'bail cours repris reprise existant achat achete deja loue anteriorite',
    reponse: 'Pour un logement acheté déjà loué : onglet <b>Locataires</b> → <b>« Reprendre un bail en cours »</b>. Le dû part de l’entrée en jouissance ; les antériorités se notent à part.' },
  { id: 'releve', cible: 'import',
    motsCles: 'releve bancaire importer import banque fichier ofx qfx xlsx mouvements',
    reponse: 'Onglet <b>Import de données</b> (ou le bouton <b>« Importer un relevé »</b> de Mouvements). Formats acceptés : <b>OFX, QFX ou XLSX</b>. Les règles d’import classent ensuite les lignes seules.' },
  { id: 'regle-import', cible: 'import',
    motsCles: 'regle import memoriser classer automatique ligne categorie rapprochement',
    reponse: 'Depuis une ligne du relevé importé, <b>« Mémoriser une règle »</b> : les lignes semblables seront classées seules aux prochains imports (catégorie, logement, locataire).' },
  { id: 'impaye', cible: 'loyers',
    motsCles: 'impaye retard loyer solde manque encaisse relance',
    reponse: 'Onglet <b>Loyers</b> : la liste montre, par locataire, le dû et l’encaissé, avec les retards en évidence. Une relance peut partir de là.' },
  { id: 'quittance', cible: 'loyers',
    motsCles: 'quittance loyer recu pdf envoyer generer mois encaisse',
    reponse: 'Onglet <b>Loyers</b> : la quittance se génère pour un mois encaissé, puis s’envoie par e-mail ou se télécharge en PDF.' },
  { id: 'revision', cible: 'loyers',
    motsCles: 'revision reviser augmenter indexer indice irl anniversaire loyer',
    reponse: 'Onglet <b>Loyers</b> : Propryo calcule la révision <b>IRL</b> à la date d’anniversaire et propose de l’appliquer — jamais d’office, jamais sur un mois déjà quittancé.' },
  { id: 'regul', cible: 'regul',
    motsCles: 'charges regularisation regulariser provisions recuperables decompte periode',
    reponse: 'Onglet <b>Charges</b> : lancer la régularisation sur la période voulue. Propryo compare provisions versées et charges réelles, puis édite le décompte.' },
  { id: 'edl-entree', cible: 'edl',
    motsCles: 'etatdeslieux edl entree piece photos constat debut emmenagement',
    reponse: 'Onglet <b>États des lieux</b> → <b>« État des lieux d’entrée »</b>, pièce par pièce, avec photos. Il peut être dicté puis signé sur l’appareil.' },
  { id: 'edl-sortie', cible: 'edl',
    motsCles: 'etatdeslieux edl sortie comparaison depart demenagement degradations',
    reponse: 'Onglet <b>États des lieux</b> → <b>« État des lieux de sortie »</b> : il reprend l’entrée pour comparer pièce par pièce et préparer le solde de tout compte.' },
  { id: 'espace-loc', cible: 'baux',
    motsCles: 'espace locataire acces lien donner compte documents signalement',
    reponse: 'Depuis le bail, <b>« Ouvrir l’espace du locataire »</b> crée un lien personnel sans mot de passe : quittances, documents signés, messages et signalement d’incident.' },
  { id: 'incident', cible: 'equipements',
    motsCles: 'incident travaux artisan panne reparation depannage fuite plombier equipement entretien plafond',
    reponse: 'Le locataire signale l’incident depuis son espace ; un artisan du carnet intervient sous le <b>plafond fixé</b> (Réglages › Artisans), au-delà son devis attend une validation. Le suivi est dans <b>Équipements & Entretiens</b>.' },
  { id: 'finances', cible: 'finances',
    motsCles: 'finances resultat cashflow rentabilite declaration 2044 fiscal fiscalite impot',
    reponse: 'Onglet <b>Finances</b> : cash-flow, résultat et aide à la déclaration <b>2044</b> sont calculés à partir des mouvements importés (jamais à la place de l’utilisateur : les montants restent vérifiables).' },
  { id: 'export', cible: 'export',
    motsCles: 'export exporter sauvegarde comptable zip dossier telecharger archive',
    reponse: 'Onglet <b>Sauvegarde & export</b> : le <b>« Dossier comptable »</b> rassemble pièces et écritures en un ZIP ; la sauvegarde JSON enregistre toutes les données du compte.' },
  { id: 'partage', cible: 'params',
    motsCles: 'partage associe inviter invitation sci acces collaborer membre',
    reponse: 'Réglages › <b>Partage</b> : inviter un associé par e-mail. Il accède aux espaces de la SCI, en lecture ou en écriture, SCI par SCI.' },
  { id: 'signature', cible: 'baux',
    motsCles: 'signature signer signe distance electronique bail parapher otp',
    reponse: 'La signature se lance depuis le bail (ou l’avenant) : sur place sur l’appareil, ou à distance par lien. Le document signé est figé et déposé dans l’espace du locataire.' },
  { id: 'avenant', cible: 'baux',
    motsCles: 'avenant modifier modification bail cours loyer changer rajouter',
    reponse: 'Depuis un bail signé, <b>« Avenant »</b> : il reprend le bail, note la modification (loyer, occupants…) et s’applique à la signature de l’avenant.' },
  { id: 'depart', cible: 'baux',
    motsCles: 'depart conge resiliation partir quitter sortie fin bail relocation',
    reponse: 'Depuis le bail, le <b>départ du locataire</b> enchaîne congé, état des lieux de sortie et solde de tout compte, puis libère le logement pour une relocation.' },
  { id: 'depot-garantie', cible: 'baux',
    motsCles: 'depot garantie caution restituer restitution rendre solde compte',
    reponse: 'Le dépôt de garantie se saisit au bail et se restitue au départ, dans le solde de tout compte (après l’état des lieux de sortie). Les montants et délais légaux sont rappelés, avec le texte de loi, dans l’écran concerné.' },
  { id: 'candidature', cible: 'candidats',
    motsCles: 'candidature candidat dossier postuler lien verifier pieces',
    reponse: 'Onglet <b>Candidats</b> : un lien de dépôt sans compte recueille les dossiers. Propryo vérifie le code 2D-Doc des pièces et signale des constats datés — la décision reste au propriétaire.' },
  { id: 'email', cible: 'emails',
    motsCles: 'email envoyer locataire modele relance message courriel',
    reponse: 'Onglet <b>E-mails</b> : les envois au locataire (quittance, relance, document) partent d’ici et sont tracés. Les modèles se réutilisent.' },
  { id: 'agenda', cible: 'agenda',
    motsCles: 'agenda rappel echeance calendrier date revision assurance',
    reponse: 'Onglet <b>Agenda</b> : révisions, fins de bail, assurances et documents à renouveler y apparaissent comme rappels datés.' },
  { id: 'theme', cible: 'params',
    motsCles: 'theme sombre clair mode couleur affichage apparence',
    reponse: 'Réglages : le <b>thème</b> (clair / sombre) se change dans les préférences d’affichage.' },
  { id: 'premiers-pas', cible: 'accueil',
    motsCles: 'premiers pas debut demarrer commencer mise route visite guidee etapes',
    reponse: 'La liste <b>« Premiers pas »</b> (barre latérale ou menu « Plus ») guide la mise en route étape par étape et relance la visite guidée. Chaque étape se coche seule.' },
  { id: 'compte', cible: 'params',
    motsCles: 'compte profil connexion identifiant nom reglages parametres',
    reponse: 'Réglages › <b>Mon profil</b> : nom, préférences et paramètres du compte. La connexion et le partage se gèrent aussi depuis les Réglages.' },
])

// ─────────────────────────── Tokenisation + score ───────────────────────────
// Mots utiles d'une question : normalisés, length > 2, hors mots vides, enrichis des synonymes.
export function motsUtiles(question) {
  const out = new Set()
  for (const w of normaliser(question).split(/\s+/)) {
    if (w.length <= 2 || MOTS_VIDES.has(w)) continue
    out.add(w)
    const syn = SYNONYMES[w]
    if (syn) out.add(syn)
  }
  return [...out]
}

// Flou léger, déterministe : deux mots « correspondent » s'ils sont égaux, ou si l'un est préfixe de
// l'autre avec au moins 4 lettres communes (pluriels, conjugaisons : logement/logements, revis…).
function correspond(a, b) {
  if (a === b) return true
  const n = Math.min(a.length, b.length)
  return n >= 4 && (a.startsWith(b) || b.startsWith(a))
}

// Score = nombre de mots-clés DISTINCTS de la fiche retrouvés dans la question.
export function score(question, motsCles) {
  const mots = motsUtiles(question)
  if (!mots.length) return 0
  let n = 0
  for (const kw of String(motsCles || '').split(/\s+/).filter(Boolean)) {
    if (mots.some((m) => correspond(m, kw))) n++
  }
  return n
}

function compteLegal(mots, ensemble) {
  let n = 0
  for (const m of mots) if (ensemble.has(m)) n++
  return n
}

// ─────────────────────────── Réponse ───────────────────────────
/**
 * @param {string} question
 * @param {Array} [corpus] — par défaut CORPUS
 * @returns {{type:'ok'|'faible'|'juridique'|'inconnu', fiche?:object}}
 *   ok       : fiche sûre (≥ 2 mots-clés) → bouton « → aller à l'écran »
 *   faible   : « réponse la plus proche » (1 seul mot-clé)
 *   juridique: question de droit / fiscalité → renvoi loi / support, JAMAIS de fiche
 *   inconnu  : hors base → « je ne sais pas → support »
 */
export function repondre(question, corpus = CORPUS) {
  const mots = motsUtiles(question)
  // Garde juridique PRIORITAIRE : un marqueur sans ambiguïté (préavis, plafond légal, « ai-je le
  // droit »…) ne renvoie jamais une fiche, même si une fiche matche par ailleurs.
  if (mots.some((m) => STRONG_LEGAL.has(m))) return { type: 'juridique' }

  let best = null, bs = 0
  for (const fiche of (corpus || [])) {
    const s = score(question, fiche.motsCles)
    if (s > bs) { bs = s; best = fiche }
  }
  if (bs >= 2) return { type: 'ok', fiche: best }
  // Pas de fiche sûre : si la question porte un marqueur juridique, on renvoie au droit plutôt qu'à une
  // fiche faible qui pourrait induire en erreur.
  if (compteLegal(mots, LEGAL_MARKERS) >= 1) return { type: 'juridique' }
  if (bs === 1) return { type: 'faible', fiche: best }
  return { type: 'inconnu' }
}

// Chips d'exemples proposés à l'ouverture (chacun matche une fiche avec un score ≥ 2).
export const AMORCES = Object.freeze([
  'Comment créer un nouveau bail ?',
  'Où voir les loyers impayés ?',
  'Comment importer un relevé bancaire ?',
  'Comment régulariser les charges ?',
])
