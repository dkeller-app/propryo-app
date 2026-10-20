/**
 * js/core/edl-video-vues.js — VUES de l'état des lieux FILMÉ (chantier EDL-VIDEO-IA).
 *
 * Même principe que edl-voix-vues.js (qu'il complète, sans le recopier) : fonctions PURES qui rendent du
 * HTML ; le monolithe les affiche dans la couche #edl-voix et branche les gestes `_edlVideo…` (jamais
 * `edl[A-Z]…`, préfixe qui déclencherait l'autosave au clic). Maquette validée par Didier le 14/10
 * (mockups/EDL-VIDEO-IA/maquette.html). Charte : ton neutre (M-13), jamais d'icône seule (M-10), une seule
 * action primaire (M-4), téléphone = page plein écran (M-16), cibles ≥ 44 px (CSS).
 * Tout texte variable passe par esc() ; les identifiants placés dans un onclick par jsId().
 */
import { esc, jsId, duree } from './edl-voix-vues.js';
import { MENTION_PROPOSITION } from './ia-transparence.js';
import { mmss } from './edl-video-images.js';

const btn = (cls, onclick, contenu, extra = '') => `<button type="button" class="btn ${cls}" onclick="${onclick}"${extra}>${contenu}</button>`;
const pri = (onclick, contenu, extra) => btn('evx-pri', onclick, contenu, extra);
const sec = (onclick, contenu, extra) => btn('evx-sec', onclick, contenu, extra);
const q = (...a) => a.map((x) => `'${jsId(x)}'`).join(',');
// Seules des images en data URL (tirées de la vidéo sur l'appareil) entrent dans un style ou un src.
const IMG_SURE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const imgSure = (s) => (IMG_SURE.test(String(s || '')) ? String(s) : '');

/** Barre en tête de pièce quand la vidéo est ouverte : « Filmer la pièce » + « Dicter seulement ». */
export function barrePieceVideo(pi, { ic }) {
  const n = Number(pi);
  return `<div class="evx-bar"><div class="evx-bar-tx"><b>Filmer la pièce en la décrivant</b>Vidéo et voix : l’IA propose observations et photos, chaque ligne se valide. 3 min au plus par prise.</div>`
    + `<div class="evx-dual"><button type="button" class="btn evx-out" onclick="_edlVideoFilmer(${n})">${ic('video')} Filmer la pièce</button>`
    + `<button type="button" class="btn evx-sec" onclick="_edlVoixDicter(${n})">${ic('mic')} Dicter seulement</button></div></div>`;
}
export function boutonsPiecePCVideo(pi, { ic }) {
  const n = Number(pi);
  return `<button type="button" class="btn bs bb evx-pc" onclick="_edlVideoFilmer(${n})">${ic('video')} Filmer la pièce</button>`
    + `<button type="button" class="btn bs bb evx-pc" onclick="_edlVoixDicter(${n})">${ic('mic')} Dicter seulement</button>`;
}

/** Accord de chaque locataire présent, avant de filmer (une fois par état des lieux). */
export function vueAccord({ notice, lignes, peut }, { ic }) {
  let corps = `<div class="evx-nt"><p class="evx-lead">${esc(notice.intro)}</p>`
    + notice.sections.map((s) => `<h3>${ic(s.icone)} ${esc(s.titre)}</h3><p>${esc(s.texte)}</p>`).join('') + '</div>'
    + '<div class="evx-sect">Accord de chaque locataire présent</div>';
  if (!lignes.length) corps += '<div class="evx-nc">Aucun locataire n’est renseigné dans l’état des lieux. Ajouter le nom du locataire dans l’étape « Parties » avant de filmer.</div>';
  corps += lignes.map((l, i) => (l.fige
    // Accord déjà donné pour cet état des lieux : affiché, jamais recoché ni retiré ici (son horodatage fait foi).
    ? `<div class="evx-acc"><button type="button" class="evx-box" role="checkbox" aria-checked="true" disabled>${ic('check')}<span class="evx-sr">Accord donné</span></button>`
      + `<div class="evx-acc-tx"><b>${esc(notice.accord)}</b><small>${esc(l.nom)} · accord déjà donné pour cet état des lieux</small></div></div>`
    : `<div class="evx-acc${l.present ? '' : ' abs'}">`
    + `<button type="button" class="evx-box" role="checkbox" aria-checked="${l.accord && l.present ? 'true' : 'false'}" ${l.present ? '' : 'disabled'} onclick="_edlVideoAccordCocher(${i})">${l.accord && l.present ? ic('check') : ''}<span class="evx-sr">Accord</span></button>`
    + `<div class="evx-acc-tx"><b>${esc(notice.accord)}</b><small>${esc(l.nom)}${l.present ? (l.accord ? ' · accord donné' : ' · case à cocher par le locataire') : ' · absent'}</small>`
    + (l.present ? `<label class="evx-lab" for="evx-rep-${i}">Représenté par (facultatif)</label><input class="evx-fld" id="evx-rep-${i}" type="text" value="${esc(l.representant || '')}" onchange="_edlVideoAccordRepresentant(${i},this.value)" placeholder="Représentant muni d’un mandat, qui coche pour le locataire">` : '')
    + `<button type="button" class="evx-lnk" onclick="_edlVideoAccordPresence(${i})">${l.present ? 'Indiquer absent' : 'Indiquer présent'}</button></div></div>`)).join('');
  corps += '<p class="evx-note">Chaque accord est enregistré dans l’état des lieux avec la date, l’heure et la version de ce texte. Un locataire absent n’est pas filmé sans son accord : filmer seulement avec l’accord des présents.</p>';
  const pied = sec('_edlVideoSansVideo()', 'Continuer sans vidéo') + pri('_edlVideoAccordOk()', `${ic('video')} Filmer`, peut ? '' : ' disabled');
  return { titre: notice.titre, sousTitre: notice.sousTitre, corps, pied, ferme: 'close' };
}

