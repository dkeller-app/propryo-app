/* js/app/demo-dataset.js — COMPTE DÉMO (05/10/2026)
 *
 * Jeu de données du mode démonstration (`index.html?demo=1`) et du bouton « Charger dataset démo » du
 * sandbox. Chargé À LA DEMANDE par _loadDemoDataset (app-part1.js) : aucun poids pour les vrais comptes.
 *
 * L'HISTOIRE (figée au JOUR_DEMO, cf. l'horloge figée du <head> d'index.html) :
 *   SCI Patrimoine Démo — 12 rue des Tanneurs, Mulhouse (4 lots, compte bancaire de la SCI, plafond d'intervention 300 €)
 *     D-101  « T2 du rez-de-chaussée », Pierre Martin   à jour · EDL d'entrée avec photos · révision IRL à faire
 *            · espace locataire actif (message non lu) · incident en cours : fuite sous l'évier, plombier du carnet
 *              prévenu, devis de 185 € accepté automatiquement (sous le plafond), rendez-vous confirmé
 *     D-102  T3 nu, Marie Bernard           impayé (relance → mise en demeure) · dépôt de garantie NON versé (case)
 *     D-103  studio VACANT                  à relouer · 2 candidatures (dossier complet vérifié 2D-Doc / dossier en cours)
 *     D-104  T2 meublé, Lucas Petit         à jour · DPE F → révision IRL gelée · espace locataire : un signalement
 *            (volet roulant) arrive au premier démarrage de la démo et entre au registre des incidents
 *   Camille Mercier, en nom propre — Résidence du Parc, Colmar (2 lots)
 *     P-201  T3 nu, Julien et Sarah Lefèvre  à jour · bail à 2 locataires · espace locataire (un lien par colocataire)
 *            · incident terminé : chaudière, constat de l'artisan, dépense payée, résultat publié au locataire
 *     P-202  « Parking n° 12 », Nicolas Faure  à jour · bail et état des lieux signés HORS Propryo (papier)
 *
 * Le « nuage » de la démo (liens de l'espace locataire, documents publiés, messages, signalements, liens et devis des
 * artisans) n'existe que dans ce navigateur : son plan (`nuage`) est semé par js/app/demo-app.js dans un stockage
 * local `_demo_`. Aucun jeton, aucune session de signature à distance, aucun lien de candidature : rien que le relais
 * pourrait reconnaître. Les vérifications 2D-Doc des pièces sont des RÉSULTATS PRÉ-CALCULÉS sur des documents
 * fictifs (aucun vrai document, aucun vrai numéro fiscal), posés par demo-app.js avec le module de vérification.
 *
 * Les mouvements bancaires s'arrêtent au 30/09 : le fichier d'exemple
 * PROPRYO-COM/6-presentation-demo/Propryo-demo-releve-SCI-octobre-2026.ofx (1er → 5 octobre, compte de la SCI)
 * s'importe en direct pendant la démo. Un loyer du mois n'est en retard qu'à partir du 10 (tolérance de
 * l'app) : au jour de la démo, octobre n'est
 * pas encore exigible → tableau de bord « sous contrôle », seules les 3 actions voulues ressortent.
 *
 * Tous les noms sont fictifs. Les indices IRL sont ceux de la table de l'app (IRL_DEFAULT, INSEE).
 */
