/**
 * core/avenant.js — AVENANT AU CONTRAT DE BAIL
 *
 * Rédige un avenant modifiant un bail en cours (12 objets possibles), en réutilisant
 * les données du bail. PUR (sans DB / DOM) : génère du HTML de document + applique les
 * garde-fous légaux chiffrés. Le câblage UI / persistance / export vit dans index.html.
 *
 * Cadre légal (loi n° 89-462 du 6 juillet 1989) :
 *   - colocation / solidarité : art. 8-1, VI (fin de solidarité + caution du sortant, au
 *     plus tard 6 mois après le congé à défaut de colocataire entrant) ;
 *   - cautionnement : art. 22-1 ;
 *   - loyer / travaux d'amélioration : art. 17-1, II (accord exprès ; hausse annuelle ≤ 15 %
 *     du coût réel TTC des travaux ; travaux ≥ 1/2 année de loyer ; interdiction si DPE F/G) ;
 *   - charges : art. 23 (provisions, régularisation) / forfait non régularisable : art. 25-10 (meublé),
 *     art. 8-1, V (colocation) — `referenceForfaitCharges` (l'art. 23-1 est le partage des économies de
 *     charges après travaux d'économie d'énergie, sans rapport avec le forfait) ;
 *   - sous-location / cession : art. 8 ; destination : art. 2.
 *
 * Tests Vitest miroir : __tests__/helpers/avenant.test.js
 */

const ROMAINS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];
export function romain(n) { return ROMAINS[n - 1] || String(n); }