/** Viseur plein écran pendant la prise. */
export function vueFilmer({ piece, mode, sec: s = 0, max = 180, pause = false, prise = 1, elements = [] }, { ic }) {
  const corps = `<div class="evx-vf"><video id="evx-viseur" class="evx-viseur" autoplay muted playsinline></video>`
    + `<div class="evx-vf-top"><span class="evx-recb${pause ? ' p' : ''}"><i></i>${pause ? 'En pause' : 'Filmé'} · <span id="evx-timer">${duree(s)}</span></span><span class="evx-vf-lim">${duree(max)} au plus</span></div>`
    + '<div class="evx-hint" id="evx-hint" hidden></div>'
    + `<div class="evx-vf-bot"><b>Nommer chaque élément, dire l’état, montrer le détail.</b>Balayer lentement ; s’approcher de ce qui est signalé.`
    + (elements.length ? `<div class="evx-said">${elements.slice(0, 40).map((e) => `<span>${esc(e)}</span>`).join('')}</div>` : '') + '</div></div>';
  const pied = sec('_edlVideoPause()', pause ? `${ic('play')} Reprendre` : `${ic('pause')} Pause`) + pri('_edlVideoTerminer()', `${ic('stop')} Terminer la pièce`);
  return { titre: `Filmer · ${piece}`, sousTitre: `${mode === 'sortie' ? 'État des lieux de sortie' : 'État des lieux d’entrée'} · prise ${Number(prise) || 1}`, corps, pied, ferme: 'close', fermeLibelle: 'Abandonner la prise', classe: 'evx-film' };
}

/** Traitement : sur l'appareil (empreinte, images), puis analyse ; envoi de la vidéo à part. */
export function vueTraitement({ piece, duree: d = 0, mo = 0, images = 0, empreinte = '', etape = 'images', envoi = null }, { ic }) {
  const ordre = ['images', 'transcription', 'propositions', 'photos'];
  const i = Math.max(0, ordre.indexOf(etape));
  const li = (k, txt, sous) => {
    const j = ordre.indexOf(k);
    const cl = j < i ? 'ok' : j === i ? 'run' : 'todo';
    const pic = cl === 'ok' ? ic('check') : cl === 'run' ? '<span class="evx-spin"></span>' : '';
    return `<li class="${cl}"><span class="evx-ic">${pic}</span><div><b>${txt}</b>${sous ? `<small>${sous}</small>` : ''}</div></li>`;
  };
  let corps = `<ul class="evx-steps"><li class="ok"><span class="evx-ic">${ic('check')}</span><div><b>Vidéo enregistrée</b><small>${duree(d)} · ${esc(String(mo).replace('.', ','))} Mo${empreinte ? ' · empreinte calculée' : ''}</small></div></li>`
    + li('images', 'Images repérées sur l’appareil', images ? `${images} vues` : '')
    + li('transcription', 'Commentaire transcrit', '')
    + li('propositions', 'Propositions d’observations', '')
    + li('photos', 'Photos proposées', '') + '</ul>';
  if (envoi) corps += `<div class="evx-envoi-courant" data-video="${esc(jsId(envoi.id || ''))}">${blocEnvoi(envoi, { ic })}</div>`;
  corps += '<p class="evx-note">L’état des lieux reste utilisable pendant le traitement. Un bandeau dans la pièce prévient quand les propositions sont prêtes.</p>';
  return { titre: `Traitement · ${piece}`, corps, pied: sec('_edlVoixFermer()', 'Revenir à l’état des lieux'), ferme: 'close' };
}

