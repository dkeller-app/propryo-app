/**
 * js/core/edl-voix-vues.js — VUES de la dictée d'EDL (chantier EDL-VOIX-IA, lots B1 à B3).
 *
 * Fonctions PURES qui rendent du HTML (chaînes) d'après un état : le monolithe ne fait que les afficher
 * dans la couche #edl-voix et brancher les gestes (fonctions globales _edlVoix…). Maquette validée le
 * 13/10 (mockups/EDL-VOIX-IA/maquette.html) : téléphone = page plein écran (M-16), tablette = feuille,
 * PC = dialogue ; le CSS choisit, le HTML est le même.
 *
 * Règles de charte tenues ici et vérifiées par test : ton neutre (M-13), jamais d'icône seule (M-10),
 * line-icons (M-9), une seule action primaire par vue (M-4), aucun texte coupé (M-14).
 * `ic(nom, taille)` = _uiIcon de l'app (injecté) ; tout texte variable passe par esc().
 * Les gestes n'utilisent JAMAIS un nom en « edl[A-Z]… » : ce préfixe déclenche l'autosave au clic.
 */
import { MENTION_PROPOSITION, BANDEAU_PROPOSITIONS } from './ia-transparence.js';

export function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** Identifiant placé dans un onclick (chaîne JS dans un attribut) : liste blanche stricte, jamais d’échappement HTML
 *  (le navigateur redécode les entités avant d’exécuter le JS). Ids = UUID locaux, clés p:/a:/c:. */