// Échappe une valeur saisie avant injection HTML (anti-XSS : le document est persisté dans
// bail.avenants[].html et sera rendu ailleurs, y compris en partage SCI multi-tenant).
export function esc(x) {
  return String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function b(x) { return '<strong>' + esc(x) + '</strong>'; }
// Marqueur de champ NON renseigné : « ‹à compléter› » lisible (jamais un « … » qui passe pour du texte final).
const TODO = '<span class="av-todo">‹à compléter›</span>';
function _vide(x) { return String(x == null ? '' : x).trim() === ''; }
function champ(x) { return _vide(x) ? TODO : '<strong>' + esc(x) + '</strong>'; }   // valeur en gras, sinon marqueur
function champTxt(x) { return _vide(x) ? TODO : esc(x); }                              // idem sans gras
function num(x) { return Number(x) || 0; }
// ── Accords grammaticaux (retour Didier 28/09) ──────────────────────────────
// Civilité du bail : 'M.' | 'Mme' | '' (inconnue). Inconnue → formes neutres « (e) », « Il / elle ».
function genre(civ) { return civ === 'Mme' ? 'f' : civ === 'M.' ? 'm' : ''; }
function accord(g, masc, fem, neutre) { return g === 'f' ? fem : g === 'm' ? masc : neutre; }
/** « Mme Alice Martin » ; civilité inconnue → « M. / Mme … », ou rien (`sansDefaut` : une caution peut être une société). */
function personne(civ, nom, sansDefaut) {
  const c = (civ === 'M.' || civ === 'Mme') ? civ + ' ' : (sansDefaut ? '' : 'M. / Mme ');
  return c + champ(nom);
}
/** Civilité d'un locataire du bail d'après son nom (ctx.locDetail = bail.locataires). */
function civiliteDe(ctx, nom) {
  const l = (Array.isArray(ctx && ctx.locDetail) ? ctx.locDetail : []).find(x => x && x.nom === nom);
  return l ? (l.civilite || '') : '';
}
/** Civilité du locataire en POSITION i (homonymes distingués) ; repli par nom si les listes divergent. */
function civiliteA(ctx, i, nom) {
  const l = (Array.isArray(ctx && ctx.locDetail) ? ctx.locDetail : [])[i];
  return l && l.nom === nom ? (l.civilite || '') : civiliteDe(ctx, nom);
}
/** « A », « A et B », « A, B et C ». */
function joinFr(arr) { return arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' et ' + arr[arr.length - 1]; }

function frDate(iso) {
  if (!iso) return '…';
  const p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
}

/**
 * Alertes (NON bloquantes) sur la modification de loyer. L'app conseille, l'utilisateur décide.
 * Le plafond 15 % / seuil ½ année ne vaut qu'en ZONE ENCADRÉE (tendue / encadrement des loyers) ;
 * en zone non tendue, la hausse pour travaux se fixe librement (art. 17-1 II) → simple info.
 * L'interdiction DPE F/G (art. 17) et l'incohérence de sens (baisse sous un motif de hausse) sont
 * signalées partout.
 * @param {{loyer0:number, coutTTC:number, dpe:string, nouveau:number, zoneEncadree:boolean, motif:string}} o
 * @returns {{seuil, maxHausseMois, maxLoyer, hausse, passoire, baisse, zoneEncadree, alertes:Array<{n:'info'|'warn', m:string}>}}
 */
export function loyerTravauxGuard(o) {
  o = o || {};
  const loyer0 = num(o.loyer0), coutTTC = num(o.coutTTC), nouveau = num(o.nouveau);
  const dpe = String(o.dpe || '').trim().toUpperCase().charAt(0);
  const motif = String(o.motif || '');
  const baisseMotif = motif.indexOf('Baisse') === 0;
  const zoneEncadree = !!o.zoneEncadree;
  const seuil = Math.round(loyer0 * 6 * 100) / 100;                 // 1/2 année de loyer
  const maxHausseMois = Math.round((coutTTC * 0.15 / 12) * 100) / 100; // 15 % TTC / an → /mois
  const maxLoyer = Math.round((loyer0 + maxHausseMois) * 100) / 100;
  const hausse = Math.round((nouveau - loyer0) * 100) / 100;
  const passoire = (dpe === 'F' || dpe === 'G');
  const alertes = [];
  if (passoire && !baisseMotif) alertes.push({ n: 'warn', m: 'Logement classé ' + dpe + ' : la majoration de loyer est en principe interdite (passoire énergétique, art. 17) tant qu\'une rénovation énergétique ne l\'en fait pas sortir.' });
  if (nouveau > 0) {
    if (!baisseMotif && hausse < 0) alertes.push({ n: 'warn', m: 'Le nouveau loyer (' + nouveau + ' €) est INFÉRIEUR au loyer actuel (' + loyer0 + ' €) : incohérent avec une majoration.' });
    if (baisseMotif && hausse > 0) alertes.push({ n: 'warn', m: 'Motif « baisse » mais le nouveau loyer (' + nouveau + ' €) est SUPÉRIEUR au loyer actuel (' + loyer0 + ' €).' });
  }
  if (!baisseMotif && hausse > 0) {
    if (zoneEncadree) {
      if (coutTTC > 0 && coutTTC < seuil) alertes.push({ n: 'warn', m: 'Zone encadrée : le coût des travaux (' + coutTTC + ' €) est inférieur à la moitié d\'une année de loyer (' + seuil + ' €) — la majoration pour travaux n\'est pas ouverte.' });
      if (hausse > maxHausseMois) alertes.push({ n: 'warn', m: 'Zone encadrée : la hausse (' + hausse + ' €/mois) dépasse le plafond de 15 % du coût TTC ÷ 12 (' + maxHausseMois + ' €/mois, soit un loyer maximal de ' + maxLoyer + ' €).' });
    } else {
      alertes.push({ n: 'info', m: 'Zone non tendue : la hausse pour travaux se fixe librement, d\'un commun accord — aucun plafond réglementaire. Seul le caractère réel des travaux est à vérifier (amélioration, non entretien).' });
    }
  }
  return { seuil, maxHausseMois, maxLoyer, hausse, passoire, baisse: hausse < 0, zoneEncadree, alertes };
}

/**
 * Génère un article d'avenant.
 * @param {string} k - type d'objet
 * @param {object} d - données saisies
 * @param {object} [ctx] - { loyer0 }
 * @returns {{titre, html, base?, caution?}|null}
 */
export function avenantArticle(k, d, ctx) {
  d = d || {}; ctx = ctx || {};
  switch (k) {
    case 'coloc': {
      const act = String(d.act || '');
      const isAjout = act.indexOf('Ajout') === 0;
      const isDepart = act.indexOf('Départ') === 0;
      // Accords (retour Didier 28/09) : singulier / pluriel selon le nombre de colocataires qui
      // RESTENT, masculin / féminin selon la civilité. Civilité inconnue → formes neutres « (e) ».
      const locs = Array.isArray(ctx.locataires) ? ctx.locataires : [];
      // Le sortant est désigné par sa POSITION (1ʳᵉ occurrence) : deux colocataires homonymes ne
      // disparaissent plus tous deux de l'acte, et chacun garde sa propre civilité (audit lot 1).
      const iS = isAjout ? -1 : locs.indexOf(d.sortant);
      const civS = iS >= 0 ? civiliteA(ctx, iS, locs[iS]) : civiliteDe(ctx, d.sortant), gS = genre(civS);
      const civE = d.civEntrant, gE = genre(civE);
      const restantsIdx = locs.map((_, i) => i).filter(i => i !== iS);
      const restants = restantsIdx.map(i => locs[i]);
      const nomsRestants = restantsIdx.map(i => personne(civiliteA(ctx, i, locs[i]), locs[i]));
      const auSortant = accord(gS, 'au colocataire sortant', 'à la colocataire sortante', 'au colocataire sortant');
      // Caution du sortant (retour Didier 28/09) : choisie parmi les garants du bail et NOMMÉE.
      // Non précisée → formule générique ; « Aucune caution » → la phrase ne parle que du sortant.
      const garants = (Array.isArray(ctx.garants) ? ctx.garants : []).map(g => String(g || '').trim()).filter(Boolean);
      const cS = String(d.cautionSortant || '').trim();
      const aucuneCaution = cS === 'Aucune caution';
      const cautionNommee = garants.indexOf(cS) >= 0 ? cS : '';
      const autresGarants = isAjout ? [] : garants.filter(g => g !== cautionNommee);
      let h = '';
      if (!isAjout) {
        const pour = accord(gS, 'lui', 'elle', 'lui / elle');
        h += personne(civS, d.sortant) + ' cesse d\'être partie au contrat de bail à compter de la date d\'effet du présent avenant et libère les lieux à cette date, renonçant à tout droit d\'occupation sur le logement. Conformément à l\'article 8-1, VI de la loi du 6 juillet 1989, ' +
          (aucuneCaution ? 'sa solidarité prend fin '
            : cautionNommee ? 'sa solidarité et celle de la personne qui s\'est portée caution pour ' + pour + ', ' + b(cautionNommee) + ', prennent fin '
            : 'sa solidarité et celle de la personne qui s\'est portée caution pour ' + pour + ' prennent fin ') +
          (isDepart
            ? 'au plus tard à l\'expiration d\'un délai de six mois suivant la date d\'effet de son congé, à défaut de colocataire entrant inscrit au bail avant ce terme'
            : 'à la date d\'effet du présent avenant, un colocataire entrant lui étant substitué') + '. ';
        // Les AUTRES cautions du bail sont nommées : leur engagement n'est pas touché par l'avenant
        // (constat, sans rien modifier : il reste régi par leur acte de cautionnement).
        // Seulement quand la caution du sortant est désignée : sinon on ne sait pas lesquelles restent.
        if ((cautionNommee || aucuneCaution) && autresGarants.length) {
          h += (autresGarants.length === 1
            ? 'L\'engagement de ' + b(autresGarants[0]) + ', caution, n\'est pas modifié par le présent avenant et demeure régi par son acte de cautionnement. '
            : 'Les engagements de ' + joinFr(autresGarants.map(b)) + ', cautions, ne sont pas modifiés par le présent avenant et demeurent régis par leurs actes de cautionnement. ');
        }
      }
      if (!isDepart) {
        const avecEnPlace = restants.length === 1 ? 'avec ' + nomsRestants[0] : restants.length > 1 ? 'avec les colocataires en place' : 'avec le ou les colocataires en place';
        h += personne(civE, d.entrant) + ' est ' + (isAjout ? accord(gE, 'adjoint', 'adjointe', 'adjoint(e)') + ' au' : accord(gE, 'substitué', 'substituée', 'substitué(e)') + ' ' + auSortant + ' et devient partie au') +
          ' contrat de bail à compter de la date d\'effet. ' + accord(gE, 'Il', 'Elle', 'Il / elle') + ' déclare avoir pris connaissance du bail initial et de ses annexes, en accepter sans réserve l\'ensemble des clauses et conditions, et devient solidairement et indivisiblement ' + accord(gE, 'tenu', 'tenue', 'tenu(e)') + ', ' + avecEnPlace + ', du paiement des loyers, charges et accessoires ainsi que de l\'exécution de toutes les obligations du bail. Un acte de cautionnement distinct est régularisé pour garantir ses engagements. ';
      }
      if (restants.length === 1) {
        h += nomsRestants[0] + ', qui demeure dans les lieux, poursuit le bail aux conditions initiales' +
          (isAjout ? '.' : ' et fait son affaire personnelle de la restitution éventuelle de la quote-part de dépôt de garantie ' + auSortant + '.');
      } else if (restants.length > 1) {
        h += (isAjout ? 'Les colocataires en place, ' : 'Les colocataires qui demeurent dans les lieux, ') + joinFr(nomsRestants) + ', poursuivent le bail aux conditions initiales' +
          (isAjout ? '.' : ' et font leur affaire personnelle de la restitution éventuelle de la quote-part de dépôt de garantie ' + auSortant + '.');
      } else {
        h += 'Le ou les colocataires demeurant dans les lieux poursuivent le bail aux conditions initiales' +
          (isAjout ? '.' : ' et font leur affaire personnelle de la restitution éventuelle de la quote-part de dépôt de garantie ' + auSortant + '.');
      }
      return { titre: 'Modification de la colocation', html: h, base: 'art. 8-1, VI, loi du 6 juillet 1989', caution: !isDepart };
    }
    case 'caution': {
      const act = String(d.act || '');
      const ml = act.indexOf('Mainlevée') === 0;
      const gC = genre(d.civ);
      const nL = Array.isArray(ctx.locataires) ? ctx.locataires.length : 0;
      const desLocs = nL === 1 ? 'du locataire' : nL > 1 ? 'des locataires' : 'du ou des locataires';
      const h = ml
        ? 'Le bailleur donne mainlevée pleine et entière de l\'engagement de caution souscrit par ' + personne(d.civ, d.nom, true) + ', qui se trouve ' + accord(gC, 'déchargé', 'déchargée', 'déchargé(e)') + ' de toute obligation au titre du bail à compter de la date d\'effet du présent avenant.'
        : act + ' : ' + personne(d.civ, d.nom, true) + ' s\'engage en qualité de caution solidaire à garantir l\'exécution de l\'ensemble des obligations ' + desLocs + ', dans la limite de ' + b(num(d.plafond) + ' €') + ', pour la durée du bail et de son ou ses renouvellements. Cet engagement, conforme à l\'article 22-1 de la loi du 6 juillet 1989, fait l\'objet d\'un acte de cautionnement distinct portant les mentions requises, annexé au présent avenant.';
      return { titre: 'Cautionnement', html: h, base: 'art. 22-1, loi du 6 juillet 1989', caution: !ml };
    }
    case 'loyer': {
      const loyer0 = num(ctx.loyer0);
      const motif = String(d.motif || '');
      const trav = motif.indexOf('Travaux') === 0, baisse = motif.indexOf('Baisse') === 0;
      let h = 'Les parties rappellent ';
      if (trav) {
        // L'acte affirmait SANS CONDITION que la majoration était « alignée sur le plafond
        // retenu pour la relocation encadrée ». Or `loyerTravauxGuard` ne fait qu'AVERTIR :
        // l'utilisateur peut dépasser le plafond, ou faire des travaux inférieurs à la demi-année
        // de loyer, et l'avenant certifiait quand même la conformité. Un locataire n'a alors
        // qu'à faire le calcul pour établir que l'acte est faux sur le point même qui fonde la
        // hausse. On ne certifie donc que ce qu'on a compté.
        const g = loyerTravauxGuard({ loyer0: loyer0, coutTTC: d.cout, dpe: d.dpe, nouveau: d.nouveau, motif: motif });
        // ⚠️ `!g.passoire` : sur un logement classé F ou G, la majoration n'est pas PLAFONNÉE,
        // elle est INTERDITE (art. 17-1, dernier alinéa : « La révision et la majoration de loyer
        // prévues aux I et II du présent article ne peuvent être appliquées aux logements de
        // classe F ou de classe G »). Certifier un alignement sur un plafond y serait certifier
        // la régularité de ce que la loi ferme. La donnée était déjà dans `g`, elle n'était pas lue.
        const aligne = num(d.cout) > 0 && num(d.nouveau) > 0 && !g.passoire
          && num(d.cout) >= g.seuil && g.hausse > 0 && g.hausse <= g.maxHausseMois;
        h += 'que le bailleur a fait réaliser dans le logement, depuis la conclusion du bail, des travaux d\'amélioration (apport d\'un équipement ou service nouveau, à l\'exclusion de tout entretien, réparation ou remise en état) : ' + champ(d.desc) + ', pour un coût réel de ' + b(num(d.cout) + ' € TTC') + '. Par application de l\'article 17-1, II de la loi du 6 juillet 1989, qui autorise les parties à fixer par avenant la majoration de loyer consécutive à de tels travaux, '
          + (aligne
            ? 'et le montant de la majoration ayant été, par prudence, aligné sur le plafond retenu pour la relocation encadrée (hausse annuelle limitée à 15 % du coût réel TTC des travaux, ces derniers excédant la moitié de la dernière année de loyer), '
            : 'la majoration étant fixée d\'un commun accord entre les parties, ');
      } else if (baisse) {
        h += 'qu\'il est consenti une baisse temporaire du loyer pendant la réalisation des travaux suivants : ' + champ(d.desc) + '. À ce titre, ';
      } else {
        h += 'leur volonté commune de réévaluer le loyer manifestement sous-évalué. En conséquence, ';
      }
      h += 'le loyer mensuel hors charges est porté de ' + b(loyer0 + ' €') + ' à ' + b(num(d.nouveau) + ' €') + ' à compter de la date d\'effet. Le locataire, dûment et préalablement informé de la nature ' + (trav ? 'des travaux et de leur coût' : 'du motif') + ', y consent expressément par la signature du présent avenant. La présente modification ne fait pas obstacle à la révision annuelle du loyer selon l\'indice de référence des loyers stipulée au bail.';
      return { titre: 'Modification du loyer', html: h, base: 'art. 17-1, II, loi du 6 juillet 1989' };
    }
    case 'charges': {
      const mode = String(d.mode || '');
      const forf = mode.toLowerCase().indexOf('forfait') >= 0;
      // Fondement du forfait selon le bail : art. 25-10 (meublé) / art. 8-1, V (colocation) ; type inconnu → la
      // loi seule, sans numéro inventé. (Jamais l'art. 23-1 : partage des économies de charges.)
      const refForf = referenceForfaitCharges({ typeBail: ctx.typeBail, nbLocataires: Array.isArray(ctx.locataires) ? ctx.locataires.length : 0 });
      const h = 'Les modalités de règlement des charges récupérables sont modifiées comme suit : ' + b(mode.toLowerCase()) + '. Le montant ' + (forf ? 'du forfait' : 'des provisions mensuelles') + ' de charges est fixé à ' + b(num(d.montant) + ' €') + ' à compter de la date d\'effet. ' +
        (forf
          ? 'Ce forfait, applicable aux locations meublées et aux colocations, n\'est pas soumis à régularisation et ne peut donner lieu à complément, conformément ' + refForf.acte + '.'
          : 'Ces provisions donnent lieu à une régularisation annuelle au regard des charges réelles, sur justificatifs tenus à la disposition du locataire, conformément à l\'article 23 de la loi du 6 juillet 1989.');
      return { titre: 'Charges locatives', html: h, base: forf ? refForf.base : 'art. 23, loi du 6 juillet 1989' };
    }
    case 'annexe': {
      const add = String(d.act || 'Adjonction') === 'Adjonction';
      const h = (add ? 'Est adjoint au contrat de bail, en qualité d\'accessoire du logement loué, ' : 'Est retiré de l\'assiette du contrat de bail ') + b((d.type || '') + ', ' + (d.design || '')) + '. ' +
        (add ? 'En contrepartie de cette adjonction, le loyer mensuel est majoré de ' + b(num(d.sup) + ' €') + ' à compter de la date d\'effet. ' : '') +
        'La jouissance de cette dépendance suit le sort du bail principal, dont elle ne peut être dissociée.';
      return { titre: (add ? 'Adjonction' : 'Retrait') + ' d\'une dépendance', html: h };
    }
    case 'duree': {
      const prorog = String(d.act || '').indexOf('Prorog') >= 0;
      // L'acte AFFIRMAIT « La présente stipulation respecte la durée minimale légale applicable
      // au contrat » — sans la moindre vérification. Or l'app ne peut PAS la vérifier : l'art. 10
      // donne trois ans aux personnes physiques ET aux bailleurs de l'art. 13 (dont les SCI
      // familiales), six ans aux autres personnes morales, et le modèle de données ne dit nulle
      // part si une SCI est familiale. Affirmer une conformité qu'on n'a pas contrôlée, dans un
      // acte contractuel, c'est offrir au locataire de quoi la contester — et endormir le
      // bailleur. On énonce donc le terme, et on rappelle la règle au lieu de certifier le fait.
      const h = 'Le terme du contrat de bail est ' + (prorog ? 'prorogé' : 'fixé') + ' au ' + b(frDate(d.fin)) + '. Les parties rappellent que la durée du contrat ne peut être inférieure à la durée minimale fixée par la loi du 6 juillet 1989 selon la qualité du bailleur et la nature du bail. Le bail se poursuit pour le surplus aux conditions initiales, la faculté de résiliation dans les conditions légales demeurant réservée à chacune des parties.';
      return { titre: 'Durée du bail', html: h };
    }
    case 'destination': {
      const h = 'La destination des lieux loués est modifiée pour devenir : ' + champ(d.dest) + ', à compter de la date d\'effet. Le locataire s\'engage à respecter les obligations et la réglementation propres à cet usage, ainsi que, le cas échéant, le règlement de copropriété de l\'immeuble.';
      return { titre: 'Destination des lieux', html: h, base: 'art. 2, loi du 6 juillet 1989' };
    }
    case 'travaux': {
      const loc = String(d.qui || 'le locataire') === 'le locataire';
      const h = 'Le bailleur autorise expressément ' + (d.qui || 'le locataire') + ' à faire réaliser les travaux suivants dans le logement : ' + champ(d.nature) + '. ' +
        (loc
          ? 'Les travaux sont exécutés sous la responsabilité du locataire, dans les règles de l\'art et sans porter atteinte à la structure ni à la destination du logement. Sauf convention contraire, les aménagements ainsi réalisés resteront acquis au bailleur en fin de bail, sans indemnité.'
          : 'Le bailleur en supporte le coût et informera le locataire du calendrier d\'exécution.') +
        (d.contre && d.contre !== '—' ? ' Contrepartie convenue : ' + b(d.contre) + '.' : '');
      return { titre: 'Autorisation de travaux', html: h };
    }
    case 'paiement': {
      const h = 'À compter de la date d\'effet, le loyer et les charges sont payables d\'avance le ' + champ(d.jour) + ' de chaque mois, par ' + champ(d.mode) + ', sur le compte du bailleur ouvert sous l\'IBAN ' + champ(d.rib) + '. La présente stipulation ne porte que sur les modalités de règlement et laisse inchangés le montant, l\'exigibilité et le terme du loyer.';
      return { titre: 'Modalités de paiement', html: h };
    }
    case 'souslocation': {
      const act = String(d.act || '');
      const sl = act.indexOf('sous-location') >= 0, ce = act.indexOf('cession') >= 0;
      const h = sl
        ? 'Le bailleur autorise le locataire à sous-louer le logement, ' + champ(d.cond) + '. Le prix du mètre carré de surface habitable de la sous-location ne peut excéder celui payé par le locataire principal ; ce dernier demeure seul tenu envers le bailleur de l\'exécution du bail, conformément à l\'article 8 de la loi du 6 juillet 1989.'
        : ce
          ? 'Le bailleur autorise le locataire à céder son droit au bail, ' + champ(d.cond) + '. Le cessionnaire est subrogé dans l\'ensemble des droits et obligations résultant du bail à compter de la date d\'effet.'
          : 'Le bailleur n\'autorise pas la sous-location ni la cession du présent bail, qui demeurent interdites sans son accord écrit préalable (art. 8 de la loi du 6 juillet 1989).';
      return { titre: 'Sous-location / cession', html: h, base: 'art. 8, loi du 6 juillet 1989' };
    }
    case 'clause':
      return { titre: esc(d.titre || 'Stipulation particulière'), html: champ(d.texte) };
    case 'correction': {
      const h = 'Les parties constatent qu\'une erreur purement matérielle affecte ' + champ(d.champ) + ' figurant au bail initial. En conséquence, la mention « ' + champTxt(d.anc) + ' » est rectifiée et remplacée par « ' + champ(d.nouv) + ' ». Cette rectification n\'emporte ni novation, ni modification de l\'économie générale du contrat.';
      return { titre: 'Rectification d\'une erreur matérielle', html: h };
    }
    default:
      return null;
  }
}

// ── « Lu et approuvé » (décision Didier 30/09 : obligatoire et imprimée, comme sur le bail) ─────────────
// Signé dans l'app : la mention est imprimée au-dessus de chaque signature (comme drawSignatureBlock pour
// le bail). Pas encore signé (document à imprimer) : la consigne de l'acte de cautionnement, au-dessus de
// l'espace où chaque partie signe à la main. Le moteur PDF (doc-native) lit `pro-sigmention`.
export const LU_APPROUVE = '« Lu et approuvé »';
// Consigne sur deux lignes : la mention à recopier n'est jamais coupée en fin de ligne.
const CONSIGNE_LU_APPROUVE = 'Précéder la signature de la mention manuscrite :<br>' + LU_APPROUVE;
/** Contenu de l'espace de signature d'un cadre : mention + image validée, ou consigne à la main. */
function _sigspaceHtml(imgHtml) {
  return imgHtml
    ? '<em class="pro-sigmention">' + LU_APPROUVE + '</em>' + imgHtml
    : '<em class="pro-sigmention pro-sigconsigne">' + CONSIGNE_LU_APPROUVE + '</em>';
}

/**
 * Assemble le document HTML complet de l'avenant.
 * @param {object} ctx - { no, bailleur, locataires:[nom], bien, dateBail, loyer0, effetIso, ville, objets:[{k,data}] }
 * @returns {{html, caution, nbArticles, entrant}}
 */
export function buildAvenantHtml(ctx) {
  ctx = ctx || {};
  const locs = Array.isArray(ctx.locataires) ? ctx.locataires : [];
  const objets = Array.isArray(ctx.objets) ? ctx.objets : [];
  const effet = frDate(ctx.effetIso);
  const entrant = avenantEntrant(objets);
  // Les articles reçoivent la liste des locataires (accords singulier / pluriel, civilités).
  const actx = { loyer0: ctx.loyer0, locataires: locs, locDetail: ctx.locDetail, garants: ctx.garants, typeBail: ctx.typeBail };
  let n = 1, arts = '', caution = false;
  objets.forEach(o => {
    const a = avenantArticle(o.k, o.data, actx);
    if (!a) return;
    if (a.caution) caution = true;
    arts += '<h3>Article ' + romain(n++) + ' — ' + a.titre + '</h3><p>' + a.html + (a.base ? ' <em style="color:#8b94a5">(' + a.base + ')</em>' : '') + '</p>';
  });
  arts += '<h3>Article ' + romain(n++) + ' — Prise d\'effet</h3><p>Le présent avenant prend effet le ' + b(effet) + '.</p>';
  // AVENANT-REFONTE §7 : la non-novation n'est dite qu'UNE fois (préambule) ; ici, l'essentiel.
  arts += '<h3>Article ' + romain(n++) + ' — Stipulations inchangées</h3><p>Toutes les autres clauses et conditions du bail demeurent applicables et inchangées. Le présent avenant forme un tout indivisible avec le bail auquel il est annexé.</p>';

  // Rôles des signataires : le colocataire qui part signe aussi (il renonce à ses droits sur le
  // logement) ; il est désigné comme tel, et non plus comme « Le locataire » parmi d'autres.
  const coloc = objets.find(o => o.k === 'coloc');
  const colocAct = String(((coloc || {}).data || {}).act || '');
  const sortant = coloc && colocAct.indexOf('Ajout') !== 0 ? String(coloc.data.sortant || '').trim() : '';
  const signataires = [{ role: 'Le bailleur', nom: ctx.bailleur || '', sous: ctx.representant ? 'représenté par ' + ctx.representant : '' }];
  const iSortant = sortant ? locs.indexOf(sortant) : -1;   // 1ʳᵉ occurrence seulement (homonymes)
  locs.forEach((nom, i) => {
    const g = genre(civiliteA(ctx, i, nom));
    signataires.push({ role: i === iSortant ? accord(g, 'Le colocataire sortant', 'La colocataire sortante', 'Le colocataire sortant') : accord(g, 'Le locataire', 'La locataire', 'Le locataire'), nom });
  });
  if (entrant) {
    const gE = genre(((coloc || {}).data || {}).civEntrant);
    signataires.push({ role: accord(gE, 'Le colocataire entrant', 'La colocataire entrante', 'Le colocataire entrant'), nom: entrant });
  }
  // Zone de signature CANONIQUE (forme {sig,label} de docSignzone) : l'espace de signature est
  // AU-DESSUS du filet, le libellé dessous. UNE seule zone : le moteur la pose par rangées de 3
  // cadres, chaque rangée entière sur une page. `ctx.signatures[i]` = data-URL d'image (lot 3),
  // VALIDÉE ici : le HTML de l'avenant est conservé et partagé (SCI) — jamais de HTML injecté tel quel.
  const sigs = Array.isArray(ctx.signatures) ? ctx.signatures : [];
  const sigImg = (u) => (typeof u === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u)) ? '<img src="' + esc(u) + '">' : '';
  const sigHtml = '<div class="pro-signzone' + (signataires.length > 1 ? ' duo' : '') + '">' +
    signataires.map((s, i) => '<div class="pro-sigcase"><div class="pro-sigspace">' + _sigspaceHtml(sigImg(sigs[i])) + '</div>' +
      '<div class="pro-signbox">' + s.role + '<br><strong>' + esc(s.nom) + '</strong>' + (s.sous ? '<br>' + esc(s.sous) : '') + '</div></div>').join('') +
    '</div>';

  // « Fait le » = date de l'ACTE (signature), jamais la date d'effet (audit 27/09). Inconnue tant
  // que l'avenant n'est pas signé dans l'app : ligne à compléter à la main.
  const dateActe = ctx.dateActeIso ? esc(frDate(ctx.dateActeIso)) : '____________________';
  const qualite = locs.length > 1 ? 'Les locataires' : accord(genre(civiliteDe(ctx, locs[0])), 'Le locataire', 'La locataire', 'Le locataire');

  // CORPS au gabarit Propryo (.pro-doc) — l'habillage (bandeau logos, titre, pied) est posé par _docPage.
  // Parties en blocs côte à côte (docParties) : fini le tableau qui répétait le titre.
  const html =
    '<div class="pro-parties">' +
      '<div class="pro-partie"><h2>Le bailleur</h2><span class="pro-qui">' + esc(ctx.bailleur || '') + '</span>' +
        (ctx.representant ? '<p>représenté par ' + esc(ctx.representant) + '</p>' : '') + '</div>' +
      '<div class="pro-partie"><h2>' + qualite + '</h2><span class="pro-qui">' + (locs.length ? locs.map(esc).join('<br>') : TODO) + '</span>' +
        '<p>' + champTxt(ctx.bien) + '</p></div>' +
    '</div>' +
    // AUDIT 27/09 : pas de « signé le » pour un bail sans signature complète dans l'app ; date échappée.
    '<p>Bail d\'habitation ' + (ctx.bailSigne === false ? 'en date du' : 'signé le') + ' <strong>' + esc(frDate(ctx.dateBail)) + '</strong>, loyer mensuel hors charges en vigueur : <strong>' + esc(String(num(ctx.loyer0))) + ' €</strong>. Les parties conviennent d\'y apporter les modifications ci-après, qui n\'emportent ni novation ni conclusion d\'un nouveau bail.</p>' +
    arts +
    (caution ? '<p><strong>Rappel :</strong> la ou les cautions concernées doivent réitérer leur engagement par un nouvel acte de cautionnement couvrant les présentes modifications, à peine de décharge (art. 22-1 de la loi du 6 juillet 1989).</p>' : '') +
    '<p class="pro-lieu">Fait à ' + champTxt(ctx.ville) + ', le ' + dateActe + ', en autant d\'exemplaires originaux que de parties, chacune reconnaissant en avoir reçu un.</p>' +
    sigHtml;
  return { html, caution, nbArticles: n - 1, entrant };
}

