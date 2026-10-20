/**
 * bail-echeance.global.js — Wrapper browser (window.BailEcheance)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    js/core/bail-echeance.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // ─── DÉPENDANCES IMPORTÉES depuis ./bail-duree.js (résolues via global) ───
  function regimeBailleur(){
    if (!global.BailDuree || typeof global.BailDuree.regimeBailleur !== 'function') {
      console.warn('[mirror bail-echeance] dep manquante: global.BailDuree.regimeBailleur');
      // Fallback minimal pour formatAdresse-like (objet imm → string vide ou rue)
      return (arguments[0] && typeof arguments[0] === 'object' && arguments[0].adr) ? arguments[0].adr : '';
    }
    return global.BailDuree.regimeBailleur.apply(null, arguments);
  }

  /**
   * bail-echeance.js — LA règle d'échéance et de reconduction d'un bail, UNE par type. Pure, testée.
   *
   * Source : mockups/BAUX-ECHUS/REGLE-LEGALE.md (Légifrance, texte en vigueur au 05/10/2026) et
   * décisions Didier du 06/10/2026. Avant ce module, cinq écrans répondaient chacun à leur façon :
   * la pastille disait « Échu » pour un garage dont le contrat (le nôtre) prévoit la reconduction,
   * l'agenda et la frise reconduisaient un bail étudiant tous les neuf mois, le rappel « préavis
   * bailleur 6 mois » visait un garage, et le bail nu était reconduit pour « la durée du bail initial ».
   *
   * RÈGLES (une par type) :
   *   nu       reconduit par la LOI (art. 10 al. 3) pour 3 ans (bailleur personne physique ou de
   *            l'art. 13 : SCI familiale, indivision) ou 6 ans (personne morale), QUELLE QUE SOIT la
   *            durée initiale. Préavis bailleur 6 mois, locataire 3 mois (art. 15-I).
   *   meuble   reconduit par la LOI pour 1 an (art. 25-7 al. 3). Préavis bailleur 3 mois, locataire
   *            1 mois (art. 25-8 I).
   *   etudiant JAMAIS reconduit (art. 25-7 al. 4) : il prend fin à son terme, sans congé.
   *   mobilite JAMAIS reconduit (art. 25-14 al. 1) : il prend fin à son terme, sans congé.
   *   garage   reconduit si le CONTRAT le prévoit. Le contrat garage de l'app le prévoit (bail-garage
   *            §3 : « le contrat se renouvelle par tacite reconduction pour des périodes successives
   *            d'une durée équivalente ») depuis son déploiement en v15.586 (04/09/2026, 15 h 28 heure
   *            de Paris). Seul un garage SIGNÉ dans l'app à partir de cet instant est donc reconduit ici. Signé avant, repris à l'achat,
   *            jamais signé : le texte du contrat n'est pas établi → arrivé à terme, « contrat à vérifier ».
   *   autre    le contrat de l'app ne prévoit pas de reconduction (« librement définies entre les
   *            parties ») : il arrive à son terme.
   *
   * Ce module ne décide JAMAIS de la fin d'occupation ni du dû (js/core/fin-occupation.js) : un bail
   * arrivé à terme reste occupé jusqu'au départ déclaré ou à la clôture. Il dit seulement ce que le
   * contrat et la loi disent de l'échéance — et rien de plus là où les sources ne tranchent pas
   * (maintien sans nouveau bail : ni « requalification » ni « occupant sans titre » ne sont affirmés).
   */

  const TYPES_BAIL = ['nu', 'meuble', 'etudiant', 'mobilite', 'garage', 'autre'];

  /** Type EFFECTIF : `bail.type` fait autorité ; à défaut `log.typeUsage` (baux d'avant v15.191) ; sinon nu. */
  function typeBailEffectif(bail, log) {
    const t = bail && bail.type;
    if (t && TYPES_BAIL.includes(t)) return t;
    const u = log && log.typeUsage;
    if (u === 'mobilite') return 'mobilite';
    if (u === 'etudiant') return 'etudiant';
    if (u === 'habitation-meuble') return 'meuble';
    return 'nu';
  }

  /** La LOI reconduit-elle ce type de bail ? (nu : art. 10 ; meublé : art. 25-7 al. 3) */
  function reconductionLegale(type) {
    return type === 'nu' || type === 'meuble' || !type;
  }

  /**
   * D'où vient la reconduction de CE bail ?
   * @returns {'loi'|'contrat'|null} null = le bail arrive à son terme
   */
  function regleReconduction(bail, log) {
    const t = typeBailEffectif(bail, log);
    if (reconductionLegale(t)) return 'loi';
    if (t === 'garage' && garageContratAppReconductible(bail)) return 'contrat';
    return null;
  }

  /**
   * L'INSTANT du déploiement du contrat garage de l'app (bail-garage, clause de tacite reconduction §3) :
   * v15.586, commit 91a8bfed « Pilotage : bail garage DÉPLOYÉ v15.586 », horodaté par git
   * 2026-09-04 15:28:19 +0200 (heure de Paris).
   */
  const INSTANT_CONTRAT_GARAGE_APP = '2026-09-04T15:28:19+02:00';
  const _MS_CONTRAT_GARAGE_APP = Date.parse(INSTANT_CONTRAT_GARAGE_APP);

  /** L'horodatage (ms) de la signature d'un bail signé dans l'app, NaN sinon. */
  function _instantSignature(bail) {
    // Bail déclaré signé HORS Propryo : la date saisie n'est pas un instant de signature dans l'app, et le
    // bail ne porte pas la clause du contrat Propryo (constat 0.5, BAIL-EN-COURS-SIGNE-HORS-PROPRYO).
    if (bail && bail.signatures && bail.signatures.mode === 'externe') return NaN;
    const s = bail && bail.signatures && bail.signatures.signedAt;
    if (s === null || s === undefined || s === '') return NaN;
    if (typeof s === 'number') return s;
    return Date.parse(String(s));
  }

  /**
   * Ce garage porte-t-il, À COUP SÛR, la clause de tacite reconduction du contrat de l'app ?
   * Oui seulement s'il a été SIGNÉ dans l'app à partir du déploiement de v15.586 (04/09/2026, 15 h 28,
   * heure de Paris) et n'est pas un bail repris. Une signature au même jour mais plus tôt : non.
   */
  function garageContratAppReconductible(bail) {
    if (!bail || bail.typeContrat === 'repris') return false;
    const t = _instantSignature(bail);
    return !isNaN(t) && t >= _MS_CONTRAT_GARAGE_APP;
  }

  /** Préavis du congé BAILLEUR avant l'échéance, en mois (null = pas de congé à délivrer par la loi de 1989). */
  function preavisBailleurMois(type) {
    if (type === 'meuble') return 3;          // art. 25-8 I
    if (type === 'nu' || !type) return 6;     // art. 15-I
    return null;                              // étudiant / mobilité : fin au terme ; garage / autre : le contrat
  }

  /** Préavis du congé LOCATAIRE, en mois (cas général ; null = selon le contrat). */
  function preavisLocataireMois(type) {
    if (type === 'meuble' || type === 'etudiant') return 1;   // art. 25-8 I
    if (type === 'mobilite') return 1;                        // art. 25-15
    if (type === 'nu' || !type) return 3;                     // art. 15-I (1 mois dans les cas réduits)
    return null;
  }

  // ── dates civiles 'YYYY-MM-DD', sans fuseau ─────────────────────────────────────────────────────
  const _iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  function _parse(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, mo, d };
  }
  /** + n jours (n entier, éventuellement négatif). */
  function ajouterJours(iso, n) {
    const p = _parse(iso); if (!p) return '';
    const t = new Date(Date.UTC(p.y, p.mo - 1, p.d) + n * 86400000);
    return _iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  /** + n mois, recadré en fin de mois (art. 641 CPC : un mois partant du 31 finit le 30 ou le 28). */
  function ajouterMois(iso, n) {
    const p = _parse(iso); if (!p) return '';
    const total = p.y * 12 + (p.mo - 1) + n;
    const y = Math.floor(total / 12), mo = total - y * 12 + 1;
    const dernier = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return _iso(y, mo, Math.min(p.d, dernier));
  }
  function _joursEntre(a, b) {
    const pa = _parse(a), pb = _parse(b); if (!pa || !pb) return null;
    return Math.round((Date.UTC(pb.y, pb.mo - 1, pb.d) - Date.UTC(pa.y, pa.mo - 1, pa.d)) / 86400000);
  }

  /** Durée INITIALE légale (mois) quand la loi la fixe — sert la fin théorique d'un bail sans date de fin. */
  function dureeInitialeMois(type, typeEntite) {
    if (type === 'meuble') return 12;                                 // art. 25-7 al. 2
    if (type === 'etudiant') return 9;                                // art. 25-7 al. 4
    if (type === 'nu' || !type) return regimeBailleur(typeEntite).ans * 12;   // art. 10 al. 1 (et art. 13)
    return null;                                                      // mobilité, garage, autre : durée du contrat
  }

  /**
   * Fin THÉORIQUE à partir du début : veille de l'anniversaire (début + durée − 1 jour).
   * Même règle que la saisie (« fin = veille de l'anniversaire »). '' si la loi ne fixe pas la durée.
   */
  function finTheorique(debutIso, type, typeEntite) {
    const mois = dureeInitialeMois(type, typeEntite);
    if (!mois || !_parse(debutIso)) return '';
    return ajouterJours(ajouterMois(debutIso, mois), -1);
  }

  /** Fin du contrat en cours : la date saisie, sinon la fin théorique (nu / meublé / étudiant). */
  function finContractuelle(bail, log, typeEntite) {
    if (!bail) return '';
    if (_parse(bail.fin)) return String(bail.fin).slice(0, 10);
    return finTheorique(bail.debut, typeBailEffectif(bail, log), typeEntite);
  }

  /**
   * La PÉRIODE de reconduction : { mois } ou { jours }.
   *  · loi : nu 3 ou 6 ans, meublé 1 an ;
   *  · contrat (garage) : « une durée équivalente » à la durée INITIALE (du début à la fin du contrat) —
   *    en mois quand elle tombe juste (1 an, 6 mois…), sinon au jour près.
   */
  function _periode(regle, type, typeEntite, debutIso, finIso) {
    if (regle === 'loi') return { mois: type === 'meuble' ? 12 : regimeBailleur(typeEntite).ans * 12 };
    if (regle !== 'contrat') return null;
    const pd = _parse(debutIso), lendemain = ajouterJours(finIso, 1);
    if (!pd || !lendemain) return null;
    const pl = _parse(lendemain);
    const mois = (pl.y - pd.y) * 12 + (pl.mo - pd.mo);
    if (mois > 0 && ajouterMois(debutIso, mois) === lendemain) return { mois };
    const jours = _joursEntre(debutIso, lendemain);
    return jours > 0 ? { jours } : null;
  }
  /** La fin de la période suivante (elle commence le lendemain de l'échéance). */
  function _finPeriodeSuivante(finIso, periode) {
    const debut = ajouterJours(finIso, 1);
    if (periode.mois) return ajouterJours(ajouterMois(debut, periode.mois), -1);
    return ajouterJours(debut, periode.jours - 1);
  }

  /**
   * L'ÉCHÉANCE d'un bail à une date donnée.
   * @param {Object} bail
   * @param {Object} [log]
   * @param {{typeEntite?:string, todayIso:string}} o
   * @returns {{type:string, regle:('loi'|'contrat'|null), statut:('termine'|'inconnue'|'en_cours'|'reconduit'|'arrive_a_terme'),
   *            finContrat:string, prochaine:string}}
   *   finContrat = fin du contrat initial (saisie ou théorique) ; prochaine = l'échéance À VENIR
   *   (en cours ou période reconduite) — '' quand le bail est arrivé à son terme sans reconduction.
   */
  function echeanceBail(bail, log, o) {
    o = o || {};
    const type = typeBailEffectif(bail, log);
    const regle = regleReconduction(bail, log);
    const out = { type, regle, statut: 'inconnue', finContrat: '', prochaine: '' };
    if (!bail) return out;
    if (bail.cloture || bail.finEffective) { out.statut = 'termine'; return out; }
    const fin = finContractuelle(bail, log, o.typeEntite);
    out.finContrat = fin;
    const today = String(o.todayIso || '').slice(0, 10);
    if (!fin || !_parse(today)) return out;
    if (today <= fin) { out.statut = 'en_cours'; out.prochaine = fin; return out; }
    if (!regle) { out.statut = 'arrive_a_terme'; return out; }
    const periode = _periode(regle, type, o.typeEntite, bail.debut, fin);
    let courant = periode ? fin : '';
    // Garde-fou : une donnée absurde (période nulle) ne doit pas figer l'onglet.
    for (let i = 0; i < 400 && courant && courant < today; i++) {
      const suivant = _finPeriodeSuivante(courant, periode);
      if (!suivant || suivant <= courant) { courant = ''; break; }
      courant = suivant;
    }
    if (!courant) { out.statut = 'inconnue'; return out; }
    out.statut = 'reconduit';
    out.prochaine = courant;
    return out;
  }

  /** Date courte JJ/MM/AAAA (sans dépendance d'affichage). */
  function dateFr(iso) {
    const p = _parse(iso);
    return p ? String(p.d).padStart(2, '0') + '/' + String(p.mo).padStart(2, '0') + '/' + p.y : '';
  }

  /**
   * La PASTILLE d'échéance (Locataires, Biens) : { cls, text, urgent }.
   *  en cours → la date (orange + jours restants sous 90 j) ; reconduit → « Tacite reconduction » ;
   *  arrivé à terme → « Arrivé à terme (JJ/MM/AAAA) » ; inconnue → « Échéance non renseignée ».
   */
  function pastilleEcheance(ech, o) {
    o = o || {};
    if (!ech) return { cls: 'muted', text: '', urgent: false };
    const fd = typeof o.fd === 'function' ? o.fd : dateFr;
    if (ech.statut === 'termine') return { cls: 'muted', text: '', urgent: false };
    if (ech.statut === 'reconduit') return { cls: 'ok', text: 'Tacite reconduction', urgent: false };
    if (ech.statut === 'arrive_a_terme') return { cls: 'err', text: 'Arrivé à terme (' + fd(ech.finContrat) + ')', urgent: true };
    if (ech.statut === 'en_cours') {
      const j = _joursEntre(o.todayIso, ech.prochaine);
      if (j != null && j < 90) return { cls: 'warn', text: fd(ech.prochaine) + ' (' + j + 'j)', urgent: true };
      return { cls: 'ok', text: fd(ech.prochaine), urgent: false };
    }
    return { cls: 'muted', text: 'Échéance non renseignée', urgent: false };
  }

  /**
   * L'ALERTE « bail arrivé à terme » (étudiant, mobilité ; garage ou autre sans reconduction au
   * contrat). Jamais bloquante, ton neutre. Elle disparaît dès qu'un départ est déclaré.
   * @returns {null|{type:string, fin:string, texte:string, nouveauBailMeuble:boolean}}
   */
  function alerteArriveATerme(bail, log, o) {
    if (!bail || bail._deleted) return null;
    if (bail.depart && bail.depart.dateSortie) return null;
    const ech = echeanceBail(bail, log, o);
    if (ech.statut !== 'arrive_a_terme') return null;
    const fd = (o && typeof o.fd === 'function') ? o.fd : dateFr;
    const meuble = ech.type === 'etudiant' || ech.type === 'mobilite';
    const texte = meuble
      ? 'Bail arrivé à terme le ' + fd(ech.finContrat) + ', non reconductible : signer un nouveau bail meublé ou déclarer le départ.'
      : 'Bail arrivé à terme le ' + fd(ech.finContrat) + ', contrat à vérifier : signer un nouveau bail ou déclarer le départ.';
    return { type: ech.type, fin: ech.finContrat, texte, nouveauBailMeuble: meuble };
  }

  /**
   * Le rappel « préavis bailleur » (agenda, frise, alerte Pilotage) : seulement là où la loi de
   * 1989 fait courir un préavis AVANT l'échéance (nu, meublé) et seulement pour une échéance à venir.
   * @returns {null|{fin:string, debut:string, mois:number, meuble:boolean}}
   */
  function preavisBailleurAvantEcheance(bail, log, o) {
    const ech = echeanceBail(bail, log, o);
    if (ech.statut !== 'en_cours' && ech.statut !== 'reconduit') return null;
    const mois = preavisBailleurMois(ech.type);
    if (!mois) return null;
    return { fin: ech.prochaine, debut: ajouterMois(ech.prochaine, -mois), mois, meuble: ech.type === 'meuble' };
  }

  /** Note de l'événement d'agenda « Fin de bail ». */
  function noteFinDeBail(ech) {
    if (ech && ech.regle === 'loi') return 'Échéance du bail — prévoir renouvellement ou congé. Sans congé, le bail est reconduit (' + (ech.type === 'meuble' ? 'art. 25-7' : 'art. 10') + ' de la loi du 6 juillet 1989).';
    if (ech && ech.regle === 'contrat') return 'Échéance du bail — sans congé, le contrat se renouvelle par tacite reconduction pour une durée équivalente (clause du contrat).';
    if (ech && (ech.type === 'etudiant' || ech.type === 'mobilite')) return 'Fin du bail, non reconductible : signer un nouveau bail meublé ou déclarer le départ.';
    return 'Fin du bail, contrat à vérifier : signer un nouveau bail ou déclarer le départ.';
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailEcheance = {
    TYPES_BAIL: TYPES_BAIL,
    typeBailEffectif: typeBailEffectif,
    reconductionLegale: reconductionLegale,
    regleReconduction: regleReconduction,
    INSTANT_CONTRAT_GARAGE_APP: INSTANT_CONTRAT_GARAGE_APP,
    garageContratAppReconductible: garageContratAppReconductible,
    preavisBailleurMois: preavisBailleurMois,
    preavisLocataireMois: preavisLocataireMois,
    ajouterJours: ajouterJours,
    ajouterMois: ajouterMois,
    dureeInitialeMois: dureeInitialeMois,
    finTheorique: finTheorique,
    finContractuelle: finContractuelle,
    echeanceBail: echeanceBail,
    dateFr: dateFr,
    pastilleEcheance: pastilleEcheance,
    alerteArriveATerme: alerteArriveATerme,
    preavisBailleurAvantEcheance: preavisBailleurAvantEcheance,
    noteFinDeBail: noteFinDeBail
  };
})(typeof window !== 'undefined' ? window : globalThis);
