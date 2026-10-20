// js/core/employeur.js — CANDIDATURES-CONFORMITE lot 2 (12/10/2026).
// Employeur déclaré par un candidat : SIREN / SIRET facultatif, vérifié dans l'Annuaire des entreprises
// (API publique Recherche d'entreprises, gratuite, sans clé ; CORS ouvert « * », vérifié le 12/10/2026 →
// appel direct depuis le navigateur). Contrôle C7 du rapport « EDL visio travaux et dossiers ».
// Le résultat est un CONSTAT daté et sourcé (« n'apparaît pas comme actif … au JJ/MM/AAAA »), jamais un
// jugement : l'existence d'une entreprise ne prouve pas l'emploi, son absence peut avoir une explication.
// Pur : l'appelant fait le fetch (hors ligne → vérification simplement reportée).
// Testé par __tests__/helpers/employeur.test.js.

export const SOURCE_EMPLOYEUR = {
  libelle: 'Annuaire des entreprises (recherche-entreprises.api.gouv.fr)',
  api: 'https://recherche-entreprises.api.gouv.fr/search'
};

function _luhn(ch) {
  let s = 0;
  for (let i = 0; i < ch.length; i++) {
    let d = ch.charCodeAt(ch.length - 1 - i) - 48;
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    s += d;
  }
  return s % 10 === 0;
}

/**
 * Normalise une saisie libre. null si vide (champ facultatif).
 * @returns {{type:'siren'|'siret'|null, valeur:string, siren?:string, valide:boolean, erreur?:'longueur'|'cle'}|null}
 */
export function normaliserIdentifiant(saisie) {
  const brut = String(saisie == null ? '' : saisie).replace(/[\s.\-]/g, '');
  if (!brut) return null;
  if (!/^\d+$/.test(brut) || (brut.length !== 9 && brut.length !== 14)) return { type: null, valeur: brut, valide: false, erreur: 'longueur' };
  const type = brut.length === 9 ? 'siren' : 'siret';
  const siren = brut.slice(0, 9);
  let ok = _luhn(siren);
  if (ok && type === 'siret') {
    // La Poste (SIREN 356000000) : SIRET hors Luhn, la somme des chiffres est un multiple de 5.
    ok = siren === '356000000' ? ([...brut].reduce((a, c) => a + (+c), 0) % 5 === 0) : _luhn(brut);
  }
  return ok ? { type, valeur: brut, siren, valide: true } : { type, valeur: brut, siren, valide: false, erreur: 'cle' };
}

export function urlRecherche(id) {
  return SOURCE_EMPLOYEUR.api + '?q=' + encodeURIComponent(String(id)) + '&page=1&per_page=1';
}

/**
 * Lit la réponse de l'API pour l'identifiant normalisé. null si la réponse est illisible (vérification reportée).
 * SIRET : l'état de l'ÉTABLISSEMENT fait foi ; SIREN : l'état de l'unité légale.
 */
export function lireReponse(json, ident, verifieLeIso) {
  if (!ident || !ident.valide || !json || !Array.isArray(json.results)) return null;
  const base = { id: ident.valeur, type: ident.type, verifieLe: verifieLeIso };
  const r = json.results.find(x => x && String(x.siren) === ident.siren);
  if (!r) return { ...base, etat: 'introuvable', nomOfficiel: '', dateFermeture: '' };
  const nomOfficiel = String(r.nom_complet || r.nom_raison_sociale || '');
  if (ident.type === 'siret') {
    const etabs = [].concat(Array.isArray(r.matching_etablissements) ? r.matching_etablissements : [], r.siege ? [r.siege] : []);
    const e = etabs.find(x => x && String(x.siret) === ident.valeur);
    if (!e) return { ...base, etat: 'introuvable', nomOfficiel: '', dateFermeture: '' };
    const actif = e.etat_administratif === 'A';
    return { ...base, etat: actif ? 'actif' : 'ferme', nomOfficiel, dateFermeture: actif ? '' : String(e.date_fermeture || '') };
  }
  const actif = r.etat_administratif === 'A';
  return { ...base, etat: actif ? 'actif' : 'ferme', nomOfficiel, dateFermeture: actif ? '' : String(r.date_fermeture || '') };
}

const _jma = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const _hm = iso => { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function _grouper(id) {
  const s = String(id || '');
  return s.length === 14 ? s.slice(0, 3) + ' ' + s.slice(3, 6) + ' ' + s.slice(6, 9) + ' ' + s.slice(9) : s.replace(/(\d{3})(?=\d)/g, '$1 ');
}

/** Point à vérifier (fiche candidat) pour un employeur introuvable, fermé ou un numéro invalide ; null sinon. */
export function pointEmployeur(verif, nomDeclare) {
  if (!verif || !verif.etat) return null;
  const date = 'vérifié le ' + _jma(verif.verifieLe) + (_hm(verif.verifieLe) ? ' à ' + _hm(verif.verifieLe) : '');
  if (verif.etat === 'invalide') {
    return { code: 'C7', icone: 'building', titre: "Le numéro d'employeur saisi n'est pas un SIREN ou SIRET valide (contrôle de la clé).",
      detail: 'Numéro saisi : ' + String(verif.id || '') + '.', source: 'Contrôle de la clé du numéro (algorithme de Luhn)', url: '', date: 'le ' + _jma(verif.verifieLe) };
  }
  if (verif.etat !== 'ferme' && verif.etat !== 'introuvable') return null;
  const lib = (verif.type === 'siret' ? 'SIRET ' : 'SIREN ') + _grouper(verif.id);
  const nom = String(nomDeclare || '').trim();
  const titre = "L'employeur indiqué n'apparaît pas comme actif dans l'Annuaire des entreprises au " + _jma(verif.verifieLe) + '.';
  let detail;
  if (verif.etat === 'introuvable') {
    detail = (verif.type === 'siret' ? 'Aucun établissement trouvé pour le ' : 'Aucune entreprise trouvée pour le ') + lib + (nom ? ' déclaré pour « ' + nom + ' »' : '') + '.';
  } else {
    detail = lib + (nom ? ' déclaré pour « ' + nom + ' »' : '') + '. L\'annuaire indique : ' + (verif.nomOfficiel || 'nom non diffusé') + ', '
      + (verif.type === 'siret' ? 'établissement fermé' : 'entreprise fermée') + (verif.dateFermeture ? ' le ' + _jma(verif.dateFermeture) : '') + '.';
  }
  return { code: 'C7', icone: 'building', titre, detail, source: SOURCE_EMPLOYEUR.libelle,
    url: 'https://annuaire-entreprises.data.gouv.fr/' + (verif.type === 'siret' ? 'etablissement/' : 'entreprise/') + verif.id, date };
}

/** Ligne factuelle (carte Situation) pour un employeur actif ; '' sinon. */
export function ligneEmployeurActif(verif) {
  if (!verif || verif.etat !== 'actif') return '';
  return "Actif dans l'Annuaire des entreprises au " + _jma(verif.verifieLe) + (verif.nomOfficiel ? ' — ' + verif.nomOfficiel : '');
}

/** Faut-il (re)vérifier ? Numéro renseigné et pas encore constaté pour CE numéro. */
export function doitVerifier(cand) {
  const ident = normaliserIdentifiant(cand && cand.employeurSiren);
  if (!ident) return false;
  const v = cand.employeurVerif;
  return !(v && v.id === ident.valeur && v.etat);
}