/** Envoi de la vidéo vers le stockage (barre + reprise). etat ∈ attente | envoi | abri | echec | trop_lourd */
export function blocEnvoi({ etat = 'attente', envoyes = 0, total = 0, maxMo = 50, message = '' }, { ic }) {
  const mo = (n) => (Math.round(n / 104857.6) / 10).toString().replace('.', ',');
  const pct = total ? Math.min(100, Math.round(envoyes * 100 / total)) : 0;
  if (etat === 'abri') return `<div class="evx-ban ready">${ic('cloud')}<div><b>Vidéo à l’abri</b>Envoyée dans le stockage de l’espace (${mo(total)} Mo).</div></div>`;
  if (etat === 'trop_lourd') return `<div class="evx-ban err">${ic('warn')}<div><b>Vidéo trop lourde pour l’envoi</b>Le stockage accepte ${esc(maxMo)} Mo par fichier ; cette vidéo pèse ${mo(total)} Mo. Elle reste sur l’appareil ; les photos et les propositions ne sont pas touchées. Filmer en prises plus courtes.</div></div>`;
  if (etat === 'echec') return `<div class="evx-ban err">${ic('warn')}<div><b>Envoi de la vidéo interrompu</b>${esc(message || 'La vidéo est gardée sur l’appareil et repartira seule.')} L’état des lieux peut être signé : la vidéo suivra.</div></div>`;
  return `<div class="evx-ban wait">${ic(etat === 'envoi' ? 'upload' : 'cloud')}<div class="evx-grow"><b>${etat === 'envoi' ? `Envoi de la vidéo : ${pct} %` : 'Vidéo gardée sur l’appareil'}</b>${etat === 'envoi' ? `${mo(envoyes)} Mo sur ${mo(total)} Mo · reprend seul après une coupure` : 'Elle partira dès que le réseau le permet.'}`
    + `<div class="evx-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div></div>`;
}

/** Vignettes des photos proposées pour un élément (dans sa carte de proposition). */
export function blocPhotos({ itemId, eid, images, vu = null, ecartees = {}, statut = '', src, personnes = null }, { ic }) {
  if (!images || !images.length) return '';
  const vignettes = images.map((im) => {
    const cle = `${eid}|${im.imageId}`;
    const dr = !!ecartees[cle];
    const action = statut ? '' : `<button type="button" class="btn evx-sec evx-gk" onclick="_edlVideoEcarter(${q(itemId, eid, im.imageId)})">${dr ? `${ic('plus')} Reprendre` : `${ic('close')} Écarter`}</button>`;
    const pers = personnes && personnes.has(im.imageId) ? '<span class="evx-pers">Personne visible</span>' : '';
    return `<div class="evx-th${dr ? ' drop' : ' keep'}"><button type="button" class="evx-th-im" style="background-image:url('${esc(imgSure(src(im.imageId)))}')" onclick="_edlVideoPhoto(${q(itemId, eid, im.imageId)})" aria-label="Ouvrir la photo de ${esc(mmss(im.t))}"><span class="evx-tc">${esc(mmss(im.t))}</span></button>${pers}${action}</div>`;
  }).join('');
  return (vu ? `<div class="evx-seen">${ic('eye')}<span><b>Vu à l’image :</b> ${esc(vu)}</span></div>` : '') + `<div class="evx-thumbs">${vignettes}</div>`;
}

/** Carte « vu à l'image, pas dit » : photos seulement, aucun état proposé. */
export function carteVu({ itemId, eid, nom, images, vu, ecartees, statut, src, personnes = null }, { ic }) {
  const cle = `v:${eid}`;
  const chip = statut === 'ok' ? '<span class="evx-chip ok">Gardé</span>' : statut === 'ign' ? '<span class="evx-chip ign">Ignoré</span>' : '<span class="evx-chip">À valider</span>';
  const kept = images.filter((im) => !ecartees[`${eid}|${im.imageId}`]).length;
  const actions = statut === 'ok'
    ? `<div class="evx-done">${ic('check')} ${kept} photo${kept > 1 ? 's' : ''} ajoutée${kept > 1 ? 's' : ''} à l’élément.<button type="button" class="btn evx-sec" onclick="_edlVideoAnnulerVu(${q(itemId, cle)})">Annuler</button></div>`
    : statut === 'ign'
      ? `<div class="evx-done">Photos écartées, rien n’a changé.<button type="button" class="btn evx-sec" onclick="_edlVideoRetablirVu(${q(itemId, cle)})">Rétablir</button></div>`
      : `<div class="evx-acts"><button type="button" class="btn evx-out" onclick="_edlVideoGarderVu(${q(itemId, cle)})"${kept ? '' : ' disabled'}>${ic('check')} Garder les photos</button><button type="button" class="btn evx-sec" onclick="_edlVideoIgnorerVu(${q(itemId, cle)})">${ic('close')} Ignorer</button></div>`;
  return `<div class="evx-card${statut === 'ign' ? ' ign' : ''}"><div class="evx-hd"><div class="evx-nm">${esc(nom)}</div>${chip}</div>`
    + '<div class="evx-kv"><span class="k">État</span><span class="v"><span class="evx-pas none">Aucun état proposé</span></span><span class="k">Entendu</span><span class="v evx-src">Non dit dans le commentaire</span></div>'
    + blocPhotos({ itemId, eid, images, vu, ecartees, statut, src, personnes }, { ic })
    + `<div class="evx-iamark">${ic('sparkle')} ${esc(MENTION_PROPOSITION)}</div>${actions}</div>`;
}