/** Nom du colocataire entrant (ajout ou remplacement), '' sinon. Source unique (document + paraphes). */
export function avenantEntrant(objets) {
  const c = (Array.isArray(objets) ? objets : []).find(o => o && o.k === 'coloc');
  const d = (c && c.data) || {};
  const nom = String(d.entrant == null ? '' : d.entrant).trim();
  return String(d.act || '').indexOf('Départ') !== 0 && nom ? nom : '';
}

/**
 * Champs essentiels non renseignés, par objet sélectionné (pour bloquer/avertir avant impression).
 * @param {Array<{k,data}>} objets
 * @returns {Array<{k, champs:string[]}>}
 */
export function avenantChampsManquants(objets) {
  const out = [];
  (objets || []).forEach(o => {
    const d = o.data || {}, miss = [];
    switch (o.k) {
      case 'coloc': {
        const act = String(d.act || '');
        if (act.indexOf('Ajout') !== 0 && _vide(d.sortant)) miss.push('colocataire sortant');
        if (act.indexOf('Départ') !== 0 && _vide(d.entrant)) miss.push('colocataire entrant');
        break;
      }
      case 'caution': if (_vide(d.nom)) miss.push('caution concernée'); break;
      case 'loyer':
        if (!(num(d.nouveau) > 0)) miss.push('nouveau loyer');
        if (String(d.motif || '').indexOf('Travaux') === 0 && _vide(d.desc)) miss.push('nature des travaux');
        break;
      case 'charges': if (!(num(d.montant) > 0)) miss.push('montant des charges'); break;
      case 'annexe': if (_vide(d.design)) miss.push('désignation de la dépendance'); break;
      case 'duree': if (_vide(d.fin)) miss.push('nouveau terme'); break;
      case 'travaux': if (_vide(d.nature)) miss.push('nature des travaux'); break;
      case 'paiement': if (_vide(d.rib)) miss.push('IBAN du bailleur'); break;
      case 'souslocation': if (String(d.act || '').indexOf('Refus') !== 0 && _vide(d.cond)) miss.push('conditions'); break;
      case 'clause':
        if (_vide(d.titre)) miss.push('intitulé de la clause');
        if (_vide(d.texte)) miss.push('texte de la clause');
        break;
      case 'correction':
        if (_vide(d.champ)) miss.push('élément corrigé');
        if (_vide(d.nouv)) miss.push('mention rectifiée');
        break;
    }
    if (miss.length) out.push({ k: o.k, champs: miss });
  });
  return out;
}

