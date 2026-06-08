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
    
    // Check pending users and show badge if manager
    if (user.role === 'manager') {
      // Small timeout to make sure DOM is updated first
      setTimeout(() => {
        loadPendingUsers();
      }, 500);
    }
    
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
          const isApproved = user.user_metadata?.approved === true;
          if (!isApproved) {
            const errorEl = document.getElementById('login-error');
            if (errorEl) {
              errorEl.textContent = 'Tài khoản của bạn đang chờ quản trị viên phê duyệt.';
              errorEl.style.display = 'block';
            }
            showLoginOverlay();
            return;
          }
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
    
    // Toggle between Login and Signup Forms
    const goToSignupBtn = document.getElementById('go-to-signup-btn');
    const goToLoginBtn = document.getElementById('go-to-login-btn');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const errorEl = document.getElementById('login-error');
    const successEl = document.getElementById('login-success');

    if (goToSignupBtn && goToLoginBtn && loginForm && signupForm) {
      goToSignupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        signupForm.style.display = 'block';
        goToSignupBtn.style.display = 'none';
        goToLoginBtn.style.display = 'inline';
        if (errorEl) errorEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';
      });

      goToLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
        goToSignupBtn.style.display = 'inline';
        goToLoginBtn.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';
      });
    }

    // Handle signup form submission
    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sName = document.getElementById('signup-name').value.trim();
        const sEmail = document.getElementById('signup-email').value.trim();
        const sPass = document.getElementById('signup-password').value;

        if (errorEl) errorEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';

        if (!window.supabaseClient) {
          if (errorEl) {
            errorEl.textContent = 'Supabase chưa được kết nối. Vui lòng bật cấu hình Cloud Auth ở dưới.';
            errorEl.style.display = 'block';
          }
          return;
        }

        try {
          const { data, error } = await window.supabaseClient.auth.signUp({
            email: sEmail,
            password: sPass,
            options: {
              data: {
                name: sName,
                role: 'operator',
                approved: false
              }
            }
          });

          if (error) throw error;
          
          if (successEl) {
            successEl.textContent = 'Đăng ký thành công! Vui lòng liên hệ Admin để được phê duyệt tài khoản.';
            successEl.style.display = 'block';
          }
          
          // Clear form
          signupForm.reset();
          
          // Switch back to login form automatically
          setTimeout(() => {
            if (goToLoginBtn) goToLoginBtn.click();
          }, 3000);

        } catch (err) {
          if (errorEl) {
            errorEl.textContent = 'Lỗi đăng ký: ' + err.message;
            errorEl.style.display = 'block';
          }
        }
      });
    }
    
    // Handle login form submission
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uname = document.getElementById('login-username').value.trim();
        const pass = document.getElementById('login-password').value;
        if (errorEl) errorEl.style.display = 'none';
        if (successEl) successEl.style.display = 'none';
        
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
            if (errorEl) {
              errorEl.textContent = 'Mật khẩu cục bộ không chính xác.';
              errorEl.style.display = 'block';
            }
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
            
            const isApproved = user.user_metadata?.approved === true;
            if (!isApproved) {
              if (errorEl) {
                errorEl.textContent = 'Đăng nhập thành công nhưng tài khoản của bạn đang chờ phê duyệt. Vui lòng liên hệ Admin.';
                errorEl.style.display = 'block';
              }
              // Sign out immediately to avoid leaving session active locally
              await window.supabaseClient.auth.signOut();
              return;
            }
            
            const role = user.user_metadata?.role || 'operator';
            const name = user.user_metadata?.name || user.email;
            setLoggedInUser({ username: user.email, name, role });
          } catch (err) {
            if (errorEl) {
              errorEl.textContent = 'Lỗi Cloud Auth: ' + err.message;
              errorEl.style.display = 'block';
            }
          }
          return;
        }
        
        if (errorEl) {
          errorEl.textContent = 'Tên đăng nhập không tồn tại hoặc chưa kết nối Cloud Auth.';
          errorEl.style.display = 'block';
        }
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

  async function loadPendingUsers() {
    const section = document.getElementById('pending-users-section');
    const listContainer = document.getElementById('pending-users-list');
    const badge = document.getElementById('pending-count-badge');
    
    if (!section || !listContainer) return;
    
    // Hide by default unless user is manager
    if (!window.currentUser || window.currentUser.role !== 'manager') {
      section.style.display = 'none';
      return;
    }
    
    section.style.display = 'block';
    listContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 10px 0;">⏳ Đang tải danh sách...</p>';
    
    if (!window.supabaseClient) {
      listContainer.innerHTML = '<p style="color: var(--red); text-align: center; padding: 10px 0;">❌ Lỗi: Chưa kết nối Supabase.</p>';
      return;
    }
    
    try {
      const { data, error } = await window.supabaseClient.rpc('get_pending_users');
      if (error) throw error;
      
      const settingsBadge = document.getElementById('settings-badge');

      if (!data || data.length === 0) {
        listContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 10px 0;">✅ Không có tài khoản nào chờ duyệt.</p>';
        if (badge) badge.style.display = 'none';
        if (settingsBadge) settingsBadge.style.display = 'none';
        return;
      }
      
      if (badge) {
        badge.textContent = data.length;
        badge.style.display = 'inline';
      }
      if (settingsBadge) {
        settingsBadge.style.display = 'block';
      }
      
      listContainer.innerHTML = '';
      data.forEach(user => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05); gap: 10px;';
        
        const info = document.createElement('div');
        info.style.cssText = 'flex: 1; overflow: hidden;';
        
        const nameText = user.name ? `<strong>${user.name}</strong><br>` : '';
        info.innerHTML = `${nameText}<span style="color: var(--text-muted); font-size: 0.65rem; display: block; text-overflow: ellipsis; overflow: hidden;">${user.email}</span>`;
        
        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 5px;';
        
        const approveStaff = document.createElement('button');
        approveStaff.textContent = 'Duyệt Staff';
        approveStaff.style.cssText = 'background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.62rem; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer;';
        approveStaff.addEventListener('click', () => handleApproveClick(user.id, 'operator', user.email));
        
        const approveManager = document.createElement('button');
        approveManager.textContent = 'Duyệt Mgr';
        approveManager.style.cssText = 'background: var(--accent); border: none; color: white; font-size: 0.62rem; padding: 4px 8px; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600;';
        approveManager.addEventListener('click', () => handleApproveClick(user.id, 'manager', user.email));
        
        actions.appendChild(approveStaff);
        actions.appendChild(approveManager);
        
        item.appendChild(info);
        item.appendChild(actions);
        listContainer.appendChild(item);
      });
      
    } catch (err) {
      console.error("Lỗi tải danh sách chờ duyệt:", err);
      listContainer.innerHTML = `<p style="color: var(--red); text-align: center; padding: 10px 0;">❌ Lỗi: ${err.message}<br><br><small>Gợi ý: Đảm bảo đã chạy SQL tạo hàm get_pending_users.</small></p>`;
    }
  }

  async function handleApproveClick(userId, role, email) {
    if (!confirm(`Phê duyệt tài khoản ${email} với vai trò ${role === 'manager' ? 'Quản lý' : 'Nhân viên'}?`)) return;
    
    try {
      const { data, error } = await window.supabaseClient.rpc('approve_user', {
        target_user_id: userId,
        target_role: role
      });
      if (error) throw error;
      
      alert(`Đã phê duyệt thành công tài khoản ${email}!`);
      loadPendingUsers();
    } catch (err) {
      alert(`❌ Lỗi phê duyệt: ${err.message}`);
    }
  }

  // Expose global methods
  window.checkAuth = checkAuth;
  window.logout = logout;
  window.initSupabase = initSupabase;
  window.loadPendingUsers = loadPendingUsers;

})();
