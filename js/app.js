/* ═══════════════════════════════════════════════════
   app.js — Core App Coordinator & Data Fetcher
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  window.TONKHO_DATA = null;

  function parseDate(str) {
    if (!str) return null;
    const parts = str.split(' ');
    if (parts.length < 2) return null;
    const dParts = parts[0].split('/');
    const tParts = parts[1].split(':');
    if (dParts.length < 3 || tParts.length < 3) return null;
    return new Date(
      parseInt(dParts[2], 10),
      parseInt(dParts[1], 10) - 1,
      parseInt(dParts[0], 10),
      parseInt(tParts[0], 10),
      parseInt(tParts[1], 10),
      parseInt(tParts[2], 10)
    );
  }

  // Update update-badge colors and session alert banner
  function checkSessionExpiryAndFreshness() {
    const D = window.TONKHO_DATA;
    if (!D || !D.updated) return;

    const updateDate = parseDate(D.updated);
    if (!updateDate) return;

    const elapsedMs = Date.now() - updateDate.getTime();
    const elapsedMinutes = elapsedMs / (1000 * 60);
    const elapsedHours = elapsedMinutes / 60;

    // 1. Session Alert Banner
    const banner = document.getElementById('session-alert-banner');
    if (banner) {
      if (D.session_expired || elapsedHours > 3) {
        banner.style.display = 'flex';
        if (D.session_expired) {
          banner.innerHTML = `⚠️ &nbsp;<strong>CẢNH BÁO:</strong> &nbsp;Phiên đăng nhập Metabase (Session Token) đã HẾT HẠN. Ní vui lòng chạy file <strong>"🔄 Cập Nhật Session.command"</strong> ở local để cập nhật Session mới!`;
        } else {
          banner.innerHTML = `⚠️ &nbsp;<strong>CẢNH BÁO:</strong> &nbsp;Dữ liệu đã hơn 3 giờ chưa được cập nhật mới. Hệ thống tự cập nhật mỗi 10 phút — nếu vẫn thấy cảnh báo này, vui lòng kiểm tra <strong>GitHub Actions</strong> hoặc <strong>Metabase Session</strong>.`;
        }
      } else {
        banner.style.display = 'none';
      }
    }

    // 2. Data Freshness badge classes (fresh, stale, critical)
    const badge = document.getElementById('update-badge');
    if (badge) {
      badge.classList.remove('fresh', 'stale', 'critical');
      if (D.session_expired || elapsedHours > 3) {
        badge.classList.add('critical');
      } else if (elapsedMinutes > 30) {
        badge.classList.add('stale');
      } else {
        badge.classList.add('fresh');
      }
    }
  }

  // Fetch Inventory JSON from Supabase and render
  async function fetchAndRenderDashboard() {
    const filterContainer = document.getElementById('filter-container');
    const activeBtn = filterContainer ? filterContainer.querySelector('.filter-btn.active') : null;
    const currentFilter = activeBtn ? activeBtn.dataset.filter : 'all';

    const tbody = document.getElementById('pivot-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-secondary);"><span class="loading-spinner">⏳</span> Đang tải dữ liệu từ Supabase...</td></tr>';
    }

    if (!window.supabaseClient) {
      console.warn("Supabase client is not initialised.");
      return;
    }

    try {
      const { data, error } = await window.supabaseClient
        .from('inventory_data')
        .select('data')
        .eq('id', 1)
        .single();

      if (error) throw error;
      if (data && data.data) {
        window.TONKHO_DATA = data.data;
        
        const updateTimeEl = document.getElementById('update-time');
        if (updateTimeEl) {
          updateTimeEl.textContent = 'Cập nhật: ' + window.TONKHO_DATA.updated;
        }
        
        checkSessionExpiryAndFreshness();
        window.renderDashboard(currentFilter);
        
        // Trigger Inbound refresh if tab active
        const dockTabBtn = document.getElementById('tab-btn-dock');
        if (dockTabBtn && dockTabBtn.classList.contains('active')) {
          window.inbound.fetchTripScanData();
        }
      }
    } catch (e) {
      console.error("Lỗi tải dữ liệu tồn kho từ Supabase:", e);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--red);">❌ Không thể tải dữ liệu bảo mật từ Supabase.<br><br><small>Lỗi: ${e.message}</small><br><br><small>Gợi ý: Hãy đảm bảo bạn đã cấu hình RLS Policy cho bảng 'inventory_data' và đã đăng nhập tài khoản hợp lệ.</small></td></tr>`;
      }
    }
  }

  // Download BaoCao_TonKho.xlsx from Supabase Storage using signed url
  async function downloadExcelReport(e) {
    e.preventDefault();
    if (!window.supabaseClient) {
      alert("Supabase client is not ready.");
      return;
    }

    const downloadBtn = document.getElementById('download-excel-btn');
    const originalText = downloadBtn.innerHTML;
    downloadBtn.innerHTML = '⏳ Đang tải file...';
    downloadBtn.style.pointerEvents = 'none';

    try {
      const { data, error } = await window.supabaseClient
        .storage
        .from('reports')
        .createSignedUrl('BaoCao_TonKho.xlsx', 60);

      if (error) throw error;
      if (data && data.signedUrl) {
        const a = document.createElement('a');
        a.href = data.signedUrl;
        a.download = 'BaoCao_TonKho.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error("Lỗi tải báo cáo Excel:", err);
      alert("❌ Lỗi tải báo cáo Excel từ Supabase Storage: " + err.message);
    } finally {
      downloadBtn.innerHTML = originalText;
      downloadBtn.style.pointerEvents = 'auto';
    }
  }

  // Parameter Mapping Settings helper
  const escapeHTML = str => {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  };

  function renderParamsList() {
    const listBody = document.getElementById('params-list-body');
    if (!listBody) return;
    listBody.innerHTML = '';
    
    const currentRaw = window.TONKHO_DATA;
    if (!currentRaw) return;
    const params = currentRaw.mapping_params || [];
    
    params.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="tinh_giao" value="${escapeHTML(p['Tỉnh giao'])}" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;"></td>
        <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="lv2" value="${escapeHTML(p['LV-2'])}" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;"></td>
        <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="kho_den" value="${escapeHTML(p['Kho Đến'])}" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;"></td>
        <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="loai_kho" value="${escapeHTML(p['Loại kho'])}" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;"></td>
      `;
      listBody.appendChild(tr);
    });
  }

  // Setup Event Listeners and Initialise
  document.addEventListener('DOMContentLoaded', () => {
    // Initialise checkAuth
    if (window.checkAuth) {
      window.checkAuth();
    }

    // 1. Tab switches
    const tabBtnInventory = document.getElementById('tab-btn-inventory');
    const tabBtnDock = document.getElementById('tab-btn-dock');
    const tabContentInventory = document.getElementById('tab-content-inventory');
    const tabContentDock = document.getElementById('tab-content-dock');
    
    if (tabBtnInventory && tabBtnDock && tabContentInventory && tabContentDock) {
      tabBtnInventory.addEventListener('click', () => {
        tabBtnInventory.classList.add('active');
        tabBtnDock.classList.remove('active');
        tabContentInventory.style.display = 'block';
        tabContentDock.style.display = 'none';
      });
      
      tabBtnDock.addEventListener('click', () => {
        tabBtnDock.classList.add('active');
        tabBtnInventory.classList.remove('active');
        tabContentInventory.style.display = 'none';
        tabContentDock.style.display = 'block';
        
        if (window.tripScanData.length === 0) {
          window.inbound.fetchTripScanData();
        } else {
          window.inbound.populateInboundDates();
          window.inbound.runDockSimulation();
        }
      });
    }

    // 2. Filter Buttons click
    const filterContainer = document.getElementById('filter-container');
    if (filterContainer) {
      filterContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn || btn.classList.contains('active')) return;
        
        filterContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const filterVal = btn.dataset.filter;
        localStorage.setItem('ktc_filter_type', filterVal);
        window.renderDashboard(filterVal);
      });

      // Restore saved filter
      const savedFilter = localStorage.getItem('ktc_filter_type') || 'all';
      const targetBtn = filterContainer.querySelector(`[data-filter="${savedFilter}"]`);
      if (targetBtn) {
        filterContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        targetBtn.classList.add('active');
      }
    }

    // 3. Bind Excel Download Button
    const downloadBtn = document.getElementById('download-excel-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', downloadExcelReport);
    }

    // 4. Inbound controls
    const refreshTripsBtn = document.getElementById('btn-refresh-trips');
    if (refreshTripsBtn) {
      refreshTripsBtn.addEventListener('click', () => window.inbound.fetchTripScanData());
    }

    const saveDocksBtn = document.getElementById('btn-save-docks');
    if (saveDocksBtn) {
      saveDocksBtn.addEventListener('click', () => {
        const stations = [];
        for (let h = 0; h < 24; h++) {
          const input = document.getElementById(`dock-stations-h${h}`);
          if (input) {
            const val = parseInt(input.value, 10);
            stations.push(isNaN(val) ? 0 : Math.max(0, val));
          } else {
            stations.push(0);
          }
        }
        window.inbound.saveDockStations(stations);
        window.inbound.runDockSimulation();
        alert('Đã lưu cấu hình số trạm nhập và áp dụng vào mô phỏng!');
      });
    }

    const simTAvgInput = document.getElementById('sim-t-avg');
    const simTAvgVal = document.getElementById('sim-t-avg-val');
    if (simTAvgInput && simTAvgVal) {
      const initialTAvg = window.inbound.getDockTAvg();
      simTAvgInput.value = initialTAvg;
      simTAvgVal.textContent = `${initialTAvg} phút`;
      
      simTAvgInput.addEventListener('input', () => {
        const val = simTAvgInput.value;
        simTAvgVal.textContent = `${val} phút`;
        window.inbound.saveDockTAvg(val);
        window.inbound.runDockSimulation();
      });
    }

    const inboundDateSelect = document.getElementById('inbound-date-select');
    if (inboundDateSelect) {
      inboundDateSelect.addEventListener('change', (e) => {
        window.selectedInboundDate = e.target.value;
        window.inbound.runDockSimulation();
      });
    }

    // 5. Settings panel click
    const openSettingsBtn = document.getElementById('open-settings-btn');
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        document.getElementById('settings-panel').classList.add('open');
        renderParamsList();
        const pat = sessionStorage.getItem('github_pat') || '';
        document.getElementById('github-pat').value = pat;
        if (window.loadPendingUsers) {
          window.loadPendingUsers();
        }
      });
    }

    const closeSettingsBtn = document.getElementById('settings-close-btn');
    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        document.getElementById('settings-panel').classList.remove('open');
      });
    }

    const addParamRowBtn = document.getElementById('add-param-row-btn');
    if (addParamRowBtn) {
      addParamRowBtn.addEventListener('click', () => {
        const listBody = document.getElementById('params-list-body');
        if (!listBody) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="tinh_giao" value="" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;" placeholder="Tỉnh mới"></td>
          <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="lv2" value="" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;" placeholder="LV-2"></td>
          <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="kho_den" value="" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;" placeholder="Kho Đến"></td>
          <td style="padding: 4px 6px;"><input type="text" class="param-input" data-col="loai_kho" value="" style="width: 100%; border: none; background: transparent; color: var(--text-primary); font-size: 0.72rem;" placeholder="Loại kho"></td>
        `;
        listBody.appendChild(tr);
        listBody.parentElement.scrollTop = listBody.parentElement.scrollHeight;
      });
    }

    const saveParamsBtn = document.getElementById('save-params-btn');
    if (saveParamsBtn) {
      saveParamsBtn.addEventListener('click', async () => {
        const pat = document.getElementById('github-pat').value.trim();
        if (!pat) {
          alert('Vui lòng nhập Personal Access Token (PAT) để cập nhật tham số!');
          return;
        }

        const btn = document.getElementById('save-params-btn');
        btn.textContent = '⏳ Đang lưu...';
        btn.disabled = true;

        sessionStorage.setItem('github_pat', pat);

        try {
          const listBody = document.getElementById('params-list-body');
          const rows = listBody.querySelectorAll('tr');
          const updatedParams = [];
          
          rows.forEach(r => {
            const inputs = r.querySelectorAll('.param-input');
            const data = {};
            inputs.forEach(ip => {
              const col = ip.dataset.col;
              const val = ip.value.trim();
              if (col === 'tinh_giao') data['Tỉnh giao'] = val;
              else if (col === 'lv2') data['LV-2'] = val;
              else if (col === 'kho_den') data['Kho Đến'] = val;
              else if (col === 'loai_kho') data['Loại kho'] = val;
            });
            
            if (data['Tỉnh giao'] && data['Loại kho']) {
              updatedParams.push(data);
            }
          });

          // Convert parameters list to CSV content
          let csvContent = "Tỉnh giao,LV-2,Kho Đến,Loại kho\n";
          updatedParams.forEach(p => {
            csvContent += `"${p['Tỉnh giao']}","${p['LV-2']}","${p['Kho Đến']}","${p['Loại kho']}"\n`;
          });

          // Push CSV content to GitHub repo
          const repo = 'ImDiDinne/ktchcm01';
          const filePath = 'mapping_params.csv';
          const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
          
          const getResp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${pat}` }
          });
          
          let sha = '';
          if (getResp.ok) {
            const fileData = await getResp.json();
            sha = fileData.sha;
          }

          const base64Content = btoa(unescape(encodeURIComponent(csvContent)));
          
          const putResp = await fetch(url, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${pat}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: 'chore(config): update mapping parameters via dashboard Settings UI',
              content: base64Content,
              sha: sha,
              branch: 'main'
            })
          });
          
          if (!putResp.ok) {
            const errData = await putResp.json();
            throw new Error(errData.message || 'Lỗi đẩy file lên GitHub.');
          }
          
          alert('Lưu thành công! Tiến trình cập nhật trên GitHub Cloud sẽ kích hoạt sau vài giây để đồng bộ báo cáo.');
          document.getElementById('settings-panel').classList.remove('open');
        } catch (err) {
          alert('❌ Thất bại: ' + err.message);
        } finally {
          btn.textContent = '💾 Lưu Tham Số Lên Cloud';
          btn.disabled = false;
        }
      });
    }

    // Inbound configuration grid
    window.inbound.renderDockConfigGrid();
  });

  // Setup periodic refreshes
  // 1. Refresh inventory from Supabase every 10 minutes
  setInterval(fetchAndRenderDashboard, 600000);

  // 2. Refresh Inbound trips from Google Sheets every 30 seconds (if inbound tab is active)
  setInterval(() => {
    const dockTabBtn = document.getElementById('tab-btn-dock');
    if (dockTabBtn && dockTabBtn.classList.contains('active')) {
      window.inbound.fetchTripScanData();
    }
  }, 30000);

  // Expose global methods
  window.fetchAndRenderDashboard = fetchAndRenderDashboard;

})();
