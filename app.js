/* GHN OPS Dashboard - Main Application */
const APP = { fleet: {}, inventory_alerts: [], inventory: [], postoffices: [], hierarchy_inventory: [], charts: {} };

// ===== DATA LOADING =====
async function loadJSON(name) {
    try {
        const r = await fetch(`${name}.json?t=${Date.now()}`);
        if (!r.ok) return name === 'fleet' ? {} : [];
        return await r.json();
    } catch (e) {
        return name === 'fleet' ? {} : [];
    }
}

async function initApp() {
    try {
        [APP.fleet, APP.inventory_alerts, APP.inventory, APP.hierarchy_inventory] = await Promise.all(
            ['fleet', 'inventory_alerts', 'inventory_data', 'hierarchy_inventory'].map(loadJSON)
        );
        // Build post office list from fleet data
        buildPostOfficeData();
        setupNav();
        setupDate();
        renderOverview();
        generateAlerts();
        populateFilters();
        // Build global search index after all data is ready
        if (window._rebuildSearchIndex) window._rebuildSearchIndex();
    } catch (e) { console.error('Load error:', e); }
}


// ===== BUILD POST OFFICE DATA =====
function buildPostOfficeData() {
    const seen = new Set();
    APP.postoffices = [];
    Object.values(APP.fleet).forEach(stops => {
        stops.forEach(s => {
            const name = s.diem_dung || '';
            if (!name || seen.has(name)) return;
            seen.add(name);
            // Extract tỉnh from name like "Bưu Cục xxx-Tỉnh" 
            const parts = name.split('-');
            const tinh = parts.length > 1 ? parts[parts.length - 1].trim() : 'Khác';
            const quan = parts.length > 2 ? parts[parts.length - 2].trim() : '';
            APP.postoffices.push({ buu_cuc: name, tinh: tinh, quan: quan, tuyen: s.tuyen });
        });
    });
}

// ===== NAVIGATION =====
function setupNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            item.classList.add('active');
            const page = item.dataset.page;
            document.getElementById(`page-${page}`).classList.add('active');
            const titles = { overview:'KTC Hồ Chí Minh 01', fleet:'Lịch xe tải', inventory:'Tồn kho (PV)', alerts:'Cảnh báo Vận hành' };
            document.getElementById('pageTitle').textContent = titles[page] || '';
            if (page === 'fleet') renderFleetPage();
            if (page === 'inventory') renderInventoryPage();
            if (page === 'alerts') renderAlertsPage();
        });
    });
    document.getElementById('menuToggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });
    document.getElementById('refreshBtn').addEventListener('click', () => location.reload());
}

function setupDate() {
    const d = new Date();
    const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
    document.getElementById('currentDate').textContent = d.toLocaleDateString('vi-VN', opts);
}

// ===== UTILITIES =====
function fmt(n) { return n != null ? n.toLocaleString('vi-VN') : '—'; }
function pct(n) { return n != null ? (n * 100).toFixed(1) + '%' : '—'; }

// ===== OVERVIEW PAGE =====
function renderOverview() {
    // KPIs
    document.getElementById('kpi-total-bc').textContent = APP.postoffices.length;
    document.getElementById('kpi-total-routes').textContent = Object.keys(APP.fleet).length;

    // Inventory summary chart
    renderInventorySummaryChart();
    renderHierarchyInventoryTable();
}

function renderInventorySummaryChart() {
    const data = APP.inventory || [];
    if (!data.length) return;

    // Get top 10 kho by total
    const top10 = [...data].sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 10);
    
    if (APP.charts.inventorySummary) APP.charts.inventorySummary.destroy();
    const el = document.getElementById('chartInventorySummary');
    if (!el) return;
    
    APP.charts.inventorySummary = new Chart(el, {
        type: 'bar',
        data: {
            labels: top10.map(r => {
                const name = r.kho || '';
                return name.length > 25 ? name.slice(0, 25) + '…' : name;
            }),
            datasets: [{
                label: 'Tổng tồn kho',
                data: top10.map(r => r.total || 0),
                backgroundColor: top10.map(r => (r.total || 0) > 3000 ? '#ef4444' : (r.total || 0) > 1000 ? '#eab308' : '#22c55e'),
                borderRadius: 6,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.8,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#64748b', callback: v => v.toLocaleString() }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } }
            }
        }
    });
}