export function jsId(s) { return String(s == null ? '' : s).replace(/[^\w:-]/g, ''); }
export function duree(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const btn = (cls, onclick, contenu, extra = '') => `<button type="button" class="btn ${cls}" onclick="${onclick}"${extra}>${contenu}</button>`;
const pri = (onclick, contenu, extra) => btn('evx-pri', onclick, contenu, extra);
const sec = (onclick, contenu, extra) => btn('evx-sec', onclick, contenu, extra);

/** Barre « Dicter la pièce » en tête d'une pièce (téléphone / tablette). */
export function barrePiece(pi, { ic }) {
  return `<div class="evx-bar"><div class="evx-bar-tx"><b>Décrire la pièce à voix haute</b>L’IA propose un état et une observation par élément ; chaque ligne se valide.</div>`
    + `<button type="button" class="btn evx-out" onclick="_edlVoixDicter(${Number(pi)})">${ic('mic')} Dicter la pièce</button></div>`;
}
/** Bouton de l'en-tête de pièce (PC, tableau dense). */
export function boutonPiecePC(pi, { ic }) {
  return `<button type="button" class="btn bs bb evx-pc" onclick="_edlVoixDicter(${Number(pi)})">${ic('mic')} Dicter la pièce</button>`;
}
/** Barre des relevés (étape Compteurs). */
export function barreCompteurs({ ic }) {
  return `<div class="evx-bar"><div class="evx-bar-tx"><b>Dicter les relevés</b>Dire le compteur puis l’index. Chaque valeur se valide une par une.</div>`
    + `<button type="button" class="btn evx-out" onclick="_edlVoixDicterCompteurs()">${ic('mic')} Dicter les relevés</button></div>`;
}

export function vueNotice(n, { ic }) {
  const corps = `<div class="evx-nt"><p class="evx-lead">${esc(n.intro)}</p>`
    + n.sections.map((s) => `<h3>${ic(s.icone)} ${esc(s.titre)}</h3><p>${esc(s.texte)}</p>`).join('')
    + '</div>';
  return { titre: n.titre, sousTitre: n.sousTitre, corps, pied: sec('_edlVoixFermer()', 'Pas maintenant') + pri('_edlVoixNoticeOk()', 'Commencer'), ferme: 'close' };
}

/** Enregistrement en cours ou en pause. */
export function vueEnregistrement({ piece, mode, sec: s = 0, max = 300, pause = false, elements = [], cible = 'piece' }, { ic }) {
  const conseil = cible === 'compteurs'
    ? '<div class="evx-tip"><b>Pour chaque compteur : le nommer, puis dire l’index.</b> Par exemple : <q>Compteur électrique heures pleines 12 345, heures creuses 6 789, eau froide 456 virgule 3.</q></div>'
    : '<div class="evx-tip"><b>Pour chaque élément : le nommer, dire l’état, décrire.</b> Par exemple : <q>Sol, carrelage, bon état, un carreau fêlé près de la porte.</q> Les états reconnus : neuf, bon état, état d’usage, mauvais état, absent.</div>';
  const liste = elements.length
    ? `<div class="evx-tip"><b>Éléments de la pièce</b> (${elements.length})<div class="evx-elist">${elements.map((e) => `<span>${esc(e)}</span>`).join('')}</div></div>`
    : '';
  const corps = `<div class="evx-rec"><span class="evx-dot${pause ? ' p' : ''}"><i></i>${pause ? 'En pause' : 'Enregistrement en cours'}</span>`
    + `<div class="evx-timer" id="evx-timer">${duree(s)}</div><div class="evx-max">${duree(max)} au plus par dictée</div>`
    + `<div class="evx-niv" aria-hidden="true"><i id="evx-niv"></i></div></div>${conseil}${liste}`;
  const pied = sec('_edlVoixPause()', pause ? `${ic('play')} Reprendre` : `${ic('pause')} Pause`)
    + pri('_edlVoixTerminer()', `${ic('check')} Terminer et analyser`);
  return { titre: `Dicter · ${piece}`, sousTitre: mode === 'sortie' ? 'État des lieux de sortie' : 'État des lieux d’entrée', corps, pied, ferme: 'close', fermeLibelle: 'Abandonner la dictée' };
}

/** Attente honnête (M-11) : 3 étapes visibles. etape ∈ envoi | transcription | propositions | attente */
export function vueAnalyse({ piece, duree: d = 0, ko = 0, etape = 'transcription' }, { ic }) {
  const ordre = ['envoi', 'transcription', 'propositions'];
  const i = Math.max(0, ordre.indexOf(etape));
  const li = (k, txt, sous) => {
    const j = ordre.indexOf(k);
    const cl = j < i ? 'ok' : j === i ? 'run' : 'todo';
    const pic = cl === 'ok' ? ic('check') : cl === 'run' ? '<span class="evx-spin"></span>' : '';
    return `<li class="${cl}"><span class="evx-ic">${pic}</span><div><b>${txt}</b>${sous ? `<small>${sous}</small>` : ''}</div></li>`;
  };
  const corps = `<ul class="evx-steps">${li('envoi', 'Dictée enregistrée', `${duree(d)}${ko ? ` · ${ko} Ko` : ''}`)}${li('transcription', i > 1 ? 'Transcription faite' : 'Transcription en cours', i === 1 ? 'Quelques secondes' : '')}${li('propositions', 'Préparation des propositions', '')}</ul>`
    + '<p class="evx-note">L’état des lieux reste utilisable pendant l’analyse. Un bandeau dans la pièce prévient quand les propositions sont prêtes.</p>';
  return { titre: `Analyse · ${piece}`, corps, pied: sec('_edlVoixFermer()', 'Revenir à l’état des lieux'), ferme: 'close' };
}

/** Échec (M-12 : visuel + texte + une action au plus) ; la saisie manuelle reste rappelée. */
export function vueErreur({ titre, texte, icone = 'warn', action = null, lien = null, piece = 'Pièce' }, { ic }) {
  const corps = `<div class="evx-emp"><div class="evx-pic">${ic(icone)}</div><h3>${esc(titre)}</h3><p>${esc(texte)}</p>`
    + '<p class="evx-man">La saisie à la main reste disponible.</p>'
    + (lien ? `<button type="button" class="evx-lnk" onclick="${lien.onclick}">${esc(lien.libelle)}</button>` : '')
    + '</div>';
  const pied = sec('_edlVoixFermer()', 'Revenir à l’état des lieux') + (action ? pri(action.onclick, `${action.icone ? ic(action.icone) + ' ' : ''}${esc(action.libelle)}`) : '');
  return { titre: `Dicter · ${piece}`, corps, pied, ferme: 'close' };
}

/** Bandeau d'une dictée dans la pièce (attente réseau, analyse, prête, erreur). */
export function banniere(item, { ic, message }) {
  const d = duree(item.duree || item.audioSec || 0);
  const id = jsId(item.id);
  if (item.etape === 'pret') {
    const r = item.resultat || {};
    const n = (r.propositions || []).length + (r.compteurs || []).length;
    const dec = item.decisions || {};
    const faites = Object.values(dec).filter(Boolean).length;
    const reste = Math.max(0, n + (r.aAjouter || []).length - faites);
    return `<div class="evx-ban ready">${ic('sparkle')}<div><b>Propositions prêtes : ${n} ${item.cible === 'compteurs' ? 'relevé' : 'élément'}${n > 1 ? 's' : ''}</b>Dictée de ${d}${faites ? ` · ${reste} à valider` : ''}.`
      + `<div class="evx-bx"><button type="button" class="btn evx-pri" onclick="_edlVoixRelire('${id}')">Relire les propositions</button></div></div></div>`;
  }
  if (item.erreur) {
    const m = message(item.erreur.code, item.erreur);
    const actions = (m.reessayable || !['too_large', 'format'].includes(item.erreur.code))
      ? `<button type="button" class="btn evx-sec" onclick="_edlVoixReessayer('${id}')">${ic('refresh')} Réessayer</button>`
      : '';
    return `<div class="evx-ban ${item.erreur.code === 'offline' ? 'wait' : 'err'}">${ic(item.erreur.code === 'offline' ? 'cloud' : 'warn')}<div><b>${esc(m.titre)}</b>${esc(m.texte)}`
      + `<div class="evx-bx">${actions}<button type="button" class="btn evx-sec" onclick="_edlVoixSupprimer('${id}')">${ic('trash')} Supprimer la dictée</button></div></div></div>`;
  }
  const filmee = Array.isArray(item.images) && item.images.length > 0;
  return `<div class="evx-ban wait">${ic('hourglass')}<div><b>Analyse ${filmee ? 'de la vidéo' : 'de la dictée'} (${d})</b>${item.etape === 'texte' ? 'Préparation des propositions.' : item.etape === 'images' ? 'Préparation des photos.' : 'Transcription en cours.'} L’état des lieux reste modifiable à la main.</div></div>`;
}


// ════════════════════════════════════════════════════════════════════════════════════════════════
// LOT B2 — relecture des propositions (Accepter / Modifier / Ignorer), lot B3 — relevés.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const ETATS = ['Neuf', 'Bon état', "État d'usage", 'Mauvais état', 'Absent'];
const KEYS = ['neuf', 'bon', 'usage', 'mauvais', 'absent'];
export function pastille(etat) {
  const i = ETATS.indexOf(etat);
  return i < 0 ? '<span class="evx-pas none">État non dicté</span>' : `<span class="evx-pas" data-e="${KEYS[i]}">${esc(etat)}</span>`;
}
const iaMark = (ic) => `<div class="evx-iamark">${ic('sparkle')} ${esc(MENTION_PROPOSITION)}</div>`;
const chip = (statut) => (statut === 'ok' ? '<span class="evx-chip ok">Inscrit</span>' : statut === 'ign' ? '<span class="evx-chip ign">Ignoré</span>' : '<span class="evx-chip">À valider</span>');
const q = (id, cle) => `'${jsId(id)}','${jsId(cle)}'`;

function actions(id, cle, statut, { ic, ajout = false, bloque = null, okTexte = 'Inscrit dans l’état des lieux.' }) {
  if (statut === 'ok') return `<div class="evx-done">${ic('check')} ${okTexte}<button type="button" class="btn evx-sec" onclick="_edlVoixAnnuler(${q(id, cle)})">Annuler</button></div>`;
  if (statut === 'ign') return `<div class="evx-done">Proposition écartée, rien n’a changé.<button type="button" class="btn evx-sec" onclick="_edlVoixRetablir(${q(id, cle)})">Rétablir</button></div>`;
  if (bloque) return `<div class="evx-done">${esc(bloque)}<button type="button" class="btn evx-sec" onclick="_edlVoixIgnorer(${q(id, cle)})">Ignorer</button></div>`;
  const acc = ajout
    ? `<button type="button" class="btn evx-out" onclick="_edlVoixAjouter(${q(id, cle)})">${ic('plus')} Ajouter à la pièce</button>`
    : `<button type="button" class="btn evx-out" onclick="_edlVoixAccepter(${q(id, cle)})">${ic('check')} Accepter</button>`
      + `<button type="button" class="btn evx-sec" onclick="_edlVoixModifier(${q(id, cle)})">${ic('edit')} Modifier</button>`;
  return `<div class="evx-acts">${acc}<button type="button" class="btn evx-sec" onclick="_edlVoixIgnorer(${q(id, cle)})">${ic('close')} Ignorer</button></div>`;
}

const ancre = (cle) => 'evx-c-' + String(cle).replace(/[^a-z0-9-]/gi, '_');

function carteProposition(id, l, sortie, { ic, photos = null }) {
  const p = l.prop;
  const corr = l.corrections.map((k) => `<span class="evx-cor">Compris : <s>${esc(k.entendu)}</s> → ${esc(k.compris)}</span>`).join('');
  const eref = l.entreeRef ? `<div class="evx-eref">${ic('lock')} Entrée signée : ${l.entreeRef.etat ? pastille(l.entreeRef.etat) : 'non renseigné'}${l.entreeRef.obs ? ` <i>${esc(l.entreeRef.obs)}</i>` : ''}</div>` : '';
  const why = p.etat && p.justification ? `<div class="evx-why">${ic('info')} ${esc(p.justification)}</div>` : '';
  const verif = p.aVerifier ? `<div class="evx-verif">${ic('warn')} ${esc(p.aVerifier)}</div>` : '';
  const repl = l.remplace && l.remplace.oui
    ? `<div class="evx-repl">${ic('info')} Remplace la saisie actuelle : ${[l.remplace.etat ? esc(l.remplace.etat) : '', l.remplace.obs ? `« ${esc(l.remplace.obs)} »` : ''].filter(Boolean).join(' · ')}.</div>` : '';
  const intro = l.introuvable ? '<div class="evx-verif">Cet élément n’existe plus dans la pièce : la proposition ne peut pas s’inscrire.</div>' : '';
  return `<div class="evx-card${l.statut === 'ign' ? ' ign' : ''}" id="${ancre(l.cle)}"><div class="evx-hd"><div class="evx-nm">${esc(l.nom)}</div>${chip(l.statut)}</div>${eref}`
    + `<div class="evx-kv"><span class="k">${sortie ? 'Sortie' : 'État'}</span><span class="v">${pastille(p.etat)}</span>`
    + `<span class="k">Obs.</span><span class="v evx-obs">${p.observation ? esc(p.observation) : '<span class="evx-t3">Aucune observation proposée</span>'}</span>`
    + `<span class="k">Entendu</span><span class="v evx-src">« ${esc(p.source)} »${corr}</span></div>`
    + why + verif + repl + intro + (photos ? photos(l) : '') + iaMark(ic)
    + (l.introuvable ? actions(id, l.cle, l.statut, { ic, bloque: 'Proposition non inscrite.' }) : actions(id, l.cle, l.statut, { ic })) + '</div>';
}

function carteAjout(id, x, { ic }) {
  const a = x.a;
  return `<div class="evx-card${x.statut === 'ign' ? ' ign' : ''}" id="${ancre(x.cle)}"><div class="evx-hd"><div class="evx-nm">${esc(a.nom)}</div>${x.statut ? chip(x.statut) : '<span class="evx-chip">À ajouter ?</span>'}</div>`
    + `<div class="evx-kv">${a.etat ? `<span class="k">État</span><span class="v">${pastille(a.etat)}</span>` : ''}<span class="k">Obs.</span><span class="v evx-obs">${a.observation ? esc(a.observation) : '<span class="evx-t3">Aucune observation proposée</span>'}</span>`
    + `<span class="k">Entendu</span><span class="v evx-src">« ${esc(a.source)} »</span></div>`
    + `<div class="evx-iamark">${ic('sparkle')} ${esc(MENTION_PROPOSITION)} · absent de la liste de la pièce</div>`
    + actions(id, x.cle, x.statut, { ic, ajout: true, okTexte: 'Ajouté à la pièce.' }) + '</div>';
}

const RAISONS_COMPTEUR = { numero_deja_note: 'Numéro déjà noté : il ne change pas entre l’entrée et la sortie.', numero_entree: 'Le numéro de compteur se note dans la colonne d’entrée, à la main.', signe: 'État des lieux signé.', cle: 'Compteur inconnu.' };
function carteCompteur(id, x, { ic }) {
  const k = x.k;
  return `<div class="evx-card${x.statut === 'ign' ? ' ign' : ''}" id="${ancre(x.cle)}"><div class="evx-hd"><div class="evx-nm">${esc(x.libelle)}</div>${chip(x.statut)}</div>`
    + (x.entree ? `<div class="evx-eref">${ic('lock')} Entrée signée : <b class="evx-num">${esc(x.entree)}</b></div>` : '')
    + `<div class="evx-big">${esc(x.valeur)}</div><div class="evx-src">Entendu : « ${esc(k.source)} »</div>`
    + (k.aVerifier ? `<div class="evx-verif">${ic('warn')} ${esc(k.aVerifier)}</div>` : '')
    + (x.remplace && !x.statut ? `<div class="evx-repl">${ic('info')} Remplace le relevé actuel : ${esc(x.actuel)}.</div>` : '')
    + iaMark(ic)
    + actions(id, x.cle, x.statut, { ic, bloque: x.bloque ? RAISONS_COMPTEUR[x.bloque] || 'Relevé non inscriptible.' : null, okTexte: 'Inscrit dans le relevé.' }) + '</div>';
}

/** Écran des propositions. `m` = EdlDictee.modeleRelecture(...).
 *  État des lieux filmé (EDL-VIDEO-IA) : `photos(l)` ajoute les vignettes de la vidéo à chaque carte,
 *  `vus` = cartes « vu à l'image, pas dit » (HTML déjà rendu), `video` = libellés de la prise. */
export function vuePropositions({ item, m, piece, sortie, duree: d, photos = null, vus = '', video = false }, { ic }) {
  const id = item.id;
  const b = m.bilan;
  const compteursSeuls = !m.lignes.length && !m.ajouts.length && m.compteurs.length;
  let corps = `<div class="evx-ia">${ic('sparkle')}<div><b>${esc(BANDEAU_PROPOSITIONS.titre)}</b> ${esc(BANDEAU_PROPOSITIONS.texte)}${video ? ' Les photos sont des images de la vidéo, non retouchées.' : ''}`
    + (item.texte ? `<button type="button" class="evx-lnk" onclick="_edlVoixTranscription('${jsId(id)}')">Voir la transcription</button>` : '') + '</div></div>'
    + `<div class="evx-sum"><span class="evx-chip"><b>${b.total}</b> proposition${b.total > 1 ? 's' : ''}</span><span class="evx-chip"><b>${b.inscrites}</b> inscrite${b.inscrites > 1 ? 's' : ''}</span>`
    + `<span class="evx-chip"><b>${b.ignorees}</b> ignorée${b.ignorees > 1 ? 's' : ''}</span><span class="evx-chip"><b>${b.aValider}</b> à valider</span></div>`;
  if (!b.total && !vus) {
    corps += `<div class="evx-emp"><div class="evx-pic">${ic('info')}</div><h3>Aucun élément reconnu</h3><p>La dictée ne cite aucun élément de la pièce de façon exploitable. Rien n’a été modifié.</p></div>`;
  }
  corps += m.lignes.map((l) => carteProposition(id, l, sortie, { ic, photos })).join('');
  if (vus) corps += '<div class="evx-sect">Vu à l’image, pas dit · aucun état proposé</div>' + vus;
  if (m.ajouts.length) corps += '<div class="evx-sect">Cité mais absent de la liste de la pièce</div>' + m.ajouts.map((x) => carteAjout(id, x, { ic })).join('');
  if (m.compteurs.length) corps += '<div class="evx-sect">Relevés de compteurs · validation une par une</div>' + m.compteurs.map((x) => carteCompteur(id, x, { ic })).join('');
  if (m.nonCites.length) corps += `<div class="evx-sect">Non cités · laissés tels quels (${m.nonCites.length})</div><div class="evx-nc">${m.nonCites.map(esc).join(' · ')}<small>Aucune valeur n’est touchée sur ces éléments.</small></div>`;
  const pied = (m.enAttente > 1 ? sec(`_edlVoixToutAccepter('${jsId(id)}')`, 'Tout accepter') : '') + pri(`_edlVoixFinRelecture('${jsId(id)}')`, 'Terminer la relecture');
  return { titre: compteursSeuls ? 'Relevés dictés' : `Propositions · ${piece}`, sousTitre: `${video ? 'Vidéo' : 'Dictée'} de ${duree(d)} · ${sortie ? 'sortie' : 'entrée'}`, corps, pied, ferme: 'close' };
}

/** Modifier une proposition avant de l'inscrire (état + observation ; ou valeur d'un relevé). */
export function vueModifier({ id, cle, nom, prop, sortie, entreeRef, note = false, compteur = null }, { ic }) {
  let corps;
  if (compteur) {
    corps = `<div class="evx-ia evx-ia-ref">${ic('sparkle')}<div><b>Proposition de l’IA</b><div class="evx-big">${esc(compteur.valeur)}</div><span class="evx-src">Entendu : « ${esc(compteur.source)} »</span></div></div>`
      + `<label class="evx-lab" for="evx-val">${esc(compteur.libelle)}</label><input class="evx-fld" id="evx-val" type="text" inputmode="${compteur.numero ? 'text' : 'decimal'}" value="${esc(compteur.valeur)}">`;
  } else {
    const boutons = ETATS.map((e, i) => `<button type="button" class="evx-st" data-e="${KEYS[i]}" data-etat="${esc(e)}" aria-pressed="${prop.etat === e ? 'true' : 'false'}" onclick="_edlVoixModEtat(this)">${esc(e)}</button>`).join('');
    corps = `<div class="evx-ia evx-ia-ref">${ic('sparkle')}<div><b>Proposition de l’IA</b><div>${pastille(prop.etat)}</div>${prop.observation ? `<div>${esc(prop.observation)}</div>` : ''}<span class="evx-src">Entendu : « ${esc(prop.source)} »</span></div></div>`
      + (entreeRef ? `<div class="evx-eref">${ic('lock')} Entrée signée : ${entreeRef.etat ? pastille(entreeRef.etat) : 'non renseigné'}${entreeRef.obs ? ` <i>${esc(entreeRef.obs)}</i>` : ''}</div>` : '')
      + (note ? '' : `<div class="evx-lab">${sortie ? 'État constaté à la sortie' : 'État'}</div><div class="evx-sts">${boutons}<button type="button" class="evx-st" data-etat="" aria-pressed="${prop.etat ? 'false' : 'true'}" onclick="_edlVoixModEtat(this)">Aucun</button></div>`)
      + `<label class="evx-lab" for="evx-obs">Observation</label><textarea class="evx-fld" id="evx-obs" rows="3">${esc(prop.observation || '')}</textarea>`;
  }
  corps += '<p class="evx-note">La version corrigée remplace la proposition. L’inscription reste annulable depuis la liste.</p>';
  return { titre: `Modifier · ${nom}`, sousTitre: 'Proposition à corriger', corps, pied: sec(`_edlVoixRelire('${jsId(id)}')`, 'Annuler') + pri(`_edlVoixModInscrire(${q(id, cle)})`, 'Inscrire'), ferme: 'back' };
}

/** Confirmation de « Tout accepter » : compte, nomme les remplacements et les « à vérifier ». */
export function vueToutAccepter({ id, m, piece }, { ic }) {
  const att = m.lignes.filter((l) => !l.statut && !l.introuvable);
  const rep = att.filter((l) => l.remplace && l.remplace.oui);
  const ver = att.filter((l) => l.prop.aVerifier);
  let corps = `<div class="evx-emp evx-emp-top"><div class="evx-pic">${ic('checkbox')}</div><h3>Inscrire les ${att.length} propositions en attente ?</h3><p>Elles seront inscrites dans l’état des lieux de la pièce « ${esc(piece)} ». Chacune reste annulable depuis la liste.</p></div>`;
  if (rep.length) corps += `<div class="evx-sect">Remplacent une saisie existante (${rep.length})</div><div class="evx-nc">${rep.map((l) => `<b>${esc(l.nom)}</b> : ${[l.remplace.etat ? `${esc(l.remplace.etat)} → ${esc(l.prop.etat)}` : '', l.remplace.obs ? `« ${esc(l.remplace.obs)} » → « ${esc(l.prop.observation)} »` : ''].filter(Boolean).join(' · ')}`).join('<br>')}</div>`;
  if (ver.length) corps += `<div class="evx-sect">Marquées « à vérifier » (${ver.length})</div><div class="evx-nc">${ver.map((l) => `<b>${esc(l.nom)}</b> : ${esc(l.prop.aVerifier)}`).join('<br>')}</div>`;
  if (m.ajouts.some((x) => !x.statut) || m.compteurs.some((x) => !x.statut)) corps += '<p class="evx-note">Les éléments à ajouter et les relevés de compteurs ne sont pas concernés : ils se confirment un par un.</p>';
  return { titre: 'Tout accepter', corps, pied: sec(`_edlVoixRelire('${jsId(id)}')`, 'Revenir') + pri(`_edlVoixToutInscrire('${jsId(id)}')`, 'Tout inscrire'), ferme: 'back' };
}

/** Transcription complète, horodatée, passages corrigés surlignés. */
export function vueTranscription({ item }, { ic }) {
  const corr = ((item.resultat || {}).corrections) || [];
  const surligne = (t) => {
    let h = esc(t);
    for (const k of corr) { const e = esc(k.entendu); if (e) h = h.split(e).join(`<mark>${e}</mark>`); }
    return h;
  };
  const segs = (item.segments && item.segments.length) ? item.segments : [{ start: 0, text: item.texte || '' }];
  const date = item.cree ? new Date(item.cree) : null;
  const quand = date && !isNaN(date) ? `${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : '';
  const corps = `<div class="evx-meta">Dictée${quand ? ` du ${quand}` : ''} · ${duree(item.duree || item.audioSec || 0)} · enregistrement supprimé</div>`
    + `<div class="evx-tr">${segs.map((s) => `<div class="evx-trl"><span>${duree(s.start)}</span><span>${surligne(s.text)}</span></div>`).join('')}</div>`
    + (corr.length ? `<div class="evx-sect">Corrections proposées</div><div class="evx-nc">${corr.map((k) => `« ${esc(k.entendu)} » → ${esc(k.compris)}`).join('<br>')}</div>` : '')
    + '<p class="evx-note">La transcription reste sur cet appareil jusqu’à la fin de la relecture, puis est effacée. Elle n’entre pas dans l’état des lieux.</p>';
  return { titre: `Transcription · ${(item.contexte || {}).pieceNom || 'Pièce'}`, corps, pied: pri(`_edlVoixRelire('${jsId(item.id)}')`, 'Retour aux propositions'), ferme: 'back' };
}
