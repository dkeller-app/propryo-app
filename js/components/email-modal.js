/**
 * components/email-modal.js — Modale de proposition d'email (EMAIL-AUTO V1 Phase 2)
 *
 * Pattern V1 "proposition de mail" (pas d'envoi backend) :
 *  - Aperçu sujet + corps éditables
 *  - Liste des pièces jointes recommandées
 *  - 3 boutons :
 *     • Ouvrir dans mon client mail (mailto: si < 1800 chars, sinon fallback)
 *     • Copier sujet + corps (clipboard)
 *     • Partager (Web Share API, mobile uniquement si dispo)
 *
 * Le DOM de la modale est injecté dynamiquement au premier appel — pas besoin
 * de polluer index-test.html avec un overlay statique.
 *
 * API :
 *   openEmailModal(type, context, opts) → ouvre la modale pré-remplie via
 *                                          _emailCompose(type, context).
 *
 * Pattern réutilisé : .ov / .modal / .m-head / .m-body / .m-foot + .btn / .btn.bs / .btn.bp
 * (cf css/main.css `.ov{...}` + `.modal{...}`).
 */

import { showToast } from './toast.js';
import { openM, closeM } from './modal.js';
import { _emailCompose } from '../core/email-compose.js';
import { escHtml } from '../core/utils.js';
// v15.80 EMAIL-SMTP-CONNECT — envoi direct via Gmail API
import { _emailToMimeBase64Url, _emailSendViaGmail } from '../core/email-send.js';
// v15.87 EM-2b — PJ PDF auto-générée
import { _emailGenPdfAttachment } from '../core/email-pdf-attachment.js';
// DOC-C étendu — un acte ne sort pas non plus par la modale email avec ses trous.
import { sortieAutorisee } from '../core/actes-mentions.js';

export const MODAL_ID = 'ov-email-compose';

// Limite mailto: pratique (RFC 2368 ne précise pas, mais beaucoup de clients
// coupent à ~2000 chars URL totale). On garde une marge sécurité.
const MAILTO_MAX_LENGTH = 1800;

// ────────────────────────────────────────────────────────────────────────────
// Construction URL mailto:
// ────────────────────────────────────────────────────────────────────────────

/**
 * Construit une URL mailto: avec encodage correct.
 * @param {string} to
 * @param {string} cc
 * @param {string} subject
 * @param {string} body
 * @returns {string}
 */
export function _buildMailtoUrl(to, cc, subject, body) {
  const params = [];
  if (cc) params.push('cc=' + encodeURIComponent(cc));
  if (subject) params.push('subject=' + encodeURIComponent(subject));
  if (body) params.push('body=' + encodeURIComponent(body));
  const qs = params.length ? '?' + params.join('&') : '';
  return 'mailto:' + encodeURIComponent(to || '') + qs;
}

// ────────────────────────────────────────────────────────────────────────────
// DOM injection (idempotent)
// ────────────────────────────────────────────────────────────────────────────