function renderHierarchyInventoryTable() {
    const el = document.getElementById('tableHierarchyInventory');
    if (!el) return;
    
    const data = APP.hierarchy_inventory || [];
    if (!data.length) {
        el.innerHTML = '<div class="empty-state">Chưa có dữ liệu tồn kho theo nhóm.</div>';
        return;
    }

    let html = `
    <table class="data-table">
        <thead>
            <tr>
                <th>Nhóm Tuyến / Điểm nhận hàng</th>
                <th class="text-right">Tổng tồn kho</th>
                <th class="text-right" style="color:#60a5fa;">Normal</th>
                <th class="text-right" style="color:#f59e0b;">Bulky</th>
                <th class="text-right" style="color:#a78bfa;">Freight</th>
                <th class="text-right">Trạng thái</th>
            </tr>
        </thead>
        <tbody>
    `;

    data.forEach(group => {
        const gNorm = group.normal || 0, gBulk = group.bulky || 0, gFreight = group.freight || 0;
        // Parent Row
        html += `
            <tr class="row-parent" style="background: rgba(255,255,255,0.03);">
                <td style="font-weight: 700; color: var(--accent);"><i class="fas fa-folder-open"></i> ${group.name}</td>
                <td class="text-right" style="font-weight: 700; color: #fff;">${fmt(group.total)}</td>
                <td class="text-right" style="color:#60a5fa; font-weight:600;">${gNorm > 0 ? fmt(gNorm) : '—'}</td>
                <td class="text-right" style="color:#f59e0b; font-weight:600;">${gBulk > 0 ? fmt(gBulk) : '—'}</td>
                <td class="text-right" style="color:#a78bfa; font-weight:600;">${gFreight > 0 ? fmt(gFreight) : '—'}</td>
                <td class="text-right"><span class="chart-tag tag-info">Tổng nhóm</span></td>
            </tr>
        `;

        // Child Rows
        if (group.children && group.children.length > 0) {
            group.children.forEach(child => {
                const badgeClass = child.total > 1000 ? 'tag-warning' : 'tag-success';
                const cNorm = child.normal || 0, cBulk = child.bulky || 0, cFreight = child.freight || 0;
                html += `
                    <tr class="row-child">
                        <td style="padding-left: 30px; color: #cbd5e1;"><i class="fas fa-caret-right" style="margin-right: 8px; color: #64748b;"></i> ${child.name}</td>
                        <td class="text-right" style="color: #fff;">${fmt(child.total)}</td>
                        <td class="text-right" style="color:#93c5fd;">${cNorm > 0 ? fmt(cNorm) : '—'}</td>
                        <td class="text-right" style="color:#fcd34d;">${cBulk > 0 ? fmt(cBulk) : '—'}</td>
                        <td class="text-right" style="color:#c4b5fd;">${cFreight > 0 ? fmt(cFreight) : '—'}</td>
                        <td class="text-right"><span class="chart-tag ${badgeClass}">${child.total > 0 ? 'Có tồn' : 'Trống'}</span></td>
                    </tr>
                `;
            });
        }
    });

    html += `</tbody></table>`;
    el.innerHTML = html;
}

