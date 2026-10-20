/**
 * bail-garage.global.js — Wrapper browser (window.BailGarage)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/bail-garage.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * bail-garage.js — Structure du document « Bail garage / box / local de stockage » (droit commun).
   *
   * NOUVELLE LOGIQUE testable (règle sandbox-first) : construit le tableau de blocs du bail garage
   * (Code civil art. 1708 et s., HORS loi 89-462). Appelée par `buildBailStructure` (index.html)
   * quand `bail.type === 'garage'`, via le mirror global `window.BailGarage`.
   *
   * DRY : les blocs PARTAGÉS et complexes (en-tête `brandzone`, identité des parties, émission des
   * signatures multi-gérant/mandataire/distance) ne sont PAS recalculés ici — `index.html` les
   * construit avec son code existant et les INJECTE via `ctx.blocks` ; ce module ne fait que les
   * assembler autour du corps garage. Aucun mécanisme dupliqué.
   *
   * Refs (CDC-BAIL-GARAGE-STOCKAGE, sources officielles Légifrance) :
   * - Code civil : 1708-1762 (louage), 1709 (durée libre), 1717 (cession), 1719-1720 (réparations
   *   bailleur), 1733 (présomption d'incendie), 1224-1230 (résolution), 1231-5 (clause pénale),
   *   1231-6 (intérêts de retard), 1310 (solidarité), 2288+ / 2297 (cautionnement), 555 (accession)
   * - Code monétaire et financier art. L112-2 : indice d'indexation (ICC/ILC/ILAT ; IRL exclu)
   * - Code de l'environnement art. L125-5 : état des risques (ERP) — dû si zone à risque
   */

  // ── Nature de l'emplacement (place / box / garage / stockage) ────────────────────
  // Juridiquement identique (Code civil) ; seul le DOCUMENT diffère (titre, désignation §1,
  // destination §2). La nature ne change PAS le régime juridique.

  /** Natures d'emplacement d'un bail garage (`bail.natureEmplacement`). */
  const BAIL_GARAGE_NATURES = ['place', 'box', 'garage', 'stockage'];
  /** Nature par défaut (rétrocompat baux garage sans champ). */
  const BAIL_GARAGE_NATURE_DEFAULT = 'box';

  /** Nature effective d'un bail garage (défaut box si absente/invalide). */
  function resolveGarageNature(bail) {
    const n = bail && bail.natureEmplacement;
    return BAIL_GARAGE_NATURES.includes(n) ? n : BAIL_GARAGE_NATURE_DEFAULT;
  }

  const GARAGE_TITLES = Object.freeze({
    place:    'CONTRAT DE LOCATION D\'UNE PLACE DE STATIONNEMENT',
    box:      'CONTRAT DE LOCATION D\'UN BOX FERMÉ',
    garage:   'CONTRAT DE LOCATION D\'UN GARAGE',
    stockage: 'CONTRAT DE LOCATION D\'UN LOCAL DE STOCKAGE'
  });
  /** Titre du bail garage pour la nature donnée (défaut box). */
  function getGarageTitle(nature) {
    return GARAGE_TITLES[nature] || GARAGE_TITLES[BAIL_GARAGE_NATURE_DEFAULT];
  }

  const GARAGE_DESTINATIONS = Object.freeze({
    place:    'exclusif de stationnement d\'un véhicule',
    box:      'exclusif de remisage et de stockage de biens personnels',
    garage:   'exclusif de stationnement d\'un véhicule et de remisage de biens personnels',
    stockage: 'exclusif de remisage et de stockage de biens personnels'
  });
  /** Usage exclusif du §2 pour la nature donnée (défaut box). Jamais d'habitation. */
  function getGarageDestinationUsage(nature) {
    return GARAGE_DESTINATIONS[nature] || GARAGE_DESTINATIONS[BAIL_GARAGE_NATURE_DEFAULT];
  }

  // Indexation — art. L112-2 du Code monétaire et financier : l'indice doit être en « relation
  // directe » avec l'objet. Immeuble bâti → ICC (défaut), ILC/ILAT si activité pro. L'IRL (indice
  // du logement, loi 89) N'EST PAS reconnu → clause nulle sur un garage isolé.
  /** Indices d'indexation valables pour un bail garage (IRL EXCLU). */
  const BAIL_GARAGE_INDICES = ['ICC', 'ILC', 'ILAT'];
  /** Indice par défaut (relation directe immeuble bâti). */
  const BAIL_GARAGE_INDEX_DEFAULT = 'ICC';
  /** Indexation proposée décochée par défaut (loyer fixe) — décision Didier 04/09. */
  function isGarageIndexationOnByDefault() {
    return false;
  }

  const SUBTITLE = 'Code civil — Art. 1708 et suivants — Location de droit commun (hors loi n° 89-462 du 6 juillet 1989)';

  /** Numéro de la section « Signatures » dans le bail garage (le résidentiel est §18). */
  const GARAGE_SIGNATURE_SECTION_NO = 16;
  /** Nombre d'exemplaires originaux (bailleur + locataire). */
  const GARAGE_NB_EXEMPLAIRES = 2;

  /**
   * Construit la structure complète du bail garage.
   *
   * @param {object} ctx
   * @param {object} ctx.data   valeurs primitives déjà formatées (voir plus bas)
   * @param {object} ctx.blocks blocs partagés injectés par index.html :
   *        { header: block[], identity: block[], signature: block[] }
   * @returns {Array<object>} tableau de blocs (même format que buildBailStructure)
   */
  function buildGarageStructure(ctx) {
    const c = (ctx && ctx.data) || {};
    const B = (ctx && ctx.blocks) || {};
    const header = Array.isArray(B.header) ? B.header : [];
    const identity = Array.isArray(B.identity) ? B.identity : [];
    const signature = Array.isArray(B.signature) ? B.signature : [];

    const nature = resolveGarageNature({ natureEmplacement: c.nature });
    const S = v => String(v == null ? '' : v);
    const has = v => S(v).trim() !== '' && S(v).trim() !== '–';

    const title = getGarageTitle(nature);
    const usage = getGarageDestinationUsage(nature);
    const natureLabel = nature === 'place' ? 'Emplacement loué'
                      : nature === 'stockage' ? 'Local loué'
                      : nature === 'garage' ? 'Garage loué'
                      : 'Emplacement loué';

    // Désignation (§1) — libellé de l'objet selon la nature.
    const objet = nature === 'place' ? 'une place de stationnement individuelle'
                : nature === 'stockage' ? 'un local de stockage / de rangement'
                : nature === 'garage' ? 'un garage individuel fermé'
                : 'un box fermé individuel';
    const numTxt = has(c.numEmplacement) ? ` portant le n° ${S(c.numEmplacement)}` : '';
    const niveauTxt = has(c.niveau) ? `, situé ${S(c.niveau)}` : '';
    const surfTxt = (nature !== 'place' && has(c.surface)) ? `, d'une superficie d'environ ${S(c.surface)} m²` : '';
    const descTxt = has(c.descriptif) ? `, ${S(c.descriptif)}` : (nature === 'place' ? ', matérialisée au sol, non fermée' : '');
    const ensemble = has(c.ensembleAdr) ? S(c.ensembleAdr) : S(c.adrBien);

    const out = [];

    // ── En-tête + couverture ────────────────────────────────────────────────
    out.push(...header);
    out.push({ type: 'h1', text: title });
    out.push({ type: 'note-center', text: SUBTITLE });
    if (has(c.locNames)) out.push({ type: 'note-center', text: 'Au profit de : ' + S(c.locNames) });
    out.push({ type: 'gap', size: 4 });

    // Table récapitulative (colonne clé grise, comme le bail — via columnStyles)
    const recapRows = [];
    if (has(c.bailleurLine)) recapRows.push(['Bailleur', S(c.bailleurLine)]);
    if (has(c.representantLine)) recapRows.push(['Représentant légal', S(c.representantLine)]);
    recapRows.push(['Locataire(s)', S(c.locNames) || '–']);
    if (has(c.garantNoms)) recapRows.push(['Garant(s) / Caution', S(c.garantNoms)]);
    recapRows.push(['Adresse du bien', S(c.adrBien) || '–']);
    recapRows.push([natureLabel, S(c.emplacementRecap) || '–']);
    recapRows.push(['Prise d\'effet', S(c.dateDebut) || '–']);
    recapRows.push(['Durée', S(c.dureeRecap) || '–']);
    recapRows.push(['Loyer HC / Charges', `${S(c.loyerHC)} € / ${S(c.charges)} €`]);
    recapRows.push(['Dépôt de garantie', has(c.dg) ? `${S(c.dg)} € (libre — régime hors loi 89-462)` : 'À régler (libre)']);
    out.push({ type: 'table', rows: recapRows, columnStyles: { 0: { fontStyle: 'bold', fillColor: [240, 240, 240], cellWidth: 55 } } });

    // ── Identité des parties (bloc partagé injecté) + phrase d'engagement garage ──
    out.push(...identity);
    // Adresse du locataire (domicile) — l'emplacement n'est pas son habitation : on porte son
    // domicile réel s'il est renseigné (le bloc identité injecté ne le contient pas pour un garage).
    if (has(c.locDomicile)) out.push({ type: 'p', text: `Le LOCATAIRE demeure : ${S(c.locDomicile)}.` });
    out.push({ type: 'p', text: 'IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT. Le BAILLEUR donne à bail au LOCATAIRE, qui accepte, l\'emplacement ci-après désigné, aux seules charges et conditions énoncées ci-dessous.' });

    // ── §1 Désignation de l'emplacement ─────────────────────────────────────
    out.push({ type: 'h2', text: '1 — Désignation de l\'emplacement loué' });
    out.push({ type: 'p', text: `Dans un ensemble immobilier situé ${ensemble}, le BAILLEUR loue ${objet}${numTxt}${niveauTxt}${surfTxt}${descTxt}.` });
    if (has(c.lotCopro)) out.push({ type: 'p', text: `${nature === 'place' ? 'La place' : nature === 'stockage' ? 'Le local' : 'Le box'} constitue le lot n° ${S(c.lotCopro)} de la copropriété (état descriptif de division).` });
    out.push({ type: 'p', text: 'Le LOCATAIRE déclare avoir visité l\'emplacement, en connaître parfaitement l\'état et la consistance, et le prendre dans l\'état où il se trouve au jour de l\'entrée en jouissance.' });
    out.push({ type: 'p-italic-note', text: 'Aucune surface habitable « loi Carrez », aucun diagnostic logement (DPE, plomb, amiante, électricité, gaz, bruit) ni notice d\'information n\'est requis : l\'emplacement n\'est pas un logement (loi n° 89-462 non applicable). Seul l\'état des risques (ERP) reste dû si l\'adresse est en zone à risque (§ 15).' });

    // ── §2 Destination — usage exclusif (clause de sécurité) ────────────────
    out.push({ type: 'h2', text: '2 — Destination — usage exclusif' });
    out.push({ type: 'p', text: `L'emplacement est loué à usage ${usage} du LOCATAIRE, à l'exclusion de tout autre usage.` });
    out.push({ type: 'p-bold', text: 'Il est formellement interdit au LOCATAIRE :' });
    out.push({ type: 'ul', items: [
      'd\'habiter, de dormir ou de séjourner, même temporairement, dans l\'emplacement, qui n\'est pas un local à usage d\'habitation ;',
      'd\'y exercer une quelconque activité professionnelle, commerciale, artisanale ou industrielle, ni d\'y recevoir du public ;',
      'd\'y entreposer des matières dangereuses, inflammables, explosives, toxiques, corrosives ou polluantes, des denrées périssables, des animaux, ainsi que tout bien de provenance illicite ;',
      'd\'y effectuer tout raccordement d\'eau, de gaz ou toute installation générant un risque, sans accord écrit préalable du BAILLEUR.'
    ] });
    out.push({ type: 'p', text: 'Toute infraction à la présente clause constitue un changement de destination et un motif de résiliation de plein droit du contrat (§ 13).' });

    // ── §3 Durée — Reconduction — Congé ─────────────────────────────────────
    const dureeText = has(c.dureeText) ? S(c.dureeText) : '[durée à préciser]';
    const preavisText = has(c.preavisText) ? S(c.preavisText) : 'un (1) mois';
    out.push({ type: 'h2', text: '3 — Durée — Reconduction — Congé' });
    out.push({ type: 'p-mixed', segments: [
      { text: 'Le présent contrat est conclu pour une durée de ' },
      { text: dureeText, bold: true },
      { text: ' à compter du ' },
      { text: S(c.dateDebut) || '[date]', bold: true },
      { text: has(c.dateFin) ? ', pour se terminer le ' : '' },
      { text: has(c.dateFin) ? S(c.dateFin) : '', bold: true },
      { text: '. La durée est librement fixée entre les parties (art. 1709 du Code civil), la loi n° 89-462 n\'étant pas applicable à la location isolée d\'un emplacement de stationnement ou de remisage.' }
    ] });
    out.push({ type: 'p', text: 'À défaut de congé, le contrat se renouvelle par tacite reconduction pour des périodes successives d\'une durée équivalente.' });
    out.push({ type: 'p', text: `Chacune des parties peut mettre fin au contrat à tout moment, moyennant un préavis de ${preavisText} notifié par lettre recommandée avec avis de réception ou par tout moyen conférant date certaine. Le congé n'a pas à être motivé.` });

    // ── §4 Loyer et révision ────────────────────────────────────────────────
    out.push({ type: 'h2', text: '4 — Loyer et révision' });
    out.push({ type: 'h3', text: '4.1 — Montant' });
    out.push({ type: 'p', text: `La présente location est consentie moyennant un loyer mensuel de ${has(c.loyerHCLettres) ? S(c.loyerHCLettres) + ' ' : ''}(${S(c.loyerHC)} €) hors charges, payable d'avance le ${S(c.jourPaiement) || '5'} de chaque mois, par virement sur le compte du BAILLEUR :` });
    out.push({ type: 'table', rows: [
      ['Titulaire', S(c.nomSci) || '–'],
      ['IBAN', S(c.iban) || '–'],
      ['BIC', S(c.bic) || '–']
    ], columnStyles: { 0: { fontStyle: 'bold', fillColor: [240, 240, 240], cellWidth: 55 } } });
    out.push({ type: 'h3', text: '4.2 — Révision annuelle du loyer' });
    const idx = c.indexation || {};
    if (idx.active) {
      const indice = idx.indice || BAIL_GARAGE_INDEX_DEFAULT;
      out.push({ type: 'p', text: `Le loyer est révisé chaque année à la date anniversaire du contrat selon la variation de l'indice « ${indice} » publié par l'INSEE${has(idx.indiceBase) ? ` (indice de base : ${S(idx.indiceBase)})` : ''}. Formule : nouveau loyer = loyer en cours × (indice de révision ÷ indice du même trimestre de l'année précédente).` });
      out.push({ type: 'p-italic-note', text: 'L\'indice retenu est en relation directe avec l\'objet du contrat (immeuble bâti), conformément à l\'article L. 112-2 du Code monétaire et financier. L\'indice de référence des loyers (IRL), propre au logement, n\'est pas applicable à la présente location.' });
    } else {
      out.push({ type: 'p', text: 'Le loyer est fixe. Il ne varie qu\'à la volonté du BAILLEUR, par avenant ou lors du renouvellement du contrat. Aucune clause d\'indexation n\'est stipulée.' });
    }
    out.push({ type: 'h3', text: '4.3 — Retard de paiement' });
    out.push({ type: 'p', text: 'Toute somme non payée à son échéance porte de plein droit intérêt au taux légal à compter de la mise en demeure (art. 1231-6 du Code civil), sans préjudice de la clause résolutoire (§ 13) et de la clause pénale (§ 14).' });

    // ── §5 Charges (conditionnelle) ─────────────────────────────────────────
    out.push({ type: 'h2', text: '5 — Charges' });
    if (c.hasCharges) {
      out.push({ type: 'p', text: `Accessoirement au loyer, le LOCATAIRE rembourse au BAILLEUR sa quote-part des charges liées à l'usage des parties communes du parking (électricité de l'éclairage, nettoyage, entretien de la porte d'accès et de la ventilation). La provision mensuelle est fixée à ${S(c.charges)} €, régularisée annuellement sur justificatifs.` });
    } else {
      out.push({ type: 'p', text: 'Aucune charge n\'est due : le loyer est forfaitaire.' });
    }

    // ── §6 Dépôt de garantie ────────────────────────────────────────────────
    out.push({ type: 'h2', text: '6 — Dépôt de garantie' });
    if (has(c.dg)) {
      out.push({ type: 'p', text: `Le LOCATAIRE verse ce jour, à titre de dépôt de garantie, la somme de ${has(c.dgLettres) ? S(c.dgLettres) + ' ' : ''}(${S(c.dg)} €). Ce montant est librement convenu entre les parties (régime hors loi n° 89-462) et ne produit pas d'intérêts. Il est restitué après libération effective de l'emplacement et remise du moyen d'accès, déduction faite des sommes dues et des frais éventuels de remise en état.` });
    } else {
      out.push({ type: 'p', text: 'Aucun dépôt de garantie n\'est demandé.' });
    }
    out.push({ type: 'p', text: 'En aucun cas le LOCATAIRE ne peut imputer le dépôt de garantie sur le paiement du loyer ou des charges, notamment du dernier terme.' });

    // ── §7 Garanties de paiement (conditionnelle : si garant) ───────────────
    if (c.hasGarant) {
      out.push({ type: 'h2', text: '7 — Garanties de paiement' });
      out.push({ type: 'p', text: 'Les obligations du LOCATAIRE sont garanties par un acte de cautionnement solidaire souscrit par un GARANT, établi conformément aux articles 2288 et suivants du Code civil, annexé au présent contrat. Le GARANT s\'engage solidairement, sans bénéfice de discussion ni de division.' });
      out.push({ type: 'p', text: 'L\'acte de caution porte la mention légale (montant garanti en toutes lettres et en chiffres, renonciation aux bénéfices de discussion et de division) exigée à peine de nullité par l\'article 2297 du Code civil.' });
      out.push({ type: 'p-italic-note', text: 'La garantie « Loyers impayés » (GLI) et la garantie Visale ne sont pas mobilisables pour un emplacement loué isolément, ces dispositifs étant réservés à la résidence principale.' });
    }

    // ── §8 Assurance et responsabilité ──────────────────────────────────────
    out.push({ type: 'h2', text: '8 — Assurance et responsabilité' });
    out.push({ type: 'p', text: 'Le LOCATAIRE répond des dommages qu\'il cause au BAILLEUR ou aux tiers du fait de l\'usage de l\'emplacement. Il fait son affaire personnelle de l\'assurance de son véhicule et des biens entreposés, dont le BAILLEUR n\'est pas gardien et qu\'il n\'assure pas.' });
    out.push({ type: 'p', text: 'Le LOCATAIRE répond de l\'incendie survenu dans l\'emplacement loué dans les conditions de l\'article 1733 du Code civil : il en est présumé responsable, à moins qu\'il ne prouve que l\'incendie est arrivé par cas fortuit ou force majeure, par vice de construction, ou que le feu a été communiqué par un immeuble voisin.' });
    out.push({ type: 'p', text: 'Le LOCATAIRE souscrit une assurance de responsabilité civile couvrant les risques liés à l\'usage de l\'emplacement (notamment incendie et dégâts causés aux tiers) et en justifie sur demande du BAILLEUR. À défaut, après mise en demeure demeurée sans effet, le BAILLEUR peut se prévaloir de la clause résolutoire (§ 13).' });

    // ── §9 État des lieux ───────────────────────────────────────────────────
    out.push({ type: 'h2', text: '9 — État des lieux' });
    out.push({ type: 'p', text: 'Un état des lieux contradictoire simplifié est établi lors de la remise du moyen d\'accès (entrée) et lors de sa restitution (sortie) ; il porte notamment sur le sol, les murs, la porte et la serrure. Il est annexé au présent contrat (Annexe 1) et remis à chaque partie.' });

    // ── §10 Entretien et usage ──────────────────────────────────────────────
    out.push({ type: 'h2', text: '10 — Entretien et usage des lieux' });
    out.push({ type: 'p', text: 'Le LOCATAIRE use paisiblement de l\'emplacement selon sa destination. Il l\'entretient et le rend en bon état, assure les menues réparations locatives (serrure, propreté, ampoule) et n\'y apporte aucune modification sans accord écrit du BAILLEUR. Il ne peut encombrer ni les circulations ni les parties communes et respecte le règlement de copropriété et le règlement intérieur du parking. Les grosses réparations et celles rendues nécessaires par la vétusté restent à la charge du BAILLEUR (art. 1719 et 1720 du Code civil).' });

    // ── §11 Cession et sous-location ────────────────────────────────────────
    out.push({ type: 'h2', text: '11 — Cession et sous-location' });
    out.push({ type: 'p', text: 'Le LOCATAIRE ne peut céder le présent bail ni sous-louer ou prêter l\'emplacement, en tout ou partie, sans l\'accord préalable et écrit du BAILLEUR (art. 1717 du Code civil).' });

    // ── §12 Restitution et biens laissés ────────────────────────────────────
    out.push({ type: 'h2', text: '12 — Restitution et biens laissés dans les lieux' });
    out.push({ type: 'p', text: 'À la fin du contrat, le LOCATAIRE restitue l\'emplacement vidé de tout bien, nettoyé, et remet l\'ensemble des moyens d\'accès (clés, badge, télécommande). À défaut de restitution en bon état, les frais de remise en état et de débarras sont à sa charge, et une indemnité d\'occupation (§ 14) reste due jusqu\'à libération effective.' });
    out.push({ type: 'p', text: 'Les biens qui demeureraient dans l\'emplacement après la fin du contrat et après une mise en demeure de les enlever, adressée par lettre recommandée avec avis de réception et restée sans effet pendant un (1) mois, seront réputés abandonnés. Le BAILLEUR pourra alors les faire enlever et entreposer, ou en disposer, aux frais et risques du LOCATAIRE, sans que sa responsabilité puisse être engagée, sous réserve des droits des tiers et des procédures applicables aux biens de valeur.' });
    out.push({ type: 'p', text: 'Toute installation fixe réalisée par le LOCATAIRE reste, au choix du BAILLEUR : soit enlevée et les lieux remis en état aux frais du LOCATAIRE, soit conservée et acquise au BAILLEUR sans indemnité, par le jeu de l\'accession (article 555 du Code civil).' });

    // ── §13 Clause résolutoire ──────────────────────────────────────────────
    out.push({ type: 'h2', text: '13 — Clause résolutoire' });
    out.push({ type: 'p', text: 'À défaut de paiement du loyer, des charges ou du dépôt de garantie à leur échéance, à défaut d\'assurance, ou en cas de manquement à la clause de destination (§ 2), le présent contrat sera résilié de plein droit un (1) mois après une mise en demeure par lettre recommandée avec avis de réception restée sans effet, conformément aux articles 1224 à 1230 du Code civil. Le LOCATAIRE devra alors libérer les lieux sans délai.' });

    // ── §14 Clause pénale — Indemnité d'occupation ──────────────────────────
    out.push({ type: 'h2', text: '14 — Clause pénale — Indemnité d\'occupation' });
    out.push({ type: 'p', text: 'En cas de maintien dans les lieux après la fin du contrat, le LOCATAIRE sera redevable, à titre de clause pénale (art. 1231-5 du Code civil), d\'une indemnité d\'occupation égale à deux fois le loyer journalier, par jour de retard jusqu\'à restitution effective du moyen d\'accès, toute journée commencée étant due.' });

    // ── §15 Dispositions diverses ───────────────────────────────────────────
    out.push({ type: 'h2', text: '15 — Dispositions diverses' });
    if (c.plusieursLocataires) {
      out.push({ type: 'h3', text: 'Solidarité' });
      out.push({ type: 'p', text: 'En cas de pluralité de locataires, ceux-ci sont tenus solidairement et indivisiblement de l\'ensemble des obligations du présent contrat (loyer, charges, remise en état, indemnités), conformément à l\'article 1310 du Code civil.' });
    }
    out.push({ type: 'h3', text: 'Tolérance — non-renonciation' });
    out.push({ type: 'p', text: 'Le fait pour le BAILLEUR de tolérer un retard de paiement ou l\'inexécution d\'une obligation ne peut jamais être interprété comme une renonciation à s\'en prévaloir ni comme une modification du contrat.' });
    out.push({ type: 'h3', text: 'Élection de domicile' });
    out.push({ type: 'p', text: 'Le BAILLEUR fait élection de domicile à son siège ; le LOCATAIRE ' + (has(c.locDomicile) ? 'à son domicile sis ' + S(c.locDomicile) : 'à l\'adresse de l\'emplacement loué') + '. Toute correspondance y est valablement notifiée.' });
    if (c.erpZoneRisque) {
      out.push({ type: 'h3', text: 'État des risques' });
      out.push({ type: 'p', text: 'L\'emplacement étant situé dans une zone couverte par un plan de prévention des risques (ou en zone sismique / radon), un état des risques (art. L. 125-5 du Code de l\'environnement) de moins de six mois est annexé au présent contrat ' + (c.erpAnnexeTxt ? 'selon l\'état détaillé à l\'Annexe 2.' : '(Annexe 2).') });
    }
    out.push({ type: 'h3', text: 'Protection des données (RGPD)' });
    out.push({ type: 'p', text: 'Les données personnelles collectées sont traitées pour les seuls besoins de l\'exécution du contrat et conservées pendant sa durée augmentée des délais de prescription. Chaque partie dispose d\'un droit d\'accès et de rectification ; toute réclamation peut être portée devant la CNIL (www.cnil.fr).' });
    out.push({ type: 'h3', text: 'Frais et compétence' });
    out.push({ type: 'p', text: 'Le tribunal compétent est celui du lieu de situation de l\'emplacement. Les frais et dépens sont supportés par la partie perdante (art. 700 du Code de procédure civile).' });

    // ── §16 Signatures (bloc partagé injecté : page-break + cadres) ─────────
    out.push(...signature);

    // ── Annexes (page à part) ───────────────────────────────────────────────
    out.push({ type: 'page-break' });
    out.push({ type: 'h2', text: 'Annexes' });
    const annexRows = [
      ['1', 'État des lieux simplifié (entrée / sortie)', 'À établir'],
      ['2', 'État des risques (art. L. 125-5 C. env.)', c.erpAnnexeTxt || (c.erpZoneRisque ? 'Joint (zone à risque)' : 'N/A — hors zone à risque')],
      ['3', 'Acte de cautionnement solidaire', c.hasGarant ? 'Joint' : 'N/A — sans garant']
    ];
    out.push({ type: 'table', headers: ['N°', 'Document', 'Statut'], rows: annexRows, columnStyles: { 0: { halign: 'center', cellWidth: 10 } } });
    out.push({ type: 'p-italic-note', text: 'Aucune autre annexe : ni dossier de diagnostic technique, ni notice d\'information, ni règlement de copropriété imposé (réservés au bail d\'habitation).' });

    return out;
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailGarage = {
    BAIL_GARAGE_NATURES: BAIL_GARAGE_NATURES,
    BAIL_GARAGE_NATURE_DEFAULT: BAIL_GARAGE_NATURE_DEFAULT,
    resolveGarageNature: resolveGarageNature,
    getGarageTitle: getGarageTitle,
    getGarageDestinationUsage: getGarageDestinationUsage,
    BAIL_GARAGE_INDICES: BAIL_GARAGE_INDICES,
    BAIL_GARAGE_INDEX_DEFAULT: BAIL_GARAGE_INDEX_DEFAULT,
    isGarageIndexationOnByDefault: isGarageIndexationOnByDefault,
    GARAGE_SIGNATURE_SECTION_NO: GARAGE_SIGNATURE_SECTION_NO,
    GARAGE_NB_EXEMPLAIRES: GARAGE_NB_EXEMPLAIRES,
    buildGarageStructure: buildGarageStructure
  };
})(typeof window !== 'undefined' ? window : globalThis);