/**
 * Lecture d'un montant saisi dans l'avenant (loyer ou charges).
 * Champ VIDE → montant en vigueur conservé ; montant négatif / illisible → refusé.
 * 0 € est valable pour les charges (charges supprimées), pas pour le loyer (`strictPositif`).
 * @param {*} raw valeur saisie
 * @param {number} prev montant en vigueur
 * @param {{strictPositif?:boolean}} [opts]
 * @returns {{ok:true, v:number}|{ok:false}}
 */
export function avenantMontant(raw, prev, opts) {
  const s = String(raw == null ? '' : raw).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return { ok: true, v: prev };
  const n = parseFloat(s);
  if (!isFinite(n) || n < 0) return { ok: false };
  if (opts && opts.strictPositif && !(n > 0)) return { ok: false };
  return { ok: true, v: Math.round(n * 100) / 100 };
}

// ── Forfait de charges (art. 25-10 meublé / art. 8-1, V colocation) : timeline reconstruite depuis les avenants
// Le forfait de charges N'EST PAS régularisable (loi 89-462 : art. 25-10 et 8-1, V). L'avenant pose
// `bail.chForfait`, mais ce flag est NON DATÉ : régulariser un exercice antérieur à la
// signature (N-1, usage courant) ne doit PAS être court-circuité. On reconstruit donc l'état
// forfait À LA DATE demandée depuis les avenants (chaque objet charges porte data.mode :
// « … forfait … » = ON, « … provisions … » = OFF), ce qui gère N-1, l'année de transition et
// un retour aux provisions. Utilisé par computeRegul pour exclure les charges/provisions
// datées pendant une période au forfait. Pur (aucune DB / DOM).
//
// AVENANT-REFONTE lot 2 (portage v15.704) : les avenants vivent dans le REGISTRE du bail
// (journal `baux_evenements`, type 'avenant' : { date (= effet), statut, no, objets }), plus
// les avenants anciens (`bail.avenants[]` : { dateEffet, objets }). L'appelant passe la liste
// du registre (`avenants`) ; sans elle, on relit `bail.avenants[]` (ancien modèle).