// ===== FLEET PAGE =====
function renderFleetPage(groupFilter, search) {
    const groups = Object.keys(APP.fleet);
    // Summary
    let totalStops = 0, totalRoutes = new Set();
    groups.forEach(g => { APP.fleet[g].forEach(s => { totalStops++; totalRoutes.add(s.tuyen); }); });
    document.getElementById('fleetSummary').innerHTML = `
        <div class="fleet-stat">
            <div class="fleet-stat-icon" style="color: var(--blue)"><i class="fas fa-layer-group"></i></div>
            <div>
                <div class="fleet-stat-val">${groups.length}</div>
                <div class="fleet-stat-label">Nhóm tuyến</div>
            </div>
        </div>
        <div class="fleet-stat">
            <div class="fleet-stat-icon" style="color: var(--accent)"><i class="fas fa-route"></i></div>
            <div>
                <div class="fleet-stat-val">${totalRoutes.size}</div>
                <div class="fleet-stat-label">Tuyến xe</div>
            </div>
        </div>
        <div class="fleet-stat">
            <div class="fleet-stat-icon" style="color: var(--green)"><i class="fas fa-map-marker-alt"></i></div>
            <div>
                <div class="fleet-stat-val">${fmt(totalStops)}</div>
                <div class="fleet-stat-label">Tổng điểm dừng</div>
            </div>
        </div>
    `;

    let filtered = groupFilter ? { [groupFilter]: APP.fleet[groupFilter] } : APP.fleet;
    let html = '';
    Object.entries(filtered).forEach(([group, stops]) => {
        let groupHasMatch = false;
        let groupHtml = `<div class="fleet-group-card">
            <div class="fleet-group-header">
                <div class="fleet-group-title"><i class="fas fa-folder-open" style="color:var(--accent);"></i> Nhóm/COT: <strong>${group.trim() || 'Khác'}</strong></div>
                <div class="fleet-group-count">${stops.length} điểm dừng</div>
            </div>
            <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Tuyến xe</th><th>Tải trọng (kg)</th><th>Kho/Điểm dừng</th><th>Loại hình</th><th><i class="far fa-clock"></i> Giờ đến</th><th><i class="far fa-clock"></i> Giờ rời (COT)</th></tr></thead><tbody>`;
        
        let stopsHtml = '';
        stops.forEach((s, i) => {
            if (search && !s.tuyen.toLowerCase().includes(search.toLowerCase()) && !(s.diem_dung || '').toLowerCase().includes(search.toLowerCase())) return;
            groupHasMatch = true;
            const isOrigin = (s.loai_hinh || '').includes('Phân loại') || (s.loai_hinh || '').includes('Kho');
            
            // Determine pill color
            let pillClass = 'status-good';
            if (isOrigin) pillClass = 'status-bad';
            else if ((s.loai_hinh || '').includes('Bưu cục')) pillClass = 'status-warn';
            else if ((s.loai_hinh || '').includes('Trung Chuyển')) pillClass = 'status-good';

            stopsHtml += `<tr>
                <td><span class="route-tag">${s.tuyen}</span></td>
                <td style="font-weight:600; color:var(--text-primary);"><i class="fas fa-weight-hanging" style="color:var(--text-muted); margin-right:4px;"></i>${fmt(s.tai_trong)}</td>
                <td style="font-weight:500;">${s.diem_dung || '-'}</td>
                <td><span class="status-pill ${pillClass}">${s.loai_hinh || '-'}</span></td>
                <td style="color:var(--blue-light); font-weight:600;">${s.gio_den || '-'}</td>
                <td style="color:var(--accent-light); font-weight:600;">${s.gio_roi || '-'}</td>
            </tr>`;
            
            // Add spacer if the next stop belongs to a different route (COT)
            if (stops[i + 1] && stops[i + 1].tuyen !== s.tuyen && !search) {
                stopsHtml += `<tr class="cot-separator"><td colspan="6"></td></tr>`;
            }
        });
        
        if (groupHasMatch) {
            html += groupHtml + stopsHtml + `</tbody></table></div></div>`;
        }
    });
    document.getElementById('tableFleet').innerHTML = html;
}

// ===== POST OFFICE PAGE =====
function renderPostOfficePage(tinhFilter, search) {
    let data = [...APP.postoffices];
    if (tinhFilter) data = data.filter(r => r.tinh === tinhFilter);
    if (search) data = data.filter(r => (r.buu_cuc + r.tinh + r.quan).toLowerCase().includes(search.toLowerCase()));

    // Group by Tỉnh
    const grouped = {};
    data.forEach(r => {
        if (!grouped[r.tinh]) grouped[r.tinh] = [];
        grouped[r.tinh].push(r);
    });

    let html = `<table class="data-table"><thead><tr><th>Tỉnh/TP</th><th>Số lượng BC</th><th>Danh sách Bưu cục</th></tr></thead><tbody>`;
    
    Object.entries(grouped).sort((a, b) => b[1].length - a[1].length).forEach(([tinh, bcs]) => {
        const bcList = bcs.map(b => {
            // Shorten the name for display
            const shortName = b.buu_cuc.replace('Bưu Cục ', '').replace('Kho Trung Chuyển ', 'KTC ');
            return `<span class="bc-tag">${shortName}</span>`;
        }).join(' ');
        const countClass = bcs.length > 10 ? 'style="color:var(--green);font-weight:bold"' : '';
        html += `<tr><td style="font-weight:600">${tinh}</td><td ${countClass}>${bcs.length}</td><td class="bc-list-cell">${bcList}</td></tr>`;
    });

    html += `</tbody></table>`;
    document.getElementById('tablePostOffice').innerHTML = html;
}

