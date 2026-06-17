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
  let _initRetries = 0;
  function initSupabase() {
    if (window.supabaseClient) return; // Already initialised
    if (!window.supabase) {
      if (_initRetries < 20) { // Retry up to 10 seconds
        _initRetries++;
        console.warn(`Supabase library not loaded yet. Retry ${_initRetries}/20...`);
        setTimeout(initSupabase, 500);
      } else {
        console.error("❌ Supabase library failed to load after 10s. Check CDN or network.");
      }
      return;
    }
    const config = DEFAULT_SUPABASE;
    if (config.url && config.key) {
      window.supabaseClient = window.supabase.createClient(config.url, config.key);
      console.log("Supabase Client initialised.");
      // Trigger pending fetches that were waiting for client
      if (window.inbound && window.inbound.fetchTripScanData) {
        window.inbound.fetchTripScanData();
      }
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
    const shiftReportBtn = document.getElementById('export-shift-report-btn');
    
    if (role === 'manager') {
      if (downloadBtn) downloadBtn.style.display = 'flex';
      if (settingsBtn) settingsBtn.style.display = 'flex';
      if (shiftReportBtn) shiftReportBtn.style.display = 'flex';
    } else {
      if (downloadBtn) downloadBtn.style.display = 'none';
      if (settingsBtn) settingsBtn.style.display = 'none';
      if (shiftReportBtn) shiftReportBtn.style.display = 'none';
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
        loadAllUsers();
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
    const supabaseConfig = DEFAULT_SUPABASE;
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
        const supabaseConfig = DEFAULT_SUPABASE;
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
    listContainer.innerHTML = '<div style="padding: 10px 0;"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>';
    
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

  async function loadAllUsers() {
    const section = document.getElementById('all-users-section');
    const listContainer = document.getElementById('all-users-list');
    
    if (!section || !listContainer) return;
    
    if (!window.currentUser || window.currentUser.role !== 'manager') {
      section.style.display = 'none';
      return;
    }
    
    section.style.display = 'block';
    listContainer.innerHTML = '<div style="padding: 10px 0;"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>';
    
    if (!window.supabaseClient) {
      listContainer.innerHTML = '<p style="color: var(--red); text-align: center; padding: 10px 0;">❌ Lỗi: Chưa kết nối Supabase.</p>';
      return;
    }
    
    try {
      const { data, error } = await window.supabaseClient.rpc('get_all_users');
      if (error) throw error;
      
      if (!data || data.length === 0) {
        listContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 10px 0;">Không có người dùng nào trong hệ thống.</p>';
        return;
      }
      
      listContainer.innerHTML = '';
      data.forEach(user => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; flex-direction: column; padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); gap: 6px; background: rgba(255, 255, 255, 0.01); border-radius: var(--radius-sm); margin-bottom: 4px;';
        
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;';
        
        const userInfo = document.createElement('div');
        userInfo.style.cssText = 'flex: 1; overflow: hidden;';
        
        const nameText = user.name ? `<strong>${user.name}</strong>` : '<em>No Name</em>';
        const roleBadge = user.role === 'manager' 
          ? '<span style="background: var(--accent); color: white; font-size: 0.55rem; padding: 1px 4px; border-radius: 3px; font-weight: bold; margin-left: 6px;">Mgr</span>' 
          : '<span style="background: rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.55rem; padding: 1px 4px; border-radius: 3px; margin-left: 6px;">Staff</span>';
          
        const approveBadge = user.approved 
          ? '<span style="background: rgba(34, 197, 94, 0.15); color: rgb(74, 222, 128); border: 1px solid rgba(34,197,94,0.3); font-size: 0.55rem; padding: 1px 4px; border-radius: 3px; margin-left: 6px;">Active</span>' 
          : '<span style="background: rgba(239, 68, 68, 0.15); color: rgb(248, 113, 113); border: 1px solid rgba(239,68,68,0.3); font-size: 0.55rem; padding: 1px 4px; border-radius: 3px; margin-left: 6px;">Blocked</span>';
          
        userInfo.innerHTML = `<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">${nameText} ${roleBadge} ${approveBadge}</div><span style="color: var(--text-muted); font-size: 0.65rem; display: block; text-overflow: ellipsis; overflow: hidden; margin-top: 2px;">${user.email}</span>`;
        
        header.appendChild(userInfo);
        
        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 6px; justify-content: flex-end; align-items: center; margin-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.03); padding-top: 6px;';
        
        const approveBtn = document.createElement('button');
        approveBtn.textContent = user.approved ? 'Khoá' : 'Duyệt';
        approveBtn.style.cssText = user.approved
          ? 'background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: rgb(248, 113, 113); font-size: 0.6rem; padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer;'
          : 'background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); color: rgb(74, 222, 128); font-size: 0.6rem; padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer;';
        approveBtn.addEventListener('click', () => handleToggleApprove(user.id, user.approved, user.email));
        
        const roleBtn = document.createElement('button');
        roleBtn.textContent = user.role === 'manager' ? 'Sét Staff' : 'Sét Mgr';
        roleBtn.style.cssText = 'background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border); color: var(--text-primary); font-size: 0.6rem; padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer;';
        roleBtn.addEventListener('click', () => handleToggleRole(user.id, user.role, user.email));
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Xoá';
        deleteBtn.style.cssText = 'background: rgba(239, 68, 68, 0.15); border: none; color: rgb(248, 113, 113); font-size: 0.6rem; padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer; font-weight: bold;';
        deleteBtn.addEventListener('click', () => handleDeleteUser(user.id, user.email));
        
        if (window.currentUser && window.currentUser.username === user.email) {
          approveBtn.disabled = true;
          approveBtn.style.opacity = '0.5';
          approveBtn.style.cursor = 'not-allowed';
          roleBtn.disabled = true;
          roleBtn.style.opacity = '0.5';
          roleBtn.style.cursor = 'not-allowed';
          deleteBtn.disabled = true;
          deleteBtn.style.opacity = '0.5';
          deleteBtn.style.cursor = 'not-allowed';
        }
        
        actions.appendChild(approveBtn);
        actions.appendChild(roleBtn);
        actions.appendChild(deleteBtn);
        
        item.appendChild(header);
        item.appendChild(actions);
        listContainer.appendChild(item);
      });
    } catch (err) {
      console.error("Lỗi tải danh sách người dùng:", err);
      listContainer.innerHTML = `<p style="color: var(--red); text-align: center; padding: 10px 0;">❌ Lỗi: ${err.message}<br><br><small>Gợi ý: Đảm bảo đã chạy các SQL tạo hàm trong file supabase_user_management.sql.</small></p>`;
    }
  }

  async function handleToggleApprove(userId, currentStatus, email) {
    const newStatus = !currentStatus;
    const actionName = newStatus ? 'Phê duyệt' : 'Khoá/Thu hồi';
    if (!confirm(`${actionName} tài khoản ${email}?`)) return;
    
    try {
      const { error } = await window.supabaseClient.rpc('update_user_approved', {
        target_user_id: userId,
        is_approved: newStatus
      });
      if (error) throw error;
      
      alert(`Đã ${actionName.toLowerCase()} thành công tài khoản ${email}!`);
      loadPendingUsers();
      loadAllUsers();
    } catch (err) {
      alert(`❌ Lỗi cập nhật trạng thái: ${err.message}`);
    }
  }

  async function handleToggleRole(userId, currentRole, email) {
    const newRole = currentRole === 'manager' ? 'operator' : 'manager';
    const roleName = newRole === 'manager' ? 'Quản lý (Hub Manager)' : 'Nhân viên (Operator/Staff)';
    if (!confirm(`Thay đổi quyền của tài khoản ${email} thành ${roleName}?`)) return;
    
    try {
      const { error } = await window.supabaseClient.rpc('update_user_role', {
        target_user_id: userId,
        target_role: newRole
      });
      if (error) throw error;
      
      alert(`Đã thay đổi quyền thành công tài khoản ${email}!`);
      loadPendingUsers();
      loadAllUsers();
    } catch (err) {
      alert(`❌ Lỗi thay đổi quyền: ${err.message}`);
    }
  }

  async function handleDeleteUser(userId, email) {
    if (!confirm(`⚠️ CẢNH BÁO: Bạn có chắc chắn muốn XÓA vĩnh viễn tài khoản ${email}? Hành động này không thể hoàn tác!`)) return;
    
    try {
      const { error } = await window.supabaseClient.rpc('delete_user_by_id', {
        target_user_id: userId
      });
      if (error) throw error;
      
      alert(`Đã xóa vĩnh viễn tài khoản ${email}!`);
      loadPendingUsers();
      loadAllUsers();
    } catch (err) {
      alert(`❌ Lỗi xóa tài khoản: ${err.message}`);
    }
  }

  // Expose global methods
  window.checkAuth = checkAuth;
  window.logout = logout;
  window.initSupabase = initSupabase;
  window.loadPendingUsers = loadPendingUsers;
  window.loadAllUsers = loadAllUsers;

})();