/** Une photo en grand : cadre proposé ajustable, image voisine de la vidéo, garder / écarter. */
export function vuePhoto({ itemId, eid, nom, imageId, t, src, cadre, prec = null, suiv = null, ecartee = false, fige = false }, { ic }) {
  const c = cadre || { x: 0, y: 0, l: 1, h: 1 };
  const pc = (v) => `${Math.round(v * 1000) / 10}%`;
  const corps = `<div class="evx-frame" id="evx-frame" data-item="${esc(jsId(itemId))}" data-eid="${esc(jsId(eid))}" data-img="${esc(jsId(imageId))}"><img src="${esc(imgSure(src))}" alt="Image de la vidéo à ${esc(mmss(t))}">`
    + `<div class="evx-crop" id="evx-crop" style="left:${pc(c.x)};top:${pc(c.y)};width:${pc(c.l)};height:${pc(c.h)}"><i class="evx-poignee" aria-hidden="true"></i></div></div>`
    + `<div class="evx-scrub">${prec ? sec(`_edlVideoPhoto(${q(itemId, eid, prec.id)})`, `${ic('chevron-left')} ${esc(mmss(prec.t))}`) : '<span></span>'}<span class="evx-tm">${esc(mmss(t))}</span>${suiv ? sec(`_edlVideoPhoto(${q(itemId, eid, suiv.id)})`, `${esc(mmss(suiv.t))} ${ic('chevron-right')}`) : '<span></span>'}</div>`
    + `<div class="evx-kv"><span class="k">Élément</span><span class="v">${esc(nom)}</span><span class="k">Vidéo</span><span class="v">à ${esc(mmss(t))}</span><span class="k">Cadre</span><span class="v">${fige ? 'Enregistré' : 'Proposé par l’IA : faire glisser le cadre, ou sa poignée pour le redimensionner'}</span></div>`
    + (fige ? '' : `<button type="button" class="evx-lnk" onclick="_edlVideoCadreEntier()">Prendre l’image entière</button>`)
    + '<p class="evx-note">L’image n’est pas retouchée (ni éclaircie, ni débruitée). Le recadrage est une copie ; la vidéo d’origine reste intacte.</p>';
  const pied = fige ? pri(`_edlVideoRetourPropositions('${jsId(itemId)}')`, 'Retour aux propositions')
    : sec(`_edlVideoEcarter(${q(itemId, eid, imageId)},true)`, ecartee ? `${ic('plus')} Reprendre` : `${ic('close')} Écarter`) + pri(`_edlVideoGarderCadre(${q(itemId, eid, imageId)})`, `${ic('crop')} Garder cette photo`);
  return { titre: `Photo · ${nom}`, sousTitre: 'Tirée de la vidéo', corps, pied, ferme: 'back' };
}

/** Échec (M-12) propre au filmage : visuel + texte + au plus une action ; dictée et saisie rappelées. */
export function vueErreurVideo({ titre, texte, icone = 'warn', action = null, lien = null, piece = 'Pièce' }, { ic }) {
  const corps = `<div class="evx-emp"><div class="evx-pic">${ic(icone)}</div><h3>${esc(titre)}</h3><p>${esc(texte)}</p>`
    + '<p class="evx-man">La dictée et la saisie à la main restent disponibles.</p>'
    + (lien ? `<button type="button" class="evx-lnk" onclick="${lien.onclick}">${esc(lien.libelle)}</button>` : '') + '</div>';
  const pied = sec('_edlVoixFermer()', 'Revenir à l’état des lieux') + (action ? pri(action.onclick, `${action.icone ? ic(action.icone) + ' ' : ''}${esc(action.libelle)}`) : '');
  return { titre: `Filmer · ${piece}`, corps, pied, ferme: 'close' };
}

/** Bandeau d'une prise dans la pièce (envoi de la vidéo). */
export function banniereVideo(v, envoi, { ic }) {
  return `<div class="evx-vban" data-video="${esc(jsId(v.id))}">${blocEnvoi(envoi, { ic })}</div>`;
}
