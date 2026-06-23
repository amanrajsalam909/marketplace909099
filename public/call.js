/* RajkotMarket — free WebRTC voice call (POC).
 *
 * Audio-only peer-to-peer call between a partner and a customer. Signaling
 * (SDP + ICE) is relayed over /api/feedback (call-signal / call-poll) — the
 * page supplies a `signal(action, body)` fn that attaches its own auth + posts
 * to /api/feedback and returns the parsed JSON. Media flows P2P via Google STUN.
 *
 * Heads-up (POC limits): both people must have their page open with mic
 * permission; no TURN relay, so calls can fail on some mobile/carrier networks.
 *
 * Public API:
 *   RMCall.call(room, signal, label)      // start an OUTGOING call (caller)
 *   RMCall.incoming(room, signal, label)  // show an INCOMING ringer (callee)
 *   RMCall.busy()                         // is a call active?
 */
(function () {
  var STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  var POLL_MS = 1200;
  var active = null;  // current connected/connecting call
  var ringing = null; // room currently showing an incoming ringer (not yet answered)

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- One-time consent (DPDP Act 2023) ----------
   * The call connects the two parties over the internet and processes the mic
   * audio + connection data needed to place the call. We ask once, then remember
   * the choice locally so we don't nag on every call. */
  var CONSENT_KEY = 'rmcall_consent_v1';
  function hasConsent() { try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch (e) { return false; } }
  function rememberConsent() { try { localStorage.setItem(CONSENT_KEY, 'yes'); } catch (e) {} }

  function askConsent() {
    return new Promise(function (resolve) {
      if (hasConsent()) { resolve(true); return; }
      var ov = document.createElement('div');
      ov.id = 'rmcall-consent';
      ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,system-ui,sans-serif';
      var card = document.createElement('div');
      card.style.cssText = 'background:#fff;color:#0f172a;border-radius:16px;max-width:380px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35)';
      card.innerHTML =
        '<div style="font-size:30px;line-height:1;margin-bottom:10px">🔒📞</div>' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:8px">Before we connect your call</div>' +
        '<div style="font-size:13px;line-height:1.55;color:#475569">' +
          'This places a free <b>internet voice call</b> directly between you and the other person — ' +
          'your phone number stays private and is never shared. To connect it, we use your ' +
          '<b>microphone</b> and the network details needed to set up the call. The call is ' +
          '<b>not recorded</b>.<br><br>By continuing you agree to this, as described in our Privacy Policy.' +
        '</div>' +
        '<div id="rmcall-consent-actions" style="display:flex;gap:8px;margin-top:18px"></div>';
      ov.appendChild(card);
      function done(ok) { try { ov.remove(); } catch (e) {} resolve(ok); }
      var actions = card.querySelector('#rmcall-consent-actions');
      actions.appendChild(btn('Not now', '#64748b', function () { done(false); }));
      actions.appendChild(btn('Agree & continue', '#059669', function () { rememberConsent(); done(true); }));
      document.body.appendChild(ov);
    });
  }

  /* ---------- Minimal overlay UI ---------- */
  function ui() {
    if (document.getElementById('rmcall-ui')) return document.getElementById('rmcall-ui');
    var el = document.createElement('div');
    el.id = 'rmcall-ui';
    el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;background:#0f172a;color:#fff;border-radius:14px;padding:14px 18px;box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:Inter,system-ui,sans-serif;min-width:260px;max-width:calc(100vw - 24px);display:none';
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="width:42px;height:42px;border-radius:50%;background:#1e293b;display:flex;align-items:center;justify-content:center;font-size:20px">📞</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div id="rmcall-who" style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>' +
          '<div id="rmcall-state" style="font-size:12px;color:#94a3b8;margin-top:2px"></div>' +
        '</div>' +
      '</div>' +
      '<div id="rmcall-actions" style="display:flex;gap:8px;margin-top:12px"></div>' +
      '<audio id="rmcall-audio" autoplay playsinline></audio>';
    document.body.appendChild(el);
    return el;
  }
  function btn(label, bg, onclick) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'flex:1;padding:10px;border:none;border-radius:9px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;background:' + bg + ';color:#fff';
    b.onclick = onclick;
    return b;
  }
  function show(who) { var u = ui(); u.style.display = 'block'; u.querySelector('#rmcall-who').textContent = who; }
  function setState(t) { var s = document.getElementById('rmcall-state'); if (s) s.textContent = t; }
  function setActions(nodes) { var a = document.getElementById('rmcall-actions'); if (!a) return; a.innerHTML = ''; nodes.forEach(function (n) { a.appendChild(n); }); }
  function hideUI() { var u = document.getElementById('rmcall-ui'); if (u) u.style.display = 'none'; }

  /* ---------- Core call ---------- */
  function teardown(sendBye) {
    if (!active) return;
    var a = active; active = null;
    a.ended = true;
    if (sendBye) { try { a.signal('call-signal', { room: a.room, kind: 'bye' }); } catch (e) {} }
    try { a.pc && a.pc.close(); } catch (e) {}
    try { a.stream && a.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  }

  async function begin(room, signal, label, isCaller) {
    if (active) return;
    // DPDP consent gate — asked once, then remembered (resolves instantly after).
    var ok = await askConsent();
    if (!ok) { if (!isCaller) { try { signal('call-signal', { room: room, kind: 'bye' }); } catch (e) {} } hideUI(); return; }
    if (active) return;
    var st = { room: room, signal: signal, isCaller: isCaller, since: 0, ended: false, pc: null, stream: null, muted: false };
    active = st;
    show((isCaller ? 'Calling ' : '') + label);
    setState('Starting microphone…');
    setActions([btn('Hang up', '#dc2626', function () { teardown(true); hideUI(); })]);

    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      setState('Microphone blocked — allow mic access to call.');
      setActions([btn('Close', '#475569', function () { teardown(false); hideUI(); })]);
      active = null;
      return;
    }
    if (st.ended) return;

    // Pull STUN + TURN from the server (TURN makes mobile networks reliable).
    var iceCfg = STUN;
    try {
      var cfg = await signal('call-ice-config', { room: room });
      if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) iceCfg = { iceServers: cfg.iceServers };
    } catch (e) { /* fall back to STUN-only */ }
    if (st.ended) return;

    st.pc = new RTCPeerConnection(iceCfg);
    st.stream.getTracks().forEach(function (t) { st.pc.addTrack(t, st.stream); });
    st.pc.onicecandidate = function (e) { if (e.candidate) st.signal('call-signal', { room: room, kind: 'ice', payload: e.candidate }); };
    st.pc.ontrack = function (e) { var au = document.getElementById('rmcall-audio'); if (au) au.srcObject = e.streams[0]; };
    st.pc.onconnectionstatechange = function () {
      var cs = st.pc.connectionState;
      if (cs === 'connected') { setState('Connected'); liveActions(st); }
      else if (cs === 'connecting') setState('Connecting…');
      else if (cs === 'failed') { setState('Call failed (network).'); setActions([btn('Close', '#475569', function () { teardown(true); hideUI(); })]); }
      else if (cs === 'disconnected' || cs === 'closed') { if (!st.ended) { setState('Call ended'); setActions([btn('Close', '#475569', function () { teardown(false); hideUI(); })]); } }
    };

    setState(isCaller ? 'Ringing…' : 'Connecting…');
    if (isCaller) {
      var offer = await st.pc.createOffer();
      await st.pc.setLocalDescription(offer);
      await st.signal('call-signal', { room: room, kind: 'offer', payload: offer });
    }
    pollLoop(st);
  }

  function liveActions(st) {
    var mute = btn(st.muted ? 'Unmute' : 'Mute', '#334155', function () {
      st.muted = !st.muted;
      st.stream.getAudioTracks().forEach(function (t) { t.enabled = !st.muted; });
      mute.textContent = st.muted ? 'Unmute' : 'Mute';
    });
    setActions([mute, btn('Hang up', '#dc2626', function () { teardown(true); hideUI(); })]);
  }

  async function pollLoop(st) {
    while (!st.ended) {
      var msgs = [];
      try { msgs = await st.signal('call-poll', { room: st.room, since: st.since }); } catch (e) { msgs = []; }
      if (st.ended) return;
      if (Array.isArray(msgs)) {
        for (var i = 0; i < msgs.length; i++) {
          var m = msgs[i];
          if (m.id > st.since) st.since = m.id;
          try {
            if (m.kind === 'offer' && !st.isCaller) {
              await st.pc.setRemoteDescription(m.payload);
              var ans = await st.pc.createAnswer();
              await st.pc.setLocalDescription(ans);
              await st.signal('call-signal', { room: st.room, kind: 'answer', payload: ans });
            } else if (m.kind === 'answer' && st.isCaller) {
              await st.pc.setRemoteDescription(m.payload);
            } else if (m.kind === 'ice') {
              try { await st.pc.addIceCandidate(m.payload); } catch (e) {}
            } else if (m.kind === 'bye') {
              setState('Call ended by the other side'); st.ended = true;
              setActions([btn('Close', '#475569', function () { teardown(false); hideUI(); })]);
              teardown(false);
              return;
            }
          } catch (e) { /* ignore individual signal errors */ }
        }
      }
      await sleep(POLL_MS);
    }
  }

  window.RMCall = {
    busy: function () { return !!active; },
    ringingRoom: function () { return ringing; },
    stopRinging: function () { if (ringing && !active) { ringing = null; hideUI(); } },
    call: function (room, signal, label) { begin(room, signal, label || 'customer', true); },
    incoming: function (room, signal, label) {
      if (active || ringing) return;
      ringing = room;
      show('Incoming call');
      setState((label || 'Caller') + ' is calling…');
      setActions([
        btn('Answer', '#059669', function () { ringing = null; begin(room, signal, label || 'caller', false); }),
        btn('Decline', '#dc2626', function () { ringing = null; try { signal('call-signal', { room: room, kind: 'bye' }); } catch (e) {} hideUI(); })
      ]);
    }
  };
})();
