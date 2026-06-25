/* ═══════════════════════════════════════════════════
   inventory.js — Inventory Dashboard Rendering
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  const AGING_KEYS = ['1. 0-6', '2. 6-12', '3. 12-24', '4. 24-36', '5. 36-48', '6. 48-72', '7. 72-96', '8. 96-120', '9. 120+'];

  const fmt = n => n != null ? n.toLocaleString('vi-VN') : '0';
  const pct = (n, t) => t ? ((n / t) * 100).toFixed(1) + '%' : '0%';
  
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

  function agingClass(key, val) {
    if (!val) return '';
    const idx = AGING_KEYS.indexOf(key);
    if (idx <= 1) return 'aging-safe';
    if (idx <= 3) return 'aging-warn';
    return 'aging-danger';
  }

  function toggleGroup(gi) {
    const rows = document.querySelectorAll('.group-' + gi);
    const toggle = document.getElementById('toggle-' + gi);
    if (!rows.length) return;
    const hidden = rows[0].style.display === 'none';
    rows.forEach(r => r.style.display = hidden ? '' : 'none');
    if (toggle) {
      toggle.textContent = hidden ? '▼' : '▶';
      toggle.classList.toggle('collapsed', !hidden);
    }
  }

  // Calculate top risks (>24h aging orders) across all routes and children hubs
  function getTopRisks(routes) {
    const risks = [];
    if (!routes) return risks;

    routes.forEach(route => {
      if (!route.children) return;
      route.children.forEach(child => {
        const a = child.aging || {};
        // Sum aging buckets > 24h (buckets 4 to 9)
        const overdueCount = (a['4. 24-36']||0) + (a['5. 36-48']||0) + (a['6. 48-72']||0) + (a['7. 72-96']||0) + (a['8. 96-120']||0) + (a['9. 120+']||0);
        
        if (overdueCount > 0) {
          // Identify most severe bucket
          let severeBucket = '24-36h';
          for (let i = AGING_KEYS.length - 1; i >= 3; i--) {
            if (a[AGING_KEYS[i]] > 0) {
              severeBucket = AGING_KEYS[i].replace(/^\d+\.\s*/, '') + 'h';
              break;
            }
          }
          
          risks.push({
            name: child.name,
            shortName: child.short_name || child.name,
            groupName: route.name,
            overdueCount: overdueCount,
            severeBucket: severeBucket,
            total: child.total
          });
        }
      });
    });

    // Sort descending by overdue count
    return risks.sort((a, b) => b.overdueCount - a.overdueCount);
  }

  // Render the new "Action Insights / Top Risks" panel
  function renderActionInsights(containerId, routes) {
    const panel = document.getElementById(containerId);
    if (!panel) return;

    const risks = getTopRisks(routes);
    const totalOverdue = risks.reduce((sum, r) => sum + r.overdueCount, 0);

    if (totalOverdue === 0) {
      panel.style.display = 'block';
      panel.innerHTML = `
        <div class="action-insights-card success">
          <div class="insights-title">
            <span class="badge success">✔ Vận Hành Ổn Định</span>
            <h3>Trạng Thái Tồn Kho Hiện Tại</h3>
          </div>
          <div class="insights-content">
            <p>Tuyệt vời! Không phát hiện tuyến hàng hoặc bưu cục nào bị ùn ứ tồn đọng trên 24 giờ. Toàn bộ dòng chảy hàng hoá đang được luân chuyển đúng SLA.</p>
          </div>
        </div>
      `;
      return;
    }

    panel.style.display = 'block';

    // Build top 5 risks rows
    const topRisks = risks.slice(0, 5);
    const tableRows = topRisks.map(r => `
      <tr class="clickable" onclick="window.openDrilldown(event, 'child', '${escapeHTML(r.groupName).replace(/'/g, "\\'")}', '${escapeHTML(r.shortName).replace(/'/g, "\\'")}', '>24H')">
        <td style="text-align: left; font-weight: 500; color: var(--text-primary); padding-left: 10px;">${escapeHTML(r.shortName)}</td>
        <td style="text-align: left; color: var(--text-secondary);">${escapeHTML(r.groupName)}</td>
        <td style="text-align: right; font-weight: 700; color: var(--red); font-family: 'JetBrains Mono', monospace;">${fmt(r.overdueCount)}</td>
        <td style="text-align: right; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;"><span class="badge danger">${r.severeBucket}</span></td>
      </tr>
    `).join('');

    // Generate dynamic priority recommendations
    const recommendations = topRisks.map((r, i) => {
      let icon = i === 0 ? '🚨' : i === 1 ? '⚠️' : '⚡';
      let priorityClass = i === 0 ? 'priority-high' : i === 1 ? 'priority-med' : 'priority-low';
      
      return `
        <div class="rec-item ${priorityClass}">
          <span class="rec-icon">${icon}</span>
          <div class="rec-details">
            <div class="rec-title">Ưu tiên ${i + 1}: Hỗ trợ tuyến ${escapeHTML(r.shortName)}</div>
            <div class="rec-text">
              Tuyến <strong>${escapeHTML(r.shortName)}</strong> thuộc nhóm <em>${escapeHTML(r.groupName)}</em> đang dồn <strong>${fmt(r.overdueCount)} đơn</strong> hàng quá 24h. 
              Mốc trễ lớn nhất ghi nhận: <span class="text-danger">${r.severeBucket}</span>. Đề xuất ưu tiên dỡ tải/bố trí xe vận chuyển gấp.
            </div>
          </div>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <div class="action-insights-grid">
        <!-- Table Column -->
        <div class="action-insights-card">
          <div class="insights-title">
            <span class="badge danger">RỦI RO CAO</span>
            <h3>Top 5 Tuyến Kho Tồn Lâu (>24h)</h3>
          </div>
          <div class="table-wrapper">
            <table class="pivot-table" style="font-size: 0.76rem; width: 100%;">
              <thead>
                <tr>
                  <th style="text-align: left; padding-left: 10px;">Tuyến / Kho</th>
                  <th style="text-align: left;">Loại Kho</th>
                  <th style="text-align: right; color: var(--red);">Tồn > 24h</th>
                  <th style="text-align: right;">Trễ Nhất</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recommendations Column -->
        <div class="action-insights-card">
          <div class="insights-title">
            <span class="badge info">AI RECOMMENDATIONS</span>
            <h3>Khuyến Nghị Điều Phối Ưu Tiên</h3>
          </div>
          <div class="rec-container">
            ${recommendations}
          </div>
        </div>
      </div>
    `;
  }

  function getHeatmapStyle(key, val, maxVal) {
    if (!val) return '';
    const idx = AGING_KEYS.indexOf(key);
    if (idx < 3) return ''; // Bỏ qua dải dưới 24h
    const opacity = Math.min(0.75, 0.12 + (val / maxVal) * 0.6);
    return `style="background-color: rgba(248, 113, 113, ${opacity}) !important; color: #fff !important; font-weight: 600;"`;
  }

  // Main render entry point
  function renderDashboard(filterType) {
    const currentRaw = window.TONKHO_DATA;
    if (!currentRaw) return;

    let D = currentRaw;
    if (currentRaw[filterType]) {
      D = currentRaw[filterType];
    } else if (filterType !== 'all') {
      D = { grand_total: 0, routes: [], destinations: {} };
    }

    // 1. Render new Action Insights panel
    renderActionInsights('action-insights-panel', D.routes);

    // 2. Render KPI Cards
    const vung = D.destinations?.by_vung || {};
    const totalGT24 = D.routes ? D.routes.reduce((s, r) => {
      const a = r.aging || {};
      return s + (a['4. 24-36']||0) + (a['5. 36-48']||0) + (a['6. 48-72']||0) + (a['7. 72-96']||0) + (a['8. 96-120']||0) + (a['9. 120+']||0);
    }, 0) : 0;

    // Removed Telegram Auto Alert logic per user request

    const kpis = [
      { label: 'Tổng Đơn Tồn', value: fmt(D.grand_total), sub: (D.routes ? D.routes.length : 0) + ' nhóm kho', colorClass: 'primary' },
      { label: 'Liên Vùng', value: fmt(vung['Liên Vùng']||0), sub: pct(vung['Liên Vùng']||0, D.grand_total) + ' tổng', colorClass: 'blue' },
      { label: 'Nội Vùng', value: fmt(vung['Nội vùng']||0), sub: pct(vung['Nội vùng']||0, D.grand_total) + ' tổng', colorClass: 'green' },
      { label: 'Nội Thành', value: fmt(vung['Nội thành']||0), sub: pct(vung['Nội thành']||0, D.grand_total) + ' tổng', colorClass: 'purple' },
      { label: 'Tồn > 24h', value: fmt(totalGT24), sub: pct(totalGT24, D.grand_total) + ' trễ SLA', colorClass: 'red' },
    ];

    const kpiGrid = document.getElementById('kpi-grid');
    if (kpiGrid) {
      kpiGrid.innerHTML = ''; 
      kpis.forEach((k, i) => {
        const card = document.createElement('div');
        card.className = `kpi-card animate-in delay-${i + 1}`;
        card.innerHTML = `
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value ${k.colorClass}">${k.value}</div>
          <div class="kpi-sub">${k.sub}</div>`;
        kpiGrid.appendChild(card);
      });
    }

    // Calculate maximum overdue cell value for heatmap scaling
    let maxOverdueVal = 1;
    if (D.routes) {
      D.routes.forEach(route => {
        AGING_KEYS.slice(3).forEach(k => {
          const v = (route.aging || {})[k] || 0;
          if (v > maxOverdueVal) maxOverdueVal = v;
        });
        route.children.forEach(child => {
          AGING_KEYS.slice(3).forEach(k => {
            const v = (child.aging || {})[k] || 0;
            if (v > maxOverdueVal) maxOverdueVal = v;
          });
        });
      });
    }

    // 3. Render Pivot Table
    const tbody = document.getElementById('pivot-body');
    if (tbody) {
      tbody.innerHTML = ''; 
      if (D.routes && D.routes.length > 0) {
        D.routes.forEach((route, ri) => {
          // Parent row
          const pr = document.createElement('tr');
          pr.className = 'group-parent';
          pr.dataset.group = ri;
          let cells = `<td><span class="group-toggle" id="toggle-${ri}">▼</span> ${escapeHTML(route.name)}</td>`;
                      AGING_KEYS.forEach(k => {
              const v = (route.aging || {})[k] || 0;
              const heatStyle = getHeatmapStyle(k, v, maxOverdueVal);
              if (v > 0) {
                const safeName = escapeHTML(route.name).replace(/'/g, "\'");
                cells += `<td class="${agingClass(k, v)} clickable" ${heatStyle} onclick="window.openDrilldown(event, 'group', '${safeName}', null, '${k}')">${fmt(v)}</td>`;
              } else {
                cells += `<td class="zero" ${heatStyle}>—</td>`;
              }
            });
          cells += `<td>${fmt(route.total)}</td>`;
          pr.innerHTML = cells;
          pr.addEventListener('click', () => toggleGroup(ri));
          tbody.appendChild(pr);

          // Children rows
          route.children.forEach(child => {
            const cr = document.createElement('tr');
            cr.className = 'group-child group-' + ri;
            let cc = `<td>${escapeHTML(child.short_name || child.name)}</td>`;
            AGING_KEYS.forEach(k => {
              const v = (child.aging || {})[k] || 0;
              const heatStyle = getHeatmapStyle(k, v, maxOverdueVal);
              if (v > 0) {
                const safeGroupName = escapeHTML(route.name).replace(/'/g, "\\'");
                const safeChildName = escapeHTML(child.short_name || child.name).replace(/'/g, "\\'");
                cc += `<td class="${agingClass(k, v)} clickable" ${heatStyle} onclick="window.openDrilldown(event, 'child', '${safeGroupName}', '${safeChildName}', '${k}')">${fmt(v)}</td>`;
              } else {
                cc += `<td class="zero" ${heatStyle}>—</td>`;
              }
            });
            cc += `<td>${fmt(child.total)}</td>`;
            cr.innerHTML = cc;
            tbody.appendChild(cr);
          });
        });

        // Grand total row
        const gtr = document.createElement('tr');
        gtr.className = 'grand-total';
        let gtCells = '<td>Grand Total</td>';
        AGING_KEYS.forEach(k => {
          const v = D.routes.reduce((s, r) => s + ((r.aging || {})[k] || 0), 0);
          gtCells += `<td>${fmt(v)}</td>`;
        });
        gtCells += `<td>${fmt(D.grand_total)}</td>`;
        gtr.innerHTML = gtCells;
        tbody.appendChild(gtr);
      } else {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted);font-family:\'Inter\',sans-serif">Không có đơn hàng nào thuộc nhóm này</td></tr>';
      }
    }

    // 4. Populate Mobile Cards
    const mobileContainer = document.getElementById('mobile-cards-container');
    if (mobileContainer) {
      mobileContainer.innerHTML = '';
      if (D.routes && D.routes.length > 0) {
        D.routes.forEach(route => {
          const card = document.createElement('div');
          card.className = 'mobile-card';
          
          const a = route.aging || {};
          const critical = (a['4. 24-36']||0) + (a['5. 36-48']||0) + (a['6. 48-72']||0) + (a['7. 72-96']||0) + (a['8. 96-120']||0) + (a['9. 120+']||0);
          
          card.innerHTML = `
            <div class="mobile-card-header">
              <span class="mobile-card-title">${escapeHTML(route.name)}</span>
              <span class="mobile-card-total">${fmt(route.total)}</span>
            </div>
            <div class="mobile-card-grid">
              <div class="mobile-card-item">
                <div class="mobile-card-label">0 - 12h</div>
                <div class="mobile-card-value">${fmt((a['1. 0-6']||0) + (a['2. 6-12']||0))}</div>
              </div>
              <div class="mobile-card-item">
                <div class="mobile-card-label">12 - 24h</div>
                <div class="mobile-card-value">${fmt(a['3. 12-24']||0)}</div>
              </div>
              <div class="mobile-card-item">
                <div class="mobile-card-label">> 24h (Trễ)</div>
                <div class="mobile-card-value${critical > 0 ? ' highlight' : ''}">${fmt(critical)}</div>
              </div>
            </div>
          `;
          mobileContainer.appendChild(card);
        });
      } else {
        mobileContainer.innerHTML = '<div style="text-align:center;padding:25px;color:var(--text-muted);font-size:0.75rem;">Không có đơn hàng nào thuộc nhóm này</div>';
      }
    }

    // 5. Render SVG Donut Chart
    if (window.charts && window.charts.renderDonutChart) {
      window.charts.renderDonutChart('donut-group', D.routes, D.grand_total);
    }

    // 6. Render CSS Bar Chart
    if (window.charts && window.charts.renderAgingBars) {
      window.charts.renderAgingBars('aging-bars', D.routes, AGING_KEYS, D.grand_total);
    }

    // 7. Render Under 3h Origins Table
    const under3hBody = document.getElementById('under3h-body');
    const badgeEl = document.getElementById('under3h-total-badge');
    if (badgeEl) {
      badgeEl.textContent = fmt(D.total_under_3h || 0);
    }
    if (under3hBody) {
      under3hBody.innerHTML = '';
      const under3hData = D.under_3h_origins || [];
      const totalUnder3h = D.total_under_3h || 0;
      
      if (totalUnder3h > 0 && under3hData.length > 0) {
        under3hData.forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="text-align: left; padding: 6px 10px; font-family: 'Inter', sans-serif;">${escapeHTML(item.province)}</td>
            <td style="text-align: right; padding: 6px 10px; font-weight: 600; color: var(--text-primary); font-family: 'JetBrains Mono', monospace;">${fmt(item.count)}</td>
            <td style="text-align: right; padding: 6px 10px; color: var(--text-muted); font-size: 0.7rem; font-family: 'JetBrains Mono', monospace;">${item.pct.toFixed(1)}%</td>
          `;
          under3hBody.appendChild(tr);
        });
      } else {
        under3hBody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted);font-family:\'Inter\',sans-serif">Không có hàng tồn < 3h</td></tr>';
      }
    }

    // 8. Render Destination detail cards
    const destGrid = document.getElementById('dest-grid');
    if (destGrid) {
      destGrid.innerHTML = ''; 
      if (D.routes && D.routes.length > 0) {
        D.routes.forEach((route, ri) => {
          const card = document.createElement('div');
          card.className = 'dest-card animate-in';
          card.style.animationDelay = (0.05 + ri * 0.03) + 's';

          const childrenSorted = [...route.children].sort((a, b) => b.total - a.total);
          const childrenHtml = childrenSorted.map(c => `
            <div class="dest-row">
              <span class="name">${escapeHTML(c.short_name || c.name)}</span>
              <span class="count">${fmt(c.total)}</span>
              <span class="pct">${pct(c.total, route.total)}</span>
            </div>`).join('');

          card.innerHTML = `
            <div class="dest-card-header">
              <h3>${escapeHTML(route.name)}</h3>
              <span class="total">${fmt(route.total)}</span>
            </div>
            <div class="dest-list">${childrenHtml}</div>`;
          destGrid.appendChild(card);
        });
      }
    }
  }

  // Clear dashboard visuals on logout
  function clearDashboardData() {
    const panel = document.getElementById('action-insights-panel');
    if (panel) panel.style.display = 'none';

    const kpiGrid = document.getElementById('kpi-grid');
    if (kpiGrid) kpiGrid.innerHTML = '';

    const tbody = document.getElementById('pivot-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text-muted);">Vui lòng đăng nhập</td></tr>';

    const donutEl = document.getElementById('donut-group');
    if (donutEl) donutEl.innerHTML = '';

    const agingEl = document.getElementById('aging-bars');
    if (agingEl) agingEl.innerHTML = '';

    const under3hBody = document.getElementById('under3h-body');
    if (under3hBody) under3hBody.innerHTML = '';

    const destGrid = document.getElementById('dest-grid');
    if (destGrid) destGrid.innerHTML = '';
  }

  // Expose global methods
  window.renderDashboard = renderDashboard;
  window.clearDashboardData = clearDashboardData;


  // ==========================================
  // DRILL-DOWN LOGIC
  // ==========================================
  let cachedRawOrders = null;
  
  async function fetchRawOrders() {
    if (cachedRawOrders) return cachedRawOrders;
    
    if (!window.supabaseClient) {
      alert("⚠️ Supabase client is not ready. Vui lòng thử lại sau.");
      return null;
    }
    
    const loadingEl = document.getElementById('drilldown-loading');
    const tableWrapper = document.getElementById('drilldown-table-wrapper');
    if (loadingEl) loadingEl.style.display = 'block';
    if (tableWrapper) tableWrapper.style.display = 'none';

    try {
      const { data, error } = await window.supabaseClient
        .storage
        .from('reports')
        .createSignedUrl('raw_orders.json', 300);

      if (error) throw error;
      
      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error("Lỗi tải file JSON (" + response.status + ")");
      const json = await response.json();
      cachedRawOrders = json;
      return json;
    } catch (err) {
      console.error("Lỗi tải dữ liệu chi tiết:", err);
      if (loadingEl) loadingEl.innerHTML = `<span style="color:var(--red);">❌ Lỗi tải dữ liệu: ${err.message}</span>`;
      return null;
    }
  }

  window.openDrilldown = async function(e, type, groupName, childName, agingKey) {
    if (e) e.stopPropagation();
    
    const modal = document.getElementById('drilldown-modal');
    if (!modal) return;
    
    modal.style.display = 'flex';
    document.getElementById('drilldown-title').innerText = `Chi Tiết: ${childName || groupName} (${agingKey})`;
    document.getElementById('drilldown-loading').style.display = 'block';
    document.getElementById('drilldown-table-wrapper').style.display = 'none';
    document.getElementById('export-drilldown-btn').style.display = 'none';
    document.getElementById('drilldown-count').innerText = '';
    
    const rawData = await fetchRawOrders();
    if (!rawData || !rawData.data) return;
    
    const idxAging = rawData.columns.indexOf('Nhóm Thời Gian');
    const idxLoaiKho = rawData.columns.indexOf('Loại Kho');
    const idxKhoDen = rawData.columns.indexOf('Kho Đến');
    const idxHours = rawData.columns.indexOf('Giờ Tồn');
    
    let filtered = rawData.data.filter(row => {
      let isAgingMatch = false;
      if (agingKey === '>24H') {
         isAgingMatch = row[idxAging] && row[idxAging].match(/^[4-9]\./);
      } else {
         isAgingMatch = row[idxAging] === agingKey;
      }
      if (!isAgingMatch) return false;
      
      if (type === 'group') {
        return row[idxLoaiKho] === groupName;
      } else {
        return row[idxLoaiKho] === groupName && row[idxKhoDen] === childName;
      }
    });
    
    filtered.sort((a, b) => b[idxHours] - a[idxHours]);
    
    const thead = document.getElementById('drilldown-thead');
    const tbody = document.getElementById('drilldown-tbody');
    
    thead.innerHTML = '<tr>' + rawData.columns.map(c => `<th style="padding: 8px; border-bottom: 1px solid var(--border);">${c}</th>`).join('') + '</tr>';
    tbody.innerHTML = filtered.map(row => 
      '<tr>' + row.map((val, i) => {
        let align = (i === idxHours) ? 'right' : 'left';
        return `<td style="text-align: ${align}; padding: 6px 10px; font-size: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05);">${val}</td>`;
      }).join('') + '</tr>'
    ).join('');
    
    document.getElementById('drilldown-loading').style.display = 'none';
    document.getElementById('drilldown-table-wrapper').style.display = 'block';
    document.getElementById('drilldown-count').innerText = `Tổng cộng: ${filtered.length.toLocaleString('vi-VN')} đơn hàng`;
    
    const exportBtn = document.getElementById('export-drilldown-btn');
    exportBtn.style.display = 'block';
    exportBtn.onclick = () => {
      const originalText = exportBtn.innerHTML;
      exportBtn.innerHTML = '⏳ Đang tạo Excel...';
      exportBtn.style.pointerEvents = 'none';
      
      setTimeout(() => {
        try {
          const ws_data = [rawData.columns, ...filtered];
          const ws = window.XLSX.utils.aoa_to_sheet(ws_data);
          const wb = window.XLSX.utils.book_new();
          window.XLSX.utils.book_append_sheet(wb, ws, "Chi_Tiet");
          window.XLSX.writeFile(wb, `ChiTiet_${childName || groupName}_${agingKey}.xlsx`);
        } catch (err) {
          console.error(err);
          alert("Lỗi xuất Excel: " + err.message);
        } finally {
          exportBtn.innerHTML = originalText;
          exportBtn.style.pointerEvents = 'auto';
        }
      }, 50);
    };
  };

  // Close modal
  const attachModalHandlers = () => {
    const closeBtn = document.getElementById('close-drilldown-btn');
    if (closeBtn) {
      closeBtn.onclick = () => { document.getElementById('drilldown-modal').style.display = 'none'; };
    }
    const modal = document.getElementById('drilldown-modal');
    if (modal) {
      modal.onclick = (e) => { if(e.target.id === 'drilldown-modal') e.target.style.display = 'none'; };
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachModalHandlers);
  } else {
    attachModalHandlers();
  }


})();
