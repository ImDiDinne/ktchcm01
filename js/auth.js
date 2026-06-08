/* ═══════════════════════════════════════════════════
   auth.js — Authentication and Access Control
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  const SESSION_KEY = 'ktc_auth_session';
  const CLOUD_AUTH_KEY = 'ktc_supabase_config';
  
  // Default connection details (TripScan project)
  const DEFAULT_SUPABASE = {
    url: 'https://baizmeqkxslajxuzyfnu.supabase.co',
    key: 'sb_publishable_VRLqjdMb3uIie89vbRXloA_xdak8hgy'
  };

  window.currentUser = null;
  window.supabaseClient = null;

  // Initialise Supabase Client (Cloud custom or default)
  function initSupabase() {
    if (!window.supabase) {
      console.warn("Supabase library not loaded yet.");
      return;
    }
    const config = JSON.parse(localStorage.getItem(CLOUD_AUTH_KEY)) || DEFAULT_SUPABASE;
    if (config.url && config.key) {
      window.supabaseClient = window.supabase.createClient(config.url, config.key);
      console.log("Supabase Client initialised.");
    }
  }

  // SHA-256 hashing for local fallback auth (works on HTTP and offline)
  async function hashSHA256(str) {
    if (window.sha256) {
      return window.sha256(str);
    }
    const msgBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Apply Role-Based Access Control (RBAC)
  function applyRBAC(role) {
    const downloadBtn = document.getElementById('download-excel-btn');
    const settingsBtn = document.getElementById('open-settings-btn');
    
    if (role === 'manager') {
      if (downloadBtn) downloadBtn.style.display = 'flex';
      if (settingsBtn) settingsBtn.style.display = 'flex';
    } else {
      if (downloadBtn) downloadBtn.style.display = 'none';
      if (settingsBtn) settingsBtn.style.display = 'none';
    }
  }

  // Display profile when logged in
  function setLoggedInUser(user) {
    window.currentUser = user;
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';
    
    const profileEl = document.getElementById('user-profile');
    if (profileEl) {
      profileEl.style.display = 'flex';
      document.getElementById('user-name').textContent = user.name;
      document.getElementById('user-role').textContent = user.role === 'manager' ? 'Hub Manager' : 'Nhân Viên';
    }
    
    applyRBAC(user.role);
    
    // Trigger dashboard data fetch after login
    if (window.fetchAndRenderDashboard) {
      window.fetchAndRenderDashboard();
    }
  }

  // Show login overlay if unauthenticated
  function showLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    const profileEl = document.getElementById('user-profile');
    if (profileEl) profileEl.style.display = 'none';
    
    if (document.getElementById('download-excel-btn')) document.getElementById('download-excel-btn').style.display = 'none';
    if (document.getElementById('open-settings-btn')) document.getElementById('open-settings-btn').style.display = 'none';
  }

  // Verify active session
  async function checkAuth() {
    initSupabase();
    
    // 1. Check Cloud Auth Session first
    const supabaseConfig = JSON.parse(localStorage.getItem(CLOUD_AUTH_KEY));
    if (supabaseConfig && window.supabaseClient) {
      try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
          const user = session.user;
          const role = user.user_metadata?.role || 'operator';
          const name = user.user_metadata?.name || user.email;
          setLoggedInUser({ username: user.email, name, role });
          return;
        }
      } catch (e) {
        console.error("Supabase Auth error:", e);
      }
    }
    
    // 2. Fallback to Local Auth Session (Session Storage)
    const localSession = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (localSession) {
      setLoggedInUser(localSession);
    } else {
      showLoginOverlay();
    }
  }

  // Log out current session
  function logout() {
    window.currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    if (window.supabaseClient) {
      try {
        window.supabaseClient.auth.signOut();
      } catch(e) {}
    }
    showLoginOverlay();
    
    // Clear display data
    if (window.clearDashboardData) {
      window.clearDashboardData();
    }
  }

  // Listeners setup
  document.addEventListener('DOMContentLoaded', () => {
    // Initialise Supabase Client on DOM Load
    initSupabase();

    // Bind logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    // Handle login form submission
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uname = document.getElementById('login-username').value.trim();
        const pass = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');
        errorEl.style.display = 'none';
        
        const unameLower = uname.toLowerCase();
        const userHashes = {
          'manager': '866485796cfa8d7c0cf7111640205b83076433547577511d81f8030ae99ecea5',
          'operator': 'ec6e1c25258002eb1c67d15c7f45da7945fa4c58778fd7d88faa5e53e3b4698d'
        };

        // 1. Verify Local Auth
        if (userHashes[unameLower]) {
          const inputHash = await hashSHA256(pass);
          if (inputHash === userHashes[unameLower]) {
            const sessionUser = {
              username: unameLower,
              name: unameLower === 'manager' ? 'Hub Manager' : 'Staff / Operator',
              role: unameLower === 'manager' ? 'manager' : 'operator'
            };
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionUser));
            setLoggedInUser(sessionUser);
          } else {
            errorEl.textContent = 'Mật khẩu cục bộ không chính xác.';
            errorEl.style.display = 'block';
          }
          return;
        }
        
        // 2. Verify Cloud Auth
        const supabaseConfig = JSON.parse(localStorage.getItem(CLOUD_AUTH_KEY));
        if (supabaseConfig && window.supabaseClient) {
          try {
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
              email: uname,
              password: pass
            });
            if (error) throw error;
            const user = data.user;
            const role = user.user_metadata?.role || 'operator';
            const name = user.user_metadata?.name || user.email;
            setLoggedInUser({ username: user.email, name, role });
          } catch (err) {
            errorEl.textContent = 'Lỗi Cloud Auth: ' + err.message;
            errorEl.style.display = 'block';
          }
          return;
        }
        
        errorEl.textContent = 'Tên đăng nhập không tồn tại hoặc chưa kết nối Cloud Auth.';
        errorEl.style.display = 'block';
      });
    }

    // Toggle Cloud Auth settings panel in login form
    const toggleCloudBtn = document.getElementById('toggle-cloud-auth-btn');
    if (toggleCloudBtn) {
      toggleCloudBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const panel = document.getElementById('cloud-auth-panel');
        if (panel) {
          panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
          if (panel.style.display === 'block') {
            const config = JSON.parse(localStorage.getItem(CLOUD_AUTH_KEY)) || { url: '', key: '' };
            document.getElementById('supabase-url').value = config.url || '';
            document.getElementById('supabase-key').value = config.key || '';
          }
        }
      });
    }

    // Save Cloud Auth credentials
    const saveCloudBtn = document.getElementById('save-cloud-auth-btn');
    if (saveCloudBtn) {
      saveCloudBtn.addEventListener('click', () => {
        const url = document.getElementById('supabase-url').value.trim();
        const key = document.getElementById('supabase-key').value.trim();
        
        if (url && key) {
          localStorage.setItem(CLOUD_AUTH_KEY, JSON.stringify({ url, key }));
          alert('Đã cấu hình Supabase Cloud Auth! Trình duyệt sẽ tải lại để áp dụng.');
          location.reload();
        } else {
          localStorage.removeItem(CLOUD_AUTH_KEY);
          alert('Đã xóa cấu hình Supabase. Hệ thống quay về dùng tài khoản cục bộ.');
          location.reload();
        }
      });
    }
  });

  // Expose global methods
  window.checkAuth = checkAuth;
  window.logout = logout;
  window.initSupabase = initSupabase;

})();