/**
 * L'avenant est-il APPLIQUÉ au bail (ses changements font foi à sa date d'effet) ?
 *  - « Signé » : oui ;
 *  - « À signer » enregistré AVANT le lot 3 (pas de `aLaSignature`) : oui — lot 2 / v15.681 appliquaient
 *    loyer et charges dès l'enregistrement, et ces avenants restent honorés ;
 *  - « À signer » du lot 3 (`aLaSignature`) : non, rien ne s'applique avant la signature de toutes les parties ;
 *  - brouillon, annulé : non ;
 *  - avenant ancien sans statut (`bail.avenants[]` brut) : oui (il a été appliqué à l'enregistrement).
 */
export function avenantApplique(a) {
  if (!a) return false;
  if (a.statut == null) return true;
  return a.statut === 'signe' || (a.statut === 'a_signer' && !a.aLaSignature);
}

// Date d'effet RÉELLEMENT appliquée : la signature (lot 3) peut recaler la date (1ᵉʳ du mois, mois déjà
// quittancé…) et la pose dans `effetApplique` ; sinon la date d'effet écrite dans l'avenant.
function _effetAvenant(a) { return String((a && (a.effetApplique || a.date || a.dateEffet)) || '').slice(0, 10); }
/** Mode de charges porté par l'avenant (texte), ou null s'il ne change pas le régime des charges. */
function _modeCharges(a) {
  const o = a && Array.isArray(a.objets)
    ? a.objets.find(x => x && x.k === 'charges' && x.data && String(x.data.mode || '').trim() !== '')
    : null;
  return o ? String(o.data.mode) : null;
}