(function () {
  'use strict';

  var JOUR_DEMO = '2026-10-05';

  // ── Petites aides ─────────────────────────────────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }           // m : 1..12
  function arr2(x) { return Math.round(x * 100) / 100; }
  // Mois de [debut ; fin] inclus, au format {y, m}.
  function mois(y0, m0, y1, m1) {
    var out = [], y = y0, m = m0;
    while (y < y1 || (y === y1 && m <= m1)) { out.push({ y: y, m: m }); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }
  var MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  // ── Images générées localement (canvas → data URL ; aucun binaire externe) ──────────────────────
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill(); }
  function piece(o) {
    try {
      var c = document.createElement('canvas'); c.width = 900; c.height = 600; var g = c.getContext('2d');
      g.fillStyle = o.floor; g.fillRect(0, 368, 900, 232);
      g.fillStyle = o.wall; g.fillRect(0, 0, 900, 368);
      g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, 360, 900, 10);
      g.fillStyle = '#e6eef5'; g.fillRect(560, 66, 250, 196);
      g.strokeStyle = '#c4d1dd'; g.lineWidth = 12; g.strokeRect(560, 66, 250, 196);
      g.lineWidth = 6; g.beginPath(); g.moveTo(685, 66); g.lineTo(685, 262); g.moveTo(560, 164); g.lineTo(810, 164); g.stroke();
      var lg = g.createLinearGradient(560, 66, 690, 420); lg.addColorStop(0, 'rgba(255,255,255,.55)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(470, 66, 360, 360);
      if (o.sofa) { g.fillStyle = o.sofa; rr(g, 70, 300, 330, 110, 18); rr(g, 60, 266, 70, 150, 14); rr(g, 340, 266, 70, 150, 14); g.fillStyle = 'rgba(255,255,255,.18)'; rr(g, 92, 312, 130, 60, 10); rr(g, 236, 312, 130, 60, 10); }
      if (o.counter) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(70, 320, 380, 100); g.fillStyle = o.counter; g.fillRect(64, 300, 392, 26); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(360, 300, 92, 26); g.strokeStyle = 'rgba(0,0,0,.15)'; g.lineWidth = 2; for (var i = 0; i < 3; i++) g.strokeRect(80 + i * 126, 332, 110, 80); }
      if (o.bed) { g.fillStyle = o.bed; rr(g, 80, 300, 300, 120, 14); g.fillStyle = '#f4f1ea'; rr(g, 92, 286, 300, 60, 12); g.fillStyle = 'rgba(255,255,255,.9)'; rr(g, 110, 300, 90, 44, 10); rr(g, 214, 300, 90, 44, 10); }
      if (o.bath) { g.fillStyle = '#f7f9fb'; rr(g, 90, 280, 360, 130, 20); g.fillStyle = '#dfe7ee'; rr(g, 110, 296, 320, 90, 16); g.fillStyle = '#b8c4cf'; g.fillRect(420, 230, 12, 60); }
      if (o.car) { g.fillStyle = '#9aa3ad'; g.fillRect(0, 0, 900, 600); g.fillStyle = '#80888f'; g.fillRect(0, 380, 900, 220); g.strokeStyle = '#f2f2f2'; g.lineWidth = 8; g.beginPath(); g.moveTo(180, 600); g.lineTo(260, 380); g.moveTo(720, 600); g.lineTo(640, 380); g.stroke(); g.fillStyle = '#f2f2f2'; g.font = '700 90px Arial'; g.fillText('12', 405, 520); }
      g.fillStyle = 'rgba(16,21,33,.5)'; g.font = '600 22px Inter,Arial,sans-serif'; g.fillText(o.tag || '', 30, 42);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '600 18px Arial'; g.fillText(o.stamp || '', 30, 576);
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) { return ''; }
  }
  function compteur(o) {
    try {
      var c = document.createElement('canvas'); c.width = 900; c.height = 600; var g = c.getContext('2d');
      g.fillStyle = '#d9dde4'; g.fillRect(0, 0, 900, 600);
      g.fillStyle = '#f4f6f9'; rr(g, 210, 90, 480, 420, 10);
      g.strokeStyle = '#c2c9d3'; g.lineWidth = 6; g.strokeRect(210, 90, 480, 420);
      g.fillStyle = '#e9edf2'; g.fillRect(240, 120, 420, 70);
      g.fillStyle = '#101521'; g.font = '700 34px Consolas,monospace'; g.fillText(o.reading, 300, 168);
      g.fillStyle = '#cfd6de'; for (var r = 0; r < 3; r++) for (var i = 0; i < 6; i++) rr(g, 250 + i * 66, 220 + r * 84, 52, 60, 6);
      g.fillStyle = '#ff5a3c'; for (var j = 0; j < 6; j++) g.fillRect(266 + j * 66, 236, 20, 12);
      g.fillStyle = 'rgba(16,21,33,.5)'; g.font = '600 22px Inter,Arial,sans-serif'; g.fillText(o.tag || '', 30, 42);
      g.fillStyle = 'rgba(16,21,33,.7)'; g.font = '600 18px Arial'; g.fillText(o.stamp || '', 30, 576);
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) { return ''; }
  }
  // Signature manuscrite stylisée (PNG transparent), déterministe pour un nom donné.
  function signature(nom) {
    try {
      var c = document.createElement('canvas'); c.width = 420; c.height = 150; var g = c.getContext('2d');
      var seed = 0; for (var k = 0; k < nom.length; k++) seed = (seed * 31 + nom.charCodeAt(k)) % 9973;
      function rnd() { seed = (seed * 7919 + 17) % 9973; return seed / 9973; }
      g.strokeStyle = '#1b2a4a'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(30, 95);
      var x = 30;
      for (var s = 0; s < 9; s++) {
        var nx = x + 30 + rnd() * 18, h = 30 + rnd() * 45;
        g.bezierCurveTo(x + 8, 95 - h, nx - 8, 95 + h * 0.6, nx, 90 - rnd() * 20);
        x = nx;
      }
      g.stroke();
      g.beginPath(); g.moveTo(40, 118); g.quadraticCurveTo(200, 100 + rnd() * 20, x + 10, 112); g.stroke();
      return c.toDataURL('image/png');
    } catch (e) { return ''; }
  }

  // Les PDF de diagnostics « factices » (une page, texte simple) — pièces jointes de démonstration.
  function pdfUnePage(titre, sousTitre) {
    var contenu = 'BT /F1 20 Tf 60 770 Td (' + titre + ') Tj ET\nBT /F1 12 Tf 60 742 Td (' + sousTitre + ') Tj ET\nBT /F1 10 Tf 60 716 Td (Document de demonstration Propryo - donnees fictives) Tj ET\n';
    var objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + contenu.length + ' >>\nstream\n' + contenu + 'endstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];
    var out = '%PDF-1.4\n', offs = [];
    for (var i = 0; i < objs.length; i++) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (var j = 0; j < offs.length; j++) out += String(offs[j]).padStart(10, '0') + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return 'data:application/pdf;base64,' + btoa(out);
  }

  window.__demoDataset = {
    JOUR_DEMO: JOUR_DEMO,
    construire: function () { return construire(); }
  };

  // ════════════════════════════════════════════════════════════════════════════════════════════════
  function construire() {
    var fichiers = {};                 // idbKey → data URL (photos d'EDL, PDF), semés en IndexedDB
    var SCI = 'SCI Patrimoine Démo', PERSO = 'Camille Mercier';
    var IMM_SCI = 'Les Tanneurs', IMM_PERSO = 'Résidence du Parc';
    var ADR_SCI = '12 rue des Tanneurs, 68100 Mulhouse', ADR_PERSO = '8 avenue de la République, 68000 Colmar';
    var GERANTE = 'Claire Morel';

    // ── Bailleurs ───────────────────────────────────────────────────────────────────────────────
    var entites = [
      { id: 1, nom: SCI, type: 'SCI IR', siren: '912345678', rcs: 'Mulhouse', capital: '1 000 €',
        gerants: [GERANTE], gerant: GERANTE, siege: ADR_SCI,
        iban: 'FR76 9999 9000 1200 0012 3456 797', bic: 'DEMOFRP0XXX', emailEnvoi: '',
        irlMoisRevision: null, signature: signature(GERANTE), logo: null,
        incidentReglages: { plafondTtc: 300, parMetier: {}, conserverPieces: false, valideLe: '2026-09-02T09:30:00.000Z', validePar: '' },
        entityId: 'eid_demo_sci', members: [], driveFileId: null, driveFolderId: null,
        immeubles: [{ id: 100, nom: IMM_SCI, adr: '12 rue des Tanneurs', codePostal: '68100', ville: 'Mulhouse',
          annee: 1975, periodeConstr: 'De 1949 à 1997', regimeJuridique: 'Copropriété', typeHabitat: 'Collectif', nbLots: 4,
          equipementsCommuns: { customs: [] }, syndic: null, compteursCollectifs: [], driveFolderId: null }] },
      { id: 2, nom: PERSO, type: 'Personne physique', siren: '', rcs: '', capital: '',
        gerants: [], gerant: '', siege: '5 rue des Clefs, 68000 Colmar',
        iban: 'FR76 9999 9030 0000 0987 6543 242', bic: 'DEMOFRP0XXX', emailEnvoi: '',
        irlMoisRevision: null, signature: signature(PERSO), logo: null,
        entityId: 'eid_demo_perso', members: [], driveFileId: null, driveFolderId: null,
        immeubles: [{ id: 200, nom: IMM_PERSO, adr: '8 avenue de la République', codePostal: '68000', ville: 'Colmar',
          annee: 2005, periodeConstr: 'Après 1997', regimeJuridique: 'Copropriété', typeHabitat: 'Collectif', nbLots: 2,
          equipementsCommuns: { customs: [] }, syndic: null, compteursCollectifs: [], driveFolderId: null }] }
    ];

    // ── Diagnostics (tous valides au JOUR_DEMO ; ERP < 6 mois) ──────────────────────────────────
    function diagsTanneurs(dpe, ges, valEner, dateDpe) {
      return { dpe: { date: dateDpe, classe: dpe, ges: ges, valEner: valEner, na: false },
        amiante: { date: '2019-03-12', presence: false }, crep: { na: true },
        elec: { na: true }, gaz: { na: true },
        erp: { date: '2026-09-15', expose: false } };
    }
    function diagsParc(dpe, ges, valEner) {
      return { dpe: { date: '2024-05-20', classe: dpe, ges: ges, valEner: valEner, na: false },
        amiante: { na: true }, crep: { na: true }, elec: { na: true }, gaz: { na: true },
        erp: { date: '2026-09-15', expose: false } };
    }
    function lot(o) {
      return Object.assign({ compteCharges: true, notes: '', periodeConstr: 'De 1949 à 1997',
        installationElecAnnee: 2012, locataire: '', tel: '', mail: '', debut: '', fin: '', irlDerniereApplication: '' }, o);
    }

    // ── Loyers et révisions IRL (indices = table IRL_DEFAULT de l'app) ──────────────────────────
    // D-101 : 680 € (juin 2023, IRL T1 2023), révisé chaque 1er octobre (date commune, irlMoisRevision).
    //   01/10/2024 : × 143,46/138,61 → 703,79 € · 01/10/2025 : × 145,47/143,46 → 713,65 €
    //   01/10/2026 : × 146,60/145,47 → révision À FAIRE au JOUR_DEMO (action n° 1 de la démo).
    // P-201 : 850 € (juillet 2024, IRL T1 2024), révisé chaque 1er juillet.
    //   01/07/2025 → 861,91 € · 01/07/2026 → 868,61 €
    // P-202 : 80 € (mars 2025, IRL T4 2024), révisé le 1er mars 2026 : × 145,78/144,64 → 80,63 €
    var HC = { D101: [680, 703.79, 713.65], P201: [850, 861.91, 868.61], P202: [80, 80.63] };

    var logements = [
      lot({ id: 1001, ref: 'D-101', libelle: 'T2 du rez-de-chaussée', imm: IMM_SCI, entity: SCI, type: 'T2', npp: 2, surf: 45, etage: 'RDC',
        adr: '12 rue des Tanneurs — RDC porte gauche', hc: HC.D101[2], ch: 90, dg: 680, tantiemes: 200,
        locataire: 'Pierre Martin', tel: '06 00 00 00 01', mail: 'pierre.martin@exemple.fr',
        debut: '2023-06-15', fin: '2029-06-14', irl: 'T1', irlDerniereApplication: '2025-10-01',
        diagnostics: diagsTanneurs('C', 'C', '145', '2023-04-10') }),
      lot({ id: 1002, ref: 'D-102', imm: IMM_SCI, entity: SCI, type: 'T3', npp: 3, surf: 65, etage: '1er',
        adr: '12 rue des Tanneurs — 1er étage', hc: 900, ch: 130, dg: 900, tantiemes: 280,
        locataire: 'Marie Bernard', tel: '06 00 00 00 02', mail: 'marie.bernard@exemple.fr',
        debut: '2025-12-01', fin: '2031-11-30', irl: 'T3',
        diagnostics: diagsTanneurs('D', 'D', '212', '2025-10-20') }),
      lot({ id: 1003, ref: 'D-103', imm: IMM_SCI, entity: SCI, type: 'Studio', npp: 1, surf: 28, etage: '2e',
        adr: '12 rue des Tanneurs — 2e étage', hc: 520, ch: 60, dg: 520, tantiemes: 120,
        loyerHcRef: 520, chargesRef: 60, irl: '',
        notes: 'Libéré le 31/08/2026 — à relouer.',
        diagnostics: diagsTanneurs('D', 'C', '198', '2024-02-08') }),
      lot({ id: 1004, ref: 'D-104', imm: IMM_SCI, entity: SCI, type: 'T2 meublé', npp: 2, surf: 42, etage: '3e', meuble: true,
        adr: '12 rue des Tanneurs — 3e étage', hc: 780, ch: 100, dg: 1560, tantiemes: 190,
        locataire: 'Lucas Petit', tel: '06 00 00 00 04', mail: 'lucas.petit@exemple.fr',
        debut: '2026-04-01', fin: '2027-03-31', irl: 'T4',
        notes: 'DPE F : loyer gelé (pas de révision IRL possible).',
        diagnostics: diagsTanneurs('F', 'E', '362', '2025-06-01') }),
      lot({ id: 2001, ref: 'P-201', imm: IMM_PERSO, entity: PERSO, type: 'T3', npp: 3, surf: 68, etage: '2e',
        adr: '8 avenue de la République — 2e étage', hc: HC.P201[2], ch: 120, dg: 850, tantiemes: 520,
        periodeConstr: 'Après 1997', installationElecAnnee: 2005,
        locataire: 'Julien Lefèvre et Sarah Lefèvre', tel: '06 00 00 00 11', mail: 'julien.lefevre@exemple.fr',
        debut: '2024-07-01', fin: '2027-06-30', irl: 'T1', irlDerniereApplication: '2026-07-01',
        diagnostics: diagsParc('C', 'B', '128') }),
      lot({ id: 2002, ref: 'P-202', libelle: 'Parking n° 12', imm: IMM_PERSO, entity: PERSO, type: 'Parking', npp: 0, surf: 12, etage: 'Sous-sol',
        adr: '8 avenue de la République — parking n° 12', hc: HC.P202[1], ch: 0, dg: 80, tantiemes: 30, compteCharges: false,
        periodeConstr: 'Après 1997',
        locataire: 'Nicolas Faure', tel: '06 00 00 00 21', mail: 'nicolas.faure@exemple.fr',
        debut: '2025-03-01', fin: '', irl: 'T4', irlDerniereApplication: '2026-03-01',
        diagnostics: { dpe: { na: true }, amiante: { na: true }, crep: { na: true }, elec: { na: true }, gaz: { na: true }, erp: { date: '2026-09-15', expose: false } } })
    ];

    // ── Baux (tous signés, en présence) ─────────────────────────────────────────────────────────
    function loc(civ, prenom, nom, tel, email, ddn, lieu) {
      return { civilite: civ, prenom: prenom, nom: prenom + ' ' + nom, tel: tel, email: email, ddn: ddn, lieuNaiss: lieu };
    }
    function signe(dateIso, nomBailleur, nomsLocs) {
      var at = dateIso + 'T10:00:00.000Z';
      return { bailleur: signature(nomBailleur), locataire: signature(nomsLocs[0]), mode: 'avec-locataire',
        signedAt: at, signedBailleurAt: at, signedLocataireAt: at, locked: true };
    }
    function bail(o) {
      var b = Object.assign({ typeContrat: 'nouveau', jpay: '5', quittanceDemandee: false, garant: null, garant2: null }, o);
      b.nom = b.locataires[0].nom; b.ddn = b.locataires[0].ddn; b.lieuNaiss = b.locataires[0].lieuNaiss;
      b.dateSignaturePrevue = o.dateSignature;
      b.signatures = signe(o.dateSignature, o.entity === SCI ? GERANTE : PERSO, b.locataires.map(function (l) { return l.nom; }));
      // Baux fictifs : signés avec la version des clauses ACTUELLE (marqueur gravé à la signature,
      // cf. js/core/contrat-type.js). Sans lui, l'app les lit comme signés avant tout changement
      // (version 1) et ré-affiche les anciens textes — dont « Bailleur personne morale » sur le bail
      // de Camille Mercier, personne physique. Version 4 = sous-titre du bail nu selon le bailleur.
      b.clauseIrlV = 4;
      // Version signée = le bail TEL QUE SIGNÉ : loyer d'origine (avant révisions IRL).
      var snap = JSON.parse(JSON.stringify(b)); delete snap.signatures; delete snap.hcSigne;
      if (o.hcSigne != null) snap.hc = o.hcSigne;
      delete b.hcSigne;
      b.signatures.bailSnapshot = snap;
      delete b.dateSignature;
      return b;
    }
    var baux = {
      'D-101': bail({ ref: 'D-101', entity: SCI, type: 'nu', debut: '2023-06-15', fin: '2029-06-14', duree: 72,
        hc: HC.D101[2], ch: 90, dg: 680, irl: 'T1 2023', irlMoisRevision: 10, dateSignature: '2023-06-09', hcSigne: HC.D101[0],
        locataires: [loc('M.', 'Pierre', 'Martin', '06 00 00 00 01', 'pierre.martin@exemple.fr', '1991-04-12', 'Strasbourg')] }),
      'D-102': bail({ ref: 'D-102', entity: SCI, type: 'nu', debut: '2025-12-01', fin: '2031-11-30', duree: 72,
        hc: 900, ch: 130, dg: 900, dgVerse: false, irl: 'T3 2025', dateSignature: '2025-11-24',
        locataires: [loc('Mme', 'Marie', 'Bernard', '06 00 00 00 02', 'marie.bernard@exemple.fr', '1987-09-03', 'Mulhouse')] }),
      'D-104': bail({ ref: 'D-104', entity: SCI, type: 'meuble', debut: '2026-04-01', fin: '2027-03-31', duree: 12,
        hc: 780, ch: 100, dg: 1560, irl: 'T4 2025', dateSignature: '2026-03-27',
        locataires: [loc('M.', 'Lucas', 'Petit', '06 00 00 00 04', 'lucas.petit@exemple.fr', '2003-02-21', 'Belfort')] }),
      'P-201': bail({ ref: 'P-201', entity: PERSO, type: 'nu', debut: '2024-07-01', fin: '2027-06-30', duree: 36,
        hc: HC.P201[2], ch: 120, dg: 850, irl: 'T1 2024', dateSignature: '2024-06-21', hcSigne: HC.P201[0],
        locataires: [loc('M.', 'Julien', 'Lefèvre', '06 00 00 00 11', 'julien.lefevre@exemple.fr', '1989-11-30', 'Colmar'),
                     loc('Mme', 'Sarah', 'Lefèvre', '06 00 00 00 12', 'sarah.lefevre@exemple.fr', '1990-06-14', 'Nancy')] }),
      'P-202': bail({ ref: 'P-202', entity: PERSO, type: 'garage', debut: '2025-03-01', fin: '', duree: 12,
        hc: HC.P202[1], ch: 0, dg: 80, irl: 'T4 2024', dateSignature: '2025-02-25', hcSigne: HC.P202[0],
        locataires: [loc('M.', 'Nicolas', 'Faure', '06 00 00 00 21', 'nicolas.faure@exemple.fr', '1984-08-08', 'Colmar')] })
    };
    // Bail de parking signé HORS Propryo (papier, Bail en cours v15.740) : forme exacte de
    // BailSignatureEtat.declarerSignatureExterne — aucune signature simulée, la version signée reste le loyer d'origine.
    (function () {
      var b = baux['P-202'], snap = b.signatures.bailSnapshot, le = '2025-03-02T18:20:00.000Z';
      b.signatures = { format: 2, mode: 'externe', signatureSource: 'externe', signedAt: '2025-02-25T12:00:00.000Z', persistedAt: le,
        externe: { date: '2025-02-25', origine: 'papier', declareLe: le, declarePar: PERSO }, bailSnapshot: snap };
    })();

    // ── Baux terminés (archivés, comme archiverBail) ────────────────────────────────────────────
    // Dépôts des anciens locataires RESTITUÉS (restitution enregistrée = `dgRestitueAt`, règle unique _dgRestitutionEnregistree) :
    // le virement correspondant est dans les mouvements (catégorie « Dépôt de garantie (reçu / restitué) »).
    function ancien(ref, type, debut, fin, finEff, hc, ch, dg, l, restitue, retenu, le) {
      return { ref: ref, entity: SCI, type: type, typeContrat: 'nouveau', debut: debut, fin: fin, finEffective: finEff, hc: hc, ch: ch, dg: dg,
        irl: '', jpay: '5', locataires: [l], nom: l.nom, finMotif: 'Congé du locataire', _archivedAt: finEff, _archivedAuto: false,
        dgRestitue: restitue, dgRetenu: retenu, dgRestitueAt: le };
    }
    var bauxHistorique = [
      ancien('D-102', 'nu', '2021-11-01', '2027-10-31', '2025-10-31', 880, 130, 880, loc('Mme', 'Sophie', 'Klein', '06 00 00 00 31', 'sophie.klein@exemple.fr', '1979-03-15', 'Colmar'), 880, 0, '2025-11-20'),
      ancien('D-104', 'meuble', '2024-04-01', '2025-03-31', '2026-03-31', 760, 100, 1520, loc('Mme', 'Inès', 'Moreau', '06 00 00 00 32', 'ines.moreau@exemple.fr', '2002-12-01', 'Metz'), 1520, 0, '2026-04-22'),
      ancien('D-103', 'nu', '2022-09-01', '2028-08-31', '2026-08-31', 520, 60, 520, loc('M.', 'Thomas', 'Roy', '06 00 00 00 33', 'thomas.roy@exemple.fr', '1995-07-19', 'Mulhouse'), 440, 80, '2026-09-15')
    ];

    // ── Historique des loyers (barème) + journal des révisions IRL ──────────────────────────────
    var loyerBareme = [
      { ref: 'D-101', debut: '2023-06-15', fin: '2024-09-30', hc: HC.D101[0], ch: 90, source: 'bail', bailDebut: '2023-06-15', note: '' },
      { ref: 'D-101', debut: '2024-10-01', fin: '2025-09-30', hc: HC.D101[1], ch: 90, source: 'irl', bailDebut: '2023-06-15', note: 'T1 2024' },
      { ref: 'D-101', debut: '2025-10-01', fin: null, hc: HC.D101[2], ch: 90, source: 'irl', bailDebut: '2023-06-15', note: 'T1 2025' },
      { ref: 'D-102', debut: '2021-11-01', fin: '2025-10-31', hc: 880, ch: 130, source: 'bail', bailDebut: '2021-11-01', note: '' },
      { ref: 'D-102', debut: '2025-12-01', fin: null, hc: 900, ch: 130, source: 'bail', bailDebut: '2025-12-01', note: '' },
      { ref: 'D-103', debut: '2022-09-01', fin: '2026-08-31', hc: 520, ch: 60, source: 'bail', bailDebut: '2022-09-01', note: '' },
      { ref: 'D-104', debut: '2024-04-01', fin: '2026-03-31', hc: 760, ch: 100, source: 'bail', bailDebut: '2024-04-01', note: '' },
      { ref: 'D-104', debut: '2026-04-01', fin: null, hc: 780, ch: 100, source: 'bail', bailDebut: '2026-04-01', note: '' },
      { ref: 'P-201', debut: '2024-07-01', fin: '2025-06-30', hc: HC.P201[0], ch: 120, source: 'bail', bailDebut: '2024-07-01', note: '' },
      { ref: 'P-201', debut: '2025-07-01', fin: '2026-06-30', hc: HC.P201[1], ch: 120, source: 'irl', bailDebut: '2024-07-01', note: 'T1 2025' },
      { ref: 'P-201', debut: '2026-07-01', fin: null, hc: HC.P201[2], ch: 120, source: 'irl', bailDebut: '2024-07-01', note: 'T1 2026' },
      { ref: 'P-202', debut: '2025-03-01', fin: '2026-02-28', hc: HC.P202[0], ch: 0, source: 'bail', bailDebut: '2025-03-01', note: '' },
      { ref: 'P-202', debut: '2026-03-01', fin: null, hc: HC.P202[1], ch: 0, source: 'irl', bailDebut: '2025-03-01', note: 'T4 2025' }
    ];
    function rev(ref, locataire, date, ancien, nouveau, irlRef, vRef, irlV, vV) {
      return { date: date, ref: ref, locataire: locataire, ancienHC: ancien, nouveauHC: nouveau, diff: arr2(nouveau - ancien),
        irlRef: irlRef, irlRefVal: vRef, irlVigueur: irlV, irlVigueurVal: vV,
        dateRevision: date, dateEffet: date, dateApplication: date, dateEffetAjustee: false,
        pendingApply: false, appliedAt: date };
    }
    var irlHistorique = [
      rev('D-101', 'Pierre Martin', '2024-10-01', HC.D101[0], HC.D101[1], 'T1 2023', 138.61, 'T1 2024', 143.46),
      rev('D-101', 'Pierre Martin', '2025-10-01', HC.D101[1], HC.D101[2], 'T1 2024', 143.46, 'T1 2025', 145.47),
      rev('P-201', 'Julien Lefèvre et Sarah Lefèvre', '2025-07-01', HC.P201[0], HC.P201[1], 'T1 2024', 143.46, 'T1 2025', 145.47),
      rev('P-201', 'Julien Lefèvre et Sarah Lefèvre', '2026-07-01', HC.P201[1], HC.P201[2], 'T1 2025', 145.47, 'T1 2026', 146.60),
      rev('P-202', 'Nicolas Faure', '2026-03-01', HC.P202[0], HC.P202[1], 'T4 2024', 144.64, 'T4 2025', 145.78)
    ];

    // ── États des lieux d'entrée (signés, photos semées en IndexedDB) ───────────────────────────
    function ph(ref, cle, label, img) { var k = 'demo_edl_' + ref + '_' + cle; fichiers[k] = img; return { name: label, idbKey: k, ts: '', cloudKey: '' }; }
    function el(nom, etat, obs, photos) { return { nom: nom, etatE: etat, obsE: obs || '', photosE: photos || [], etatS: '', obsS: '', photosS: [] }; }
    function edl(id, ref, locataire, dateIso, surf, nomBailleur, pieces, compteurs, opts) {
      return Object.assign({ id: id, type: 'Entrée', date: dateIso, logement: ref, locataire: locataire, locAdr: '',
        gerant: nomBailleur, bailleurNom: nomBailleur, bailleurAdr: '', adr: '', surf: surf, npp: '', ltype: '', notes: '',
        pieces: pieces, compteurs: compteurs, compteursSortie: {}, chauffage: {}, technologies: {},
        cles: [{ type: 'Porte d\'entrée', nb: '2', nbS: '', obs: '', photos: [], photosS: [] },
               { type: 'Boîte aux lettres', nb: '1', nbS: '', obs: '', photos: [], photosS: [] }],
        daaf: null, mobilierEnabled: false, mobilier: null, garage: false,
        signatures: { bailleur: signature(nomBailleur), locataire: signature(locataire), signedAt: dateIso + 'T09:30:00.000Z' } }, opts || {});
    }
    var stamp = function (d) { return d.split('-').reverse().join('/') + '  10:42'; };
    var edls = [
      edl(3001, 'D-101', 'Pierre Martin', '2023-06-15', 45, GERANTE, [
        { nom: 'Séjour', elements: [
          el('Murs / peinture', 'Bon état', 'Peinture refaite à neuf, aucune trace.', [ph('D-101', 'sejour', 'Séjour — murs', piece({ wall: '#efe8dd', floor: '#c39a63', sofa: '#8fa7b3', tag: 'Séjour', stamp: stamp('2023-06-15') }))]),
          el('Sol / parquet', 'Bon état', 'Légères micro-rayures près de la fenêtre.', [ph('D-101', 'sol', 'Séjour — parquet', piece({ wall: '#efe8dd', floor: '#b98a4e', tag: 'Séjour — sol', stamp: stamp('2023-06-15') }))]) ] },
        { nom: 'Cuisine', elements: [
          el('Plan de travail / évier', 'Bon état', '', [ph('D-101', 'cuisine', 'Cuisine', piece({ wall: '#e7eef0', floor: '#b9a988', counter: '#e9edf2', tag: 'Cuisine', stamp: stamp('2023-06-15') }))]),
          el('Plaques / hotte', 'Bon état', 'Fonctionnelles.') ] },
        { nom: 'Chambre', elements: [
          el('Murs / sol', 'Bon état', '', [ph('D-101', 'chambre', 'Chambre', piece({ wall: '#ece7e2', floor: '#c39a63', bed: '#b7c2cc', tag: 'Chambre', stamp: stamp('2023-06-15') }))]) ] },
        { nom: 'Salle de bain', elements: [
          el('Sanitaires / robinetterie', 'Bon état', 'Joints propres, pas de fuite.', [ph('D-101', 'sdb', 'Salle de bain', piece({ wall: '#e9eef2', floor: '#cfd6dd', bath: true, tag: 'Salle de bain', stamp: stamp('2023-06-15') }))]) ] }
      ], { 'elec-num': '12345678901234', 'elec-hp': '00123', 'eau-f': '00451' },
        { compteursPhotos: { elec: [ph('D-101', 'compteur', 'Compteur électrique', compteur({ reading: '0 0 1 2 3', tag: 'Compteur électrique', stamp: stamp('2023-06-15') }))] } }),
      edl(3002, 'D-102', 'Marie Bernard', '2025-12-01', 65, GERANTE, [
        { nom: 'Séjour', elements: [ el('Murs / sol', 'Bon état', '', [ph('D-102', 'sejour', 'Séjour', piece({ wall: '#ede6da', floor: '#c39a63', sofa: '#a7b39a', tag: 'Séjour', stamp: stamp('2025-12-01') }))]) ] },
        { nom: 'Cuisine', elements: [ el('Équipements', 'Bon état', '', [ph('D-102', 'cuisine', 'Cuisine', piece({ wall: '#e7eef0', floor: '#b9a988', counter: '#e9edf2', tag: 'Cuisine', stamp: stamp('2025-12-01') }))]) ] },
        { nom: 'Chambre 1', elements: [ el('Murs / sol', 'Bon état', '') ] },
        { nom: 'Chambre 2', elements: [ el('Murs / sol', "État d'usage", 'Trace de cheville au-dessus du radiateur.') ] },
        { nom: 'Salle de bain', elements: [ el('Sanitaires', 'Bon état', '') ] }
      ], { 'elec-num': '22345678901234', 'elec-hp': '04512', 'eau-f': '01207' }),
      edl(3004, 'D-104', 'Lucas Petit', '2026-04-01', 42, GERANTE, [
        { nom: 'Séjour', elements: [ el('Murs / sol', 'Bon état', '', [ph('D-104', 'sejour', 'Séjour meublé', piece({ wall: '#f0ebe3', floor: '#c7a374', sofa: '#7f95a3', tag: 'Séjour', stamp: stamp('2026-04-01') }))]) ] },
        { nom: 'Chambre', elements: [ el('Lit / literie', 'Neuf', 'Matelas neuf.', [ph('D-104', 'chambre', 'Chambre', piece({ wall: '#ece7e2', floor: '#c39a63', bed: '#c8b7a6', tag: 'Chambre', stamp: stamp('2026-04-01') }))]) ] },
        { nom: 'Cuisine', elements: [ el('Électroménager', 'Bon état', 'Réfrigérateur, plaques, micro-ondes.') ] },
        { nom: 'Salle d\'eau', elements: [ el('Sanitaires', 'Bon état', '') ] }
      ], { 'elec-num': '32345678901234', 'elec-hp': '02210', 'eau-f': '00388' },
        { compteursPhotos: { elec: [ph('D-104', 'compteur', 'Compteur électrique', compteur({ reading: '0 2 2 1 0', tag: 'Compteur électrique', stamp: stamp('2026-04-01') }))] } }),
      edl(3005, 'P-201', 'Julien Lefèvre', '2024-07-01', 68, PERSO, [
        { nom: 'Séjour', elements: [ el('Murs / sol', 'Bon état', '', [ph('P-201', 'sejour', 'Séjour', piece({ wall: '#eef0ea', floor: '#b48b5c', sofa: '#9b8fb0', tag: 'Séjour', stamp: stamp('2024-07-01') }))]) ] },
        { nom: 'Cuisine', elements: [ el('Équipements', 'Bon état', '') ] },
        { nom: 'Chambre 1', elements: [ el('Murs / sol', 'Bon état', '') ] },
        { nom: 'Chambre 2', elements: [ el('Murs / sol', 'Bon état', '') ] },
        { nom: 'Salle de bain', elements: [ el('Sanitaires', 'Bon état', '') ] }
      ], { 'elec-num': '42345678901234', 'elec-hp': '03377', 'eau-f': '00912' }),
      // Parking : état des lieux fait HORS Propryo, sur papier (Bail en cours v15.740) — forme exacte d'edlExterneCreer,
      // AUCUNE signature simulée ; il compte pour la conformité comme l'entrée du bail.
      { id: 3006, type: 'Entrée', date: '2025-03-01', logement: 'P-202', locataire: 'Nicolas Faure',
        externe: { declareLe: '2025-03-02T18:25:00.000Z', declarePar: PERSO, pjDocId: null }, pieces: [], signatures: {} }
    ];

    // ── Assurances : habitation des locataires + PNO des immeubles ───────────────────────────────
    var mrh = ['D-101', 'D-102', 'D-104', 'P-201', 'P-202'].map(function (r, i) {
      var l = logements.filter(function (x) { return x.ref === r; })[0];
      return { id: 8001 + i, logement: r, locataire: l.locataire, compagnie: 'Assurance Exemple', numContrat: 'MRH-' + r, echeance: '2027-06-30', notes: '' };
    });
    var assurances = [
      { id: 8101, portee: 'immeuble', immeuble: IMM_SCI, logement: '', type: 'PNO', compagnie: 'Assurance Exemple', numContrat: 'PNO-TAN-01', notes: '', echeance: '2027-09-11', prime: 432 },
      { id: 8102, portee: 'immeuble', immeuble: IMM_PERSO, logement: '', type: 'PNO', compagnie: 'Assurance Exemple', numContrat: 'PNO-PAR-02', notes: '', echeance: '2027-01-31', prime: 190 }
    ];

    // ── Mouvements bancaires (janvier 2025 → 30 septembre 2026) ──────────────────────────────────
    var mvts = [], mid = 50000;
    function mv(date, lib, cat, qui, imm, montant, extra) {
      var m = Object.assign({ id: mid++, date: date, lib: lib, cat: cat, qui: qui || '', imm: imm || '',
        db: montant < 0 ? arr2(-montant) : 0, cr: montant > 0 ? arr2(montant) : 0, fac: '' }, extra || {});
      mvts.push(m);
      return m;
    }
    function baremeAu(ref, ymd) {
      var p = loyerBareme.filter(function (b) { return b.ref === ref && b.debut <= ymd && (!b.fin || b.fin >= ymd); })[0];
      return p ? p.hc + p.ch : 0;
    }
    function loyers(ref, imm, nomVir, y0, m0, y1, m1, jour, sauf) {
      mois(y0, m0, y1, m1).forEach(function (x) {
        var k = x.y + '-' + pad(x.m);
        if (sauf && sauf.indexOf(k) >= 0) return;
        var d = iso(x.y, x.m, jour);
        mv(d, 'VIR ' + nomVir + ' LOYER ' + MOIS_FR[x.m - 1].toUpperCase() + ' ' + x.y, 'Loyers encaissés', ref, imm, baremeAu(ref, iso(x.y, x.m, 15)));
      });
    }
    // SCI : loyers
    loyers('D-101', IMM_SCI, 'M PIERRE MARTIN', 2025, 1, 2026, 9, 3);
    loyers('D-102', IMM_SCI, 'MME MARIE BERNARD', 2025, 12, 2026, 9, 6, ['2026-08', '2026-09']);   // impayé août + septembre
    loyers('D-104', IMM_SCI, 'M LUCAS PETIT', 2026, 4, 2026, 9, 2);
    // Anciens locataires (baux archivés) : D-102 jusqu'au 31/10/2025, D-104 jusqu'au 31/03/2026, D-103 jusqu'au 31/08/2026
    loyers('D-102', IMM_SCI, 'MME SOPHIE KLEIN', 2025, 1, 2025, 10, 4);
    loyers('D-104', IMM_SCI, 'MME INES MOREAU', 2025, 1, 2026, 3, 3);
    loyers('D-103', IMM_SCI, 'M THOMAS ROY', 2025, 1, 2026, 8, 4);
    // SCI : charges
    mois(2025, 1, 2026, 9).forEach(function (x) {
      mv(iso(x.y, x.m, 10), 'ECHEANCE PRET IMMOBILIER N 4471', 'Prêt', '', IMM_SCI, -1180);
      mv(iso(x.y, x.m, 28), 'FRAIS TENUE DE COMPTE', 'Frais bancaires', 'SCI:' + SCI, '', -8.5);
      if (x.m % 3 === 1) mv(iso(x.y, x.m, 1), 'PRLV SYNDIC CABINET DEMO GESTION APPEL DE FONDS T' + ((x.m + 2) / 3) + ' ' + x.y, 'Charges de copropriété', '', IMM_SCI, -540);
    });
    mv('2025-10-15', 'PRLV DGFIP TAXE FONCIERE 2025', 'Taxe foncière (et taxes annexes)', '', IMM_SCI, -1480);
    mv('2025-09-12', 'ASSURANCE PNO IMMEUBLE LES TANNEURS', 'Primes d\'assurance (PNO, GLI)', '', IMM_SCI, -418);
    mv('2026-09-12', 'ASSURANCE PNO IMMEUBLE LES TANNEURS', 'Primes d\'assurance (PNO, GLI)', '', IMM_SCI, -432);
    mv('2026-03-18', 'PLOMBERIE DEMO FACT 2026-0412 D-101', 'Travaux (entretien, réparation, amélioration)', 'D-101', IMM_SCI, -650);
    mv('2026-09-08', 'PEINTURE DEMO FACT 2026-118 D-103', 'Travaux (entretien, réparation, amélioration)', 'D-103', IMM_SCI, -940);
    mv('2026-04-20', 'CABINET COMPTABLE EXPERT 68 HONORAIRES 2025', 'Frais de gestion / honoraires / comptabilité', 'SCI:' + SCI, '', -360);
    mv('2026-02-10', 'PRLV EAU MULHOUSE PARTIES COMMUNES', 'Charges récupérables (eau, énergie…)', '', IMM_SCI, -312);
    mv('2025-02-11', 'PRLV EAU MULHOUSE PARTIES COMMUNES', 'Charges récupérables (eau, énergie…)', '', IMM_SCI, -296);
    mv('2026-09-15', 'VIR M THOMAS ROY RESTITUTION DEPOT GARANTIE', 'Dépôt de garantie (reçu / restitué)', 'D-103', IMM_SCI, -440);
    mv('2025-11-20', 'VIR MME SOPHIE KLEIN RESTITUTION DEPOT GARANTIE', 'Dépôt de garantie (reçu / restitué)', 'D-102', IMM_SCI, -880);
    mv('2026-04-22', 'VIR MME INES MOREAU RESTITUTION DEPOT GARANTIE', 'Dépôt de garantie (reçu / restitué)', 'D-104', IMM_SCI, -1520);
    // Camille Mercier : loyers et charges
    loyers('P-201', IMM_PERSO, 'M JULIEN LEFEVRE', 2025, 1, 2026, 9, 2);
    loyers('P-202', IMM_PERSO, 'M NICOLAS FAURE', 2025, 3, 2026, 9, 5);
    mois(2025, 1, 2026, 9).forEach(function (x) {
      if (x.m % 3 === 1) mv(iso(x.y, x.m, 5), 'PRLV SYNDIC RESIDENCE DU PARC T' + ((x.m + 2) / 3) + ' ' + x.y, 'Charges de copropriété', '', IMM_PERSO, -310);
    });
    mv('2025-10-15', 'PRLV DGFIP TAXE FONCIERE 2025', 'Taxe foncière (et taxes annexes)', '', IMM_PERSO, -1120);
    mv('2026-02-01', 'ASSURANCE PNO RESIDENCE DU PARC', 'Primes d\'assurance (PNO, GLI)', '', IMM_PERSO, -190);
    mv('2025-02-01', 'ASSURANCE PNO RESIDENCE DU PARC', 'Primes d\'assurance (PNO, GLI)', '', IMM_PERSO, -184);
    // Facture de l'incident « chaudière » de P-201 (circuit terminé) : la dépense existe UNE fois, rattachée à l'incident.
    var MV_CHAUDIERE = mv('2026-05-22', 'CHAUFFAGE DEMO FACT F-2026-0522 P-201', 'Travaux (entretien, réparation, amélioration)', 'P-201', IMM_PERSO, -145,
      { fac: 'F-2026-0522', incidentId: 4002 });
    mvts.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; });

    // ── Quittances (mois payés de 2026, locataires à jour) ───────────────────────────────────────
    var quittances = [], qid = 70000;
    [['D-101', 'Pierre Martin', SCI], ['D-104', 'Lucas Petit', SCI], ['P-201', 'Julien Lefèvre et Sarah Lefèvre', PERSO], ['P-202', 'Nicolas Faure', PERSO]].forEach(function (q) {
      mois(2026, q[0] === 'D-104' ? 4 : 1, 2026, 9).forEach(function (x) {
        var p = loyerBareme.filter(function (b) { return b.ref === q[0] && b.debut <= iso(x.y, x.m, 15) && (!b.fin || b.fin >= iso(x.y, x.m, 15)); })[0];
        quittances.push({ id: qid++, logement: q[0], locataire: q[1], mois: MOIS_FR[x.m - 1] + ' ' + x.y, hc: p.hc, ch: p.ch, entity: q[2], date: iso(x.y, x.m, 8) });
      });
    });

    // ── Candidatures sur le studio vacant D-103 ──────────────────────────────────────────────────
    var candidats = [
      { id: 'cand_demo_1', ref: 'cand_demo_1', logRef: 'D-103', entity: SCI, source: 'lien', civilite: 'Mme', nom: 'Rousseau', prenom: 'Emma',
        ddn: '1998-05-17', lieuNaiss: 'Besançon', tel: '06 00 00 10 01', email: 'emma.rousseau@exemple.fr', adressePrecedente: '3 rue Victor Hugo, 25000 Besançon',
        dateDebutSouhaitee: '2026-11-01', revenus: 2450, employeur: 'Centre médical Démo', contrat: 'CDI',
        garant: { nom: 'Rousseau', prenom: 'Jean', adresse: '3 rue Victor Hugo, 25000 Besançon', ddn: '1966-01-09', lieu: 'Besançon' }, visale: null,
        piecesCompletes: true, statut: 'enCours', piecesVerifiees: false, notes: 'Dossier complet, garant parent.',
        bailRef: '', dateCreation: '2026-09-18T09:12:00.000Z', _modifiedAt: '2026-09-22T17:40:00.000Z', _archived: false, vu: true },
      { id: 'cand_demo_2', ref: 'cand_demo_2', logRef: 'D-103', entity: SCI, source: 'manuel', civilite: 'M.', nom: 'Girard', prenom: 'Thomas',
        ddn: '2001-10-02', lieuNaiss: 'Mulhouse', tel: '06 00 00 10 02', email: 'thomas.girard@exemple.fr', adressePrecedente: '',
        dateDebutSouhaitee: '2026-11-15', revenus: 1850, employeur: 'Mairie de Démoville', contrat: 'CDD', garant: null, visale: null,
        piecesCompletes: false, statut: 'recu', piecesVerifiees: false, notes: 'Attend son dernier bulletin de salaire.',
        bailRef: '', dateCreation: '2026-09-29T14:03:00.000Z', _modifiedAt: '2026-09-29T14:03:00.000Z', _archived: false, vu: false }
    ];

    // ── Pièces jointes : diagnostics du lot D-101 ────────────────────────────────────────────────
    fichiers.demo_doc_ddt = pdfUnePage('Dossier de diagnostic technique - D-101', 'DPE + amiante + ERP - 12 rue des Tanneurs, Mulhouse');
    fichiers.demo_doc_erp = pdfUnePage('Etat des risques (ERP) - Les Tanneurs', '12 rue des Tanneurs, 68100 Mulhouse - septembre 2026');
    var documents = [
      { id: 6001, parentType: 'logement', parentId: 1001, category: 'documents', name: 'Diagnostics D-101 (DPE, amiante).pdf',
        originalName: 'Diagnostics D-101 (DPE, amiante).pdf', mime: 'application/pdf', size: 1200, uploadedAt: '2023-06-09T09:00:00.000Z', idbKey: 'demo_doc_ddt' },
      { id: 6002, parentType: 'logement', parentId: 1001, category: 'documents', name: 'ERP Les Tanneurs septembre 2026.pdf',
        originalName: 'ERP Les Tanneurs septembre 2026.pdf', mime: 'application/pdf', size: 1100, uploadedAt: '2026-09-15T09:05:00.000Z', idbKey: 'demo_doc_erp' }
    ];

    // ── Pièces des candidatures (fichiers FICTIFS d'une page ; aucun vrai document) ─────────────────────────────
    // `_demoVerif` : scénario de vérification 2D-Doc PRÉ-CALCULÉ, posé au démarrage par js/app/demo-app.js avec le
    // module de vérification (js/core/verif-pieces.js) — le fichier fictif ne porte aucun code 2D-Doc.
    fichiers.demo_cand_pdf = pdfUnePage('Piece de candidature - document fictif', 'Demonstration Propryo - aucune donnee reelle');
    fichiers.demo_cand_photo = piece({ wall: '#f2f2ee', floor: '#e4e4dc', tag: 'Photo d\'un avis d\'imposition (copie)', stamp: '29/09/2026  14:01' });
    var did = 6100;
    function pc(cand, category, pieceType, nom, recu, o) {
      var photo = o && o.photo;
      documents.push(Object.assign({ id: did++, parentType: 'candidat', parentId: cand, category: category, pieceType: pieceType,
        name: nom, originalName: nom, mime: photo ? 'image/jpeg' : 'application/pdf', size: photo ? 48000 : 1200, uploadedAt: recu,
        idbKey: photo ? 'demo_cand_photo' : 'demo_cand_pdf' }, o && o.verif ? { _demoVerif: o.verif } : {}));
    }
    var R1 = '2026-09-18T09:12:00.000Z', R2 = '2026-09-29T14:03:00.000Z';
    pc('cand_demo_1', 'identite', 'I.A.1', 'Carte d\'identité Emma Rousseau.pdf', R1);
    pc('cand_demo_1', 'domicile', 'I.B.1', 'Quittances juin à août 2026.pdf', R1);
    pc('cand_demo_1', 'situation', 'I.C.1', 'Contrat de travail Centre médical Démo.pdf', R1);
    pc('cand_demo_1', 'ressources', 'I.D.2', 'Bulletins de salaire juin à août 2026.pdf', R1);
    pc('cand_demo_1', 'ressources', 'I.D.1', 'Avis d\'impôt 2026 sur les revenus 2025.pdf', R1, { verif: 'avis-valide' });
    pc('cand_demo_1', 'garant', 'II.A.1', 'Garant - carte d\'identité Jean Rousseau.pdf', R1);
    pc('cand_demo_1', 'garant', 'II.E.1', 'Garant - avis d\'impôt 2026.pdf', R1, { verif: 'avis-valide-garant' });
    pc('cand_demo_2', 'identite', 'I.A.1', 'CNI Thomas Girard.pdf', R2);
    pc('cand_demo_2', 'situation', 'I.C.1', 'Contrat CDD Mairie de Démoville.pdf', R2);
    pc('cand_demo_2', 'ressources', 'I.D.1', 'Photo avis d\'imposition.jpg', R2, { photo: true, verif: 'avis-sans-code' });

    // ── Carnet d'artisans (circuit d'un incident, v15.738) ───────────────────────────────────────────────────────
    var artisans = [
      { id: 9101, entity: SCI, nom: 'Plomberie Démo', siret: '', metiers: ['plomberie'], tel: '06 00 00 20 01', email: 'contact@plomberie-demo.exemple.fr',
        adresse: '4 rue de la Démo', commune: 'Mulhouse', rge: false, notePrivee: 'Intervient vite, devis clairs.', prevenirAuto: true, source: 'carnet', creeLe: '2026-02-11T10:00:00.000Z' },
      { id: 9102, entity: SCI, nom: 'Menuiserie Démo', siret: '', metiers: ['menuiserie'], tel: '06 00 00 20 02', email: '',
        adresse: '', commune: 'Mulhouse', rge: false, notePrivee: '', prevenirAuto: true, source: 'carnet', creeLe: '2026-02-11T10:05:00.000Z' },
      { id: 9103, entity: PERSO, nom: 'Chauffage Démo', siret: '', metiers: ['chauffage'], tel: '06 00 00 20 03', email: 'atelier@chauffage-demo.exemple.fr',
        adresse: '', commune: 'Colmar', rge: true, notePrivee: '', prevenirAuto: true, source: 'carnet', creeLe: '2025-11-03T10:00:00.000Z' }
    ];

    // ── Incidents (registre + circuit, v15.738) ──────────────────────────────────────────────────────────────────
    // Identifiants FIXES du nuage fictif (format uuid, préfixe de3… ; rien de commun avec le cloud réel).
    var U = { acD101: 'de300000-0000-4000-8000-000000000101', acP201a: 'de300000-0000-4000-8000-000000000201', acP201b: 'de300000-0000-4000-8000-000000000202',
      acD104: 'de300000-0000-4000-8000-000000000104', sigD101: 'de300000-0000-4000-8000-00000000a101', sigP201: 'de300000-0000-4000-8000-00000000a201',
      sigD104: 'de300000-0000-4000-8000-00000000a104', arD101: 'de300000-0000-4000-8000-00000000b101', arP201: 'de300000-0000-4000-8000-00000000b201' };
    var incidents = [
      { id: 4001, logRef: 'D-101', imm: '', entity: SCI, creeLe: '2026-09-29T07:55:00.000Z', signalePar: 'locataire', signaleParNom: 'Pierre Martin', canal: 'espace',
        element: 'canalisation', elementLibre: 'Cuisine', nature: 'fuite', intervention: 'inconnue', cause: 'inconnue', urgences: [], ageAns: null,
        description: 'Fuite sous l\'évier de la cuisine : le meuble est mouillé chaque matin, un seau est posé dessous.',
        contexte: { meuble: null, partieCommune: false, copro: null, clauseChaudiereBailleur: false },
        statut: 'en_cours', statutDates: { signale: '2026-09-29T07:55:00.000Z', en_cours: '2026-09-29T09:10:00.000Z' },
        verdict: null, payeurRetenu: null, artisan: { nom: 'Plomberie Démo', siret: '', tel: '06 00 00 20 01', source: 'carnet', metier: 'plomberie' },
        assurance: { checklist: {} }, mouvementIds: [], ia: null, espaceSignalementId: U.sigD101, espaceAccesId: U.acD101, vu: true,
        circuit: { artisanId: 9101, metier: 'plomberie', plafondTtc: 300, accesId: U.arD101, emisLe: '2026-09-29T09:10:00.000Z', factureNumero: null } },
      // Terminé : constat de l'artisan → verdict du moteur (calculé au démarrage par demo-app.js, règles inchangées),
      // dépense payée une fois (MV_CHAUDIERE), résultat publié dans l'espace du locataire.
      { id: 4002, logRef: 'P-201', imm: '', entity: PERSO, creeLe: '2026-05-19T06:40:00.000Z', signalePar: 'locataire', signaleParNom: 'Julien Lefèvre', canal: 'espace',
        element: 'chaudiere', elementLibre: 'Cuisine', nature: 'panne', intervention: 'petite_piece', cause: 'malfacon_vice', urgences: [], ageAns: 7,
        description: 'Plus d\'eau chaude depuis ce matin, la chaudière affiche un code erreur.',
        contexte: { meuble: null, partieCommune: false, copro: null, clauseChaudiereBailleur: false },
        statut: 'resolu', statutDates: { signale: '2026-05-19T06:40:00.000Z', en_cours: '2026-05-19T08:05:00.000Z', resolu: '2026-05-22T16:30:00.000Z' },
        verdict: null, payeurRetenu: null, artisan: { nom: 'Chauffage Démo', siret: '', tel: '06 00 00 20 03', source: 'carnet', metier: 'chauffage' },
        assurance: { checklist: {} }, mouvementIds: [MV_CHAUDIERE.id], ia: null, espaceSignalementId: U.sigP201, espaceAccesId: U.acP201a, vu: true,
        circuit: { artisanId: 9103, metier: 'chauffage', plafondTtc: 300, accesId: U.arP201, emisLe: '2026-05-19T08:05:00.000Z', factureNumero: 'F-2026-0522' },
        constat: { constat: 'defaut', sousType: null, ampleur: 'petite', resume: 'Carte électronique de la chaudière défectueuse, remplacée.', source: 'artisan', le: '2026-05-22T15:10:00.000Z' },
        valideLe: '2026-05-22T16:30:00.000Z', resultatPublieLe: '2026-05-22T16:30:00.000Z' }
    ];
    fichiers.demo_nuage_devis = pdfUnePage('Devis D-2026-118 - Plomberie Demo', 'Remplacement du siphon et des joints sous evier - 185,00 EUR TTC');
    fichiers.demo_nuage_facture = pdfUnePage('Facture F-2026-0522 - Chauffage Demo', 'Carte electronique chaudiere remplacee - 145,00 EUR TTC');

    // ── Nuage FICTIF (semé par js/app/demo-app.js, local seulement) ──────────────────────────────────────────────
    // Accès à l'espace locataire, messages, signalements, liens et dépôts des artisans. Les identifiants de bail
    // (bail_id) sont calculés au semis à partir de la base, comme le ferait le cloud. Aucun jeton : un accès fictif
    // ne porte qu'une empreinte vide, aucun lien reçu par un locataire n'existe.
    var nuage = {
      acces: [
        { id: U.acD101, ref: 'D-101', rang: 0, nom: 'Pierre Martin', emis_le: '2026-09-01T18:02:00.000Z', derniere_visite: '2026-10-04T19:12:00.000Z',
          accord_quittance_le: '2026-09-01T18:06:00.000Z', accord_quittance_version: 'v1' },
        { id: U.acP201a, ref: 'P-201', rang: 0, nom: 'Julien Lefèvre', emis_le: '2026-05-02T08:30:00.000Z', derniere_visite: '2026-09-28T21:03:00.000Z',
          accord_quittance_le: '2026-05-02T08:41:00.000Z', accord_quittance_version: 'v1' },
        { id: U.acP201b, ref: 'P-201', rang: 1, nom: 'Sarah Lefèvre', emis_le: '2026-05-02T08:31:00.000Z', derniere_visite: null },
        { id: U.acD104, ref: 'D-104', rang: 0, nom: 'Lucas Petit', emis_le: '2026-04-02T17:20:00.000Z', derniere_visite: '2026-10-05T07:40:00.000Z' }
      ],
      messages: [
        { acces: U.acD101, auteur: 'bailleur', corps: 'Bonjour, la société Plomberie Démo passe jeudi 8 octobre entre 17 h et 18 h pour la fuite sous l\'évier.', cree_le: '2026-09-30T08:15:00.000Z', lu: true },
        { acces: U.acD101, auteur: 'locataire', corps: 'Bonjour, c\'est noté pour jeudi, présence assurée. La quittance de septembre est bien dans l\'espace, merci.', cree_le: '2026-10-04T19:14:00.000Z', lu: false },
        { acces: U.acP201a, auteur: 'locataire', corps: 'Eau chaude revenue, merci pour la rapidité.', cree_le: '2026-05-22T19:02:00.000Z', lu: true }
      ],
      signalements: [
        { id: U.sigD101, acces: U.acD101, piece: 'cuisine', element: 'fuite_eau', urgence: 'importante', cree_le: '2026-09-29T07:55:00.000Z',
          description: 'Fuite sous l\'évier de la cuisine : le meuble est mouillé chaque matin, un seau est posé dessous.', incident: '4001', importe_le: '2026-09-29T08:01:00.000Z',
          tel_partage: true, telephone: '06 00 00 00 01', presence: 'En semaine après 17 h' },
        { id: U.sigP201, acces: U.acP201a, piece: 'cuisine', element: 'chauffage', urgence: 'importante', cree_le: '2026-05-19T06:40:00.000Z',
          description: 'Plus d\'eau chaude depuis ce matin, la chaudière affiche un code erreur.', incident: '4002', importe_le: '2026-05-19T06:52:00.000Z', resultatDe: 4002 },
        // Arrive au PREMIER démarrage de la démo : importé dans le registre des incidents sous les yeux du prospect.
        { id: U.sigD104, acces: U.acD104, piece: 'chambre', element: 'fenetre_volet', urgence: 'faible', cree_le: '2026-10-05T07:38:00.000Z',
          description: 'Le volet roulant de la chambre reste bloqué à mi-hauteur depuis hier soir.', incident: null, importe_le: null,
          ia: { resume: 'Volet roulant de la chambre bloqué à mi-hauteur.', element: 'volet', nature: 'casse', urgences: [] } }
      ],
      artisanAcces: [
        { id: U.arD101, incident: '4001', signalement: U.sigD101, artisan_nom: 'Plomberie Démo', artisan_email: 'contact@plomberie-demo.exemple.fr', artisan_tel: '06 00 00 20 01',
          metier: 'plomberie', plafond_ttc: 300, emis_le: '2026-09-29T09:10:00.000Z', derniere_visite: '2026-09-30T07:48:00.000Z',
          creneau_date: '2026-10-08', creneau_debut: '17:00:00', creneau_fin: '18:00:00', creneau_confirme_le: '2026-09-30T12:20:00.000Z', creneau_accord_expres: true },
        { id: U.arP201, incident: '4002', signalement: U.sigP201, artisan_nom: 'Chauffage Démo', artisan_email: 'atelier@chauffage-demo.exemple.fr', artisan_tel: '06 00 00 20 03',
          metier: 'chauffage', plafond_ttc: 300, emis_le: '2026-05-19T08:05:00.000Z', derniere_visite: '2026-05-22T15:12:00.000Z', valide_le: '2026-05-22T16:30:00.000Z',
          creneau_date: '2026-05-20', creneau_debut: '08:00:00', creneau_fin: '10:00:00', creneau_confirme_le: '2026-05-19T09:00:00.000Z', creneau_accord_expres: true,
          constat: 'defaut', constat_ampleur: 'petite', constat_resume: 'Carte électronique de la chaudière défectueuse, remplacée.', constat_le: '2026-05-22T15:10:00.000Z' }
      ],
      depots: [
        { id: 'de300000-0000-4000-8000-00000000c101', acces: U.arD101, type_depot: 'devis', nom: 'Devis D-2026-118.pdf', numero: 'D-2026-118', montant_ttc: 185,
          statut: 'auto_accepte', decide_le: '2026-09-30T07:52:00.000Z', cree_le: '2026-09-30T07:52:00.000Z', fichier: 'demo_nuage_devis' },
        { id: 'de300000-0000-4000-8000-00000000c201', acces: U.arP201, type_depot: 'facture', nom: 'Facture F-2026-0522.pdf', numero: 'F-2026-0522', montant_ttc: 145,
          statut: null, decide_le: null, cree_le: '2026-05-22T15:12:00.000Z', fichier: 'demo_nuage_facture' }
      ]
    };

    // ── Compte bancaire de la SCI + règles d'import (le relevé OFX de démo s'y range tout seul) ──
    var bankAccounts = [{ id: 9001, label: 'Compte courant SCI', type: 'ofx', bailleur: SCI, mixte: false,
      identifiers: ['acct:30004:00012345678'], createdAt: '2025-01-05T10:00:00.000Z', lastImport: null }];   // forme objet {fingerprints,…} posée par l'app au 1er import
    function regle(pattern, cat, qui, imm, sens) {
      return { pattern: pattern, sens: sens || '', compte: 9001, cat: cat, qui: qui || '', imm: imm || '', compteurCcId: '', bailleurDuCompte: false };
    }
    var importRules = [
      regle('PIERRE MARTIN', 'Loyers encaissés', 'D-101', '', 'cr'),
      regle('MARIE BERNARD', 'Loyers encaissés', 'D-102', '', 'cr'),
      regle('LUCAS PETIT', 'Loyers encaissés', 'D-104', '', 'cr'),
      regle('SYNDIC CABINET DEMO', 'Charges de copropriété', '', IMM_SCI, 'db'),
      regle('FRAIS TENUE DE COMPTE', 'Frais bancaires', 'SCI:' + SCI, '', 'db')
    ];

    // ── Agenda : un parc tenu à jour au JOUR_DEMO ──────────────────────────────────────────────────
    // Les rappels automatiques déjà passés (agendaAutoSync, mêmes clés) sont FAITS : révisions IRL du journal ci-dessus,
    // régularisations des charges 2025. Un rappel de révision sans révision possible (date égale ou antérieure à l'entrée
    // du locataire) est ÉCARTÉ, comme un rappel supprimé (params.agendaAutoEcartes). Seule reste à faire la révision de
    // D-101 du 01/10/2026 (action n° 1 de la démo).
    var agenda = [], aid = 1;
    function fait(cat, ref, imm, entite, cle, date, titre, notes, rappels) {
      agenda.push({ id: 'evt_demo_' + (aid++), titre: titre, date: date, dateFin: date, logement: ref, immeuble: imm, entite: entite,
        cat: cat, couleur: '', notes: notes, recurrence: { type: 'none', interval: 1, fin: '' }, rappels: rappels,
        auto: true, autoKey: cle, autoDate: date, done: true, createdAt: date });
    }
    function irlFait(ref, imm, entite, date) {
      var d = date.split('-').reverse().join('/');
      fait('IRL', ref, imm, entite, 'IRL:' + ref + ':' + date.slice(0, 4), date, 'Révision IRL — ' + ref + ' (le ' + d + ')',
        'Date de révision du bail : ' + d + '\nPréparer la lettre de révision IRL à envoyer au locataire (rappel un mois avant).', [30]);
    }
    irlHistorique.forEach(function (r) {
      if (r.date < '2025-01-01') return;   // l'agenda ne remonte qu'à l'année précédente
      var sci = r.ref.charAt(0) === 'D';
      irlFait(r.ref, sci ? IMM_SCI : IMM_PERSO, sci ? SCI : PERSO, r.date);
    });
    [['D-101', 90], ['D-102', 130], ['D-104', 100], ['P-201', 120]].forEach(function (x) {
      var sci = x[0].charAt(0) === 'D';
      fait('REGUL', x[0], sci ? IMM_SCI : IMM_PERSO, sci ? SCI : PERSO, 'REGUL:' + x[0] + ':2026', '2026-03-31',
        'Régularisation charges 2025 — ' + x[0], 'Régulariser les provisions de charges 2025 (' + x[1] + ' €/mois).', [30, 7]);
    });
    // Entrée du locataire le jour anniversaire (D-102 01/12/2025, D-104 01/04/2026, P-202 01/03/2025) ou après (D-104 2025).
    var agendaAutoEcartes = ['IRL:D-102:2025', 'IRL:D-104:2025', 'IRL:D-104:2026', 'IRL:P-202:2025'];

    var db = {
      entites: entites, logements: logements, baux: baux, baux_historique: bauxHistorique,
      mouvements: mvts, quittances: quittances, edl: edls, mrh: mrh, assurances: assurances,
      candidats: candidats, documents: documents, agenda: agenda, incidents: incidents, artisans: artisans,
      loyerBareme: loyerBareme, irlHistorique: irlHistorique, importRules: importRules,
      params: { bankAccounts: bankAccounts, _loyerBaremeMigreV1: true, agendaAutoEcartes: agendaAutoEcartes }
    };
    return { db: db, fichiers: fichiers, nuage: nuage };
  }
})();
