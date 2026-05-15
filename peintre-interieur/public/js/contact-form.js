/**
 * Envoi du formulaire de contact vers Supabase (REST).
 * Config : priorité au JSON (#supabase-config-json), sinon attributs data-* (#supabase-config).
 * En dev (localhost, file:) : appel direct via directUrl si présent.
 */
(function () {
  var forms = document.querySelectorAll('form.contact-form');
  if (!forms.length) return;
  forms.forEach(function (form) { initForm(form); });
})();

function initForm(form) {
  if (!form) return;

  function readSupabaseConfig() {
    var jsonEl = document.getElementById('supabase-config-json');
    if (jsonEl && jsonEl.textContent) {
      try {
        var o = JSON.parse(jsonEl.textContent.trim());
        if (o && typeof o.anon === 'string' && o.anon.length > 0) {
          return {
            url: String(o.url || '').trim(),
            directUrl: String(o.directUrl || '').trim(),
            relative: Boolean(o.relative),
            anon: o.anon.trim(),
            table: String(o.table || 'leads_peinture').trim()
          };
        }
      } catch (e) {}
    }
    var cfg = document.getElementById('supabase-config');
    if (!cfg) return null;
    return {
      url: (cfg.getAttribute('data-url') || '').trim(),
      directUrl: (cfg.getAttribute('data-supabase-url') || '').trim(),
      relative:
        cfg.getAttribute('data-api-relative') === '1' ||
        cfg.getAttribute('data-api-relative') === 'true',
      anon: (cfg.getAttribute('data-anon') || '').trim(),
      table: (cfg.getAttribute('data-table') || 'leads_peinture').trim()
    };
  }

  /** Erreur HTTP PostgREST : objet plain (les propriétés sur Error ne sont pas toujours conservées en catch). */
  function httpError(status, body) {
    var b = body == null ? '' : String(body);
    return {
      _contactFormHttp: true,
      status: status,
      body: b,
      message: b || 'HTTP ' + status
    };
  }

  function parsePostgrestMessage(body) {
    if (!body || typeof body !== 'string') return '';
    try {
      var j = JSON.parse(body);
      if (j && j.message) return String(j.message);
    } catch (e) {}
    return '';
  }

  var feedbackHideTimer = null;
  var SUCCESS_FEEDBACK_MS = 2000;

  function showFeedback(el, type, text) {
    if (feedbackHideTimer) {
      clearTimeout(feedbackHideTimer);
      feedbackHideTimer = null;
    }
    if (!el) {
      window.alert(text);
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = 'contact-form-feedback contact-form-feedback--' + type;
    el.setAttribute('role', 'status');
    if (type === 'success') {
      feedbackHideTimer = setTimeout(function () {
        el.hidden = true;
        el.textContent = '';
        el.className = 'contact-form-feedback';
        el.removeAttribute('role');
        feedbackHideTimer = null;
      }, SUCCESS_FEEDBACK_MS);
    }
  }

  // Cherche le feedback dans le parent du form, sinon global
  var feedbackEl = (form.parentElement && form.parentElement.querySelector('.contact-form-feedback'))
    || form.querySelector('.contact-form-feedback')
    || document.getElementById('contact-form-feedback');
  var cfgData = readSupabaseConfig();

  if (!cfgData) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      showFeedback(feedbackEl, 'error', 'Envoi indisponible : configuration manquante.');
    });
    return;
  }

  var url = cfgData.url;
  var useRelative = cfgData.relative;
  /* Génération avec proxy Nginx : data-url vide + clé présente → même origine (évite erreur si data-api-relative absent). */
  if (!url && !useRelative) {
    useRelative = true;
  }

  var directUrl = cfgData.directUrl;
  var hostname = '';
  try {
    hostname = String(window.location.hostname || '');
  } catch (e1) {
    hostname = '';
  }
  var proto = '';
  try {
    proto = String(window.location.protocol || '');
  } catch (e2) {
    proto = '';
  }
  /* En local : appel direct vers Supabase (voir Supabase → Settings → API si la connexion est refusée). */
  var isDevHost =
    /^localhost$/i.test(hostname) ||
    hostname === '127.0.0.1' ||
    /^192\.168\.\d+\.\d+$/.test(hostname) ||
    /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
    proto === 'file:';
  if (isDevHost && directUrl) {
    useRelative = false;
    url = directUrl;
  }

  var anon = cfgData.anon;
  var table = cfgData.table;

  if (!anon) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      showFeedback(
        feedbackEl,
        'error',
        'Envoi indisponible : clé Supabase absente. Régénérez les pages avec factory/.env (SUPABASE_ANON_KEY) puis redéployez.'
      );
    });
    return;
  }

  var base = useRelative ? String(window.location.origin || '').replace(/\/$/, '') : url.replace(/\/$/, '');

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var fd = new FormData(form);
    /* Honeypot (name neutre : évite l’autofill « site web / entreprise » sur company_website). */
    var hp = String(fd.get('field_hp') || '').trim();
    if (hp.length > 0) {
      showFeedback(
        feedbackEl,
        'success',
        'Merci ! Votre demande a bien été envoyée. Nous vous recontactons rapidement.'
      );
      return;
    }

    var nameVal    = String(fd.get('name') || '').trim();
    var emailVal   = String(fd.get('email') || '').trim();
    var phoneVal   = String(fd.get('phone') || '').trim();
    var postalVal  = String(fd.get('postal') || '').trim();
    var cityVal    = String(fd.get('city') || '').trim();
    var messageVal = String(fd.get('message') || '').trim();

    /* Validation */
    if (!nameVal || !emailVal || !phoneVal || !postalVal || !cityVal || !messageVal) {
      showFeedback(feedbackEl, 'error', 'Veuillez remplir tous les champs du formulaire.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      showFeedback(feedbackEl, 'error', 'Veuillez entrer une adresse email valide.');
      return;
    }

    /* Téléphone français : 01-09, +33, 0033 — 10 chiffres après normalisation */
    var phoneDigits = phoneVal.replace(/[\s.\-()]/g, '');
    if (/^\+33/.test(phoneDigits)) phoneDigits = '0' + phoneDigits.slice(3);
    if (/^0033/.test(phoneDigits)) phoneDigits = '0' + phoneDigits.slice(4);
    if (!/^0[1-9]\d{8}$/.test(phoneDigits)) {
      showFeedback(feedbackEl, 'error', 'Veuillez entrer un numéro de téléphone français valide (10 chiffres, ex : 06 12 34 56 78).');
      return;
    }

    /* Code postal : exactement 5 chiffres */
    if (!/^\d{5}$/.test(postalVal)) {
      showFeedback(feedbackEl, 'error', 'Le code postal doit contenir exactement 5 chiffres.');
      return;
    }

    var now = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : String(n); };
    var dateStr = pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear()
      + ' à ' + pad(now.getHours()) + ':' + pad(now.getMinutes());

    var payload = {
      name: nameVal,
      email: emailVal,
      phone: phoneVal,
      postal: postalVal,
      dep_code: postalVal.slice(0, 2),
      city: cityVal,
      message: messageVal,
      site_name: 'Peintre - ' + ((document.querySelector('.hero-h1-city') || {}).textContent || '').trim(),
      site_url: (function() { var m = document.querySelector('meta[property="og:url"]'); return m ? m.content.replace(/^https?:\/\//, '') : window.location.hostname || ''; })(),
      submitted_at: dateStr
    };

    var btn = form.querySelector('button[type="submit"]');
    var prevText = btn ? btn.textContent : '';
    var prevDisabled = btn ? btn.disabled : false;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Envoi en cours…';
    }

    var endpoint = base + '/rest/v1/' + encodeURIComponent(table);

    try {
      if (/\bdebug=1\b/.test(String(window.location.search || ''))) {
        console.info('[contact-form]', {
          endpoint: endpoint,
          mode: useRelative ? 'même origine (proxy Nginx attendu)' : 'URL Supabase directe',
          origin: window.location.origin
        });
      }
    } catch (d) {}

    fetch(endpoint, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        apikey: anon,
        Authorization: 'Bearer ' + anon,
        Prefer: 'return=minimal',
        'X-Client-Info': 'peintres-france-site'
      },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(
            function (t) {
              throw httpError(res.status, t);
            },
            function () {
              throw httpError(res.status, '');
            }
          );
        }
        form.reset();
        var hpInput = form.querySelector('input[name="field_hp"]');
        if (hpInput) hpInput.value = '';
        showFeedback(
          feedbackEl,
          'success',
          'Merci ! Votre demande a bien été envoyée. Nous vous recontactons rapidement.'
        );
      })
      .catch(function (err) {
        var body = err && typeof err.body === 'string' ? err.body : '';
        var st = err && typeof err.status === 'number' ? err.status : undefined;
        if (!body && err && typeof err.message === 'string' && /^\s*\{/.test(err.message)) {
          body = err.message;
        }
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[contact-form] Supabase:', st, body || (err && err.message));
        }
        var msg =
          'Envoi impossible pour le moment. Réessayez plus tard ou contactez-nous par téléphone.';
        var errStr = err && err.message != null ? String(err.message) : '';
        if (
          errStr === 'Failed to fetch' ||
          (err && err.name === 'TypeError' && /fetch|network|load failed/i.test(errStr))
        ) {
          msg =
            'Connexion impossible vers l’API. Vérifiez l’URL dans l’onglet Réseau (F12). En production : proxy Nginx /rest/v1/ (SUPABASE_USE_RELATIVE_API=1) ou appel direct avec origines autorisées dans Supabase → Settings → API.';
        } else if (body && /row-level security|RLS|permission denied/i.test(body)) {
          msg =
            'Configuration serveur : les insertions sont refusées (politique RLS). Voir factory/.env.example.';
        } else if (typeof st === 'number') {
          var jMsg = parsePostgrestMessage(body);
          if (st === 404) {
            msg =
              'API introuvable (404). Sur le serveur : le bloc Nginx location /rest/v1/ doit exister pour ce domaine (y compris en HTTPS). Vérifiez aussi SUPABASE_USE_RELATIVE_API=1 à la génération.';
          } else if (st === 401 || st === 403) {
            msg =
              'Accès refusé par Supabase (clé ou JWT). Vérifiez SUPABASE_ANON_KEY dans factory/.env, régénérez et redéployez.';
          } else if (st === 502 || st === 503 || st === 504) {
            msg =
              'Le serveur ne joint pas Supabase (' +
              st +
              '). Vérifiez le proxy Nginx (SSL, résolution DNS, pare-feu).';
          } else if (st === 0) {
            msg =
              'Réponse bloquée (statut 0). Vérifiez l’URL dans Réseau (F12) : contenu mixte, extension ou réseau.';
          } else if (jMsg) {
            msg = 'Envoi refusé : ' + jMsg;
          } else if (body && body.length > 0 && body.length < 280) {
            msg = 'Envoi refusé (' + st + ') : ' + body.replace(/\s+/g, ' ').trim();
          } else if (st >= 400) {
            msg =
              'Envoi refusé (erreur HTTP ' + st + '). Ouvrez l’onglet Réseau (F12) sur la requête POST /rest/v1/ pour le détail.';
          }
        }
        if (msg === 'Envoi impossible pour le moment. Réessayez plus tard ou contactez-nous par téléphone.') {
          var fallback = parsePostgrestMessage(body) || parsePostgrestMessage(errStr);
          if (fallback) {
            msg = 'Envoi refusé : ' + fallback;
          } else if (errStr && errStr.length > 2 && errStr !== 'Failed to fetch') {
            var short = errStr.replace(/\s+/g, ' ').trim();
            if (short.length > 220) short = short.slice(0, 217) + '…';
            msg = 'Erreur : ' + short;
          }
        }
        showFeedback(feedbackEl, 'error', msg);
      })
      .finally(function () {
        if (btn) {
          btn.disabled = prevDisabled;
          btn.textContent = prevText;
        }
      });
  });
}