/**
 * Étapes datées du régime de charges, dans l'ordre d'application (date d'effet, puis n°) :
 * [{ date, forfait }]. `null` si AUCUN avenant — quel que soit son statut — ne porte de régime de
 * charges : le flag `bail.chForfait` fait alors foi (forfait d'origine / données anciennes). Dès qu'un
 * avenant de charges existe, la timeline fait foi : seul un avenant APPLIQUÉ y compte (`avenantApplique` :
 * signé, ou « À signer » d'avant le lot 3) — brouillon, annulé et « À signer » du lot 3 non ; le flag
 * (non daté, jamais retiré à l'annulation) n'est plus lu. Date = `effetApplique` sinon date d'effet.
 * @param {object} bail
 * @param {Array} [avenants] avenants du bail (registre) ; absent → `bail.avenants[]`
 */
export function forfaitEtapes(bail, avenants) {
  if (!bail) return null;
  const src = Array.isArray(avenants) ? avenants : (Array.isArray(bail.avenants) ? bail.avenants : []);
  const charges = src.filter(a => a && _effetAvenant(a) && _modeCharges(a) !== null);
  if (!charges.length) return null;
  return charges
    .filter(avenantApplique)
    .slice()
    .sort((x, y) => _effetAvenant(x).localeCompare(_effetAvenant(y)) || ((Number(x.no) || 0) - (Number(y.no) || 0)))
    .map(a => ({ date: _effetAvenant(a), forfait: _modeCharges(a).toLowerCase().indexOf('forfait') >= 0 }));
}

