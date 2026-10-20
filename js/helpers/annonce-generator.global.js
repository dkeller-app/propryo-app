/**
 * annonce-generator.global.js — Wrapper browser (window.AnnonceGenerator)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/annonce-generator.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * Module annonce-generator — annonce de location CONFORME (chantier ANNONCES, CDC validé 29/09/2026,
   * révisé le 29/09 après maquette v2 : UN SEUL TEXTE modifiable, format B sans emojis).
   *
   * Le moteur produit UN texte complet — accroche, LE LOGEMENT, POINTS FORTS, DOSSIER À PRÉPARER,
   * INFORMATIONS — que l'utilisateur retouche librement. Les mentions obligatoires sont des phrases
   * CONNUES (libellé légal + valeur de la fiche) : controlerTexte() les cherche dans le texte à chaque
   * frappe (présente / à compléter / retirée), remettreMention() réinsère une phrase retirée,
   * majMentions() remplace les phrases (et emplacements « À COMPLÉTER ») après un passage par la fiche,
   * sans toucher aux retouches.
   *
   * Ne lit QUE des données saisies (aucun adjectif inventé). Module PUR : l'appelant fournit
   *   dpe          ← _diagGet(log,'dpe')                         { classe, ges, depensesEnergie, anneePrix, na }
   *   composition  ← BiensPieces.designationPieces(pieces)       « Séjour, Cuisine, 1 chambre, … »
   *   imm          ← immeuble, commune résolue par LogImmResolver (ville / codePostal)
   *   mandataire   ← un mandataire est configuré (Référentiel)   booléen
   *
   * Libellés VERBATIM (mockups/ANNONCES/AUDIT.md partie 2) : arrêté du 21 avril 2022 (art. 2-1 loi 89-462),
   * arrêté du 10 janvier 2017 art. 4 (mandataire), CCH L126-33 / R126-21 à R126-24, arrêté du
   * 22 décembre 2021, C. env. R125-25. Dossier : liste autorisée (décret n° 2015-1437, service-public F1169).
   * Donnée manquante → emplacement « [À COMPLÉTER : …] » dans le texte (D3 : rien n'est bloqué).
   */

  // ═══════════════════════════════════════════════════════════════
  // Libellés imposés par les textes (ne pas reformuler)
  // ═══════════════════════════════════════════════════════════════
  const TXT_GEORISQUES = 'Les informations sur les risques auxquels ce bien est exposé sont disponibles sur le site Géorisques : www.georisques.gouv.fr';
  const TXT_DEPENSES = 'Montant estimé des dépenses annuelles d\'énergie pour un usage standard : ';
  const TXT_EXCESSIF = 'Logement à consommation énergétique excessive : ';
  const TXT_HCL = 'honoraires charge locataire';

  /** Rubriques du format B (sans emojis). */
  const RUBRIQUES = Object.freeze({ logement: 'LE LOGEMENT', points: 'POINTS FORTS', dossier: 'DOSSIER À PRÉPARER', infos: 'INFORMATIONS' });

  /** Dossier : pièces de la liste autorisée (décret n° 2015-1437, service-public.fr F1169), version courte validée. */
  const DOSSIER_PIECES = Object.freeze([
    'Pièce d\'identité',
    'Justificatif de domicile',
    'Contrat de travail (ou justificatif d\'activité)',
    '3 dernières fiches de paie',
    'Dernier avis d\'imposition',
    'Pour un garant : les mêmes pièces'
  ]);
  const TXT_DOSSIERFACILE = 'Le dossier peut être constitué sur DossierFacile, service public gratuit.';

  /** Usages hors loi 89-462 (garage, box, parking, local pro, autre). */
  const USAGES_HORS_HABITATION = Object.freeze(['garage', 'local-pro', 'autre']);
  /** Usages meublés : bail meublé, bail mobilité (meublé par définition), bail étudiant. */
  const USAGES_MEUBLES = Object.freeze(['habitation-meuble', 'mobilite', 'etudiant']);

  const GARANTIES_LIBELLES = Object.freeze({
    caution_solidaire: 'caution solidaire',
    visale: 'Visale',
    gli: 'garantie loyers impayés (GLI)',
    garant_perso: 'garant personnel'
  });

  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════
  const _s = (x) => String(x == null ? '' : x).trim();
  const _rempli = (x) => _s(x) !== '';
  const _maj = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;

  /** Emplacement d'une donnée manquante, dans le texte même. */
  const MANQUE = (quoi) => '[À COMPLÉTER : ' + quoi + ']';
  const RE_MANQUE = /\[À COMPLÉTER : [^\]]*\]/g;

  /** Nombre saisi ou null (champ vide ≠ 0 : un 0 saisi est une valeur). */
  function nombre(x) {
    if (!_rempli(x)) return null;
    const n = Number(String(x).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  /** 1580 → « 1 580 », 812.7 → « 812,70 ». Espace simple (copier-coller sans surprise). */
  function montant(n) {
    const v = Number(n) || 0;
    const entier = Math.round(v * 100) % 100 === 0;
    const [ent, dec] = (entier ? Math.round(v).toString() : v.toFixed(2)).split('.');
    const groupes = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return dec ? groupes + ',' + dec : groupes;
  }

  function estHorsHabitation(log) {
    return USAGES_HORS_HABITATION.indexOf(_s(log && log.typeUsage)) >= 0;
  }

  function estMeuble(log) {
    return USAGES_MEUBLES.indexOf(_s(log && log.typeUsage)) >= 0;
  }

  /** « 2e étage », « rez-de-chaussée », « niveau -1 » ; '' si inexploitable. */
  function etageLabel(etage) {
    const e = _s(etage);
    if (!e) return '';
    if (/^(rdc|rez)/i.test(e)) return 'rez-de-chaussée';
    if (/^-\s*\d+/.test(e)) return 'niveau ' + e.replace(/\s+/g, '');
    const n = parseInt(e, 10);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n === 0) return 'rez-de-chaussée';
    return (n === 1 ? '1er' : n + 'e') + ' étage';
  }

  /** Paris / Lyon / Marseille : ville à arrondissements (art. L. 2511-3 CGCT). */
  function villeAArrondissements(ville) {
    return /^(paris|lyon|marseille)\b/i.test(_s(ville));
  }

  /**
   * Commune + arrondissement depuis le code postal. Paris 16e a DEUX codes (75016 et 75116).
   * Renvoie { texte, manque } : manque = true quand l'arrondissement d'une des 3 villes est indéductible.
   */
  function commune(imm) {
    const ville = _s(imm && imm.ville).replace(/\s+\d.*$/, '');
    if (!ville) return { texte: '', manque: false };
    if (!villeAArrondissements(ville)) return { texte: ville, manque: false };
    const cp = _s(imm && imm.codePostal);
    const v = ville.toLowerCase();
    let n = null;
    if (/^paris/.test(v) && /^75(0\d\d|116)$/.test(cp)) n = cp === '75116' ? 16 : +cp.slice(3);
    else if (/^lyon/.test(v) && /^6900\d$/.test(cp)) n = +cp.slice(4);
    else if (/^marseille/.test(v) && /^130\d\d$/.test(cp)) n = +cp.slice(3);
    const max = /^paris/.test(v) ? 20 : /^lyon/.test(v) ? 9 : 16;
    if (n && n >= 1 && n <= max) return { texte: ville + ' ' + (n === 1 ? '1er' : n + 'e') + ' arrondissement', manque: false };
    return { texte: ville + ' ' + MANQUE('arrondissement'), manque: true };
  }

  /** Compatibilité : libellé seul (sans l'état « manque »). */
  function communeLabel(imm) {
    return commune(imm).texte;
  }

  /** '2026-11-01' → « 1er novembre 2026 ». */
  function dateFr(iso) {
    const m = _s(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const j = +m[3], mo = +m[2];
    if (mo < 1 || mo > 12 || j < 1 || j > 31) return '';
    return (j === 1 ? '1er' : String(j)) + ' ' + MOIS[mo - 1] + ' ' + m[1];
  }

  function _estMaison(log, imm) {
    return _s(imm && imm.typeHabitat) === 'Maison individuelle' || /^maison/i.test(_s(log && log.type));
  }

  /** « Appartement T2 », « Maison T4 », « Studio » — le type saisi prime s'il nomme déjà la nature. */
  function natureBien(log, imm) {
    const type = _s(log && log.type);
    if (estHorsHabitation(log)) return type || 'Local';
    if (/^(studio|maison|appartement|duplex|triplex|loft|chambre)/i.test(type)) return _maj(type);
    const nature = _estMaison(log, imm) ? 'Maison' : 'Appartement';
    return type ? nature + ' ' + type : nature;
  }

  /** Même règle que le bail (fmtDepensesEnergie, index.html) : « 900 à 1200 » → fourchette, nombre seul → « € par an ». */
  function depensesTexte(s) {
    const t = _s(s).replace(/\s*\(fourchette DPE\)\s*$/i, '').replace(/\.$/, '');
    if (!t) return '';
    const m = t.match(/^\s*(\d[\d ]*(?:[.,]\d+)?)\s*(?:€|eur[os]*)?\s*(?:et|-|–|—|à|a)\s*(\d[\d ]*(?:[.,]\d+)?)\s*(?:€|eur[os]*)?\s*$/i);
    if (m) return 'entre ' + m[1].trim() + ' € et ' + m[2].trim() + ' € par an';
    if (/€|euro|par\s*an/i.test(t)) return t;
    if (/^\d[\d ]*(?:[.,]\d+)?$/.test(t)) return t + ' € par an';
    return t;
  }

  function _anneesTexte(annees) {
    const a = _s(annees).replace(/\.$/, '');
    if (!a) return '';
    return /[,;]|\bet\b/.test(a)
      ? 'Prix moyens des énergies indexés sur les années ' + a + '.'
      : 'Année de référence des prix de l\'énergie : ' + a + '.';
  }

  // ═══════════════════════════════════════════════════════════════
  // Titre
  // ═══════════════════════════════════════════════════════════════
  function _premierExterieur(log) {
    const ext = log.exterieurs || {};
    return ext.balcon && ext.balcon.present ? 'balcon'
      : ext.terrasse && ext.terrasse.present ? 'terrasse'
      : ext.loggia && ext.loggia.present ? 'loggia'
      : ext.jardin_privatif && ext.jardin_privatif.present ? 'jardin' : '';
  }

  function genererTitre(log, imm) {
    log = log || {}; imm = imm || {};
    const surf = nombre(log.surf);
    const parts = [natureBien(log, imm)];
    if (surf) parts.push(montant(surf) + ' m²');
    if (!estHorsHabitation(log)) {
      if (estMeuble(log)) parts.push('meublé');
      const ext = _premierExterieur(log);
      if (ext) parts.push('avec ' + ext);
    }
    const c = commune(imm);
    return parts.join(' ') + (c.texte && !c.manque ? ' — ' + c.texte : (c.texte ? ' — ' + _s(imm.ville) : ''));
  }

  // ═══════════════════════════════════════════════════════════════
  // Accroche + rubriques (uniquement des données saisies)
  // ═══════════════════════════════════════════════════════════════
  const CUISINE_LIBELLES = [['four', 'four'], ['plaques', 'plaques de cuisson'], ['hotte', 'hotte'],
    ['lave_vaisselle', 'lave-vaisselle'], ['micro_ondes', 'micro-ondes'], ['frigo', 'réfrigérateur']];
  const SANITAIRES_LIBELLES = [['bain', 'baignoire'], ['douche', 'douche'], ['wc_separe', 'WC séparé'],
    ['lave_linge', 'lave-linge'], ['seche_linge', 'sèche-linge']];
  const ANNEXES_LIBELLES = [['cave', 'cave'], ['grenier', 'grenier'], ['parking', 'parking'], ['garage', 'garage'],
    ['buanderie', 'buanderie'], ['cellier', 'cellier'], ['localVelos', 'local vélos'], ['atelier', 'atelier']];

  function _et(arr) {
    const a = arr.filter(Boolean);
    return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1];
  }

  function _extLibelle(nom, o) {
    const s = nombre(o && o.surface);
    return s && s > 0 ? nom + ' de ' + montant(s) + ' m²' : nom;
  }

  /** Phrase d'accroche factuelle : « À louer à Strasbourg : appartement T2 de 50 m² avec balcon, au 2e étage avec ascenseur. Disponible le … » */
  function genererAccroche(log, imm, ctx) {
    log = log || {}; imm = imm || {}; ctx = ctx || {};
    const hors = estHorsHabitation(log);
    const surf = nombre(log.surf);
    const etage = etageLabel(log.etage);
    const nat = natureBien(log, imm);
    let bien = (/^[A-Z]{2,}|^T\d/.test(nat) ? nat : nat.charAt(0).toLowerCase() + nat.slice(1)) + (surf ? ' de ' + montant(surf) + ' m²' : '');
    if (hors) {
      if (etage) bien += ' au ' + etage;
      if (_rempli(log.numApt)) bien += ', n° ' + _s(log.numApt);
    } else {
      if (estMeuble(log)) bien += ' meublé';
      const ext = _premierExterieur(log);
      if (ext) bien += ' avec ' + ext;
      if (!_estMaison(log, imm) && etage) bien += ', au ' + etage + ((imm.equipementsCommuns || {}).ascenseur ? ' avec ascenseur' : '');
    }
    const c = commune(imm);
    const ville = c.texte && !c.manque ? c.texte : _s(imm.ville);
    let phrase = 'À louer' + (ville ? ' à ' + ville : '') + ' : ' + bien + '.';
    const li = log.locationInfo || {};
    const dispo = dateFr(li.disponibilite);
    if (dispo) phrase += _s(li.disponibilite) <= _s(ctx.aujourdhui) ? ' Disponible immédiatement.' : ' Disponible le ' + dispo + '.';
    return phrase;
  }

  /** « Séjour, Cuisine, 1 chambre, Salle d'eau, WC » → « Séjour, cuisine, 1 chambre, salle d'eau, WC. » */
  function _composition(c) {
    const parts = _s(c).split(/\s*,\s*/).filter(Boolean);
    if (!parts.length) return '';
    return parts.map((p, i) => i === 0 ? _maj(p) : (/^[A-Z]{2,}/.test(p) ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(', ') + '.';
  }

  /** Puces « POINTS FORTS » : extérieurs, cuisine, sanitaires, annexes, fibre — rien d'autre. */
  function pointsForts(log) {
    log = log || {};
    const out = [];
    const ext = log.exterieurs || {};
    if (ext.balcon && ext.balcon.present) out.push(_maj(_extLibelle('balcon', ext.balcon)));
    if (ext.terrasse && ext.terrasse.present) out.push(_maj(_extLibelle('terrasse', ext.terrasse)));
    if (ext.loggia && ext.loggia.present) out.push('Loggia');
    if (ext.jardin_privatif && ext.jardin_privatif.present) out.push(_maj(_extLibelle('jardin privatif', ext.jardin_privatif)));
    const eq = log.equipements || {};
    const cu = eq.cuisine || {};
    const cuListe = CUISINE_LIBELLES.filter(([k]) => cu[k]).map(([, v]) => v)
      .concat((Array.isArray(cu.customs) ? cu.customs : []).map(_s).filter(Boolean));
    if (cu.equipee || cuListe.length) out.push('Cuisine' + (cu.equipee ? ' équipée' : '') + (cuListe.length ? ' : ' + cuListe.join(', ') : ''));
    const sa = eq.sanitaires || {};
    const saListe = SANITAIRES_LIBELLES.filter(([k]) => sa[k]).map(([, v]) => v);
    if (saListe.length) out.push(_maj(_et(saListe)));
    const an = log.annexes || {};
    ANNEXES_LIBELLES.filter(([k]) => an[k] && an[k].present).forEach(([k, v]) => {
      out.push(_maj(k === 'parking' && an.parking.type === 'box' ? 'box' : v));
    });
    (Array.isArray(an.customs) ? an.customs : []).map(_s).filter(Boolean).forEach(c => out.push(_maj(c)));
    if (eq.technologies && eq.technologies.fibre) out.push('Fibre optique');
    return out;
  }

  function garanties(log) {
    const li = (log && log.locationInfo) || {};
    return (Array.isArray(li.garanties_acceptees) ? li.garanties_acceptees : []).map(k => GARANTIES_LIBELLES[k]).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════════
  // Mentions obligatoires + contrôle
  // ═══════════════════════════════════════════════════════════════
  /**
   * Construit les mentions ET la liste de contrôle, dans l'ordre du CDC §3.3 / §4.
   * @returns {{ lignes: {key:string, texte:string, manquant:boolean}[],
   *             controle: {key:string, label:string, etat:'ok'|'ko'|'na'|'warn', detail:string, cible:string}[] }}
   */
  function genererMentions(log, imm, ctx) {
    log = log || {}; imm = imm || {}; ctx = ctx || {};
    const hors = estHorsHabitation(log);
    const meuble = estMeuble(log);
    const dpe = ctx.dpe || {};
    const lignes = [];
    const controle = [];
    const libSurface = (hors ? 'Surface' : 'Surface habitable') + ' : ';
    const LIB = { loyer: 'Loyer : ', charges: 'Charges : ', meuble: 'Location meublée', dg: 'Dépôt de garantie : ',
      honorairesEdl: "Honoraires d'état des lieux à la charge du locataire : ", hcl: '', surface: libSurface, commune: 'Commune : ',
      dpe: 'Classe énergie : ', excessif: TXT_EXCESSIF, depenses: TXT_DEPENSES, georisques: 'Les informations sur les risques auxquels ce bien est exposé' };
    const L = (key, texte, manquant) => lignes.push({ key, texte, libelle: LIB[key] || '', manquant: !!manquant });
    const C = (key, label, etat, detail, cible) => controle.push({ key, label, etat, detail: detail || '', cible: cible || '' });

    const hc = nombre(log.loyerHcRef);
    const ch = nombre(log.chargesRef);
    const dg = nombre(log.dgRef);
    const modalite = _s(log.chargesModalite);

    // ── Loyer (1°) — le montant CC exige les charges ; tant qu'elles sont vides, le loyer n'est pas complet.
    if (hc == null) {
      L('loyer', 'Loyer : ' + MANQUE('loyer'), true);
      C('loyer', hors ? 'Loyer' : 'Loyer charges comprises', 'ko', 'loyer non renseigné', 'loyer');
    } else if (hors) {
      L('loyer', 'Loyer : ' + montant(hc) + ' € par mois' + (ch ? ' + charges ' + montant(ch) + ' € par mois' : ''));
      C('loyer', 'Loyer', 'ok', montant(hc) + ' € par mois', 'loyer');
    } else if (ch == null) {
      L('loyer', 'Loyer : ' + MANQUE('loyer charges comprises'), true);
      C('loyer', 'Loyer charges comprises', 'ko', 'charges non renseignées', 'loyer');
    } else {
      const total = hc + ch;
      L('loyer', 'Loyer : ' + montant(total) + ' € par mois' + (ch ? ' charges comprises' : ''));
      C('loyer', 'Loyer charges comprises', 'ok', montant(total) + ' € par mois', 'loyer');
    }

    // ── Charges + modalité (2°) — habitation ──
    if (!hors) {
      if (ch === 0) {
        L('charges', 'Charges : aucune');
        C('charges', 'Charges et modalité', 'ok', 'aucune charge', 'identite');
      } else if (ch == null) {
        L('charges', 'Charges : ' + MANQUE('montant des charges'), true);
        C('charges', 'Charges et modalité', 'ko', 'montant non renseigné', 'loyer');
      } else {
        const mod = modalite === 'forfait' ? 'forfait' : modalite === 'provision' ? 'provision avec régularisation annuelle' : '';
        L('charges', 'Charges : ' + montant(ch) + ' € par mois — ' + (mod || MANQUE('mode de règlement des charges')), !mod);
        C('charges', 'Charges et modalité', mod ? 'ok' : 'ko', mod ? montant(ch) + ' € · ' + (modalite === 'forfait' ? 'forfait' : 'provision') : 'mode de règlement non renseigné', 'identite');
      }
    }

    // ── Meublé (5°) ──
    if (!hors) {
      if (meuble) { L('meuble', 'Location meublée'); C('meuble', 'Location meublée', 'ok', 'oui', ''); }
      else C('meuble', 'Meublé', 'na', 'location vide', '');
    }

    // ── Dépôt de garantie (4°) ──
    if (dg == null) {
      if (!hors) {
        L('dg', 'Dépôt de garantie : ' + MANQUE('montant'), true);
        C('dg', 'Dépôt de garantie', 'ko', 'non renseigné', 'identite');
      }
    } else if (dg === 0) {
      if (!hors) { L('dg', 'Dépôt de garantie : aucun'); C('dg', 'Dépôt de garantie', 'ok', 'aucun', 'identite'); }
    } else {
      L('dg', 'Dépôt de garantie : ' + montant(dg) + ' €');
      let etat = 'ok', detail = montant(dg) + ' €';
      if (!hors && hc) {
        const usage = _s(log.typeUsage);
        if (usage === 'mobilite') { etat = 'warn'; detail += ' — aucun dépôt en bail mobilité (art. 25-17)'; }
        else if (meuble && dg > 2 * hc) { etat = 'warn'; detail += ' — au-delà de 2 mois de loyer (art. 25-6)'; }
        else if (!meuble && dg > hc) { etat = 'warn'; detail += ' — au-delà d\'1 mois de loyer (art. 22)'; }
      }
      C('dg', 'Dépôt de garantie', etat, detail, 'identite');
    }

    // ── Honoraires (arr. 2022 6° ; arr. 2017 4-I-6°) ──
    const hEdl = nombre(log.honorairesEdlRef);
    if (!hors && hEdl && hEdl > 0) {
      L('honorairesEdl', 'Honoraires d\'état des lieux à la charge du locataire : ' + montant(hEdl) + ' € TTC');
      C('honorairesEdl', 'Honoraires d\'état des lieux', 'ok', montant(hEdl) + ' € TTC', 'identite');
    } else if (!hors) {
      C('honorairesEdl', 'Honoraires d\'état des lieux', 'na', 'aucun renseigné', 'identite');
    }
    if (ctx.mandataire) {
      const hcl = nombre(log.honorairesHclRef);
      if (hcl == null) {
        if (!hors) {
          L('hcl', MANQUE('montant TTC') + ' ' + TXT_HCL, true);
          C('hcl', 'Honoraires charge locataire', 'ko', 'mandataire configuré — montant non renseigné', 'identite');
        }
      } else {
        L('hcl', montant(hcl) + ' € TTC ' + TXT_HCL);
        C('hcl', 'Honoraires charge locataire', 'ok', montant(hcl) + ' € TTC', 'identite');
      }
    }

    // ── Surface (8°) ──
    const surf = nombre(log.surf);
    const libSurf = hors ? 'Surface' : 'Surface habitable';
    if (surf && surf > 0) {
      L('surface', libSurf + ' : ' + montant(surf) + ' m²');
      C('surface', libSurf, 'ok', montant(surf) + ' m²', 'identite');
    } else {
      L('surface', libSurf + ' : ' + MANQUE('surface'), true);
      C('surface', libSurf, 'ko', 'non renseignée', 'identite');
    }

    // ── Commune (+ arrondissement « le cas échéant », 7°) ──
    const c = commune(imm);
    if (c.texte && !c.manque) {
      L('commune', 'Commune : ' + c.texte);
      C('commune', /arrondissement/.test(c.texte) ? 'Commune + arrondissement' : 'Commune', 'ok', c.texte, 'immeuble');
    } else {
      L('commune', 'Commune : ' + (c.texte || MANQUE('commune')), true);
      C('commune', c.texte ? 'Commune + arrondissement' : 'Commune', 'ko', c.texte ? 'arrondissement non déductible du code postal' : 'non renseignée', 'immeuble');
    }

    // ── DPE : classes (L126-33, R126-21/22) ──
    const classe = _s(dpe.classe).toUpperCase();
    const ges = _s(dpe.ges).toUpperCase();
    const garage = _s(log.typeUsage) === 'garage';
    if (classe && ges) {
      L('dpe', 'Classe énergie : ' + classe + ' · Classe climat : ' + ges);
      C('dpe', 'Classes énergie et climat', 'ok', classe + ' · ' + ges, 'dpe');
    } else if (dpe.na === true || (garage && !classe && !ges)) {
      C('dpe', 'DPE', 'na', garage ? 'non concerné — non chauffé (R126-15 f)' : 'déclaré non concerné', 'dpe');
    } else {
      L('dpe', 'Classe énergie : ' + (classe || MANQUE('classe énergie du DPE')) + ' · Classe climat : ' + (ges || MANQUE('classe climat du DPE')), true);
      C('dpe', 'Classes énergie et climat', 'ko', classe || ges ? 'une classe manque' : 'DPE non renseigné', 'dpe');
    }

    // ── Habitation seulement : F/G (R126-24) + dépenses (R126-23) ──
    if (!hors && dpe.na !== true) {
      if (classe === 'F' || classe === 'G') {
        L('excessif', TXT_EXCESSIF + 'classe ' + classe + '.');
        C('excessif', 'Mention classe ' + classe, 'ok', 'ajoutée', '');
      }
      const dep = depensesTexte(dpe.depensesEnergie);
      const ann = _anneesTexte(dpe.anneePrix);
      if (dep && ann) {
        L('depenses', TXT_DEPENSES + dep + '. ' + ann);
        C('depenses', 'Dépenses d\'énergie + années des prix', 'ok', dep.replace(/^entre\s+/i, '') + ' · ' + _s(dpe.anneePrix), 'dpe');
      } else {
        const quoi = !dep && !ann ? 'montant et années de référence des prix indiqués sur le DPE' : !dep ? 'montant indiqué sur le DPE' : 'années de référence des prix indiquées sur le DPE';
        L('depenses', TXT_DEPENSES + (dep ? dep + '. ' : '') + MANQUE(quoi), true);
        C('depenses', 'Dépenses d\'énergie + années des prix', 'ko', !dep && !ann ? 'DPE non renseigné' : 'à compléter : ' + (!dep ? 'montant' : 'années des prix'), 'dpe');
      }
    }

    // ── Géorisques (R125-25) — toujours (D10) ──
    L('georisques', TXT_GEORISQUES);
    C('georisques', 'Géorisques', 'ok', 'présent', '');

    return { lignes, controle };
  }

  // ═══════════════════════════════════════════════════════════════
  // Texte unique (format B)
  // ═══════════════════════════════════════════════════════════════
  function genererDossier(log) {
    const lignes = [RUBRIQUES.dossier].concat(DOSSIER_PIECES.map(p => '- ' + p));
    const gar = garanties(log);
    if (gar.length) lignes.push('Garanties acceptées : ' + gar.join(' ou ') + '.');
    lignes.push(TXT_DOSSIERFACILE);
    return lignes.join('\n');
  }

  /**
   * @param {object} args { log, imm, dpe, composition, mandataire, includeDossier, aujourdhui }
   * @returns {{ mode, titre, texte, mentions, controle, manquantes }}
   */
  function genererAnnonce(args) {
    const a = args || {};
    const log = a.log || {}; const imm = a.imm || {};
    const hors = estHorsHabitation(log);
    const ctx = { dpe: a.dpe || {}, composition: a.composition || '', mandataire: !!a.mandataire, aujourdhui: a.aujourdhui || '' };
    const { lignes, controle } = genererMentions(log, imm, ctx);
    // Blocs GÉNÉRÉS (hors INFORMATIONS), mémorisés : majMentions ne les remplace que s'ils n'ont pas été retouchés.
    const blocs = { accroche: genererAccroche(log, imm, ctx), logement: '', points: '', dossier: '' };
    if (!hors) {
      const compo = _composition(ctx.composition);
      if (compo) blocs.logement = RUBRIQUES.logement + '\n' + compo;
      const pf = pointsForts(log);
      if (pf.length) blocs.points = RUBRIQUES.points + '\n' + pf.map(p => '- ' + p).join('\n');
      if (a.includeDossier !== false) blocs.dossier = genererDossier(log);
      else {
        const gar = garanties(log);
        if (gar.length) blocs.dossier = 'Garanties acceptées : ' + gar.join(' ou ') + '.';
      }
    }
    const infos = RUBRIQUES.infos + '\n' + lignes.map(l => l.texte).join('\n');
    const texte = [blocs.accroche, blocs.logement, blocs.points, blocs.dossier, infos].filter(Boolean).join('\n\n');
    const r = { mode: hors ? 'hors-habitation' : 'habitation', titre: genererTitre(log, imm), texte, blocs, mentions: lignes, controle };
    return Object.assign(r, controlerTexte(texte, r));
  }

  // ═══════════════════════════════════════════════════════════════
  // Contrôle EN DIRECT du texte retouché — comparaison LIGNE PAR LIGNE
  // ═══════════════════════════════════════════════════════════════
  const _norme = (l) => String(l).replace(/\s+$/, '');

  /** Repère la ligne d'une mention : 'exacte' (identique), 'modifiee' (même libellé, autre valeur), ou rien. */
  function _cherche(lignes, m, depuis) {
    let mod = -1;
    for (let i = depuis || 0; i < lignes.length; i++) {
      const l = _norme(lignes[i]);
      if (l === m.texte) return { etat: 'exacte', i };
      if (mod < 0 && _memeLibelle(l, m)) mod = i;
    }
    return mod >= 0 ? { etat: 'modifiee', i: mod } : null;
  }
  function _memeLibelle(ligne, m) {
    if (m.key === 'hcl') return ligne.indexOf(TXT_HCL) >= 0;
    const lib = m.libelle || '';
    return !!lib && ligne.indexOf(lib) === 0;
  }
  function _debutInfos(lignes) {
    const i = lignes.findIndex(l => _norme(l) === RUBRIQUES.infos);
    return i < 0 ? 0 : i;
  }

  /**
   * Relit le texte, ligne par ligne :
   *   ligne identique → état du moteur (ok / warn ; ko si elle porte encore « [À COMPLÉTER] ») ;
   *   ligne au même libellé mais autre valeur → 'modifie' (« diffère de la fiche · Rétablir ») ;
   *   aucune ligne → 'retire' (« retirée du texte · Remettre »).
   * Recherche d'abord sous INFORMATIONS, puis dans tout le texte.
   */
  function controlerTexte(texte, annonce) {
    const t = String(texte == null ? '' : texte);
    const lignes = t.split('\n');
    const d = _debutInfos(lignes);
    const parKey = {};
    (annonce.mentions || []).forEach(m => { parKey[m.key] = m; });
    const controle = (annonce.controle || []).map(c => {
      const m = parKey[c.key];
      if (!m || c.etat === 'na') return Object.assign({}, c);
      const f = _cherche(lignes, m, d) || _cherche(lignes, m, 0);
      if (!f) return Object.assign({}, c, { etat: 'retire', detail: 'retirée du texte' });
      if (f.etat === 'modifiee') return Object.assign({}, c, { etat: 'modifie', detail: 'diffère de la fiche' + (m.manquant ? '' : ' (' + m.texte.slice((m.libelle || '').length).slice(0, 40) + ')') });
      return Object.assign({}, c);
    });
    return {
      controle,
      manquantes: controle.filter(c => c.etat === 'ko').length,
      retirees: controle.filter(c => c.etat === 'retire').length,
      modifiees: controle.filter(c => c.etat === 'modifie').length,
      emplacements: (t.match(RE_MANQUE) || []).length
    };
  }

  /**
   * « Remettre » / « Rétablir » : la phrase exacte de la fiche.
   *   ligne modifiée (même libellé) → REMPLACÉE (jamais de doublon contradictoire) ;
   *   sinon insérée sous INFORMATIONS, après la dernière mention précédente présente (ordre du moteur),
   *   sinon juste sous le titre INFORMATIONS, sinon en fin de texte sous ce titre.
   */
  function remettreMention(texte, annonce, key) {
    const lignes = String(texte == null ? '' : texte).split('\n');
    const liste = annonce.mentions || [];
    const k = liste.findIndex(m => m.key === key);
    if (k < 0) return lignes.join('\n');
    const m = liste[k];
    const d = _debutInfos(lignes);
    const f = _cherche(lignes, m, d) || _cherche(lignes, m, 0);
    if (f && f.etat === 'exacte') return lignes.join('\n');
    if (f && f.etat === 'modifiee') { lignes[f.i] = m.texte; return lignes.join('\n'); }
    for (let j = k - 1; j >= 0; j--) {
      const p = _cherche(lignes, liste[j], d);
      if (p && p.etat === 'exacte') { lignes.splice(p.i + 1, 0, m.texte); return lignes.join('\n'); }
    }
    const h = lignes.findIndex(l => _norme(l) === RUBRIQUES.infos);
    if (h >= 0) { lignes.splice(h + 1, 0, m.texte); return lignes.join('\n'); }
    return lignes.join('\n').replace(/\s+$/, '') + '\n\n' + RUBRIQUES.infos + '\n' + m.texte;
  }

  /**
   * Après un passage par la fiche : met le texte retouché à jour SANS toucher aux retouches.
   *  - mentions : ligne identique à l'ancienne version → remplacée ; mention nouvelle → insérée à sa
   *    place ; mention disparue → sa LIGNE ENTIÈRE retirée (jamais un morceau de phrase de l'utilisateur) ;
   *  - blocs générés (accroche, logement, points forts, dossier) : remplacés s'ils sont restés
   *    identiques à leur version générée ; sinon signalés « à relire » s'ils ont changé.
   * @returns {{ texte: string, aRelire: string[] }}  aRelire ⊂ ['accroche','logement','points','dossier']
   */
  function majMentions(texte, ancienne, nouvelle) {
    let t = String(texte == null ? '' : texte);
    const aRelire = [];
    const ab = ancienne.blocs || {}, nb = nouvelle.blocs || {};
    ['accroche', 'logement', 'points', 'dossier'].forEach(k => {
      const o = ab[k] || '', n = nb[k] || '';
      if (o === n) return;
      if (o && t.indexOf(o) >= 0) t = n ? t.replace(o, n) : t.replace(o + '\n\n', '').replace('\n\n' + o, '').replace(o, '');
      else if (o || n) aRelire.push(k);
    });
    let lignes = t.split('\n');
    const avant = {};
    (ancienne.mentions || []).forEach(m => { avant[m.key] = m.texte; });
    const nouv = {};
    (nouvelle.mentions || []).forEach(m => { nouv[m.key] = true; });
    // Mentions disparues : ligne entière identique, retirée.
    (ancienne.mentions || []).forEach(m => {
      if (!nouv[m.key]) lignes = lignes.filter(l => _norme(l) !== m.texte);
    });
    // Mentions changées : ligne identique à l'ancienne version → nouvelle version.
    (nouvelle.mentions || []).forEach(m => {
      const old = avant[m.key];
      if (old && old !== m.texte) {
        const i = lignes.findIndex(l => _norme(l) === old);
        if (i >= 0) lignes[i] = m.texte;
      }
    });
    t = lignes.join('\n');
    // Mentions nouvelles : insérées à leur place.
    (nouvelle.mentions || []).forEach(m => {
      if (!avant[m.key]) t = remettreMention(t, nouvelle, m.key);
    });
    return { texte: t, aRelire };
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.AnnonceGenerator = {
    TXT_GEORISQUES: TXT_GEORISQUES,
    TXT_DEPENSES: TXT_DEPENSES,
    TXT_EXCESSIF: TXT_EXCESSIF,
    TXT_HCL: TXT_HCL,
    RUBRIQUES: RUBRIQUES,
    DOSSIER_PIECES: DOSSIER_PIECES,
    TXT_DOSSIERFACILE: TXT_DOSSIERFACILE,
    USAGES_HORS_HABITATION: USAGES_HORS_HABITATION,
    USAGES_MEUBLES: USAGES_MEUBLES,
    MANQUE: MANQUE,
    RE_MANQUE: RE_MANQUE,
    nombre: nombre,
    montant: montant,
    estHorsHabitation: estHorsHabitation,
    estMeuble: estMeuble,
    etageLabel: etageLabel,
    villeAArrondissements: villeAArrondissements,
    commune: commune,
    communeLabel: communeLabel,
    dateFr: dateFr,
    natureBien: natureBien,
    depensesTexte: depensesTexte,
    pointsForts: pointsForts,
    garanties: garanties,
    genererTitre: genererTitre,
    genererAccroche: genererAccroche,
    genererMentions: genererMentions,
    genererDossier: genererDossier,
    genererAnnonce: genererAnnonce,
    controlerTexte: controlerTexte,
    remettreMention: remettreMention,
    majMentions: majMentions
  };
})(typeof window !== 'undefined' ? window : globalThis);
