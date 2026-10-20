/**
 * bail-signature-etat.global.js — Wrapper browser (window.BailSignatureEtat)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    js/core/bail-signature-etat.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // js/core/bail-signature-etat.js — « Le bail est-il signé, et Propryo en détient-il une PREUVE ÉLECTRONIQUE ? »
  // Module PUR, testé (__tests__/helpers/bail-signature-etat.test.js). Conception :
  // docs/subjects/BAIL-EN-COURS-SIGNE-HORS-PROPRYO.md §1.
  //
  // POURQUOI. Un bail peut être signé hors Propryo (papier, notaire, bail repris du vendeur). Il est alors
  // CONCLU (gel des termes, journal des modifications, verrou cloud, avenants…), mais Propryo ne détient ni
  // signature électronique, ni PDF signé, ni certificat. On garde donc `signatures.signedAt` comme critère
  // « contrat conclu » (≈ 90 lecteurs) et on ajoute un MODE explicite `'externe'` pour la dizaine de sites qui
  // demandent « y a-t-il une preuve électronique ? » (archivage PDF, certificat, relais, clause du contrat type).
  //
  // RÈGLE DURE : on ne fabrique JAMAIS de signature. L'objet produit ne contient ni `finales`, ni `paraphes`,
  // ni `parapheImg`, ni `proof`, ni `contentHash`, ni `certRef`, ni `cloudPdfKey`, ni `remoteSession`.
  //
  // ⚠️ Pas d'import : le module est recopié tel quel dans un miroir IIFE (js/helpers/bail-signature-etat.global.js,
  // window.BailSignatureEtat) par tools/sync-helpers-global-mirrors.mjs.

  /** Même valeur que FORMAT_SIGNATURES (bail-paraphes.js) : `_appAJourPourSigner` lit `signatures.format`. */
  const FORMAT_SIGNATURE_EXTERNE = 2;

  /** Origines possibles d'une déclaration « signé hors Propryo ». */
  const ORIGINES_EXTERNE = ['papier', 'repris', 'session-expiree'];

  /** Motifs d'archivage d'une signature retirée de l'état courant (bail.signaturesAnnulees). */
  const MOTIFS_ARCHIVE = ['externe-retire', 'externe-redate', 'remplace-par-externe', 'session-annulee'];

  const _ISO_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

  /** 'AAAA-MM-JJ' valide (calendrier compris : pas de 31/02) ? */
  function dateJourValide(s) {
    const m = _ISO_JOUR.exec(String(s == null ? '' : s));
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }

  function _iso(now) {
    const d = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
    return isNaN(d) ? new Date().toISOString() : d.toISOString();
  }

  function _jourDe(signedAt) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(signedAt == null ? '' : signedAt));
    return m ? m[1] : null;
  }

  /**
   * État de signature d'un bail.
   *   conclu       = signedAt présent ET mode ≠ 'bailleur-seul'   (= bailSigneComplet, bail-modifications.js)
   *   externe      = conclu ET mode === 'externe'
   *   electronique = conclu ET mode ≠ 'externe'                    ('avec-locataire', 'distance', ancien format sans mode)
   *   partiel      = signedAt ET mode === 'bailleur-seul'
   * @returns {{ etat: 'non'|'partiel'|'electronique'|'externe', conclu: boolean, date: string|null }}
   */
  function etatSignatureBail(bail) {
    const s = bail && bail.signatures;
    if (!s || !s.signedAt) return { etat: 'non', conclu: false, date: null };
    if (s.mode === 'bailleur-seul') return { etat: 'partiel', conclu: false, date: _jourDe(s.signedAt) };
    if (s.mode === 'externe') {
      const d = s.externe && dateJourValide(s.externe.date) ? s.externe.date : _jourDe(s.signedAt);
      return { etat: 'externe', conclu: true, date: d };
    }
    return { etat: 'electronique', conclu: true, date: _jourDe(s.signedAt) };
  }

  /** Propryo détient-il une preuve électronique de la signature ? (faux pour un bail externe) */
  function preuveElectronique(bail) {
    return etatSignatureBail(bail).etat === 'electronique';
  }

  /** Bail déclaré signé hors Propryo ? */
  function estSigneExterne(bail) {
    return etatSignatureBail(bail).etat === 'externe';
  }

  /**
   * L'objet `signatures` d'un bail signé hors Propryo (pur : ne touche pas au bail).
   * @param {object} bail   bail concerné (sert à déduire l'origine : 'repris' si typeContrat === 'repris')
   * @param {{date:string, origine?:string, now?:Date|string|number, auteur?:string, dateApprox?:boolean, snapshot?:object}} o
   *        date : 'AAAA-MM-JJ' (jour de signature, saisi). snapshot : termes déclarés (bail sans signatures).
   * @throws {RangeError} date absente ou invalide (code 'date-invalide')
   */
  function declarerSignatureExterne(bail, o) {
    const opt = o || {};
    if (!dateJourValide(opt.date)) {
      const e = new RangeError('Date de signature invalide (AAAA-MM-JJ attendu)');
      e.code = 'date-invalide';
      throw e;
    }
    const now = _iso(opt.now);
    let origine = ORIGINES_EXTERNE.indexOf(opt.origine) >= 0 ? opt.origine : null;
    if (!origine) origine = (bail && bail.typeContrat === 'repris') ? 'repris' : 'papier';
    const externe = { date: opt.date, origine, declareLe: now, declarePar: String(opt.auteur || '') };
    if (opt.dateApprox) externe.dateApprox = true;
    const sg = {
      format: FORMAT_SIGNATURE_EXTERNE,
      mode: 'externe',
      signatureSource: 'externe',     // posé AVANT le scellement : sealSignedBaux n'écrase que s'il est vide
      signedAt: opt.date + 'T12:00:00.000Z',   // midi UTC : même convention que la date saisie d'une signature en présence
      persistedAt: now,
      externe
    };
    if (opt.snapshot && typeof opt.snapshot === 'object') {
      sg.bailSnapshot = JSON.parse(JSON.stringify(opt.snapshot));
      delete sg.bailSnapshot.signatures;
      delete sg.bailSnapshot.signaturesAnnulees;
    }
    return sg;
  }

  /**
   * Entrée d'archive (bail.signaturesAnnulees) pour une signature retirée de l'état courant. Pure : copie
   * profonde, ne modifie pas le bail. Rien n'est détruit : la copie intégrale de l'ancien objet est gardée.
   * @param {{now?:any, auteur?:string, motif:string, etatRelais?:string}} o
   * @returns {{archive: object|null}} archive = null si le bail n'a aucune signature.
   */
  function archiverSignatures(bail, o) {
    const opt = o || {};
    const sg = bail && bail.signatures;
    if (!sg || typeof sg !== 'object') return { archive: null };
    const archive = {
      at: _iso(opt.now),
      par: String(opt.auteur || ''),
      motif: MOTIFS_ARCHIVE.indexOf(opt.motif) >= 0 ? opt.motif : String(opt.motif || ''),
      signatures: JSON.parse(JSON.stringify(sg))
    };
    if (opt.etatRelais) archive.etatRelais = String(opt.etatRelais);
    // Le jeton propriétaire du relais (il ouvre le DELETE qui détruit la session et son PDF signé) ne part jamais dans l'archive,
    // synchronisée chez les membres de la SCI. Rien ne le relit après l'archivage : une purge à retenter le garde sur l'appareil
    // qui l'a lancée (file locale), une signature récupérée reprend le jeton de la session vivante.
    if (archive.signatures.remoteSession && typeof archive.signatures.remoteSession === 'object') archive.signatures.remoteSession.ownerToken = null;
    const rs = sg.remoteSession;
    if (rs && typeof rs === 'object') {
      archive.resume = {
        envoyeeLe: rs.createdAt || null,
        signataires: (Array.isArray(rs.signers) ? rs.signers : []).map(function (x) {
          return { role: x && x.role || null, nom: x && x.nom || null, signedAt: x && x.signedAt || null };
        })
      };
    }
    return { archive };
  }

  /**
   * Décoche « signé hors Propryo » : l'entrée d'archive à ajouter à `bail.signaturesAnnulees` (motif
   * 'externe-retire', ou celui passé en option, p. ex. 'externe-redate'). Pour un bail qui n'est pas
   * externe : `{ archive: null }` (jamais d'archivage d'une signature électronique par ce chemin).
   */
  function retirerSignatureExterne(bail, o) {
    if (!estSigneExterne(bail)) return { archive: null };
    const opt = o || {};
    return archiverSignatures(bail, { now: opt.now, auteur: opt.auteur, motif: opt.motif || 'externe-retire' });
  }

  /** Libellé court de l'état, pour badges et cartes (le choix des couleurs reste à l'appelant). */
  function libelleSignatureBail(bail) {
    const e = etatSignatureBail(bail);
    if (e.etat === 'externe') return 'Signé hors Propryo';
    if (e.etat === 'electronique') return 'Signé bilatéralement';
    if (e.etat === 'partiel') return 'Signature en cours';
    return 'Non signé';
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailSignatureEtat = {
    FORMAT_SIGNATURE_EXTERNE: FORMAT_SIGNATURE_EXTERNE,
    ORIGINES_EXTERNE: ORIGINES_EXTERNE,
    MOTIFS_ARCHIVE: MOTIFS_ARCHIVE,
    dateJourValide: dateJourValide,
    etatSignatureBail: etatSignatureBail,
    preuveElectronique: preuveElectronique,
    estSigneExterne: estSigneExterne,
    declarerSignatureExterne: declarerSignatureExterne,
    archiverSignatures: archiverSignatures,
    retirerSignatureExterne: retirerSignatureExterne,
    libelleSignatureBail: libelleSignatureBail
  };
})(typeof window !== 'undefined' ? window : globalThis);
