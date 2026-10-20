/**
 * core/email-send.js — EMAIL-SMTP-CONNECT v15.80 (Phase 1+2)
 *
 * Helpers purs pour l'envoi d'email via Gmail API REST :
 *  - encodage MIME RFC 5322 + base64url (compatible Gmail API)
 *  - support multipart/mixed pour pièces jointes
 *  - encodage UTF-8 des headers (=?UTF-8?B?...?=)
 *  - call API Gmail (Phase 2 réseau, mockable en test)
 *
 * Tests Vitest miroir : __tests__/helpers/email-send.test.js
 *
 * NB : nécessite scope OAuth `https://www.googleapis.com/auth/gmail.send`
 * à ajouter dans Google Cloud Console (OAuth consent screen) + vérification
 * Google ~2-6 semaines pour passer le mode dev → production.
 */

// ────────────────────────────────────────────────────────────────────────────
// Helpers d'encodage
// ────────────────────────────────────────────────────────────────────────────

/**
 * Encode une string UTF-8 en base64url (Gmail API utilise base64url, pas base64 standard).
 * Compatible navigateur + Node (Vitest).
 * @param {string} str
 * @returns {string}
 */
export function _base64UrlEncode(str) {
  let b64;
  if (typeof Buffer !== 'undefined') {
    // Node / Vitest
    b64 = Buffer.from(String(str), 'utf-8').toString('base64');
  } else {
    // Navigateur : btoa ne supporte que latin1 → encode UTF-8 → latin1 first
    const utf8 = unescape(encodeURIComponent(String(str)));
    b64 = btoa(utf8);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encode un header MIME en RFC 2047 si non-ASCII (=?UTF-8?B?...?=).
 * Sinon retourne la valeur telle quelle. Utile pour Subject, From, To names.
 * @param {string} value
 * @returns {string}
 */
export function _emailEncodeMimeHeader(value) {
  const s = String(value || '');
  // ASCII pur (codes 32-126) → pas d'encoding nécessaire
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  // Sinon encode tout en base64 UTF-8
  let b64;
  if (typeof Buffer !== 'undefined') b64 = Buffer.from(s, 'utf-8').toString('base64');
  else b64 = btoa(unescape(encodeURIComponent(s)));
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Génère un boundary unique pour les emails multipart (PJ).
 * @returns {string}
 */
export function _emailMakeBoundary() {
  return '----=_Part_' + Math.random().toString(36).slice(2, 12) + '_' + Date.now().toString(36);
}

// ────────────────────────────────────────────────────────────────────────────
// Construction MIME
// ────────────────────────────────────────────────────────────────────────────

/**
 * Construit un message MIME RFC 5322 encodé en base64url, prêt pour
 * Gmail API POST users/me/messages/send.
 *
 * @param {object} data
 *   - to: string (adresse destinataire)
 *   - cc: string (optionnel)
 *   - bcc: string (optionnel)
 *   - from: string (optionnel, par défaut Gmail le déduit du token)
 *   - subject: string
 *   - body: string (plain text)
 *   - html: string (optionnel, génère multipart/alternative)
 *   - attachments: Array<{ filename, mimeType, base64 }> (optionnel)
 * @returns {string} base64url-encoded MIME
 */
export function _emailToMimeBase64Url(data) {
  const d = data || {};
  if (!d.to) throw new Error('to required');
  const lines = [];
  const hasAtt = Array.isArray(d.attachments) && d.attachments.length > 0;
  const hasHtml = !!d.html;
  const boundary = (hasAtt || hasHtml) ? _emailMakeBoundary() : null;
  const altBoundary = (hasAtt && hasHtml) ? _emailMakeBoundary() : null;

  // Headers
  if (d.from) lines.push('From: ' + _emailEncodeMimeHeader(d.from));
  lines.push('To: ' + _emailEncodeMimeHeader(d.to));
  if (d.cc)  lines.push('Cc: ' + _emailEncodeMimeHeader(d.cc));
  if (d.bcc) lines.push('Bcc: ' + _emailEncodeMimeHeader(d.bcc));
  lines.push('Subject: ' + _emailEncodeMimeHeader(d.subject || ''));
  lines.push('MIME-Version: 1.0');

  if (hasAtt) {
    lines.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
    lines.push('');
    // Partie principale : texte (et html si présent) en multipart/alternative ou direct
    lines.push('--' + boundary);
    if (hasHtml) {
      lines.push('Content-Type: multipart/alternative; boundary="' + altBoundary + '"');
      lines.push('');
      lines.push('--' + altBoundary);
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(String(d.body || ''));
      lines.push('');
      lines.push('--' + altBoundary);
      lines.push('Content-Type: text/html; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(String(d.html));
      lines.push('');
      lines.push('--' + altBoundary + '--');
    } else {
      lines.push('Content-Type: text/plain; charset=UTF-8');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(String(d.body || ''));
    }
    lines.push('');
    // Pièces jointes
    for (const att of d.attachments) {
      if (!att || !att.filename || !att.base64) continue;
      lines.push('--' + boundary);
      lines.push('Content-Type: ' + (att.mimeType || 'application/octet-stream') + '; name="' + _emailEncodeMimeHeader(att.filename) + '"');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('Content-Disposition: attachment; filename="' + _emailEncodeMimeHeader(att.filename) + '"');
      lines.push('');
      // base64 standard avec retour à la ligne tous les 76 chars (recommandé RFC)
      lines.push(String(att.base64).replace(/(.{76})/g, '$1\r\n'));
    }
    lines.push('--' + boundary + '--');
  } else if (hasHtml) {
    lines.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
    lines.push('');
    lines.push('--' + boundary);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(String(d.body || ''));
    lines.push('');
    lines.push('--' + boundary);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(String(d.html));
    lines.push('');
    lines.push('--' + boundary + '--');
  } else {
    // Email texte simple
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(String(d.body || ''));
  }

  const mime = lines.join('\r\n');
  return _base64UrlEncode(mime);
}

// ────────────────────────────────────────────────────────────────────────────
// Appel API Gmail
// ────────────────────────────────────────────────────────────────────────────

/**
 * Envoie un message via Gmail API.
 * @param {string} accessToken — OAuth access token avec scope gmail.send
 * @param {string} mimeBase64Url — sortie de _emailToMimeBase64Url
 * @param {object} [opts] — { fetch?: Function (override pour tests) }
 * @returns {Promise<{id: string, threadId: string}>} response Gmail
 * @throws si HTTP 4xx/5xx ou erreur réseau
 */
export async function _emailSendViaGmail(accessToken, mimeBase64Url, opts) {
  if (!accessToken) throw new Error('accessToken required');
  if (!mimeBase64Url) throw new Error('mimeBase64Url required');
  const fetchFn = (opts && opts.fetch) || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) throw new Error('fetch not available');

  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: mimeBase64Url }),
  });

  if (!res.ok) {
    let errMsg = 'HTTP ' + res.status;
    try {
      const errBody = await res.json();
      if (errBody && errBody.error && errBody.error.message) errMsg += ' — ' + errBody.error.message;
    } catch (e) { /* body non JSON, ignore */ }
    const err = new Error('Gmail API: ' + errMsg);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return { id: data.id || '', threadId: data.threadId || '' };
}
