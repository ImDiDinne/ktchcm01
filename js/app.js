/* ═══════════════════════════════════════════════════
   app.js — Core App Coordinator & Data Fetcher
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  // 🧹 SECURITY CLEANUP: Xoá các token cũ khỏi bộ nhớ trình duyệt nếu còn sót lại
  try {
    localStorage.removeItem('ktc_github_pat');
    sessionStorage.removeItem('github_pat');
    localStorage.removeItem('alert_telegram_token');
  } catch(e) {}

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
      let skeletonRows = '';
      for (let i = 0; i < 5; i++) {
        skeletonRows += `<tr class="skeleton-row">`;
        for (let j = 0; j < 11; j++) {
          skeletonRows += `<td><div class="skeleton skeleton-cell"></div></td>`;
        }
        skeletonRows += `</tr>`;
      }
      tbody.innerHTML = skeletonRows;
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
        
        if (window.updateHeartbeatTimers) {
          window.updateHeartbeatTimers();
        }
        
        checkSessionExpiryAndFreshness();
        window.renderDashboard(currentFilter);
        
        // Fetch inventory history and render chart
        window.renderCompare24hChart();
        
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

  // ── Supabase Realtime cho Dữ Liệu Tồn Kho ──
  let inventoryRealtimeChannel = null;
  function subscribeRealtimeInventoryData() {
    if (inventoryRealtimeChannel) return;
    if (!window.supabaseClient) {
      setTimeout(subscribeRealtimeInventoryData, 1000);
      return;
    }

    try {
      inventoryRealtimeChannel = window.supabaseClient
        .channel('inventory_data_changes')
        .on('postgres_changes', 
          { event: '*', schema: 'public', table: 'inventory_data', filter: 'id=eq.1' },
          (payload) => {
            console.log(`⚡ Realtime: Tồn kho đã được cập nhật từ hệ thống. Đang tải lại...`);
            fetchAndRenderDashboard();
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Realtime: Đã kết nối bảng inventory_data — dữ liệu tồn kho tự động làm mới.');
          }
        });
    } catch (e) {
      console.error('❌ Realtime inventory subscription error:', e);
      inventoryRealtimeChannel = null;
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

  // 🤖 Telegram Alert Dispatcher (via Supabase Edge Function)
  async function sendTelegramAlert(message) {
    // Không còn lấy token từ trình duyệt để bảo mật
    const chatIdsStr = localStorage.getItem('alert_telegram_chat_ids') || '-1001681377844,-1001374377435';
    const chatIds = chatIdsStr.split(',').map(id => id.trim()).filter(Boolean);
    
    for (const chatId of chatIds) {
      try {
        await window.supabaseClient.functions.invoke('telegram-proxy', {
          body: {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
          }
        });
      } catch (e) {
        console.error(`Error sending Telegram alert to ${chatId} via Edge Function:`, e);
      }
    }
  }
  window.sendTelegramAlert = sendTelegramAlert;

  // ⏱️ Dynamic Data Sync Heartbeat Timers
  // Cache heartbeat DOM elements (tránh query mỗi giây)
  let _hbCache = null;
  function getHeartbeatEls() {
    if (!_hbCache) {
      _hbCache = {
        invSpan: document.querySelector('#inventory-heartbeat span:last-child'),
        invDot: document.querySelector('#inventory-heartbeat .pulse-dot'),
        inSpan: document.querySelector('#inbound-heartbeat span:last-child'),
        inDot: document.querySelector('#inbound-heartbeat .pulse-dot'),
        predSpan: document.querySelector('#prediction-heartbeat span:last-child'),
        predDot: document.querySelector('#prediction-heartbeat .pulse-dot'),
      };
    }
    return _hbCache;
  }

  let _lastHbText = {};
  window.updateHeartbeatTimers = function() {
    const fmtElapsed = (ms) => {
      if (ms == null || isNaN(ms) || ms < 0) return 'Đang cập nhật...';
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return `${sec} giây trước`;
      const min = Math.floor(sec / 60);
      const remSec = sec % 60;
      return `${min} phút ${remSec} giây trước`;
    };

    const els = getHeartbeatEls();

    // 1. Inventory Heartbeat
    if (els.invSpan && window.TONKHO_DATA && window.TONKHO_DATA.updated) {
      const invDate = parseDate(window.TONKHO_DATA.updated);
      if (invDate) {
        const diff = Date.now() - invDate.getTime();
        const txt = `Đồng bộ tồn kho: ${fmtElapsed(diff)}`;
        if (_lastHbText.inv !== txt) {
          els.invSpan.textContent = txt;
          _lastHbText.inv = txt;
        }
        if (els.invDot) {
          const cls = 'pulse-dot ' + (diff > 1800000 ? 'yellow' : 'green');
          if (els.invDot.className !== cls) els.invDot.className = cls;
        }
      }
    }

    // 2. Inbound Heartbeat
    if (els.inSpan) {
      if (window.inboundLastFetched) {
        const diff = Date.now() - window.inboundLastFetched;
        const txt = `Đồng bộ TripScan: ${fmtElapsed(diff)}`;
        if (_lastHbText.inb !== txt) {
          els.inSpan.textContent = txt;
          _lastHbText.inb = txt;
        }
        if (els.inDot) {
          const cls = 'pulse-dot ' + (diff > 120000 ? 'yellow' : 'green');
          if (els.inDot.className !== cls) els.inDot.className = cls;
        }
      } else if (!_lastHbText.inb) {
        els.inSpan.textContent = 'TripScan: Đang đồng bộ...';
        _lastHbText.inb = 'init';
      }
    }

    // 3. Prediction Heartbeat
    if (els.predSpan) {
      if (window.inboundLastFetched) {
        const diff = Date.now() - window.inboundLastFetched;
        const txt = `Bản tin dự báo: Đã đồng bộ (${fmtElapsed(diff)})`;
        if (_lastHbText.pred !== txt) {
          els.predSpan.textContent = txt;
          _lastHbText.pred = txt;
        }
        if (els.predDot) {
          const cls = 'pulse-dot ' + (diff > 120000 ? 'yellow' : 'green');
          if (els.predDot.className !== cls) els.predDot.className = cls;
        }
      } else if (!_lastHbText.pred) {
        els.predSpan.textContent = 'Dự báo: Sẵn sàng';
        _lastHbText.pred = 'init';
      }
    }
  }

  // 📊 Excel Shift Report Export using SheetJS
  function exportShiftExcelReport() {
    if (!window.TONKHO_DATA) {
      alert("Không có dữ liệu tồn kho để xuất báo cáo!");
      return;
    }
    if (!window.xlsx) {
      // Fallback check if SheetJS library is loaded
      if (typeof XLSX === 'undefined') {
        alert("Đang tải thư viện Excel. Vui lòng thử lại sau vài giây!");
        return;
      }
    }
    
    const D = window.TONKHO_DATA;
    const trips = window.tripScanData || [];
    
    // 1. Sheet 1: Tổng Quan Ca
    const totalGT24 = D.routes ? D.routes.reduce((s, r) => {
      const a = r.aging || {};
      return s + (a['4. 24-36']||0) + (a['5. 36-48']||0) + (a['6. 48-72']||0) + (a['7. 72-96']||0) + (a['8. 96-120']||0) + (a['9. 120+']||0);
    }, 0) : 0;

    const overviewData = [
      { "Chỉ Số Vận Hành": "Thời Gian Xuất Báo Cáo", "Giá Trị": new Date().toLocaleString('vi-VN') },
      { "Chỉ Số Vận Hành": "Tổng Đơn Tồn Kho Hiện Tại", "Giá Trị": D.grand_total },
      { "Chỉ Số Vận Hành": "Tồn Liên Vùng", "Giá Trị": D.destinations?.by_vung?.["Liên Vùng"] || 0 },
      { "Chỉ Số Vận Hành": "Tồn Nội Vùng", "Giá Trị": D.destinations?.by_vung?.["Nội vùng"] || 0 },
      { "Chỉ Số Vận Hành": "Tồn Nội Thành", "Giá Trị": D.destinations?.by_vung?.["Nội thành"] || 0 },
      { "Chỉ Số Vận Hành": "Hàng Tồn Trễ SLA (>24h)", "Giá Trị": totalGT24 },
      { "Chỉ Số Vận Hành": "Tổng Số Chuyến Xe Inbound Hôm Nay", "Giá Trị": trips.length },
      { "Chỉ Số Vận Hành": "Số Xe Đã Nhận (Đã Dỡ)", "Giá Trị": trips.filter(t => { const s = (t.status || '').toLowerCase(); return s === 'đã nhận' || s === 'đã giao' || s === 'received' || s === 'completed'; }).length },
      { "Chỉ Số Vận Hành": "Số Xe Đang Nhập", "Giá Trị": trips.filter(t => { const s = (t.status || '').toLowerCase(); return s === 'đang nhập' || s === 'đang xử lý' || s === 'unloading' || s === 'processing'; }).length },
      { "Chỉ Số Vận Hành": "Số Xe Đang Chờ (Seal)", "Giá Trị": trips.filter(t => { const s = (t.status || '').toLowerCase(); return s === 'đang chờ' || s === 'đăng chờ' || s === 'chờ dỡ' || s === 'waiting'; }).length }
    ];
    
    const wb = XLSX.book_new();
    const wsOverview = XLSX.json_to_sheet(overviewData);
    XLSX.book_append_sheet(wb, wsOverview, "Tổng Quan Ca");
    
    // 2. Sheet 2: Danh Sách Xe Inbound
    const inboundExcelData = trips.map(t => ({
      "Mã Chuyến": t.code || "—",
      "Biển Số": t.vehicle || "—",
      "Tải Trọng": t.capacity || "—",
      "Khung Đăng Ký (Slot)": t.slot || "—",
      "Giờ Quét Nhập": t.time || "—",
      "Trạng Thái": t.status || "—",
      "Nhân Viên Ghi Nhận": t.username || "—"
    }));
    const wsInbound = XLSX.json_to_sheet(inboundExcelData);
    XLSX.book_append_sheet(wb, wsInbound, "Chi Tiết Xe Inbound");
    
    // 3. Sheet 3: Chi Tiết Tuyến Kho
    const routesExcelData = [];
    if (D.routes) {
      D.routes.forEach(r => {
        r.children.forEach(c => {
          const a = c.aging || {};
          routesExcelData.push({
            "Nhóm Kho": r.name,
            "Tên Kho Con": c.name,
            "0-6h": a["1. 0-6"] || 0,
            "6-12h": a["2. 6-12"] || 0,
            "12-24h": a["3. 12-24"] || 0,
            "24-36h": a["4. 24-36"] || 0,
            "36-48h": a["5. 36-48"] || 0,
            "48-72h": a["6. 48-72"] || 0,
            "72-96h": a["7. 72-96"] || 0,
            "96-120h": a["8. 96-120"] || 0,
            "120h+": a["9. 120+"] || 0,
            "Tổng Tồn": c.total
          });
        });
      });
    }
    const wsRoutes = XLSX.json_to_sheet(routesExcelData);
    XLSX.book_append_sheet(wb, wsRoutes, "Tồn Chi Tiết Tuyến Kho");
    
    // Export Excel
    XLSX.writeFile(wb, `BaoCao_Ca_KTC_HCM01_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  // Setup Event Listeners and Initialise
  document.addEventListener('DOMContentLoaded', () => {
    // Initialise checkAuth
    if (window.checkAuth) {
      window.checkAuth();
    }
    
    subscribeRealtimeInventoryData();

    // 1. Tab switches
    const tabBtnInventory = document.getElementById('tab-btn-inventory');
    const tabBtnDock = document.getElementById('tab-btn-dock');
    const tabBtnPrediction = document.getElementById('tab-btn-prediction');
    const tabBtnCapacity = document.getElementById('tab-btn-capacity');
    
    const tabContentInventory = document.getElementById('tab-content-inventory');
    const tabContentDock = document.getElementById('tab-content-dock');
    const tabContentPrediction = document.getElementById('tab-content-prediction');
    const tabContentCapacity = document.getElementById('tab-content-capacity');
    
    // Theme Toggle Logic
    const themeBtn = document.getElementById('theme-toggle-btn');
    const currentTheme = localStorage.getItem('theme') || 'dark';
    if (currentTheme === 'light') {
      document.body.classList.add('light-mode');
    }
    if (themeBtn) {
      themeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        
        // Update Chart.js defaults if needed and re-render charts
        if (window.Chart) {
          window.Chart.defaults.color = isLight ? '#475569' : '#94a3b8';
          window.Chart.defaults.borderColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.06)';
          
          // Re-render main chart if function exists
          if (window.inventory && typeof window.inventory.renderCompareChart === 'function') {
            window.inventory.renderCompareChart(window.lastSelectedRouteName || 'Tất Cả Kho');
          }
        }
      });
    }
    
    // Apply transition styles to tab content containers
    [tabContentInventory, tabContentDock, tabContentPrediction, tabContentCapacity].forEach(el => {
      if (el) {
        el.style.transition = 'opacity 0.2s ease';
      }
    });

    function deactivateAllTabs() {
      // Ẩn tất cả tab ngay lập tức (không delay)
      [tabContentInventory, tabContentDock, tabContentPrediction, tabContentCapacity].forEach(el => {
        if (el) {
          el.style.opacity = '0';
          el.style.display = 'none';
        }
      });
      // Deactivate tab buttons
      document.querySelectorAll('.nav-main-tab').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      });
    }

    function activateTab(tabEl, btnEl) {
      if (tabEl) {
        tabEl.style.display = 'block';
        // Force reflow rồi fade-in
        void tabEl.offsetHeight;
        tabEl.style.opacity = '1';
      }
      if (btnEl) {
        btnEl.classList.add('active');
        btnEl.setAttribute('aria-selected', 'true');
      }
    }
    
    if (tabBtnInventory && tabBtnDock && tabBtnPrediction && tabBtnCapacity && tabContentInventory && tabContentDock && tabContentPrediction && tabContentCapacity) {
      tabBtnInventory.addEventListener('click', () => {
        deactivateAllTabs();
        activateTab(tabContentInventory, tabBtnInventory);
      });
      
      tabBtnDock.addEventListener('click', () => {
        deactivateAllTabs();
        activateTab(tabContentDock, tabBtnDock);
        if (window.tripScanData.length === 0) {
          window.inbound.fetchTripScanData();
        } else {
          window.inbound.populateInboundDates();
          window.inbound.runDockSimulation();
        }
      });

      tabBtnPrediction.addEventListener('click', () => {
        deactivateAllTabs();
        activateTab(tabContentPrediction, tabBtnPrediction);
        if (window.tripScanData.length === 0) {
          window.inbound.fetchTripScanData();
        } else {
          if (window.prediction && window.prediction.renderPredictionDashboard) {
            window.prediction.renderPredictionDashboard();
          }
        }
      });

      let capacityInitialized = false;
      tabBtnCapacity.addEventListener('click', () => {
        deactivateAllTabs();
        activateTab(tabContentCapacity, tabBtnCapacity);
        if (window.capacity) {
          if (!capacityInitialized) {
            window.capacity.initCapacity();
            capacityInitialized = true;
          }
          window.capacity.renderCapacityDashboard();
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
        // GitHub PAT handled securely via Edge Function
        
        // Load Telegram settings
        document.getElementById('telegram-chatids').value = localStorage.getItem('alert_telegram_chat_ids') || '-1001681377844,-1001374377435';
        
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
        // Save Telegram configurations first
        const teleChatIds = document.getElementById('telegram-chatids').value.trim();
        localStorage.setItem('alert_telegram_chat_ids', teleChatIds);

        const btn = document.getElementById('save-params-btn');
        btn.textContent = '⏳ Đang lưu...';
        btn.disabled = true;

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
          
          // Use Supabase Edge Function as proxy
          let sha = '';
          const { data: getRespData, error: getErr } = await window.supabaseClient.functions.invoke('github-proxy', {
            body: { url, method: 'GET' }
          });
          
          if (!getErr && getRespData && getRespData.sha) {
            sha = getRespData.sha;
          }

          const base64Content = btoa(unescape(encodeURIComponent(csvContent)));
          
          const { error: putErr } = await window.supabaseClient.functions.invoke('github-proxy', {
            body: {
              url,
              method: 'PUT',
              body: {
                message: 'chore(config): update mapping parameters via dashboard Settings UI',
                content: base64Content,
                sha: sha,
                branch: 'main'
              }
            }
          });
          
          if (putErr) {
            throw new Error(putErr.message || 'Lỗi đẩy file lên GitHub qua Edge Function.');
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

    // Initialize prediction module
    if (window.prediction && window.prediction.initPrediction) {
      window.prediction.initPrediction();
    }

    // Bind Shift Report Excel Export Button
    const exportShiftReportBtn = document.getElementById('export-shift-report-btn');
    if (exportShiftReportBtn) {
      exportShiftReportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exportShiftExcelReport();
      });
    }

    // Start Heartbeat loop
    setInterval(window.updateHeartbeatTimers, 1000);
    window.updateHeartbeatTimers();
  });

  // ── Smart Polling: Tạm dừng khi tab ẩn, refresh ngay khi quay lại ──
  let inventoryIntervalId = null;
  let inboundIntervalId = null;

  function startPolling() {
    // 1. Inventory refresh mỗi 10 phút
    if (!inventoryIntervalId) {
      inventoryIntervalId = setInterval(() => {
        if (navigator.onLine) fetchAndRenderDashboard();
      }, 600000);
    }
    // 2. Inbound trips refresh mỗi 30s (nếu tab Dock active)
    if (!inboundIntervalId) {
      inboundIntervalId = setInterval(() => {
        if (!navigator.onLine) return;
        const dockTabBtn = document.getElementById('tab-btn-dock');
        if (dockTabBtn && dockTabBtn.classList.contains('active')) {
          window.inbound.fetchTripScanData();
        }
      }, 30000);
    }
  }

  function stopPolling() {
    if (inventoryIntervalId) { clearInterval(inventoryIntervalId); inventoryIntervalId = null; }
    if (inboundIntervalId) { clearInterval(inboundIntervalId); inboundIntervalId = null; }
  }

  // Khởi động polling
  startPolling();

  // Pause khi tab ẩn, resume + refresh ngay khi tab hiện lại
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
      console.log('⏸️ Tab ẩn — tạm dừng auto-refresh.');
    } else {
      console.log('▶️ Tab hiện — khởi động lại auto-refresh.');
      startPolling();
      // Refresh ngay khi quay lại tab
      if (navigator.onLine) {
        fetchAndRenderDashboard();
        const dockTabBtn = document.getElementById('tab-btn-dock');
        if (dockTabBtn && dockTabBtn.classList.contains('active')) {
          window.inbound.fetchTripScanData();
        }
      }
    }
  });

  // Xử lý khi mất/có mạng
  window.addEventListener('online', () => {
    console.log('🌐 Đã có mạng — refresh dữ liệu.');
    fetchAndRenderDashboard();
  });
  window.addEventListener('offline', () => {
    console.log('📡 Mất mạng — tạm dừng fetch.');
  });

  // Expose global methods
  window.fetchAndRenderDashboard = fetchAndRenderDashboard;

  let compare24hChartInstance = null;
  let currentActiveTab = 'all';

  window.renderCompare24hChart = function() {
    const canvas = document.getElementById('compare24hChart');
    if (!canvas) return;

    if (!window.TONKHO_DATA || !window.TONKHO_DATA.history_24h) return;
    
    const hist = window.TONKHO_DATA.history_24h;
    const labels = hist.hours;

    // Các nhóm kho cần hiển thị
    const groups = [
      { id: 'all', title: 'Tất Cả Nhóm Kho' },
      { id: 'Kho Trung Chuyển', title: 'Kho Trung Chuyển (KTC)' },
      { id: 'Kho Chuyển Tiếp', title: 'Kho Chuyển Tiếp (KCT)' },
      { id: 'Nội vùng', title: 'Nội Vùng' },
      { id: 'Nội Thành', title: 'Nội Thành' },
      { id: 'Kho Giao Hàng Nặng', title: 'Giao Hàng Nặng' }
    ];

    // Render Tabs
    const tabsContainer = document.getElementById('chart-tabs');
    if (tabsContainer) {
      tabsContainer.innerHTML = '';
      groups.forEach(groupInfo => {
        const btn = document.createElement('button');
        btn.textContent = groupInfo.title;
        btn.style.padding = '6px 14px';
        btn.style.fontSize = '13px';
        btn.style.fontWeight = '500';
        btn.style.border = '1px solid var(--border-color)';
        btn.style.borderRadius = '20px';
        btn.style.cursor = 'pointer';
        btn.style.transition = 'all 0.2s';
        
        if (groupInfo.id === currentActiveTab) {
          btn.style.background = 'var(--accent)';
          btn.style.color = '#fff';
          btn.style.borderColor = 'var(--accent)';
        } else {
          btn.style.background = 'transparent';
          btn.style.color = 'var(--text-secondary)';
        }

        btn.onclick = () => {
          currentActiveTab = groupInfo.id;
          window.renderCompare24hChart(); // Re-render to update chart and tabs
        };

        tabsContainer.appendChild(btn);
      });
    }

    // Prepare data for currentActiveTab
    const currentData = [];
    const n1Data = [];
    let lastTodayVal = null;
    let lastN1Val = null;

    const currentHour = new Date().getHours();

    for (let i = 0; i < 24; i++) {
      const hStr = i < 10 ? '0' + i : '' + i;
      let todayVal = null;
      let n1Val = null;

      if (hist.today && hist.today[hStr]) {
        todayVal = currentActiveTab === 'all' ? (hist.today[hStr].grand_total || 0) : ((hist.today[hStr].routes && hist.today[hStr].routes[currentActiveTab]) || 0);
      }
      if (hist.n1 && hist.n1[hStr]) {
        n1Val = currentActiveTab === 'all' ? (hist.n1[hStr].grand_total || 0) : ((hist.n1[hStr].routes && hist.n1[hStr].routes[currentActiveTab]) || 0);
      }

      // Forward fill nếu dữ liệu bị khuyết, nhưng chỉ áp dụng cho giờ quá khứ/hiện tại
      if (todayVal === null && lastTodayVal !== null && i <= currentHour) todayVal = lastTodayVal;
      if (n1Val === null && lastN1Val !== null) n1Val = lastN1Val;

      // Nếu vẫn null thì gán tạm = 0 (nếu là giờ tương lai thì giữ nguyên null để không vẽ cột)
      if (todayVal === null && i <= currentHour) todayVal = 0;
      if (n1Val === null) n1Val = 0;

      if (todayVal !== null) lastTodayVal = todayVal;
      lastN1Val = n1Val;

      // Ghi đè dữ liệu realtime cho khung giờ hiện tại thay vì dùng lịch sử Git (thường bị chậm 1 nhịp)
      if (i === currentHour && window.TONKHO_DATA) {
          if (currentActiveTab === 'all') {
              todayVal = window.TONKHO_DATA.grand_total || 0;
          } else {
              // Tìm tổng của nhóm kho cụ thể từ routes array
              const route = (window.TONKHO_DATA.routes || []).find(r => r.name === currentActiveTab);
              if (route) todayVal = route.total || 0;
          }
      }

      currentData.push(todayVal);
      n1Data.push(n1Val);
    }

    if (compare24hChartInstance) {
      compare24hChartInstance.destroy();
    }

    compare24hChartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            type: 'bar',
            label: 'Hôm nay',
            data: currentData,
            backgroundColor: 'rgba(251, 146, 60, 0.8)',
            borderColor: '#fb923c',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            type: 'line',
            label: 'Hôm qua (N-1)',
            data: n1Data,
            backgroundColor: 'transparent',
            borderColor: '#94a3b8',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: '#1e293b',
            borderDash: [5, 5]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { color: '#94a3b8', font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.parsed.y !== null) label += new Intl.NumberFormat('vi-VN').format(context.parsed.y);
                return label;
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: '#334155' } },
          y: { beginAtZero: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
        }
      }
    });

    // ----------------------------------------------------
    // AI Analyst Generation
    // ----------------------------------------------------
    const insightPanel = document.getElementById('ai-insight-panel');
    const insightText = document.getElementById('ai-insight-text');
    if (insightPanel && insightText) {
      try {
        let insight = "";
        const currentHour = new Date().getHours();
        
        let currentTdn = currentData[currentHour] || 0;
        let n1Tdn = n1Data[currentHour] || 0;
        let trendText = "tương đương";
        
        if (currentTdn > n1Tdn * 1.05) {
            let pct = Math.round((currentTdn - n1Tdn) / n1Tdn * 100);
            trendText = `<span style="color:#ef4444;font-weight:600;">cao hơn ${pct}%</span> so với cùng kỳ hôm qua`;
        } else if (currentTdn < n1Tdn * 0.95) {
            let pct = Math.round((n1Tdn - currentTdn) / n1Tdn * 100);
            trendText = `<span style="color:#10b981;font-weight:600;">thấp hơn ${pct}%</span> so với cùng kỳ hôm qua (tín hiệu tốt)`;
        } else {
            trendText = "ở mức ổn định, tương đương hôm qua";
        }
        
        insight += `📌 <b>Hiện tại:</b> Tồn kho lúc này đang <b>${trendText}</b>. `;

        let maxVal = -1;
        let maxHour = -1;
        for(let i=0; i<=currentHour; i++) {
            if (currentData[i] !== null && currentData[i] > maxVal) {
                maxVal = currentData[i];
                maxHour = i;
            }
        }
        if (maxHour !== -1 && maxVal > 0) {
            let hStr = maxHour < 10 ? '0'+maxHour+':00' : maxHour+':00';
            insight += `Đỉnh tồn kho ghi nhận là <b>${new Intl.NumberFormat('vi-VN').format(maxVal)}</b> đơn (vào lúc ${hStr}). `;
        }

        if (currentHour < 22 && n1Data[currentHour+2] !== null) {
            let diffN1 = n1Data[currentHour+2] - n1Tdn; 
            if (diffN1 > n1Tdn * 0.05) {
                 insight += `<br/><br/>🚀 <b>Dự báo AI:</b> Cảnh báo lượng tồn có dấu hiệu sẽ <b>tăng tiếp</b> trong 2 giờ tới (theo chu kỳ dữ liệu hôm qua). Yêu cầu ưu tiên đẩy mạnh Outbound!`;
            } else if (diffN1 < -n1Tdn * 0.05) {
                 insight += `<br/><br/>📉 <b>Dự báo AI:</b> Tồn kho dự kiến sẽ <b>hạ nhiệt</b> và giảm dần trong 2 giờ tới, các tuyến sẽ dần được giải tỏa.`;
            } else {
                 insight += `<br/><br/>➡️ <b>Dự báo AI:</b> Tồn kho dự kiến sẽ duy trì nhịp độ đi ngang trong 2 giờ tiếp theo.`;
            }
        }

        // Fetch AI Report from system_secrets
        window.supabase.from('system_secrets').select('value').eq('key', 'latest_ai_report').single()
        .then(({ data, error }) => {
            if (data && data.value) {
                let aiReportHTML = data.value.replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                insight += `<br/><br/><div style="padding-top: 12px; border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 12px; color: var(--green);"><b>Bê "Não AI" Lên Web Dashboard (AI Insights on Web)</b><br/>${aiReportHTML}</div>`;
            }
            insightText.innerHTML = insight;
            insightPanel.style.display = 'block';
        })
        .catch(e => {
            insightText.innerHTML = insight;
            insightPanel.style.display = 'block';
        });
      } catch (e) {
        console.error("Lỗi khi tạo AI Insight:", e);
      }
    }
  }

})();