function _ensureModalDom() {
  if (typeof document === 'undefined') return null;
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.className = 'ov hidden';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'em-title');
  // v15.82bis — Pattern onclick inline (cohérent avec les autres modales ImmoTrack,
  // cf #ov-bail, #ov-mv, etc. qui utilisent closeBg(event,'ov-X')). Les approches
  // listener JS (sur modal puis sur document) ont toutes échoué silencieusement
  // en prod — pattern HTML attribute garanti fonctionner.
  modal.setAttribute('onclick', "closeBg(event,'" + MODAL_ID + "')");
  // v15.86 EM-2a — Refonte UX modale email variant A :
  //  - FROM bar verte (adresse Gmail visible avant envoi)
  //  - PJ card avec statut Prête/En cours/Erreur (slot prêt pour PJ auto v15.87)
  //  - Note légale repliable <details> (au lieu de bloc orange permanent)
  //  - Footer : Annuler (ghost) / Copier+Client (secondary) / Envoyer (primary)
  //  - Mobile (≤640px) : footer 2 rangs (primary fullwidth + secondaires)
  modal.innerHTML = `
    <style id="em-modal-styles">
      #${MODAL_ID} .em-from-bar { display: flex; align-items: center; gap: 8px; padding: 8px 20px; background: rgba(16,185,129,.10); border-bottom: 1px solid rgba(16,185,129,.25); font-size: 12px; }
      #${MODAL_ID} .em-from-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; flex: 0 0 8px; }
      #${MODAL_ID} .em-from-lbl { color: var(--mu, #94a3b8); }
      #${MODAL_ID} .em-from-email { color: var(--t1, inherit); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 auto; }
      #${MODAL_ID} .em-from-meta { color: var(--mu, #94a3b8); font-size: 11px; flex: 0 0 auto; }
      #${MODAL_ID} .em-att-card { background: rgba(0,0,0,.04); border: 1px solid var(--bd, #e2e8f0); border-radius: 8px; padding: 10px; margin-top: 12px; }
      [data-theme="dark"] #${MODAL_ID} .em-att-card { background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.10); }
      #${MODAL_ID} .em-att-title { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--mu, #94a3b8); font-weight: 600; margin-bottom: 6px; }
      #${MODAL_ID} .em-att-item { display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--bg, #fff); border-radius: 6px; margin-bottom: 6px; }
      [data-theme="dark"] #${MODAL_ID} .em-att-item { background: rgba(0,0,0,.20); }
      #${MODAL_ID} .em-att-item:last-child { margin-bottom: 0; }
      #${MODAL_ID} .em-att-icon { width: 32px; height: 32px; background: rgba(59,130,246,.15); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex: 0 0 32px; }
      #${MODAL_ID} .em-att-info { flex: 1; min-width: 0; }
      #${MODAL_ID} .em-att-name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${MODAL_ID} .em-att-meta { font-size: 11px; color: var(--mu, #94a3b8); }
      #${MODAL_ID} .em-att-status { font-size: 11px; padding: 3px 8px; border-radius: 999px; font-weight: 500; flex: 0 0 auto; }
      #${MODAL_ID} .em-att-status.ok { background: rgba(16,185,129,.15); color: #059669; }
      #${MODAL_ID} .em-att-status.pending { background: rgba(245,158,11,.15); color: #d97706; }
      #${MODAL_ID} .em-att-status.err { background: rgba(220,38,38,.15); color: #dc2626; }
      #${MODAL_ID} .em-legal { margin-top: 12px; background: rgba(245,158,11,.08); border-left: 3px solid var(--ora, #f59e0b); border-radius: 6px; padding: 8px 12px; font-size: 12.5px; }
      #${MODAL_ID} .em-legal summary { cursor: pointer; color: #d97706; font-weight: 500; outline: none; list-style: none; }
      #${MODAL_ID} .em-legal summary::-webkit-details-marker { display: none; }
      #${MODAL_ID} .em-legal[open] summary { margin-bottom: 6px; }
      #${MODAL_ID} .em-legal-content { color: var(--t1, inherit); line-height: 1.5; }
      #${MODAL_ID} .m-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      #${MODAL_ID} .em-foot-secondary { display: flex; gap: 6px; margin-left: auto; }
      #${MODAL_ID} .em-foot-primary { flex: 0 0 auto; }
      @media (max-width: 640px) {
        #${MODAL_ID} .m-foot { flex-direction: column-reverse !important; align-items: stretch !important; }
        #${MODAL_ID} .em-foot-primary { width: 100%; min-height: 44px; font-size: 15px; }
        #${MODAL_ID} .em-foot-secondary { margin-left: 0 !important; display: flex !important; gap: 6px; flex-wrap: wrap; width: 100%; }
        #${MODAL_ID} .em-foot-secondary .btn { flex: 1 1 0; min-width: 0; min-height: 40px; }
        #${MODAL_ID} .m-foot > .btn.bs { min-height: 40px; align-self: flex-end; }
      }
    </style>
    <div class="modal lg" onclick="event.stopPropagation()">
      <div class="m-head">
        <h3 id="em-title">📧 Proposition de mail</h3>
        <button class="m-close" type="button" onclick="closeM('${MODAL_ID}')" aria-label="Fermer">✕</button>
      </div>
      <!-- v15.86 EM-2a : FROM bar — adresse Gmail connectée visible avant envoi -->
      <div class="em-from-bar" id="em-from-bar" style="display:none">
        <span class="em-from-dot"></span>
        <span class="em-from-lbl">Envoi depuis</span>
        <span class="em-from-email" id="em-from-email">—</span>
        <span class="em-from-meta" id="em-from-meta"></span>
      </div>
      <div class="m-body">
        <div class="fg2">
          <div class="fg">
            <label for="em-to">Destinataire</label>
            <input class="inp" type="email" id="em-to" placeholder="locataire@example.com">
          </div>
          <div class="fg">
            <label for="em-cc">CC (optionnel)</label>
            <input class="inp" type="email" id="em-cc" placeholder="copie@example.com">
          </div>
        </div>
        <div class="fg mt8">
          <label for="em-subject">Sujet</label>
          <input class="inp" type="text" id="em-subject">
        </div>
        <div class="fg mt8">
          <label for="em-body">Corps du message</label>
          <textarea class="inp" id="em-body" rows="12" style="font-family:'SF Mono',Consolas,monospace;font-size:13px;line-height:1.5"></textarea>
        </div>
        <!-- v15.86 EM-2a : PJ card (slot prêt pour PJ auto-générée v15.87) -->
        <div id="em-attachments-section" class="em-att-card" style="display:none">
          <div class="em-att-title" id="em-att-title">📎 Pièce jointe</div>
          <div id="em-att-list"></div>
        </div>
        <!-- v15.86 EM-2a : Note légale repliable (au lieu de bloc orange permanent) -->
        <details class="em-legal" id="em-legal-note" style="display:none">
          <summary>⚠️ Note légale</summary>
          <div class="em-legal-content" id="em-legal-content"></div>
        </details>
        <div id="em-mailto-warn" class="mt12" style="display:none"></div>
      </div>
      <div class="m-foot">
        <button class="btn bs" type="button" onclick="closeM('${MODAL_ID}')">Annuler</button>
        <div class="em-foot-secondary">
          <button class="btn bp" type="button" onclick="window._emHandleAction('share')" id="em-share-btn" style="display:none">📎 Partager (PDF joint)</button>
          <button class="btn" type="button" onclick="window._emHandleAction('copy')">📋 Copier</button>
          <button class="btn" type="button" onclick="window._emHandleAction('mailto')">📧 Client externe</button>
        </div>
        <button class="btn bp em-foot-primary" type="button" onclick="window._emHandleAction('sendnow')" id="em-sendnow-btn" style="display:none" title="Envoyer directement via le compte Gmail (nécessite connexion Google)">📤 Envoyer maintenant</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}

/**
 * v15.82bis — Handler global exposé sur window. Appelé depuis les onclick inline
 * des boutons de la modale. Lit le contexte stocké sur la modale + dispatch.
 */
/** Ce que l'utilisateur s'apprête à faire, pour que la question finale soit la sienne. */
const VERBES_SORTIE = {
  mailto: 'Ouvrir le client mail',
  copy: 'Copier',
  share: 'Partager',
  sendnow: 'Envoyer maintenant'
};

/**
 * LES MENTIONS OBLIGATOIRES, AVANT LA SORTIE — quelle que soit la sortie.
 *
 * DOC-C avait gardé la sortie PDF de la modale d'actes, mais le congé a un SECOND chemin : le
 * Hub Communications, dont les quatre boutons (client mail, copie, partage, envoi Gmail) font
 * tous sortir l'acte de l'app. On garde donc le point de passage commun, pas chaque bouton :
 * un cinquième bouton serait couvert d'office.
 *
 * On lit le SUJET et le CORPS tels qu'ils sont à l'écran, pas le brouillon composé : les deux
 * champs sont éditables, et c'est ce qui part au locataire qui fait foi.
 *
 * Sans marqueur, la fonction ne dit rien et ne coûte rien — un email courant n'ouvre aucune
 * boîte de dialogue.
 *
 * @returns {boolean} false = l'utilisateur a renoncé ; la sortie doit être interrompue.
 */
export function _emActeMentionsOk(action) {
  const v = _readModalValues();
  // Sujet ET corps : les deux sont éditables, et l'objet d'un congé porte lui aussi le motif.
  const texte = String(v.subject || '') + '\n\n' + String(v.body || '');
  // `confirm2` vit dans le monolithe ; on retombe sur `confirm` natif. Si aucun des deux n'est
  // là, `sortieAutorisee` REFUSE — un garde-fou légal ne s'évapore pas faute de décoration.
  const demander = (typeof window !== 'undefined' && typeof window.confirm2 === 'function')
    ? window.confirm2
    : ((typeof window !== 'undefined' && typeof window.confirm === 'function')
        ? window.confirm.bind(window) : null);
  return sortieAutorisee(texte, VERBES_SORTIE[action] || 'Continuer', demander);
}

export function _emHandleAction(action) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  const ctx = modal._emailCtx || {};
  if (!_emActeMentionsOk(action)) return;
  if (action === 'mailto') _onMailto(ctx);
  else if (action === 'copy') _onCopy(ctx);
  else if (action === 'share') _onShare(ctx);
  else if (action === 'sendnow') _onSendNow(ctx);
}

// ────────────────────────────────────────────────────────────────────────────
// Pré-remplissage
// ────────────────────────────────────────────────────────────────────────────

function _fillModal(draft, type, opts, context) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;

  // v15.92 EM-5 — récupère l'alias d'envoi de l'entité (si configuré)
  // context contient locataire/bail/logement/entite/quittance/... transmis par openEmailModal()
  const _entite = (context && context.entite) || null;
  const _fromEntite = _entite && typeof _entite.emailEnvoi === 'string' && _entite.emailEnvoi.trim()
    ? _entite.emailEnvoi.trim() : '';

  // Stocker le contexte pour les boutons (lus par les handlers)
  modal._emailCtx = {
    type,
    entityType: opts.entityType || '',
    entityId: opts.entityId || '',
    legalNote: draft.legalNote || '',
    error: draft.error || '',
    fromEntite: _fromEntite  // v15.92 EM-5 EMAIL-FROM-PAR-ENTITE
  };

  // Cas type inconnu → afficher le message d'erreur explicite mais permettre
  // quand même la modale (utilisateur voit l'erreur, peut annuler).
  const to = document.getElementById('em-to');
  const cc = document.getElementById('em-cc');
  const subject = document.getElementById('em-subject');
  const body = document.getElementById('em-body');
  if (to) to.value = draft.to || '';
  if (cc) cc.value = draft.cc || '';

  // v15.93 EM-5b — auto-CC de l'alias d'envoi (traçabilité dans boîte SCI).
  // Quand un mail part via send-as alias Gmail, le message est stocké dans la
  // boîte "Envoyés" du compte maître Gmail (didierkeller@gmail.com), PAS dans
  // celle de l'alias (gestion@sci-xxx.fr). C'est un comportement Google par design.
  // Pour que l'user ait une trace dans la boîte de l'alias, on auto-CC l'alias.
  // L'user voit le CC pré-rempli et peut le retirer s'il ne veut pas.
  if (cc && _fromEntite && !cc.value) {
    cc.value = _fromEntite;
    cc.title = 'Pré-rempli automatiquement avec l\'adresse d\'envoi de l\'entité, pour archiver une copie dans la boîte de cette adresse (les mails envoyés via alias Gmail send-as ne sont sinon stockés que dans la boîte du compte Gmail maître). Le CC peut être retiré si non souhaité.';
  } else if (cc) {
    cc.title = '';
  }
  if (subject) subject.value = draft.subject || '';
  if (body) body.value = draft.body || '';

  // v15.86 EM-2a — FROM bar : adresse Gmail connectée visible avant envoi
  // v15.92 EM-5 — si entite.emailEnvoi configuré → affiche l'alias en gras + Gmail principal en discret
  const fromBar = document.getElementById('em-from-bar');
  const fromEmail = document.getElementById('em-from-email');
  const fromMeta = document.getElementById('em-from-meta');
  if (fromBar && fromEmail) {
    const userEmail = (typeof window !== 'undefined' && typeof window._getDriveUserEmail === 'function')
      ? window._getDriveUserEmail() : '';
    if (_fromEntite && userEmail) {
      // EM-5 : alias entité actif → "Envoi depuis [alias] (via Gmail [perso])"
      fromEmail.textContent = _fromEntite;
      if (fromMeta) fromMeta.textContent = '(via ' + userEmail + ')';
      fromBar.style.display = '';
    } else if (userEmail) {
      // Cas standard : Gmail perso direct
      fromEmail.textContent = userEmail;
      if (fromMeta) fromMeta.textContent = '(Gmail connecté)';
      fromBar.style.display = '';
    } else {
      fromBar.style.display = 'none';
    }
  }

  // v15.86 EM-2a — Pièces jointes : nouvelle card avec statut Prête/En cours/Erreur
  // V1a (EM-2a) : affiche les PJ déclarées par le template avec statut "pending" (génération PJ auto = EM-2b v15.87).
  const attSection = document.getElementById('em-attachments-section');
  const attList = document.getElementById('em-att-list');
  const attTitle = document.getElementById('em-att-title');
  if (attSection && attList) {
    if (draft.attachments && draft.attachments.length) {
      attSection.style.display = '';
      if (attTitle) attTitle.textContent = draft.attachments.length > 1
        ? '📎 ' + draft.attachments.length + ' pièces jointes'
        : '📎 Pièce jointe';
      attList.innerHTML = draft.attachments.map(a => `
        <div class="em-att-item">
          <div class="em-att-icon">📄</div>
          <div class="em-att-info">
            <div class="em-att-name">${escHtml(a.name)}</div>
            <div class="em-att-meta">À générer · type ${escHtml(a.type || 'pdf')}</div>
          </div>
          <span class="em-att-status pending" title="PJ auto-générée disponible v15.87">⏳ À générer</span>
        </div>
      `).join('');
    } else {
      attSection.style.display = 'none';
      attList.innerHTML = '';
    }
  }

  // v15.86 EM-2a — Note légale repliable (au lieu de bloc orange permanent)
  const legalNote = document.getElementById('em-legal-note');
  const legalContent = document.getElementById('em-legal-content');
  if (legalNote && legalContent) {
    if (draft.legalNote) {
      legalNote.style.display = '';
      legalContent.textContent = draft.legalNote;
    } else {
      legalNote.style.display = 'none';
      legalContent.textContent = '';
    }
  }

  // Warning si type inconnu
  const warn = document.getElementById('em-mailto-warn');
  if (warn) {
    if (draft.error === 'TYPE_UNKNOWN') {
      warn.style.display = '';
      warn.innerHTML = `<div style="background:rgba(220,38,38,.10);border-left:3px solid var(--red);padding:8px 12px;border-radius:4px;font-size:12.5px;color:var(--t1)">❌ Type d'email inconnu : <code>${escHtml(type)}</code></div>`;
    } else {
      warn.style.display = 'none';
      warn.innerHTML = '';
    }
  }

  // Bouton share : visible seulement si Web Share API dispo (mobile principalement)
  const shareBtn = document.getElementById('em-share-btn');
  // Toujours visible : sur mobile/Chrome-Edge → partage natif avec PDF joint ; sur les autres PC
  // → télécharge le PDF + ouvre le mail pré-rempli (cf. _onShare). Dans tous les cas, action utile.
  if (shareBtn) shareBtn.style.display = '';

  // v15.80 EMAIL-SMTP-CONNECT — bouton "Envoyer maintenant" visible si OAuth Gmail OK.
  // Détection : window._driveTokenValid() retourne true → token Drive actif (inclut le
  // scope gmail.send après mise à jour OAuth consent v15.80). Si l'envoi échoue 403
  // (scope insuffisant), on guidera l'user vers la reconnexion.
  const sendBtn = document.getElementById('em-sendnow-btn');
  if (sendBtn) {
    const hasGmail = typeof window !== 'undefined'
      && typeof window._driveTokenValid === 'function'
      && window._driveTokenValid();
    sendBtn.style.display = hasGmail ? '' : 'none';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Actions des boutons
// ────────────────────────────────────────────────────────────────────────────

function _readModalValues() {
  return {
    to: (document.getElementById('em-to') || {}).value || '',
    cc: (document.getElementById('em-cc') || {}).value || '',
    subject: (document.getElementById('em-subject') || {}).value || '',
    body: (document.getElementById('em-body') || {}).value || ''
  };
}

function _onMailto(ctx) {
  const v = _readModalValues();
  const url = _buildMailtoUrl(v.to, v.cc, v.subject, v.body);

  if (url.length > MAILTO_MAX_LENGTH) {
    showToast('Mail trop long pour mailto: — utiliser « Copier sujet + corps » à la place', 'warn', 6000);
    return;
  }

  if (typeof window !== 'undefined') {
    window.location.href = url;
  }
  showToast('Client mail ouvert ✉️', 'ok', 2000);
  closeM(MODAL_ID);

  // Hook log d'envoi (Phase 3 — sera actif après commit Phase 3)
  if (typeof window !== 'undefined' && typeof window._logEmailSent === 'function') {
    window._logEmailSent(ctx.entityType, ctx.entityId, {
      type: ctx.type, to: v.to, cc: v.cc, subject: v.subject, status: 'mailto'
    });
  }
}

function _onCopy(ctx) {
  const v = _readModalValues();
  const text = v.subject + '\n\n' + v.body;

  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    showToast('Presse-papier non disponible — sélectionne + copie manuellement', 'err', 4000);
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast('Sujet + corps copiés 📋', 'ok', 2000);
    closeM(MODAL_ID);
    if (typeof window !== 'undefined' && typeof window._logEmailSent === 'function') {
      window._logEmailSent(ctx.entityType, ctx.entityId, {
        type: ctx.type, to: v.to, cc: v.cc, subject: v.subject, status: 'copied'
      });
    }
  }).catch((err) => {
    showToast('Erreur copie : ' + (err && err.message ? err.message : 'inconnue'), 'err');
  });
}