/** Le bail est-il au forfait de charges à `dateIso` ? Régime d'origine (avant le 1er avenant charges) = provisions. */
export function bailForfaitActifLe(bail, dateIso, avenants) {
  if (!bail || !dateIso) return false;
  const d = String(dateIso).slice(0, 10);
  const etapes = forfaitEtapes(bail, avenants);
  // Pas de timeline charges → fallback sur le flag global (forfait day-1 / legacy).
  if (etapes === null) return bail.chForfait === true;
  let etat = false;
  for (const e of etapes) {
    if (e.date > d) break;
    etat = e.forfait;
  }
  return etat;
}

/**
 * Date d'effet du forfait en vigueur à `toIso` (début de la période continue au forfait), '' si le bail
 * n'est pas au forfait à cette date ou s'il l'est sans avenant (forfait d'origine : « toute la période »).
 */
export function forfaitEffetAu(bail, toIso, avenants) {
  const etapes = forfaitEtapes(bail, avenants);
  if (!etapes || !toIso) return '';
  const t = String(toIso).slice(0, 10);
  let eff = '';
  for (const e of etapes) {
    if (e.date > t) break;
    eff = e.forfait ? (eff || e.date) : '';
  }
  return eff;
}

/** Faut-il examiner le forfait de ce bail (flag posé ou avenant de charges) ? Court-circuit de computeRegul. */
export function forfaitPertinent(bail, avenants) {
  return !!bail && (bail.chForfait === true || forfaitEtapes(bail, avenants) !== null);
}

// ── AVENANT-REFONTE lot 3b — signature d'un avenant FIGÉ (jamais régénéré depuis le bail actuel) ────────
// Les cadres de signature sont repérés par un analyseur LINÉAIRE (recherche de chaînes, curseur qui ne
// recule jamais) et non par une expression régulière : un document forgé, venu du partage SCI, ne peut pas
// geler l'onglet (audit lot 3b I5).
const _OUV = '<div class="pro-sigcase"><div class="pro-sigspace">';
const _MIL = '</div><div class="pro-signbox">';
const _FIN = '</div></div>';
/** Cadres du document, dans l'ordre : [{debut, fin, space, box}] (positions dans la chaîne). */
function _cadres(s) {
  const out = [];
  let pos = 0, ferme = -1;   // `ferme` = 1er '</div>' connu après la dernière ouverture (amorti linéaire)
  for (;;) {
    const o = s.indexOf(_OUV, pos);
    if (o < 0) break;
    const d = o + _OUV.length;
    if (ferme < d) ferme = s.indexOf('</div>', d);
    if (ferme < 0) break;                                   // plus aucune fermeture : aucun cadre complet
    if (s.startsWith(_MIL, ferme)) {
      const b = ferme + _MIL.length;
      const f = s.indexOf('</div>', b);
      if (f < 0) break;
      if (s.startsWith(_FIN, f)) {
        out.push({ debut: o, fin: f + _FIN.length, space: s.slice(d, ferme), box: s.slice(b, f) });
        pos = f + _FIN.length; ferme = -1;
        continue;
      }
    }
    pos = d;   // ouverture sans cadre complet : on repart juste après
  }
  return out;
}
const _txt = (h) => String(h == null ? '' : h).replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
const _SIG_OK = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/**
 * Parties qui signent, lues dans le document de l'avenant tel qu'il a été enregistré (cadres de
 * signature, dans l'ordre) : c'est le document qui fait foi, pas le bail d'aujourd'hui.
 * @returns {Array<{role:string, nom:string, sous:string}>} texte brut (à échapper par l'appelant)
 */
export function avenantPartiesSignature(html) {
  return _cadres(String(html == null ? '' : html)).map((c) => {
    const parts = c.box.split(/<br\s*\/?>/i);
    return { role: _txt(parts[0]), nom: _txt(parts[1]), sous: _txt(parts.slice(2).join(' ')) };
  });
}

/**
 * Document signé : chaque image (data-URL PNG/JPEG VALIDÉE — le document est partagé, jamais de HTML
 * injecté tel quel) posée dans le cadre de même rang ; la date de l'acte remplace la ligne à compléter.
 * « Lu et approuvé » (décision 30/09) : `lus[i]` doit valoir true pour CHAQUE cadre ; la mention est alors
 * imprimée au-dessus de chaque signature (elle remplace la consigne du document à imprimer).
 * Retourne null si le nombre de signatures ne correspond pas aux cadres (document incohérent) ou si une
 * partie n'a pas coché « Lu et approuvé » (signature non valable).
 */
export function avenantHtmlSigne(html, sigs, dateActeIso, lus) {
  const s = String(html == null ? '' : html);
  const liste = Array.isArray(sigs) ? sigs : [];
  const cadres = _cadres(s);
  if (!cadres.length || liste.length !== cadres.length || !liste.every(u => typeof u === 'string' && _SIG_OK.test(u))) return null;
  if (!Array.isArray(lus) || lus.length !== cadres.length || !lus.every(x => x === true)) return null;
  let out = '', pos = 0;
  cadres.forEach((c, i) => {
    out += s.slice(pos, c.debut) + _OUV + _sigspaceHtml('<img src="' + esc(liste[i]) + '">') + _MIL + c.box + _FIN;
    pos = c.fin;
  });
  out += s.slice(pos);
  // La ligne « Fait à …, le ____ , en autant… » précisément — jamais des soulignés saisis dans une clause.
  if (dateActeIso) out = out.replace(', le ____________________, en autant', ', le ' + esc(frDate(dateActeIso)) + ', en autant');
  return out;
}

