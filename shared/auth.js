/* =========================================================
   AuthStorage — shared login + cloud-sync layer for every
   deck on this site.

   What it does:
   - Lets a visitor create an account / sign in (Supabase Auth),
     via a small floating widget it injects in the top-right
     corner of the page.
   - Provides AuthStorage.get(key) / AuthStorage.set(key, json),
     a drop-in replacement for the old window.storage calls each
     deck used to make.
   - Guests (not signed in) still get their progress saved -- it
     lives in this browser's localStorage, exactly like before.
   - Signed-in users get their progress written to a Supabase
     table too, keyed by their account, so it survives logging
     out, closing the tab, or switching to a different browser
     or device. The first time someone signs in on a browser
     that already has guest progress, that local progress is
     copied up to their new account automatically (without
     overwriting progress the account may already have).
   - If shared/supabase-config.js still has its placeholder
     values (no project set up yet), everything falls back to
     local-only mode and the site keeps working normally -- the
     account widget just explains cloud sync isn't configured.

   Include this AFTER the Supabase CDN script and AFTER
   shared/supabase-config.js, and BEFORE a deck's own script:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
     <script src="shared/supabase-config.js"></script>
     <script src="shared/auth.js"></script>
   ========================================================= */
(function(){
  'use strict';

  const cfg = window.SUPABASE_CONFIG || {};
  const cloudEnabled = !!(cfg.url && cfg.anonKey && !/YOUR-PROJECT|YOUR-ANON/.test(cfg.url + cfg.anonKey));

  let client = null;
  if (cloudEnabled && window.supabase && typeof window.supabase.createClient === 'function') {
    try { client = window.supabase.createClient(cfg.url, cfg.anonKey); }
    catch (e) { console.error('Supabase init failed:', e); client = null; }
  }

  let currentUser = null;
  let sessionReady;
  const listeners = [];

  function notify(){ listeners.forEach(fn => { try{ fn(currentUser); }catch(e){} }); }

  async function migrateLocalProgress(){
    if (!client || !currentUser) return;
    let keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.endsWith('-progress')) keys.push(k);
      }
    } catch(e) { return; }
    for (const key of keys) {
      try {
        const { data, error } = await client.from('deck_progress')
          .select('deck_key').eq('user_id', currentUser.id).eq('deck_key', key).maybeSingle();
        if (error) throw error;
        if (!data) {
          const local = localStorage.getItem(key);
          if (local) {
            await client.from('deck_progress').upsert({
              user_id: currentUser.id, deck_key: key,
              data: JSON.parse(local), updated_at: new Date().toISOString()
            });
          }
        }
      } catch(e) { console.warn('Progress migration skipped for', key, e); }
    }
  }

  if (client) {
    sessionReady = client.auth.getSession().then(({data}) => {
      currentUser = data && data.session ? data.session.user : null;
    }).catch(()=>{ currentUser = null; });

    client.auth.onAuthStateChange((event, session) => {
      const wasSignedOut = !currentUser;
      currentUser = session ? session.user : null;
      notify();
      if (wasSignedOut && currentUser) migrateLocalProgress();
    });
  } else {
    sessionReady = Promise.resolve();
  }

  async function ensureSession(){ await sessionReady; }

  async function get(key){
    let local = null;
    try { local = localStorage.getItem(key); } catch(e){}
    await ensureSession();
    if (!client || !currentUser) return local;
    try {
      const { data, error } = await client.from('deck_progress')
        .select('data').eq('user_id', currentUser.id).eq('deck_key', key).maybeSingle();
      if (error) throw error;
      if (data && data.data) {
        const json = JSON.stringify(data.data);
        try { localStorage.setItem(key, json); } catch(e){}
        return json;
      }
      if (local) {
        try {
          await client.from('deck_progress').upsert({
            user_id: currentUser.id, deck_key: key,
            data: JSON.parse(local), updated_at: new Date().toISOString()
          });
        } catch(e) { console.warn('Could not upload guest progress for', key, e); }
      }
      return local;
    } catch(e) {
      console.warn('Cloud load failed, using local copy for', key, e);
      return local;
    }
  }

  async function set(key, json){
    try { localStorage.setItem(key, json); } catch(e){}
    await ensureSession();
    if (!client || !currentUser) return;
    try {
      const { error } = await client.from('deck_progress').upsert({
        user_id: currentUser.id, deck_key: key,
        data: JSON.parse(json), updated_at: new Date().toISOString()
      });
      if (error) throw error;
    } catch(e) { console.warn('Cloud save failed, kept locally only for', key, e); }
  }

  async function signUp(email, password){
    if (!client) throw new Error('Cloud sync is not configured yet.');
    const { data, error } = await client.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    if (error) throw error;
    return data;
  }
  async function signIn(email, password){
    if (!client) throw new Error('Cloud sync is not configured yet.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }
  async function signOut(){
    if (!client) return;
    await client.auth.signOut();
  }
  async function resetPassword(email){
    if (!client) throw new Error('Cloud sync is not configured yet.');
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname
    });
    if (error) throw error;
  }

  window.AuthStorage = {
    get, set, signUp, signIn, signOut, resetPassword,
    isCloudEnabled: () => cloudEnabled,
    getUser: () => currentUser,
    onChange: (fn) => { listeners.push(fn); },
    ready: () => ensureSession()
  };

  /* ---------------------------------------------------------
     Floating account widget -- injected into every page that
     includes this file. Self-contained styling so it looks
     right on top of any deck's own theme.
     --------------------------------------------------------- */
  function injectWidget(){
    const css = `
      #as-widget{position:fixed;top:14px;right:14px;z-index:99999;font-family:'Manrope','Segoe UI',sans-serif;font-size:13px;}
      #as-pill{display:flex;align-items:center;gap:6px;background:rgba(20,20,26,.88);color:#f2eee2;border:1px solid rgba(255,255,255,.14);
        padding:7px 12px;border-radius:999px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);backdrop-filter:blur(6px);
        transition:background .15s ease;user-select:none;max-width:180px;}
      #as-pill:hover{background:rgba(32,32,40,.92);}
      #as-pill .as-dot{width:7px;height:7px;border-radius:50%;background:#8a8d9c;flex:none;}
      #as-pill.as-signedin .as-dot{background:#5fbf74;}
      #as-pill-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      #as-panel{display:none;position:absolute;top:calc(100% + 8px);right:0;width:260px;background:#1c1d24;color:#f2eee2;
        border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.45);padding:16px;}
      #as-panel.as-open{display:block;}
      #as-panel h4{margin:0 0 4px;font-size:14px;font-weight:700;}
      #as-panel p{margin:0 0 10px;font-size:12px;line-height:1.5;color:#b7b9c7;}
      #as-panel .as-tabs{display:flex;gap:4px;margin-bottom:10px;background:#141419;border-radius:8px;padding:3px;}
      #as-panel .as-tab{flex:1;text-align:center;padding:6px 0;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;color:#9294a3;}
      #as-panel .as-tab.as-active{background:#2b2c36;color:#f2eee2;}
      #as-panel input{width:100%;box-sizing:border-box;background:#101116;border:1px solid rgba(255,255,255,.14);color:#f2eee2;
        border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:8px;font-family:inherit;}
      #as-panel input:focus{outline:1px solid #e0b84a;}
      #as-panel button.as-primary{width:100%;background:#e0b84a;color:#1c1d24;border:none;border-radius:8px;padding:9px 0;
        font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}
      #as-panel button.as-primary:hover{background:#f0cc70;}
      #as-panel button.as-link{display:block;width:100%;text-align:center;background:none;border:none;color:#9294a3;font-size:11.5px;
        cursor:pointer;padding:0;margin-top:8px;text-decoration:underline;font-family:inherit;}
      #as-panel .as-msg{font-size:11.5px;line-height:1.5;margin-top:8px;padding:8px;border-radius:6px;}
      #as-panel .as-msg:empty{display:none;}
      #as-panel .as-msg.as-err{background:rgba(220,80,80,.15);color:#ff9a9a;}
      #as-panel .as-msg.as-ok{background:rgba(95,191,116,.15);color:#8fe0a3;}
      #as-panel .as-signedin-row{display:flex;flex-direction:column;gap:8px;}
      #as-panel .as-email{font-weight:700;word-break:break-all;}
      #as-panel button.as-secondary{background:#2b2c36;color:#f2eee2;border:1px solid rgba(255,255,255,.14);border-radius:8px;
        padding:8px 0;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;}
    `;
    if (!document.getElementById('as-style')) {
      const style = document.createElement('style');
      style.id = 'as-style';
      style.textContent = css;
      document.head.appendChild(style);
    }

    const wrap = document.createElement('div');
    wrap.id = 'as-widget';
    wrap.innerHTML =
      '<div id="as-pill"><span class="as-dot"></span><span id="as-pill-label">Guest</span></div>' +
      '<div id="as-panel"></div>';
    document.body.appendChild(wrap);

    const pill = wrap.querySelector('#as-pill');
    const pillLabel = wrap.querySelector('#as-pill-label');
    const panel = wrap.querySelector('#as-panel');
    let mode = 'signin';

    function escapeHtml(s){
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function renderPanel(){
      const user = window.AuthStorage.getUser();
      if (user) {
        panel.innerHTML =
          '<div class="as-signedin-row"><h4>Signed in</h4>' +
          '<div class="as-email">' + escapeHtml(user.email||'') + '</div>' +
          '<p>Your deck progress syncs to this account across devices.</p>' +
          '<button class="as-secondary" id="as-signout">Log out</button></div>';
        panel.querySelector('#as-signout').onclick = async () => {
          await window.AuthStorage.signOut();
        };
        return;
      }
      if (!cloudEnabled) {
        panel.innerHTML =
          '<h4>Guest mode</h4>' +
          '<p>Progress is saved in this browser only. Cloud accounts aren’t set up on this site yet.</p>';
        return;
      }
      panel.innerHTML =
        '<div class="as-tabs">' +
          '<div class="as-tab ' + (mode==='signin'?'as-active':'') + '" data-mode="signin">Sign in</div>' +
          '<div class="as-tab ' + (mode==='signup'?'as-active':'') + '" data-mode="signup">Sign up</div>' +
        '</div>' +
        '<p>' + (mode==='signin' ? 'Sign in to sync progress across devices.' : 'Create an account so your progress is never lost.') + '</p>' +
        '<input type="email" id="as-email" placeholder="Email" autocomplete="email">' +
        '<input type="password" id="as-password" placeholder="Password" autocomplete="' + (mode==='signin'?'current-password':'new-password') + '">' +
        '<button class="as-primary" id="as-submit">' + (mode==='signin' ? 'Sign in' : 'Create account') + '</button>' +
        '<button class="as-link" id="as-forgot">Forgot password?</button>' +
        '<div class="as-msg" id="as-msg"></div>';
      panel.querySelectorAll('.as-tab').forEach(t => t.onclick = () => { mode = t.dataset.mode; renderPanel(); });
      panel.querySelector('#as-submit').onclick = async () => {
        const email = panel.querySelector('#as-email').value.trim();
        const password = panel.querySelector('#as-password').value;
        const msg = panel.querySelector('#as-msg');
        msg.className = 'as-msg'; msg.textContent = '';
        if (!email || !password) { msg.className='as-msg as-err'; msg.textContent='Enter an email and password.'; return; }
        try {
          if (mode === 'signin') {
            await window.AuthStorage.signIn(email, password);
          } else {
            const res = await window.AuthStorage.signUp(email, password);
            if (res && res.session) {
              // email confirmation is off for this project -- already signed in
            } else {
              msg.className='as-msg as-ok';
              msg.textContent='Account created! Check your email to confirm it, then sign in.';
            }
          }
        } catch(e) {
          msg.className='as-msg as-err';
          msg.textContent = (e && e.message) || 'Something went wrong.';
        }
      };
      panel.querySelector('#as-forgot').onclick = async () => {
        const email = panel.querySelector('#as-email').value.trim();
        const msg = panel.querySelector('#as-msg');
        if (!email) { msg.className='as-msg as-err'; msg.textContent='Enter your email above first.'; return; }
        try {
          await window.AuthStorage.resetPassword(email);
          msg.className='as-msg as-ok'; msg.textContent='Password reset email sent.';
        } catch(e) {
          msg.className='as-msg as-err'; msg.textContent=(e && e.message) || 'Could not send reset email.';
        }
      };
    }

    function renderPill(){
      const user = window.AuthStorage.getUser();
      pill.classList.toggle('as-signedin', !!user);
      pillLabel.textContent = user ? (user.email || 'Account') : 'Guest';
    }

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('as-open');
      if (panel.classList.contains('as-open')) renderPanel();
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) panel.classList.remove('as-open');
    });

    window.AuthStorage.onChange(() => { renderPill(); if (panel.classList.contains('as-open')) renderPanel(); });
    renderPill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectWidget);
  } else {
    injectWidget();
  }
})();