/**
 * v15.80 EMAIL-SMTP-CONNECT — envoie l'email directement via Gmail API.
 * Pré-requis : token OAuth Drive avec scope gmail.send (cf index.html DRIVE_SCOPE).
 * Si erreur 403 (scope manquant) → guide l'user vers reconnexion.
 */
function _onSendNow(ctx) {
  const v = _readModalValues();
  if (!v.to) { showToast('Destinataire vide', 'err'); return; }

  // v15.83 — _driveToken est en `let` (scope <script>), invisible depuis ES modules.
  // On utilise le getter window._getDriveToken() exposé par index.html.
  const token = (typeof window !== 'undefined' && typeof window._getDriveToken === 'function')
    ? window._getDriveToken()
    : null;
  if (!token) {
    showToast('Connexion Google requise — cliquer sur ☁ Drive dans la sidebar', 'err', 5000);
    return;
  }

  // v15.84 — Confirmation user avant envoi (anti-erreur destinataire/sujet).
  // v15.93 EM-5b fix — afficher fromEntite (alias) si configuré au lieu de Gmail maître.
  const modalElCheck = document.getElementById(MODAL_ID);
  const fromEntiteCheck = (modalElCheck && modalElCheck._emailCtx && modalElCheck._emailCtx.fromEntite) || '';
  const userEmail = (typeof window !== 'undefined' && typeof window._getDriveUserEmail === 'function')
    ? (window._getDriveUserEmail() || '(compte Gmail)')
    : '(compte Gmail)';
  const fromDisplay = fromEntiteCheck
    ? fromEntiteCheck + ' (via ' + userEmail + ')'
    : userEmail;
  const subjectShort = (v.subject || '(sans sujet)').slice(0, 80);
  const msg = 'Envoyer cet email ?\n\n'
    + 'Destinataire : ' + v.to + '\n'
    + (v.cc ? 'CC           : ' + v.cc + '\n' : '')
    + 'Sujet        : ' + subjectShort + (v.subject && v.subject.length > 80 ? '…' : '') + '\n'
    + 'Depuis       : ' + fromDisplay;
  if (typeof window !== 'undefined' && !window.confirm(msg)) return;

  // Lock UI : disable boutons pendant l'envoi
  const sendBtn = document.getElementById('em-sendnow-btn');
  const allBtns = document.querySelectorAll('#' + MODAL_ID + ' .m-foot .btn');
  allBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
  if (sendBtn) sendBtn.textContent = '📤 Envoi en cours…';

  // v15.87 EM-2b — Récupère la PJ auto-générée (si dispo) pour la joindre au MIME multipart.
  // ctx.pjAttachments stocké par _autoGenAttachmentInBackground après openEmailModal().
  const modalEl = document.getElementById(MODAL_ID);
  const pjAttachments = (modalEl && modalEl._emailCtx && Array.isArray(modalEl._emailCtx.pjAttachments))
    ? modalEl._emailCtx.pjAttachments : [];

  // v15.92 EM-5 EMAIL-FROM-PAR-ENTITE — si entité.emailEnvoi configuré (alias Gmail send-as),
  // utiliser cette adresse comme From au lieu du Gmail principal. Sinon : Gmail principal
  // (Gmail déduit du token, pas besoin de header From).
  const fromEntite = (modalEl && modalEl._emailCtx && modalEl._emailCtx.fromEntite) || '';

  let mime;
  try {
    mime = _emailToMimeBase64Url({
      to: v.to, cc: v.cc, subject: v.subject, body: v.body,
      from: fromEntite || undefined,
      attachments: pjAttachments
    });
  } catch (e) {
    showToast('Erreur de construction du message : ' + (e.message || e), 'err');
    allBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    if (sendBtn) sendBtn.textContent = '📤 Envoyer maintenant';
    return;
  }

  // v15.85 EM-1 : helper reset UI mutualisé (utilisé par .catch ET .finally defensive).
  // Sans ce reset dans .finally, si .then plante (closeM exception, _logEmailSent error)
  // l'UI reste figée sur "Envoi en cours…" et l'user croit que rien n'a marché.
  const _resetUi = () => {
    allBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    if (sendBtn) sendBtn.textContent = '📤 Envoyer maintenant';
  };

  _emailSendViaGmail(token, mime)
    .then(result => {
      showToast('Email envoyé ✓ depuis Gmail', 'ok', 3000);
      // closeM dans try/catch pour ne pas bloquer le reset UI si la modale a un état corrompu
      try { closeM(MODAL_ID); } catch (_) { /* swallow */ }
      // Log avec status='sent' + externalId pour traçabilité (RGPD : métadonnées seules)
      if (typeof window !== 'undefined' && typeof window._logEmailSent === 'function') {
        try {
          window._logEmailSent(ctx.entityType, ctx.entityId, {
            type: ctx.type, to: v.to, cc: v.cc, subject: v.subject,
            status: 'sent', externalId: result && result.id ? result.id : '',
            sendChannel: 'gmail-api',
          });
        } catch (_) { /* log err ne doit jamais bloquer l'UI */ }
      }
    })
    .catch(err => {
      const status = err && err.status;
      let msg = err && err.message ? err.message : String(err);
      if (status === 403) {
        // v15.92 EM-5 EMAIL-FROM-PAR-ENTITE — détection alias non configuré
        // Gmail répond 403 si on essaie de send-as une adresse non listée dans
        // users.settings.sendAs OR scope gmail.send manquant.
        const errBody = err && err.message ? err.message : '';
        const looksLikeSendAsRejected = /not\s*allowed|invalidsender|delegate|sendas|from.*address/i.test(errBody);
        if (fromEntite && looksLikeSendAsRejected) {
          msg = 'Adresse d\'envoi « ' + fromEntite + ' » non autorisée par Gmail.\n\n'
              + 'Cause probable : l\'alias n\'est pas configuré dans le compte Gmail.\n\n'
              + 'À faire : Gmail → ⚙ Paramètres → Comptes et importation → « Envoyer des e-mails en tant que » → ajouter cette adresse + validation par code.\n\n'
              + 'En attendant, retirer l\'adresse du champ "Email d\'envoi" de l\'entité pour utiliser le Gmail principal.';
        } else {
          msg = 'Permission insuffisante (scope gmail.send manquant). Reconnecter Drive pour autoriser l\'envoi d\'emails.';
        }
      } else if (status === 401) {
        msg = 'Token expiré. Reconnecter Drive et réessayer.';
      } else if (status === 429 || status === 503) {
        msg = 'Quota Gmail dépassé temporairement. Réessayer dans quelques minutes ou utiliser « Ouvrir client mail ».';
      }
      showToast(msg, 'err', 6000);
    })
    .finally(() => {
      // v15.85 EM-1 : reset UI garanti dans tous les cas (succès, erreur, exception .then).
      _resetUi();
    });
}