/**
 * Document à imprimer (signature sur papier) : chaque cadre dont l'espace de signature est VIDE reçoit la
 * consigne « Précéder la signature de la mention manuscrite… ». Sert aux avenants enregistrés avant la
 * décision du 30/09 (document figé sans consigne) ; un cadre déjà rempli (consigne, signature) est laissé tel quel.
 */
export function avenantHtmlAImprimer(html) {
  const s = String(html == null ? '' : html);
  const cadres = _cadres(s);
  let out = '', pos = 0;
  cadres.forEach((c) => {
    out += s.slice(pos, c.debut) + (c.space.trim() ? s.slice(c.debut, c.fin) : _OUV + _sigspaceHtml('') + _MIL + c.box + _FIN);
    pos = c.fin;
  });
  return out + s.slice(pos);
}

/**
 * Signature d'une partie sur l'appareil (règle du bail, décision 30/09) : valable seulement tracée ET
 * « Lu et approuvé » coché. Retourne ce qui manque (texte à l'infinitif) ou null si elle est valable.
 */
export function avenantSignatureManque(signe, lu) {
  if (signe && lu) return null;
  if (!signe && !lu) return 'signer ET cocher ' + LU_APPROUVE;
  return signe ? 'cocher ' + LU_APPROUVE : 'signer';
}

/**
 * Un objet d'avenant est-il APPLIQUÉ au bail (et non « document seulement ») ? Loyer : le montant change.
 * Charges : le montant change OU le régime change (forfait ↔ provisions, lu par la régularisation).
 */
export function avenantObjetApplique(o, { prevHc, newHc, prevCh, newCh, prevForfait, newForfait } = {}) {
  if (!o) return false;
  if (o.k === 'loyer') return newHc !== prevHc;
  if (o.k === 'charges') return newCh !== prevCh || !!newForfait !== !!prevForfait;
  return false;
}

/** Régime demandé par un objet « charges » : true = forfait, false = provisions, null = pas de régime. */
export function regimeForfaitObjet(o) {
  if (!o || o.k !== 'charges' || !o.data || String(o.data.mode || '').trim() === '') return null;
  return String(o.data.mode).toLowerCase().indexOf('forfait') >= 0;
}

/** Date d'effet réellement appliquée d'un avenant (`effetApplique`, sinon date d'effet écrite). */
export function effetAvenant(a) { return _effetAvenant(a); }

// ── Forfait de charges : où la loi le prévoit (décision Didier 01/10 : AVERTIR, jamais bloquer) ─────────
// Loi n° 89-462 (Légifrance, relevé le 01/10/2026) :
//  - art. 25-10 (location meublée, en vigueur depuis le 27/03/2014) : les charges « sont récupérées par le
//    bailleur au choix des parties […] 2° Soit sous la forme d'un forfait versé simultanément au loyer » ;
//  - art. 8-1, V (colocation, version en vigueur depuis le 01/07/2021) : « Les charges locatives accessoires
//    au loyer principal d'un contrat de bail d'une colocation sont récupérées par le bailleur au choix des
//    parties […] 2° Soit sous la forme d'un forfait versé simultanément au loyer ».
// Hors de ces deux cas (bail nu à un seul locataire), seules les provisions avec régularisation (art. 23).
// NB : « colocation » = 2 locataires ou plus, comme le reste de l'app ; la situation époux / PACS
// (art. 8-1, I, qui l'exclut de la colocation) sera demandée au lot 4 de l'avenant.
const TYPES_MEUBLES = ['meuble', 'etudiant', 'mobilite'];
const LOI_1989 = 'loi n° 89-462 du 6 juillet 1989';

/**
 * Référence légale du FORFAIT de charges pour un bail — source UNIQUE (acte d'avenant, régularisation,
 * décomptes, avertissement). Meublé → art. 25-10 ; colocation (2 locataires ou plus) → art. 8-1, V ;
 * les deux → les deux ; type indéterminable (ou bail nu à un seul locataire, où la loi ne prévoit pas le
 * forfait) → la loi seule, SANS numéro d'article inventé.
 * @returns {{article:string, citation:string, acte:string, base:string}}
 *   article : « art. 25-10 » / « art. 8-1, V » / « art. 8-1, V et 25-10 » / '' ;
 *   citation : pour l'écran et les décomptes ; acte : suite de « conformément … » dans un acte ;
 *   base : mention entre parenthèses sous un article d'avenant.
 */
export function referenceForfaitCharges({ typeBail, nbLocataires } = {}) {
  const arts = [];
  if ((Number(nbLocataires) || 0) > 1) arts.push('8-1, V');
  if (TYPES_MEUBLES.indexOf(String(typeBail || '')) >= 0) arts.push('25-10');
  if (!arts.length) {
    return { article: '', citation: LOI_1989 + ' (forfait de charges)', acte: 'à la loi du 6 juillet 1989', base: 'loi du 6 juillet 1989' };
  }
  const article = 'art. ' + arts.join(' et ');
  return {
    article,
    citation: article + ', ' + LOI_1989,
    acte: (arts.length === 1 ? 'à l\'article ' + arts[0] : 'aux articles ' + arts.join(' et ')) + ' de la loi du 6 juillet 1989',
    base: article + ', loi du 6 juillet 1989',
  };
}

/** Le forfait de charges est-il prévu par la loi pour ce bail (meublé ou colocation) ? */
export function forfaitChargesPrevu(typeBail, nbLocataires) {
  return TYPES_MEUBLES.indexOf(String(typeBail || '')) >= 0 || (Number(nbLocataires) || 0) > 1;
}

/**
 * Avertissement (NON bloquant) à l'enregistrement d'un avenant qui pose un forfait de charges sur un bail
 * où la loi ne le prévoit pas (bail nu à un seul locataire). null si sans objet.
 * @param {Array<{k,data}>} objets  objets de l'avenant
 * @param {{typeBail:string, nbLocataires:number}} ctx
 */
export function avertissementForfaitCharges(objets, { typeBail, nbLocataires } = {}) {
  const forfait = (Array.isArray(objets) ? objets : []).some((o) => regimeForfaitObjet(o) === true);
  if (!forfait || forfaitChargesPrevu(typeBail, nbLocataires)) return null;
  // Articles tirés de la source unique (DRY) : meublé seul / colocation seule.
  const meuble = referenceForfaitCharges({ typeBail: 'meuble', nbLocataires: 1 }).article;
  const coloc = referenceForfaitCharges({ typeBail: 'nu', nbLocataires: 2 }).article;
  return 'Forfait de charges sur un bail nu à un seul locataire : la loi du 6 juillet 1989 ne prévoit le forfait '
    + "qu'en location meublée (" + meuble + ') ou en colocation (' + coloc + '). Hors de ces cas, les charges se '
    + "récupèrent par provisions avec régularisation annuelle (art. 23). Vérifier la nature du bail avant d'enregistrer.";
}
