/* ───────────────────────────────────────────────────────────────────────────
 * src/lib/authRecovery.js
 *
 * Fixes the console error storm seen on pos.cannalife.co.za:
 *
 *   POST /auth/v1/token?grant_type=refresh_token   400
 *   GET  /rest/v1/…                                401
 *   WebSocket connection to wss://…/realtime/v1/websocket?apikey=… failed
 *
 * WHAT IS ACTUALLY HAPPENING
 * The Supabase auth server returns
 *     400: Invalid Refresh Token: Refresh Token Not Found
 * (confirmed in the project auth logs — every hour, against real cashier
 * sessions). The browser holds a refresh token the server no longer has. Once
 * that refresh fails, supabase-js keeps the dead session in localStorage
 * instead of clearing it, so:
 *   - every REST call goes out with an expired access token   -> 401
 *   - realtime opens a socket with the same token             -> rejected
 *   - the socket retries forever                              -> the wall of
 *     identical "WebSocket connection failed" lines
 *
 * The cashier sees a page that looks logged in but silently fails, which is
 * the "charge button does nothing" class of complaint.
 *
 * INSTALL — one line, once, at app start (src/main.jsx, before render):
 *
 *     import { supabase } from './api/supabaseClient';
 *     import { installAuthRecovery } from './lib/authRecovery';
 *     installAuthRecovery(supabase);
 * ─────────────────────────────────────────────────────────────────────────── */

var installed = false;

// Matches every wording GoTrue uses when the refresh token is unusable.
var DEAD_SESSION = /refresh token not found|invalid refresh token|already used|refresh_token_not_found|session not found|session_not_found/i;

function isDeadSessionError(err) {
  if (!err) return false;
  var msg = (err.message || err.error_description || err.msg || String(err)) || '';
  if (DEAD_SESSION.test(msg)) return true;
  var status = err.status || err.code;
  return (status === 400 || status === 403) && /refresh|session/i.test(msg);
}

function loginPath() {
  // HashRouter — keep the hash form so this works on pos.cannalife.co.za.
  return window.location.pathname + '#/login';
}

function alreadyOnLogin() {
  var h = (window.location.hash || '').toLowerCase();
  return h.indexOf('/login') > -1 || h.indexOf('/signup') > -1 || h.indexOf('/reset') > -1;
}

/**
 * Wipe every Supabase auth key this origin owns. Deliberately broader than
 * supabase.auth.signOut() — signOut() on a dead session can itself 400 and
 * leave the row behind, which is how a tab gets stuck in the failing state.
 */
function clearStoredSession() {
  try {
    var doomed = [];
    for (var i = 0; i < window.localStorage.length; i++) {
      var key = window.localStorage.key(i);
      if (!key) continue;
      if (key.indexOf('sb-') === 0 || key.indexOf('supabase.auth.token') === 0 || key.indexOf('cannalife-pos-auth') === 0) doomed.push(key);
    }
    doomed.forEach(function (k) { window.localStorage.removeItem(k); });
  } catch (_) {
    // Private mode / storage blocked — nothing to clear.
  }
}

function notify(message) {
  try {
    var toast = window.__cannalifeToast;
    if (typeof toast === 'function') { toast(message); return; }
  } catch (_) { /* ignore */ }
  console.warn('[cannalife-auth] ' + message);
}

function bounceToLogin(supabase, reason) {
  try { supabase.realtime.disconnect(); } catch (_) { /* ignore */ }
  try { supabase.removeAllChannels(); } catch (_) { /* ignore */ }
  clearStoredSession();

  if (alreadyOnLogin()) return;

  notify('Your session expired — please sign in again.');
  console.warn('[cannalife-auth] signing out: ' + reason);

  // Full reload, not a router push: it drops every stale in-memory client,
  // timer and socket in one go.
  window.location.replace(loginPath());
}

export function installAuthRecovery(supabase) {
  if (installed || !supabase) return;
  installed = true;

  /* 1 — React to auth state changes */
  supabase.auth.onAuthStateChange(function (event, session) {
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) {
      // Realtime holds its own copy of the JWT. Without this it keeps
      // presenting the OLD token after every refresh, which is why sockets
      // start failing an hour into a shift even when auth is healthy.
      try { supabase.realtime.setAuth(session.access_token); } catch (_) { /* ignore */ }
      return;
    }

    if (event === 'SIGNED_OUT') {
      try { supabase.realtime.disconnect(); } catch (_) { /* ignore */ }
      try { supabase.removeAllChannels(); } catch (_) { /* ignore */ }
    }
  });

  /* 2 — Catch the failed refresh itself.
   * supabase-js does not surface a refresh failure through onAuthStateChange,
   * so watch the network call. This is the only reliable hook. */
  if (typeof window.fetch === 'function' && !window.__cannalifeAuthFetchPatched) {
    window.__cannalifeAuthFetchPatched = true;
    var nativeFetch = window.fetch.bind(window);

    window.fetch = async function (input, init) {
      var res = await nativeFetch(input, init);

      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/auth/v1/token') > -1 && url.indexOf('refresh_token') > -1 && res.status === 400) {
          var body = await res.clone().json().catch(function () { return {}; });
          if (isDeadSessionError(body) || isDeadSessionError({ status: 400, message: body.msg || body.error_description || '' })) {
            bounceToLogin(supabase, 'refresh token rejected: ' + (body.msg || body.error_description || 'unknown'));
          }
        }
      } catch (_) { /* never let the interceptor break a request */ }

      return res;
    };
  }

  /* 3 — Stop the socket retry storm.
   * If realtime cannot connect repeatedly it is almost always the token, not
   * the network. Check the session once instead of hammering all shift. */
  var socketFailures = 0;
  var lastFailureAt = 0;

  window.addEventListener('error', function (e) {
    var msg = (e && e.message) || '';
    if (msg.indexOf('WebSocket') === -1) return;

    var now = Date.now();
    if (now - lastFailureAt > 60000) socketFailures = 0;
    lastFailureAt = now;
    socketFailures += 1;

    if (socketFailures === 5) {
      supabase.auth.getSession().then(function (r) {
        var session = r && r.data ? r.data.session : null;
        if (!session) {
          bounceToLogin(supabase, 'realtime failing with no session');
        } else {
          try { supabase.realtime.setAuth(session.access_token); } catch (_) { /* ignore */ }
        }
      }).catch(function () { /* ignore */ });
    }
  }, true);

  /* 4 — Re-check the session when a till comes back from sleep.
   * Tablets sleep between customers; on wake the access token is usually
   * stale, so surface it at the counter rather than mid-sale. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    supabase.auth.getSession().then(function (r) {
      var session = r && r.data ? r.data.session : null;
      if (session && session.access_token) {
        try { supabase.realtime.setAuth(session.access_token); } catch (_) { /* ignore */ }
      }
    }).catch(function () { /* ignore */ });
  });

  /* 5 — Stale build after a deploy.
   * A tab left open across a deploy still references old asset hashes; those
   * files are gone, so a lazy chunk 404s and the page half-works. */
  window.addEventListener('vite:preloadError', function (e) {
    if (e && e.preventDefault) e.preventDefault();
    notify('A new version of Cannalife Co was released. Reloading…');
    window.location.reload();
  });
}

export default installAuthRecovery;