// ===== INVENTORY PAGE =====
function renderInventoryPage(search) {
    let data = APP.inventory || [];
    if (search) {
        const q = search.toLowerCase();
        data = data.filter(r => (r.kho || '').toLowerCase().includes(q));
    }

    let html = `<table class="data-table">
        <thead>
            <tr>
                <th>Tên Kho / Khu vực</th>
                <th>0-6h</th>
                <th>6-12h</th>
                <th>12-24h</th>
                <th>24-36h</th>
                <th>36-48h</th>
                <th>48-72h</th>
                <th>>72h</th>
                <th>Tổng tồn kho</th>
            </tr>
        </thead>
        <tbody>`;
        
    data.forEach(r => {
        const total = r.total || 0;
        const totalHtml = total > 3000 ? `<span style="color:var(--red);font-weight:bold">${fmt(total)}</span>` : 
                          total > 1000 ? `<span style="color:var(--yellow);font-weight:bold">${fmt(total)}</span>` : fmt(total);
        
        const over72 = (r.h_72_96 || 0) + (r.h_96_120 || 0) + (r.h_120_plus || 0);
        const over72Html = over72 > 0 ? `<span style="color:var(--red);font-weight:bold">${fmt(over72)}</span>` : '-';
        
        html += `<tr>
            <td style="font-weight:500">${r.kho}</td>
            <td>${r.h_0_6 ? fmt(r.h_0_6) : '-'}</td>
            <td>${r.h_6_12 ? fmt(r.h_6_12) : '-'}</td>
            <td>${r.h_12_24 ? fmt(r.h_12_24) : '-'}</td>
            <td>${r.h_24_36 ? fmt(r.h_24_36) : '-'}</td>
            <td>${r.h_36_48 ? fmt(r.h_36_48) : '-'}</td>
            <td>${r.h_48_72 ? fmt(r.h_48_72) : '-'}</td>
            <td>${over72Html}</td>
            <td>${totalHtml}</td>
        </tr>`;
    });
    
    html += `</tbody></table>`;
    document.getElementById('tableInventory').innerHTML = html;
}

// ===== ALERTS =====
function generateAlerts() {
    APP.alerts = [];
    
    // Thêm các cảnh báo Tồn Kho & Lịch tải (từ backend Python)
    if (APP.inventory_alerts && APP.inventory_alerts.length) {
        APP.alerts.push(...APP.inventory_alerts);
    }

    APP.alerts.sort((a, b) => (a.level === 'critical' ? 0 : a.level === 'warning' ? 1 : 2) - (b.level === 'critical' ? 0 : b.level === 'warning' ? 1 : 2));
    const count = APP.alerts.filter(a => a.level === 'critical').length;
    document.getElementById('alertBadge').textContent = count;
    if (count > 0) { document.getElementById('notifDot').classList.add('active'); }
}