function _onShare(ctx) {
  const v = _readModalValues();
  const _log = (channel) => {
    if (typeof window !== 'undefined' && typeof window._logEmailSent === 'function') {
      window._logEmailSent(ctx.entityType, ctx.entityId, {
        type: ctx.type, to: v.to, cc: v.cc, subject: v.subject, status: 'shared', sendChannel: channel
      });
    }
  };

  // PJ PDF auto-générée : modal._emailCtx.pjAttachments = [{filename,mimeType,base64}].
  let file = null;
  try {
    const modalEl = document.getElementById(MODAL_ID);
    const pj = (modalEl && modalEl._emailCtx && Array.isArray(modalEl._emailCtx.pjAttachments)) ? modalEl._emailCtx.pjAttachments[0] : null;
    if (pj && pj.base64) {
      const bin = atob(pj.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      file = new File([bytes], pj.filename || 'document.pdf', { type: pj.mimeType || 'application/pdf' });
    }
  } catch (e) { file = null; }

  const canShareFile = file
    && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  // Cas 1 — téléphone / Chrome-Edge PC : partage natif AVEC le PDF joint (tout automatique).
  if (canShareFile) {
    navigator.share({ title: v.subject, text: v.subject + '\n\n' + v.body, files: [file] })
      .then(() => { showToast('Partagé — PDF joint ✓', 'ok'); closeM(MODAL_ID); _log('share-file'); })
      .catch(() => { /* annulation = silencieux */ });
    return;
  }

  // Cas 2 — autres navigateurs PC (Firefox/Opera/Safari) : la loi du web interdit à un site de joindre
  // un fichier à un mail. Meilleur substitut : télécharger le PDF + ouvrir le mail pré-rempli → l'user y glisse le PDF.
  if (file) {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
    } catch (e) { /* download best-effort */ }
    showToast('PDF téléchargé — à glisser dans le mail qui s\'ouvre', 'ok', 7000);
    _log('download+mailto');
    _onMailto(ctx);   // ouvre le client mail pré-rempli (Outlook…) — l'user y dépose le PDF
    return;
  }

  // Cas 3 — aucune PJ : partage texte natif si possible, sinon on ouvre le client mail.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    navigator.share({ title: v.subject, text: v.subject + '\n\n' + v.body })
      .then(() => { showToast('Partagé ✓', 'ok'); closeM(MODAL_ID); _log('share-text'); })
      .catch(() => {});
  } else {
    _onMailto(ctx);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// API publique
// ────────────────────────────────────────────────────────────────────────────

/**
 * Ouvre la modale de proposition d'email pré-remplie depuis _emailCompose.
 *
 * @param {string} type - Type d'email (cf _emailTypesSupportes)
 * @param {object} context - Contexte (bail, locataire, entite, etc.)
 * @param {object} [opts]
 * @param {string} [opts.entityType] - Pour logger (Phase 3) : 'logement'|'bail'|'quittance'
 * @param {string} [opts.entityId] - Référence (log.ref, bail.ref, quittance.id)
 */
export function openEmailModal(type, context, opts = {}) {
  const draft = _emailCompose(type, context || {});
  _ensureModalDom();
  _fillModal(draft, type, opts || {}, context || {}); // v15.92 EM-5 : passe le contexte pour lire entite.emailEnvoi
  openM(MODAL_ID);
  // v15.87 EM-2b — Lance la génération PJ PDF auto en arrière-plan
  // (les types supportés V1.0 : quittance + irl-revision ; les autres reportés V1.1).
  // L'envoi attendra la PJ via _onSendNow.
  _autoGenAttachmentInBackground(type, context);
}

/**
 * v15.87 EM-2b — Génère la PJ en arrière-plan + met à jour le statut visuel + stocke
 * la base64 dans modal._emailCtx.pjAttachments pour que `_onSendNow` la passe à
 * `_emailToMimeBase64Url`.
 */
function _autoGenAttachmentInBackground(type, context) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  // Guard pour tests avec mock DOM partiel (jsdom non chargé) — pas de querySelectorAll dispo
  if (typeof modal.querySelectorAll !== 'function') return;
  const statusEls = modal.querySelectorAll('.em-att-status');
  if (!statusEls.length) return; // Pas de PJ déclarée par le template → rien à générer

  // Marker "en cours"
  statusEls.forEach(s => {
    s.className = 'em-att-status pending';
    s.textContent = '⏳ Génération…';
  });

  _emailGenPdfAttachment(type, context || {})
    .then(result => {
      if (result && result.error) {
        // Type non supporté V1 → on garde le statut "à joindre manuellement" + tooltip explicatif
        statusEls.forEach(s => {
          s.className = 'em-att-status pending';
          s.textContent = '⚠️ Joindre manuellement';
          s.title = result.message || 'PJ non auto-générée pour ce type d\'email';
        });
        return;
      }
      // Succès : stocke pour _onSendNow + UI status "Prête"
      modal._emailCtx = modal._emailCtx || {};
      modal._emailCtx.pjAttachments = [{
        filename: result.filename,
        mimeType: result.mimeType,
        base64: result.base64
      }];
      statusEls.forEach(s => {
        s.className = 'em-att-status ok';
        s.textContent = '✓ Prête';
        s.title = '';
      });
    })
    .catch(err => {
      console.error('[EMAIL-PDF-ATTACH]', err);
      statusEls.forEach(s => {
        s.className = 'em-att-status err';
        s.textContent = '❌ Erreur génération';
        s.title = (err && err.message) || String(err);
      });
    });
}