function renderAlertsPage(levelFilter) {
    let data = APP.alerts || [];
    if (levelFilter) data = data.filter(a => a.level === levelFilter);
    const icons = { critical: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    let html = '';
    if (data.length === 0) {
        html = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-check-circle" style="font-size:2rem;color:var(--green);margin-bottom:12px;display:block"></i>Không có cảnh báo nào</div>';
    } else {
        data.forEach((a, i) => {
            let progressHtml = '';
            if (a.ty_le) {
                // Remove % sign and parse
                const pctVal = parseFloat(a.ty_le.replace('%', ''));
                const w = Math.min(pctVal, 100);
                const isOver = pctVal >= 100;
                
                progressHtml = `
                    <div class="alert-stats-row">
                        <div class="alert-stat">
                            <span class="stat-lbl">Tồn hiện tại</span>
                            <span class="stat-val ${isOver ? 'text-red' : ''}">${fmt(a.ton_hien_tai)} <span style="font-size:0.75rem;font-weight:500;color:var(--text-muted)">đơn</span></span>
                        </div>
                        <div class="alert-stat">
                            <span class="stat-lbl">Sức chứa</span>
                            <span class="stat-val">${fmt(a.suc_chua)}</span>
                        </div>
                        <div class="alert-stat">
                            <span class="stat-lbl">Tỷ lệ</span>
                            <span class="stat-val ${isOver ? 'text-red' : (pctVal >= 80 ? 'text-yellow' : 'text-green')}">${a.ty_le}</span>
                        </div>
                        ${a.gio_con_lai ? `<div class="alert-stat"><span class="stat-lbl">Giờ còn lại</span><span class="stat-val text-yellow">${a.gio_con_lai}</span></div>` : ''}
                    </div>
                    <div class="alert-progress">
                        <div class="alert-progress-fill ${isOver ? 'overload' : (pctVal >= 80 ? 'warning' : 'good')}" style="width: ${w}%"></div>
                    </div>
                `;
            }

            html += `<div class="alert-item ${a.level}" style="animation-delay:${i * 0.05}s">
                <div class="alert-icon"><i class="fas ${icons[a.level]}"></i></div>
                <div class="alert-body">
                    <div class="alert-title">${a.title}</div>
                    <div class="alert-desc">${a.desc}</div>
                    ${progressHtml}
                    <div class="alert-meta"><span><i class="fas fa-tag"></i> ${a.category}</span>${a.am ? `<span><i class="fas fa-user"></i> ${a.am}</span>` : ''}</div>
                </div>
            </div>`;
        });
    }
    document.getElementById('alertsList').innerHTML = html;
}

// ===== FILTERS =====
function populateFilters() {
    const fleetGroups = Object.keys(APP.fleet).sort();
    const tinhList = [...new Set(APP.postoffices.map(r => r.tinh).filter(Boolean))].sort();

    fillSelect('filterFleetGroup', fleetGroups);
    fillSelect('filterProvince', tinhList);

    // Event listeners
    document.getElementById('filterFleetGroup').addEventListener('change', e => renderFleetPage(e.target.value, document.getElementById('searchFleet').value));
    document.getElementById('searchFleet').addEventListener('input', e => renderFleetPage(document.getElementById('filterFleetGroup').value, e.target.value));
    document.getElementById('filterProvince').addEventListener('change', e => renderPostOfficePage(e.target.value, document.getElementById('searchPo').value));
    document.getElementById('searchPo').addEventListener('input', e => renderPostOfficePage(document.getElementById('filterProvince').value, e.target.value));
    document.getElementById('searchInventory').addEventListener('input', e => renderInventoryPage(e.target.value));
    document.getElementById('filterAlertLevel').addEventListener('change', e => renderAlertsPage(e.target.value));

    // ===== GLOBAL SEARCH (Live search across all data) =====
    const searchInput  = document.getElementById('globalSearch');
    const searchDropdown = document.getElementById('searchDropdown');
    const searchClear  = document.getElementById('searchClear');

    function buildSearchIndex() {
        const index = [];

        // 1. Fleet routes & stops
        Object.entries(APP.fleet).forEach(([group, stops]) => {
            const addedRoutes = new Set();
            stops.forEach(s => {
                // Route name (unique per route)
                if (!addedRoutes.has(s.tuyen)) {
                    addedRoutes.add(s.tuyen);
                    index.push({ type: 'fleet', label: s.tuyen, sub: `Nhóm ${group} · ${s.tai_trong?.toLocaleString() || ''}kg`, page: 'fleet', search: s.tuyen.toLowerCase(), group });
                }
                // Stop/kho name
                if (s.diem_dung) {
                    index.push({ type: 'stop', label: s.diem_dung, sub: `Tuyến ${s.tuyen} · ${s.loai_hinh || ''}`, page: 'fleet', search: s.diem_dung.toLowerCase(), group });
                }
            });
        });

        // 2. Inventory kho
        (APP.inventory || []).forEach(r => {
            if (r.kho) {
                index.push({ type: 'inventory', label: r.kho, sub: `Tồn kho: ${(r.total || 0).toLocaleString('vi-VN')} đơn`, page: 'inventory', search: r.kho.toLowerCase() });
            }
        });

        // 3. Hierarchy groups & children
        (APP.hierarchy_inventory || []).forEach(g => {
            index.push({ type: 'group', label: g.name, sub: `Nhóm tuyến · Tổng: ${(g.total || 0).toLocaleString('vi-VN')}`, page: 'overview', search: g.name.toLowerCase() });
            (g.children || []).forEach(c => {
                index.push({ type: 'group', label: c.name, sub: `Thuộc ${g.name} · ${(c.total || 0).toLocaleString('vi-VN')} đơn`, page: 'overview', search: c.name.toLowerCase() });
            });
        });

        // 4. Alerts
        (APP.alerts || []).forEach(a => {
            index.push({ type: 'alert', label: a.title || '', sub: a.desc ? a.desc.slice(0, 60) + '…' : '', page: 'alerts', level: a.level, search: (a.title + ' ' + (a.desc || '')).toLowerCase() });
        });

        return index;
    }

    const TYPE_ICONS = {
        fleet: { icon: 'fa-route', color: '#60a5fa', label: 'Tuyến xe' },
        stop:  { icon: 'fa-map-marker-alt', color: '#34d399', label: 'Điểm dừng / Kho' },
        inventory: { icon: 'fa-warehouse', color: '#f59e0b', label: 'Tồn kho PV' },
        group: { icon: 'fa-layer-group', color: '#a78bfa', label: 'Nhóm tuyến' },
        alert: { icon: 'fa-triangle-exclamation', color: '#f87171', label: 'Cảnh báo' },
    };

    let searchIndex = [];
    // Build index after data loads (called after initApp)
    window._rebuildSearchIndex = () => { searchIndex = buildSearchIndex(); };

    function navigateTo(page, group, search) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const navItem = document.querySelector(`[data-page="${page}"]`);
        if (navItem) navItem.classList.add('active');
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) pageEl.classList.add('active');
        const titles = { overview: 'KTC Hồ Chí Minh 01', fleet: 'Lịch xe tải', inventory: 'Tồn kho (PV)', alerts: 'Cảnh báo Vận hành' };
        document.getElementById('pageTitle').textContent = titles[page] || '';

        if (page === 'fleet') {
            if (group) document.getElementById('filterFleetGroup').value = group;
            if (search) document.getElementById('searchFleet').value = search;
            renderFleetPage(group || document.getElementById('filterFleetGroup').value, search || '');
        } else if (page === 'inventory') {
            if (search) { document.getElementById('searchInventory').value = search; renderInventoryPage(search); }
            else renderInventoryPage();
        } else if (page === 'alerts') {
            renderAlertsPage();
        } else if (page === 'overview') {
            renderOverview();
        }
    }

    function runSearch(q) {
        searchDropdown.innerHTML = '';
        if (!q || q.length < 2) { searchDropdown.style.display = 'none'; return; }

        const ql = q.toLowerCase();
        const hits = searchIndex.filter(item => item.search.includes(ql)).slice(0, 20);

        if (!hits.length) {
            searchDropdown.innerHTML = `<div class="search-empty"><i class="fas fa-search-minus"></i> Không tìm thấy kết quả cho "<b>${q}</b>"</div>`;
            searchDropdown.style.display = 'block';
            return;
        }

        // Group by type
        const groups = {};
        hits.forEach(h => { if (!groups[h.type]) groups[h.type] = []; groups[h.type].push(h); });

        let html = '';
        Object.entries(groups).forEach(([type, items]) => {
            const meta = TYPE_ICONS[type] || { icon: 'fa-circle', color: '#94a3b8', label: type };
            html += `<div class="search-group-header"><i class="fas ${meta.icon}" style="color:${meta.color}"></i> ${meta.label}</div>`;
            items.slice(0, 6).forEach((item, idx) => {
                const levelDot = item.level === 'critical' ? '🔴' : item.level === 'warning' ? '🟡' : '';
                html += `<div class="search-result-item" data-idx="${type}_${idx}">
                    <div class="sri-label">${levelDot} ${item.label}</div>
                    <div class="sri-sub">${item.sub}</div>
                </div>`;
                // Store item data on element after render
            });
        });

        searchDropdown.innerHTML = html;
        searchDropdown.style.display = 'block';

        // Attach click handlers
        let flatHits = [];
        Object.entries(groups).forEach(([type, items]) => { flatHits = flatHits.concat(items.slice(0, 6)); });
        searchDropdown.querySelectorAll('.search-result-item').forEach((el, i) => {
            el.addEventListener('click', () => {
                const item = flatHits[i];
                searchDropdown.style.display = 'none';
                searchInput.value = item.label;
                navigateTo(item.page, item.group, item.type === 'fleet' ? item.label : (item.type === 'stop' ? item.label : (item.type === 'inventory' ? item.label : '')));
            });
        });
    }

    searchInput.addEventListener('input', e => {
        const q = e.target.value.trim();
        searchClear.style.display = q ? 'flex' : 'none';
        runSearch(q);
    });

    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') { searchDropdown.style.display = 'none'; searchInput.blur(); }
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        searchDropdown.style.display = 'none';
        searchInput.focus();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
        if (!document.getElementById('searchBoxWrap').contains(e.target)) {
            searchDropdown.style.display = 'none';
        }
    });


    // Notification bell
    document.getElementById('notifBtn').addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelector('[data-page="alerts"]').classList.add('active');
        document.getElementById('page-alerts').classList.add('active');
        document.getElementById('pageTitle').textContent = 'Cảnh báo Vận hành';
        renderAlertsPage();
    });
}

function fillSelect(id, options) {
    const sel = document.getElementById(id);
    if (!sel) return;
    options.forEach(o => { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; sel.appendChild(opt); });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', initApp);
