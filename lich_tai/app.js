// Mock Data khởi tạo ban đầu cho GHN
const todayStr = new Date().toISOString().split('T')[0];

// Function to sanitize user inputs and prevent XSS vulnerabilities
function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Khởi tạo bảng tọa độ: Ưu tiên lấy từ file locations.js tự động sinh, nếu không thì dùng bản offline fallback
let WAREHOUSE_COORDINATES = (typeof WAREHOUSE_COORDINATES_DB !== 'undefined') ? Object.assign({}, WAREHOUSE_COORDINATES_DB) : {
    "Kho Trung Chuyển Hồ Chí Minh 20": { lat: 10.8231, lng: 106.6297 },
    "Kho Chuyển Tiếp Lâm Đồng": { lat: 11.9404, lng: 108.4583 },
    "Kho Trung Chuyển Hải Phòng": { lat: 20.8449, lng: 106.6881 },
    "Kho Vận Quy Nhơn": { lat: 13.7820, lng: 109.2194 },
    "Kho Chuyển Tiếp Lào Cai": { lat: 22.4856, lng: 103.9707 },
    "Bưu cục Biên Hoà Đồng Nai": { lat: 10.9574, lng: 106.8427 },
    "Bưu cục Vũng Tàu": { lat: 10.3460, lng: 107.0843 }
};

// Gộp thêm tọa độ tùy chỉnh người dùng đã cập nhật qua file Excel lưu trữ trong localStorage
const savedCustomCoords = localStorage.getItem('GHN_WAREHOUSE_COORDINATES_CUSTOM');
if (savedCustomCoords) {
    try {
        const parsed = JSON.parse(savedCustomCoords);
        Object.assign(WAREHOUSE_COORDINATES, parsed);
        console.log(`Đã tải thành công ${Object.keys(parsed).length} tọa độ bưu cục tùy chỉnh từ bộ nhớ đệm.`);
    } catch (e) {
        console.error('Lỗi khi đọc tọa độ từ localStorage:', e);
    }
}

// Hàm lấy tọa độ cho một địa điểm (có fallback thuật toán sinh tọa độ giả lập từ chuỗi cho điểm bất kỳ)
function getCoordinates(name) {
    if (!name) return null;
    const cleanName = name.trim();
    if (WAREHOUSE_COORDINATES[cleanName]) {
        return WAREHOUSE_COORDINATES[cleanName];
    }
    
    // Thuật toán băm chuỗi (String hashing) để tự động sinh tọa độ mô phỏng ổn định trong khu vực VN
    let hash = 0;
    for (let i = 0; i < cleanName.length; i++) {
        hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Giới hạn trong khoảng Vĩ độ: 8.5 đến 23.0, Kinh độ: 102.5 đến 109.5 (khu vực VN địa phận đất liền)
    const lat = 8.5 + Math.abs((hash % 145) / 10);
    const lng = 102.5 + Math.abs(((hash >> 8) % 70) / 10);
    return { lat, lng };
}

// Hàm tính khoảng cách giữa hai địa điểm bằng công thức Haversine (đường chim bay)
function calculateHaversineDistance(loc1, loc2) {
    const coord1 = getCoordinates(loc1);
    const coord2 = getCoordinates(loc2);
    if (!coord1 || !coord2) return null;
    
    const R = 6371; // Bán kính Trái Đất (km)
    const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
    const dLng = (coord2.lng - coord1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

let schedules = [
    {
        id: 1,
        route: "HCM_LĐ_01",
        payload: "Tải 8 tấn",
        type: "Phân loại",
        arrival: `${todayStr}T13:00`,
        departure: `${todayStr}T14:00`,
        status: "active",
        exportRoute: "Nội Thành",
        tuyenXuat: "Nội Thành",
        stops: [
            { name: "Kho Trung Chuyển Hồ Chí Minh 20", arrival: "13:00", departure: "14:00", type: "Phân loại" },
            { name: "Kho Chuyển Tiếp Lâm Đồng", arrival: "21:00", departure: "22:30", type: "Giao và Lấy" }
        ]
    },
    {
        id: 2,
        route: "HN_HP_02",
        payload: "Container (40T)",
        type: "Giao",
        arrival: `${todayStr}T08:00`,
        departure: `${todayStr}T09:00`,
        status: "active",
        exportRoute: "Miền Bắc",
        tuyenXuat: "Liên Vùng",
        stops: [
            { name: "Kho Trung Chuyển Hải Phòng", arrival: "08:00", departure: "09:00", type: "Giao" }
        ]
    },
    {
        id: 3,
        route: "SG_ĐN_03",
        payload: "Tải 5 tấn",
        type: "Lấy",
        arrival: `${todayStr}T10:30`,
        departure: `${todayStr}T11:45`,
        status: "off",
        exportRoute: "Đồng Nai",
        tuyenXuat: "Nội Vùng",
        stops: [
            { name: "Bưu cục Biên Hoà Đồng Nai", arrival: "10:30", departure: "11:45", type: "Lấy" }
        ]
    },
    {
        id: 4,
        route: "HCM_QN_05",
        payload: "Tải 15 tấn",
        type: "Giao và Lấy",
        arrival: `${todayStr}T15:00`,
        departure: `${todayStr}T16:30`,
        status: "active",
        exportRoute: "Duyên Hải",
        tuyenXuat: "Giao Xe Tải",
        stops: [
            { name: "Kho Vận Quy Nhơn", arrival: "15:00", departure: "16:30", type: "Giao và Lấy" }
        ]
    },
    {
        id: 5,
        route: "HN_LC_06",
        payload: "Tải 2 tấn",
        type: "Giao",
        arrival: `${todayStr}T06:00`,
        departure: `${todayStr}T07:15`,
        status: "adjust",
        exportRoute: "Miền Bắc",
        tuyenXuat: "Liên Vùng",
        stops: [
            { name: "Kho Chuyển Tiếp Lào Cai", arrival: "06:00", departure: "07:15", type: "Giao" }
        ]
    },
    {
        id: 6,
        route: "HCM_VT_08",
        payload: "Tải Van",
        type: "Lấy",
        arrival: `${todayStr}T09:00`,
        departure: `${todayStr}T10:00`,
        status: "draft",
        exportRoute: "Nội Vùng",
        tuyenXuat: "Nội Vùng",
        stops: [
            { name: "Bưu cục Vũng Tàu", arrival: "09:00", departure: "10:00", type: "Lấy" }
        ]
    }
];

let editingScheduleId = null;
let currentViewingScheduleId = null;
let activeTab = 'deployed'; // 'deployed', 'adjust', 'draft'

// E2E Interactive Filter States
let selectedRegionFilter = null; // null, regionName, or 'khac'
let selectedStatusFilter = null; // null, 'active', or 'off'
let selectedSpecificRouteFilter = null; // null or routeName (e.g. "HCM_LĐ_01")
let selectedPayloadFilter = null; // null or payloadName (e.g. "Tải 8 tấn")
let selectedTuyenXuatFilter = null; // null or tuyenXuatName (e.g. "KTC HCM 20")
let top3RoutesGlobal = [];

const tableBody = document.getElementById('table-body');
const searchInput = document.getElementById('search-route');
const modal = document.getElementById('add-modal');
const btnAdd = document.getElementById('btn-add-schedule');
const btnClose = document.getElementById('close-modal');
const btnCancel = document.getElementById('btn-cancel');
const form = document.getElementById('add-form');

// Function to format datetime
function formatDateTime(dateString) {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        if (dateString.includes('T')) {
            const timePart = dateString.split('T')[1];
            if (timePart && timePart.includes(':')) return timePart;
        }
        return dateString;
    }
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

// Function to filter schedules based on active tab, status filters, region filters, and search query
function getFilteredSchedules() {
    const searchTerm = searchInput.value.toLowerCase();
    
    // 1. Filter by Tab
    let tabData = [];
    if (activeTab === 'deployed') {
        tabData = schedules.filter(s => s.status === 'active' || s.status === 'off');
    } else if (activeTab === 'adjust') {
        tabData = schedules.filter(s => s.status === 'adjust');
    } else if (activeTab === 'draft') {
        tabData = schedules.filter(s => s.status === 'draft');
    }
    
    // 2. Filter by status filter (e.g. click "Đang vận hành" or "Đã OFF" card)
    if (selectedStatusFilter) {
        tabData = tabData.filter(s => s.status === selectedStatusFilter);
    }
    
    // 3. Filter by region filter (e.g. click region badge)
    if (selectedRegionFilter) {
        if (selectedRegionFilter === 'khac') {
            tabData = tabData.filter(s => !top3RoutesGlobal.includes(s.exportRoute || 'Khác'));
        } else {
            tabData = tabData.filter(s => s.exportRoute === selectedRegionFilter);
        }
    }
    
    // 3.5. Filter by specific route filter
    if (selectedSpecificRouteFilter) {
        tabData = tabData.filter(s => s.route === selectedSpecificRouteFilter);
    }
    
    // 3.7. Filter by payload filter
    if (selectedPayloadFilter) {
        tabData = tabData.filter(s => s.payload === selectedPayloadFilter);
    }
    
    // 3.8. Filter by tuyenXuat filter
    if (selectedTuyenXuatFilter) {
        tabData = tabData.filter(s => s.tuyenXuat === selectedTuyenXuatFilter);
    }
    
    // 4. Filter by search term
    if (searchTerm) {
        return tabData.filter(item => {
            const statusText = item.status === 'active' ? 'Đang hoạt động' : 
                               item.status === 'off' ? 'OFF' : 
                               item.status === 'adjust' ? 'Yêu cầu điều chỉnh' : 
                               item.status === 'draft' ? 'Bản nháp' : '';
            return item.route.toLowerCase().includes(searchTerm) || 
                   (item.tuyenXuat && item.tuyenXuat.toLowerCase().includes(searchTerm)) ||
                   (item.exportRoute && item.exportRoute.toLowerCase().includes(searchTerm)) ||
                   (item.payload && item.payload.toLowerCase().includes(searchTerm)) ||
                   statusText.toLowerCase().includes(searchTerm);
        });
    }
    return tabData;
}

// Function to switch tabs
window.switchTab = function(tab) {
    activeTab = tab;
    
    // Remove active class from all tabs
    document.getElementById('tab-deployed').classList.remove('active');
    document.getElementById('tab-adjust').classList.remove('active');
    document.getElementById('tab-draft').classList.remove('active');
    
    // Reset filters when switching tabs
    selectedRegionFilter = null;
    selectedStatusFilter = null;
    selectedSpecificRouteFilter = null;
    selectedPayloadFilter = null;
    selectedTuyenXuatFilter = null;
    closeRoutePopover();
    const indicator = document.getElementById('filter-indicator');
    if (indicator) indicator.style.display = 'none';
    
    // Add active class to selected tab
    document.getElementById(`tab-${tab}`).classList.add('active');
    
    // Update Title in UI
    const titleEl = document.getElementById('table-title');
    if (titleEl) {
        const titleSpan = titleEl.querySelector('span');
        if (titleSpan) {
            if (tab === 'deployed') {
                titleSpan.textContent = 'Danh Sách Lịch Tải Hiện Tại';
            } else if (tab === 'adjust') {
                titleSpan.textContent = 'Danh Sách Yêu Cầu Điều Chỉnh';
            } else if (tab === 'draft') {
                titleSpan.textContent = 'Danh Sách Lộ Trình Nháp (Chưa triển khai)';
            }
        }
    }
    
    // Reset search when switching tabs
    searchInput.value = '';
    
    // Re-render
    renderTable(getFilteredSchedules());
};

// Filter actions
window.filterByRegion = function(regionName) {
    selectedRegionFilter = regionName;
    selectedSpecificRouteFilter = null;
    closeRoutePopover();
    
    // Show filter indicator
    const indicator = document.getElementById('filter-indicator');
    const filterText = document.getElementById('filter-text');
    if (indicator && filterText) {
        filterText.textContent = regionName === 'khac' ? 'Các loại tuyến khác' : `Loại tuyến: ${regionName}`;
        indicator.style.display = 'inline-flex';
    }
    
    renderTable(getFilteredSchedules());
};

window.filterByStatus = function(statusName) {
    selectedStatusFilter = statusName;
    selectedSpecificRouteFilter = null; // Clear route filter on status change
    selectedRegionFilter = null;        // Clear region filter on status change
    selectedPayloadFilter = null;       // Clear payload filter on status change
    closeRoutePopover();
    
    // Show filter indicator
    const indicator = document.getElementById('filter-indicator');
    const filterText = document.getElementById('filter-text');
    if (indicator && filterText) {
        let statusLabel = 'Đang vận hành';
        if (statusName === 'off') statusLabel = 'Đã OFF';
        else if (statusName === 'adjust') statusLabel = 'Yêu cầu điều chỉnh';
        else if (statusName === 'draft') statusLabel = 'Bản nháp';
        
        filterText.textContent = `Trạng thái: ${statusLabel}`;
        indicator.style.display = 'inline-flex';
    }
    
    renderTable(getFilteredSchedules());
};

window.filterByPayload = function(payloadName) {
    selectedPayloadFilter = payloadName;
    selectedRegionFilter = null;
    selectedStatusFilter = null;
    selectedSpecificRouteFilter = null;
    closeRoutePopover();
    
    // Show filter indicator
    const indicator = document.getElementById('filter-indicator');
    const filterText = document.getElementById('filter-text');
    if (indicator && filterText) {
        filterText.textContent = `Trọng tải: ${payloadName}`;
        indicator.style.display = 'inline-flex';
    }
    
    renderTable(getFilteredSchedules());
};

window.filterByTuyenXuat = function(tuyenXuatName) {
    selectedTuyenXuatFilter = tuyenXuatName;
    selectedRegionFilter = null;
    selectedStatusFilter = null;
    selectedSpecificRouteFilter = null;
    selectedPayloadFilter = null;
    closeRoutePopover();
    
    // Show filter indicator
    const indicator = document.getElementById('filter-indicator');
    const filterText = document.getElementById('filter-text');
    if (indicator && filterText) {
        filterText.textContent = `Tuyến xuất: ${tuyenXuatName}`;
        indicator.style.display = 'inline-flex';
    }
    
    renderTable(getFilteredSchedules());
};

window.resetFilters = function() {
    selectedRegionFilter = null;
    selectedStatusFilter = null;
    selectedSpecificRouteFilter = null;
    selectedPayloadFilter = null;
    selectedTuyenXuatFilter = null;
    closeRoutePopover();
    
    // Hide filter indicator
    const indicator = document.getElementById('filter-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
    
    renderTable(getFilteredSchedules());
};

window.closeRoutePopover = function() {
    const popover = document.getElementById('kpi-route-popover');
    if (popover) {
        popover.remove();
    }
};

window.showRoutePopover = function(e, regionName) {
    e.stopPropagation();
    
    const existingPopover = document.getElementById('kpi-route-popover');
    if (existingPopover) {
        const openedRegion = existingPopover.getAttribute('data-region');
        existingPopover.remove();
        if (openedRegion === regionName) {
            return;
        }
    }
    
    // Determine overall schedules belonging to this region (excluding drafts)
    const statSchedules = schedules.filter(s => s.status !== 'draft');
    let regionSchedulesOverall = [];
    if (regionName === 'khac') {
        regionSchedulesOverall = statSchedules.filter(s => !top3RoutesGlobal.includes(s.exportRoute || 'Khác'));
    } else {
        regionSchedulesOverall = statSchedules.filter(s => s.exportRoute === regionName);
    }
    
    // Find all unique route names
    const uniqueRouteNames = [...new Set(regionSchedulesOverall.map(s => s.route))].sort((a, b) => 
        a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' })
    );
    
    // Find matching schedules in the active tab to display active count
    let tabData = [];
    if (activeTab === 'deployed') {
        tabData = schedules.filter(s => s.status === 'active' || s.status === 'off');
    } else if (activeTab === 'adjust') {
        tabData = schedules.filter(s => s.status === 'adjust');
    } else if (activeTab === 'draft') {
        tabData = schedules.filter(s => s.status === 'draft');
    }
    
    // If a status filter (e.g. Đang vận hành) is active, respect that as well for counts!
    if (selectedStatusFilter) {
        tabData = tabData.filter(s => s.status === selectedStatusFilter);
    }
    
    const routeCountsInTab = {};
    uniqueRouteNames.forEach(rn => {
        routeCountsInTab[rn] = tabData.filter(s => s.route === rn).length;
    });
    
    // Create popover element
    const popover = document.createElement('div');
    popover.id = 'kpi-route-popover';
    popover.className = 'kpi-popover';
    popover.setAttribute('data-region', regionName);
    
    let headerText = regionName === 'khac' ? 'Các tuyến khác' : regionName;
    
    // Add "All routes" option at the top of the list
    const isAllSelected = selectedRegionFilter === regionName && !selectedSpecificRouteFilter;
    let itemsHtml = `
        <li class="kpi-popover-item ${isAllSelected ? 'selected' : ''}" onclick="filterByRegion('${escapeHTML(regionName)}')">
            <span>Tất cả tuyến</span>
            <span class="kpi-popover-item-count">${regionSchedulesOverall.length} chuyến</span>
        </li>
    `;
    
    itemsHtml += uniqueRouteNames.map(rn => {
        const count = routeCountsInTab[rn] || 0;
        const isSelected = selectedSpecificRouteFilter === rn;
        return `
            <li class="kpi-popover-item ${isSelected ? 'selected' : ''}" onclick="filterBySpecificRoute('${escapeHTML(regionName)}', '${escapeHTML(rn)}')">
                <span>${escapeHTML(rn)}</span>
                <span class="kpi-popover-item-count">${count} chuyến</span>
            </li>
        `;
    }).join('');
    
    popover.innerHTML = `
        <div class="kpi-popover-header">
            <span>${escapeHTML(headerText)}</span>
            <span style="cursor: pointer; font-size: 16px; font-weight: bold; line-height: 1;" onclick="event.stopPropagation(); closeRoutePopover();">&times;</span>
        </div>
        <ul class="kpi-popover-list">
            ${itemsHtml || '<li style="padding: 12px 16px; color: var(--text-muted); font-style: italic; font-size: 13px;">Không có tuyến</li>'}
        </ul>
    `;
    
    document.body.appendChild(popover);
    
    // Position it below the clicked badge
    const rect = e.currentTarget.getBoundingClientRect();
    const popoverWidth = 240; // minimum width
    let leftPos = rect.left + window.scrollX;
    
    if (leftPos + popoverWidth > window.innerWidth) {
        leftPos = rect.right + window.scrollX - popoverWidth;
    }
    if (leftPos < 10) {
        leftPos = 10;
    }
    
    popover.style.left = `${leftPos}px`;
    popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
};

window.filterBySpecificRoute = function(regionName, routeName) {
    selectedRegionFilter = regionName;
    selectedSpecificRouteFilter = routeName;
    closeRoutePopover();
    
    // Update filter indicator
    const indicator = document.getElementById('filter-indicator');
    const filterText = document.getElementById('filter-text');
    if (indicator && filterText) {
        const displayRegion = regionName === 'khac' ? 'Khác' : regionName;
        filterText.textContent = `Loại tuyến: ${displayRegion} › ${routeName}`;
        indicator.style.display = 'inline-flex';
    }
    
    renderTable(getFilteredSchedules());
};

// Function to update KPI stats on dashboard
function updateKPIs() {
    const statSchedules = schedules.filter(s => s.status !== 'draft');
    const totalCount = statSchedules.length;
    const activeCount = statSchedules.filter(s => s.status === 'active').length;
    const offCount = statSchedules.filter(s => s.status === 'off').length;

    document.getElementById('kpi-total').textContent = totalCount;
    document.getElementById('kpi-active').textContent = activeCount;
    document.getElementById('kpi-off').textContent = offCount;

    const activePercent = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0;
    const offPercent = totalCount > 0 ? Math.round((offCount / totalCount) * 100) : 0;

    document.getElementById('kpi-active-percent').textContent = `${activePercent}% tổng số chuyến`;
    document.getElementById('kpi-off-percent').textContent = `${offPercent}% tổng số chuyến`;

    // Highlight active status card
    const cardActive = document.getElementById('kpi-card-active');
    const cardOff = document.getElementById('kpi-card-off');
    
    if (cardActive && cardOff) {
        cardActive.style.borderColor = selectedStatusFilter === 'active' ? 'var(--success)' : 'var(--border)';
        cardActive.style.boxShadow = selectedStatusFilter === 'active' ? '0 4px 12px rgba(16, 185, 129, 0.15)' : 'none';
        
        cardOff.style.borderColor = selectedStatusFilter === 'off' ? 'var(--danger)' : 'var(--border)';
        cardOff.style.boxShadow = selectedStatusFilter === 'off' ? '0 4px 12px rgba(239, 68, 68, 0.15)' : 'none';
    }

    // Calculate top3RoutesGlobal for 'Khác' filtering logic
    const routeCounts = {};
    statSchedules.forEach(s => {
        const key = s.exportRoute || 'Khác';
        routeCounts[key] = (routeCounts[key] || 0) + 1;
    });

    const sortedRoutes = Object.entries(routeCounts).sort((a, b) => b[1] - a[1]);
    top3RoutesGlobal = sortedRoutes.slice(0, 3).map(r => r[0]);
}

function renderTable(data) {
    tableBody.innerHTML = '';
    
    // Tự động sắp xếp: Ưu tiên 1 theo Tuyến xuất, Ưu tiên 2 theo Loại tuyến, Ưu tiên 3 theo Tên tuyến
    data.sort((a, b) => {
        const txA = a.tuyenXuat || '';
        const txB = b.tuyenXuat || '';
        
        if (txA !== txB) {
            return txA.localeCompare(txB, 'vi'); // Nhóm Tuyến xuất
        }
        
        const exportA = a.exportRoute || '';
        const exportB = b.exportRoute || '';
        
        if (exportA !== exportB) {
            return exportA.localeCompare(exportB, 'vi'); // Nhóm Loại tuyến
        }
        
        // Sắp xếp theo Tên tuyến (có nhận diện số 01, 02...)
        const routeA = a.route || '';
        const routeB = b.route || '';
        return routeA.localeCompare(routeB, 'vi', { numeric: true, sensitivity: 'base' });
    });

    updateKPIs();

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 32px; color:var(--text-muted)">Không tìm thấy lịch tải nào</td></tr>`;
        return;
    }

    data.forEach(item => {
        const tr = document.createElement('tr');
        
        // Translate status dynamically
        let statusText = 'OFF';
        if (item.status === 'active') statusText = 'Đang hoạt động';
        else if (item.status === 'adjust') statusText = 'Yêu cầu điều chỉnh';
        else if (item.status === 'draft') statusText = 'Bản nháp';

        tr.innerHTML = `
            <td>${escapeHTML(item.tuyenXuat || '-')}</td>
            <td><strong class="route-link" style="cursor: pointer;" onclick="viewScheduleDetails(${item.id})">${escapeHTML(item.route)}</strong></td>
            <td>${escapeHTML(item.exportRoute) || '-'}</td>
            <td>${escapeHTML(item.payload)}</td>
            <td>${formatDateTime(item.arrival)}</td>
            <td>${formatDateTime(item.departure)}</td>
            <td>
                <span class="status-badge status-${item.status}">${statusText}</span>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

window.closeSearchDropdown = function() {
    const dropdown = document.getElementById('search-dropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
};

window.renderSearchDropdown = function(searchTerm = '') {
    const dropdown = document.getElementById('search-dropdown');
    if (!dropdown) return;
    
    const query = searchTerm.trim().toLowerCase();
    
    // Filter active tab's base schedules or all schedules excluding drafts
    const statSchedules = schedules.filter(s => s.status !== 'draft');
    
    // 1. Status list and fuzzy matching
    const statuses = [
        { code: 'active', label: 'Đang hoạt động' },
        { code: 'off', label: 'OFF' },
        { code: 'adjust', label: 'Yêu cầu điều chỉnh' },
        { code: 'draft', label: 'Bản nháp' }
    ];
    const filteredStatuses = statuses.filter(st => st.label.toLowerCase().includes(query));
    
    // 2. Payload list and fuzzy matching
    const allPayloads = [...new Set(schedules.map(s => s.payload))].sort();
    const filteredPayloads = allPayloads.filter(p => p.toLowerCase().includes(query));
    
    // 2.5. Tuyen xuat list and fuzzy matching
    const allTuyenXuat = [...new Set(schedules.map(s => s.tuyenXuat).filter(Boolean))].sort();
    const filteredTuyenXuat = allTuyenXuat.filter(tx => tx.toLowerCase().includes(query));
    
    // 3. Get unique export regions
    const allRegions = [...new Set(statSchedules.map(s => s.exportRoute || 'Khác'))].sort((a, b) => 
        a.localeCompare(b, 'vi')
    );
    const filteredRegions = allRegions.filter(r => r.toLowerCase().includes(query));
    
    if (filteredStatuses.length === 0 && filteredPayloads.length === 0 && filteredTuyenXuat.length === 0 && filteredRegions.length === 0) {
        dropdown.innerHTML = `
            <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 13px; font-style: italic;">
                Không tìm thấy thông tin phù hợp
            </div>
        `;
        dropdown.classList.add('show');
        return;
    }
    
    // Count schedules in the active tab (respecting tab filter) for displaying item counts
    let tabData = [];
    if (activeTab === 'deployed') {
        tabData = schedules.filter(s => s.status === 'active' || s.status === 'off');
    } else if (activeTab === 'adjust') {
        tabData = schedules.filter(s => s.status === 'adjust');
    } else if (activeTab === 'draft') {
        tabData = schedules.filter(s => s.status === 'draft');
    }
    if (selectedStatusFilter) {
        tabData = tabData.filter(s => s.status === selectedStatusFilter);
    }
    
    let html = '';
    
    // Render Status Section
    if (filteredStatuses.length > 0) {
        html += `<div class="search-dropdown-header">Trạng thái</div>`;
        html += `<ul class="search-dropdown-list">`;
        filteredStatuses.forEach(st => {
            const count = schedules.filter(s => s.status === st.code).length;
            const isSelected = selectedStatusFilter === st.code;
            
            html += `
                <li class="search-dropdown-item ${isSelected ? 'selected' : ''}" onclick="selectSearchFilterStatus('${st.code}')">
                    <span>⚡ ${escapeHTML(st.label)}</span>
                    <span class="search-dropdown-item-count">${count} chuyến tổng</span>
                </li>
            `;
        });
        html += `</ul>`;
    }
    
    // Render Payload Section
    if (filteredPayloads.length > 0) {
        html += `<div class="search-dropdown-header">Trọng tải / Loại xe</div>`;
        html += `<ul class="search-dropdown-list">`;
        filteredPayloads.forEach(payload => {
            const count = tabData.filter(s => s.payload === payload).length;
            const isSelected = selectedPayloadFilter === payload;
            
            html += `
                <li class="search-dropdown-item ${isSelected ? 'selected' : ''}" onclick="selectSearchFilterPayload('${escapeHTML(payload)}')">
                    <span>⚖️ ${escapeHTML(payload)}</span>
                    <span class="search-dropdown-item-count">${count} chuyến</span>
                </li>
            `;
        });
        html += `</ul>`;
    }
    
    // Render Tuyen Xuat Section
    if (filteredTuyenXuat.length > 0) {
        html += `<div class="search-dropdown-header">Tuyến xuất</div>`;
        html += `<ul class="search-dropdown-list">`;
        filteredTuyenXuat.forEach(tx => {
            const count = tabData.filter(s => s.tuyenXuat === tx).length;
            const isSelected = selectedTuyenXuatFilter === tx;
            
            html += `
                <li class="search-dropdown-item ${isSelected ? 'selected' : ''}" onclick="selectSearchFilterTuyenXuat('${escapeHTML(tx)}')">
                    <span>🚛 ${escapeHTML(tx)}</span>
                    <span class="search-dropdown-item-count">${count} chuyến</span>
                </li>
            `;
        });
        html += `</ul>`;
    }
    
    // Render Region Section
    if (filteredRegions.length > 0) {
        html += `<div class="search-dropdown-header">Loại tuyến</div>`;
        html += `<ul class="search-dropdown-list">`;
        filteredRegions.forEach(region => {
            const count = tabData.filter(s => {
                if (region === 'Khác') {
                    return !s.exportRoute; // match empty/missing exportRoute
                }
                return s.exportRoute === region;
            }).length;
            
            const regionVal = region === 'Khác' ? 'khac' : region;
            const isSelected = selectedRegionFilter === regionVal && !selectedSpecificRouteFilter;
            
            html += `
                <li class="search-dropdown-item ${isSelected ? 'selected' : ''}" onclick="selectSearchFilterRegion('${escapeHTML(region)}')">
                    <span>📍 ${escapeHTML(region)}</span>
                    <span class="search-dropdown-item-count">${count} chuyến</span>
                </li>
            `;
        });
        html += `</ul>`;
    }
    
    dropdown.innerHTML = html;
    dropdown.classList.add('show');
};

window.selectSearchFilterStatus = function(statusCode) {
    if (statusCode === 'adjust') {
        switchTab('adjust');
    } else if (statusCode === 'draft') {
        switchTab('draft');
    } else {
        switchTab('deployed');
        filterByStatus(statusCode);
    }
    closeSearchDropdown();
    searchInput.value = '';
};

window.selectSearchFilterPayload = function(payloadName) {
    filterByPayload(payloadName);
    closeSearchDropdown();
    searchInput.value = '';
};

window.selectSearchFilterTuyenXuat = function(tuyenXuatName) {
    filterByTuyenXuat(tuyenXuatName);
    closeSearchDropdown();
    searchInput.value = '';
};

window.selectSearchFilterRegion = function(regionName) {
    const regionVal = regionName === 'Khác' ? 'khac' : regionName;
    filterByRegion(regionVal);
    closeSearchDropdown();
    searchInput.value = '';
};

searchInput.addEventListener('input', (e) => {
    const value = e.target.value;
    renderTable(getFilteredSchedules());
    renderSearchDropdown(value);
});

searchInput.addEventListener('focus', (e) => {
    renderSearchDropdown(e.target.value);
});

btnAdd.addEventListener('click', () => {
    editingScheduleId = null;
    const title = document.getElementById('add-modal-title');
    if(title) title.innerText = 'Thêm Lịch Tải mới';
    
    // Đặt mặc định trạng thái
    const statusSelect = document.getElementById('select-status');
    if(statusSelect) statusSelect.value = 'active';
    
    // Ẩn nút Xoá
    const btnDel = document.getElementById('btn-delete-schedule');
    if(btnDel) btnDel.style.display = 'none';
    
    modal.classList.add('show');
});

function closeModal() {
    modal.classList.remove('show');
    form.reset();
    resetRouteStops();
    
    // Reset Loại tuyến
    const selectRoute = document.getElementById('select-export-route');
    const inputOther = document.getElementById('input-export-route-other');
    if (selectRoute && inputOther) {
        selectRoute.value = '';
        inputOther.style.display = 'none';
        inputOther.value = '';
    }
    
    // Reset Tuyến xuất
    const selectTuyenXuat = document.getElementById('select-tuyen-xuat');
    const inputTuyenXuatOther = document.getElementById('input-tuyen-xuat-other');
    if (selectTuyenXuat && inputTuyenXuatOther) {
        selectTuyenXuat.value = '';
        inputTuyenXuatOther.style.display = 'none';
        inputTuyenXuatOther.value = '';
    }
}

btnClose.addEventListener('click', closeModal);
btnCancel.addEventListener('click', closeModal);

// Đóng modal thêm/sửa khi click ra ngoài vùng modal-content
modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        closeModal();
    }
});

// Dynamic Route Stops logic
const routeContainer = document.getElementById('route-stops-container');
const btnAddStop = document.getElementById('btn-add-stop');
let stopCount = 1;

function resetRouteStops() {
    const rows = routeContainer.querySelectorAll('.route-row');
    rows.forEach((row, index) => {
        if (index > 0) row.remove(); // Keep first row
    });
    stopCount = 1;
}

btnAddStop.addEventListener('click', () => {
    stopCount++;
    const row = document.createElement('div');
    row.className = 'route-row';
    row.innerHTML = `
        <div class="route-index">${stopCount}</div>
        <div class="col-dest">
            <input type="text" required placeholder="Nhập để tìm điểm dừng">
        </div>
        <div class="col-time">
            <input type="time" required value="00:00">
        </div>
        <div class="col-time">
            <input type="time" required value="00:00">
        </div>
        <div class="col-type">
            <select required>
                <option value="">Loại vận hành</option>
                <option value="Lấy">Lấy</option>
                <option value="Giao">Giao</option>
                <option value="Giao và Lấy">Giao và Lấy</option>
                <option value="Phân loại">Phân loại</option>
            </select>
        </div>
        <div class="col-action">
            <button type="button" class="remove-stop-btn">&times;</button>
        </div>
    `;
    
    row.querySelector('.remove-stop-btn').addEventListener('click', function() {
        row.remove();
        updateStopIndices();
    });
    
    routeContainer.appendChild(row);
});

function updateStopIndices() {
    const rows = routeContainer.querySelectorAll('.route-row');
    stopCount = rows.length;
    rows.forEach((row, index) => {
        row.querySelector('.route-index').textContent = index + 1;
    });
}

// Tuyến xuất Logic
const selectTuyenXuat = document.getElementById('select-tuyen-xuat');
const inputTuyenXuatOther = document.getElementById('input-tuyen-xuat-other');
if (selectTuyenXuat && inputTuyenXuatOther) {
    selectTuyenXuat.addEventListener('change', function() {
        if (this.value === 'Khác') {
            inputTuyenXuatOther.style.display = 'inline-block';
            inputTuyenXuatOther.focus();
        } else {
            inputTuyenXuatOther.style.display = 'none';
            inputTuyenXuatOther.value = '';
        }
    });
}

// Loại tuyến Logic
const selectExportRoute = document.getElementById('select-export-route');
const inputExportRouteOther = document.getElementById('input-export-route-other');
if (selectExportRoute && inputExportRouteOther) {
    selectExportRoute.addEventListener('change', function() {
        if (this.value === 'Khác') {
            inputExportRouteOther.style.display = 'inline-block';
            inputExportRouteOther.focus();
        } else {
            inputExportRouteOther.style.display = 'none';
            inputExportRouteOther.value = '';
        }
    });
}

// Submit Form
form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const today = new Date().toISOString().split('T')[0];
    
    // Ràng buộc nhập liệu: Tên tuyến/Mã xe không được trống hoặc chỉ chứa khoảng trắng
    const routeVal = (document.getElementById('input-route') ? document.getElementById('input-route').value : "").trim();
    if (!routeVal) {
        alert("Tên tuyến / Mã xe không được để trống hoặc chỉ chứa khoảng trắng.");
        return;
    }
    
    // Kiểm tra trùng lặp mã tuyến trên hệ thống (loại trừ tuyến đang sửa)
    const isDuplicate = schedules.some(s => s.route.toLowerCase() === routeVal.toLowerCase() && s.id !== editingScheduleId);
    if (isDuplicate) {
        alert(`Tên tuyến / Mã xe "${routeVal}" đã tồn tại trên hệ thống. Vui lòng nhập tên khác.`);
        return;
    }

    const tuyenXuatSelect = document.getElementById('select-tuyen-xuat');
    const tuyenXuatOther = document.getElementById('input-tuyen-xuat-other');
    let tuyenXuat = tuyenXuatSelect ? tuyenXuatSelect.value : "";
    if (tuyenXuat === 'Khác' && tuyenXuatOther) {
        tuyenXuat = tuyenXuatOther.value.trim();
    }
    
    const exportRouteSelect = document.getElementById('select-export-route');
    const exportRouteOther = document.getElementById('input-export-route-other');
    let exportRoute = exportRouteSelect ? exportRouteSelect.value : "";
    if (exportRoute === 'Khác' && exportRouteOther) {
        exportRoute = exportRouteOther.value.trim();
    }

    const stops = [];
    const rows = routeContainer.querySelectorAll('.route-row');
    rows.forEach(row => {
        const destInput = row.querySelector('.col-dest input');
        const arrivalInput = row.querySelectorAll('.col-time input')[0];
        const departureInput = row.querySelectorAll('.col-time input')[1];
        const typeSelect = row.querySelector('.col-type select');
        
        if(destInput && arrivalInput && departureInput && typeSelect) {
            stops.push({
                name: destInput.value.trim(),
                arrival: arrivalInput.value,
                departure: departureInput.value,
                type: typeSelect.value
            });
        }
    });

    // Kiểm duyệt lộ trình: Điểm dừng phải điền đầy đủ giờ (không chặn giờ xuyên đêm)
    let validTimes = true;
    stops.forEach((stop, index) => {
        if (!stop.arrival || !stop.departure) {
            alert(`Lỗi tại điểm dừng thứ ${index + 1}: Vui lòng điền đầy đủ Giờ tới điểm và Giờ rời điểm.`);
            validTimes = false;
        }
    });
    if (!validTimes) return;

    const statusVal = document.getElementById('select-status') ? document.getElementById('select-status').value : "active";

    const newSchedule = {
        id: editingScheduleId || Date.now(),
        route: routeVal,
        payload: document.getElementById('input-payload').value || "Chưa xác định",
        type: stops.length > 0 ? stops[0].type : "Chưa xác định",
        arrival: stops.length > 0 ? `${today}T${stops[0].arrival}` : "",
        departure: stops.length > 0 ? `${today}T${stops[0].departure}` : "",
        status: statusVal,
        exportRoute: exportRoute,
        tuyenXuat: tuyenXuat,
        stops: stops
    };

    if (editingScheduleId) {
        const idx = schedules.findIndex(s => s.id === editingScheduleId);
        if (idx !== -1) {
            schedules[idx] = newSchedule;
        }
        editingScheduleId = null;
    } else {
        schedules.unshift(newSchedule);
    }
    renderTable(getFilteredSchedules());
    searchInput.value = '';
    closeModal();
});

window.viewScheduleDetails = function(id) {
    currentViewingScheduleId = id;
    const schedule = schedules.find(s => s.id === id);
    if (!schedule) return;
    
    const detailsBody = document.getElementById('details-body');
    
    let stopsHtml = '';
    if (schedule.stops && schedule.stops.length > 0) {
        stopsHtml = `
            <div class="timeline">
                ${schedule.stops.map((stop, index) => {
                    let distanceHtml = '';
                    if (index < schedule.stops.length - 1) {
                        const dist = calculateHaversineDistance(stop.name, schedule.stops[index + 1].name);
                        if (dist !== null) {
                            distanceHtml = `
                                <div class="timeline-distance-divider">
                                    <span class="distance-badge">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; margin-right: 4px;">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                                        </svg>
                                        Khoảng cách: <strong>${dist} km</strong>
                                    </span>
                                </div>
                            `;
                        }
                    }
                    return `
                        <div class="timeline-item active">
                            <div class="timeline-dot">${index + 1}</div>
                            <div class="timeline-content">
                                <div class="timeline-info">
                                    <div class="timeline-title">${escapeHTML(stop.name)}</div>
                                    <div class="timeline-times">
                                        <div class="timeline-time-group">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <span class="timeline-time-label">Tới điểm:</span> ${escapeHTML(stop.arrival)}
                                        </div>
                                        <div class="timeline-time-group">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                            </svg>
                                            <span class="timeline-time-label">Rời điểm:</span> ${escapeHTML(stop.departure)}
                                        </div>
                                    </div>
                                </div>
                                <span class="timeline-badge badge-${
                                    stop.type === 'Lấy' ? 'lay' :
                                    stop.type === 'Giao' ? 'giao' :
                                    stop.type === 'Giao và Lấy' ? 'giaolay' :
                                    stop.type === 'Phân loại' ? 'phanloai' : 'lay'
                                }">${escapeHTML(stop.type)}</span>
                            </div>
                        </div>
                        ${distanceHtml}
                    `;
                }).join('')}
            </div>
        `;
    } else {
        stopsHtml = `<p style="padding: 20px; color: var(--text-muted); font-style: italic; text-align: center;">Chưa cấu hình lộ trình điểm dừng cho chuyến xe này.</p>`;
    }

    detailsBody.innerHTML = `
        <div class="details-grid">
            <div class="details-grid-item">
                <span class="details-grid-label">Tuyến xuất</span>
                <span class="details-grid-value">${escapeHTML(schedule.tuyenXuat) || 'Không có'}</span>
            </div>
            <div class="details-grid-item">
                <span class="details-grid-label">Tên tuyến / Mã xe</span>
                <span class="details-grid-value">${escapeHTML(schedule.route)}</span>
            </div>
            <div class="details-grid-item">
                <span class="details-grid-label">Trọng tải / Loại xe</span>
                <span class="details-grid-value">${escapeHTML(schedule.payload)}</span>
            </div>
            <div class="details-grid-item">
                <span class="details-grid-label">Loại tuyến</span>
                <span class="details-grid-value">${escapeHTML(schedule.exportRoute) || 'Không có'}</span>
            </div>
            <div class="details-grid-item">
                <span class="details-grid-label">Trạng thái</span>
                <div>
                    <span class="status-badge status-${schedule.status}">
                        ${schedule.status === 'active' ? 'Đang hoạt động' : 
                          schedule.status === 'off' ? 'OFF' : 
                          schedule.status === 'adjust' ? 'Yêu cầu điều chỉnh' : 
                          schedule.status === 'draft' ? 'Bản nháp' : schedule.status}
                    </span>
                </div>
            </div>
        </div>
        <div class="details-section-title">Lộ trình chi tiết</div>
        ${stopsHtml}
    `;
    
    document.getElementById('details-modal').classList.add('show');
}

const detailsModal = document.getElementById('details-modal');
if (detailsModal) {
    document.getElementById('close-details-modal').addEventListener('click', () => {
        detailsModal.classList.remove('show');
    });
    
    // Đóng modal chi tiết khi click ra ngoài vùng modal-content
    detailsModal.addEventListener('click', (e) => {
        if (e.target === detailsModal) {
            detailsModal.classList.remove('show');
        }
    });
}

// Logic cho nút Chỉnh sửa
const btnEditSchedule = document.getElementById('btn-edit-schedule');
if (btnEditSchedule) {
    btnEditSchedule.addEventListener('click', () => {
        if (!currentViewingScheduleId) return;
        const schedule = schedules.find(s => s.id === currentViewingScheduleId);
        if (!schedule) return;
        
        // Đóng modal chi tiết
        document.getElementById('details-modal').classList.remove('show');
        
        // Thiết lập trạng thái sửa
        editingScheduleId = schedule.id;
        const title = document.getElementById('add-modal-title');
        if(title) title.innerText = 'Chỉnh sửa Lịch Tải';
        
        // Điền dữ liệu chung
        document.getElementById('input-route').value = schedule.route;
        document.getElementById('input-payload').value = schedule.payload;
        
        const statusSelect = document.getElementById('select-status');
        if (statusSelect) statusSelect.value = schedule.status || 'active';
        
        const selectTuyenXuat = document.getElementById('select-tuyen-xuat');
        const inputTuyenXuatOther = document.getElementById('input-tuyen-xuat-other');
        
        if (selectTuyenXuat && inputTuyenXuatOther) {
            const predefinedTuyenXuat = Array.from(selectTuyenXuat.options).map(opt => opt.value);
            if (schedule.tuyenXuat && !predefinedTuyenXuat.includes(schedule.tuyenXuat) && schedule.tuyenXuat !== "") {
                selectTuyenXuat.value = 'Khác';
                inputTuyenXuatOther.style.display = 'inline-block';
                inputTuyenXuatOther.value = schedule.tuyenXuat;
            } else {
                selectTuyenXuat.value = schedule.tuyenXuat || '';
                inputTuyenXuatOther.style.display = 'none';
                inputTuyenXuatOther.value = '';
            }
        }

        const selectRoute = document.getElementById('select-export-route');
        const inputOther = document.getElementById('input-export-route-other');
        
        if (selectRoute && inputOther) {
            const predefinedRoutes = Array.from(selectRoute.options).map(opt => opt.value);
            if (schedule.exportRoute && !predefinedRoutes.includes(schedule.exportRoute) && schedule.exportRoute !== "") {
                selectRoute.value = 'Khác';
                inputOther.style.display = 'inline-block';
                inputOther.value = schedule.exportRoute;
            } else {
                selectRoute.value = schedule.exportRoute || '';
                inputOther.style.display = 'none';
                inputOther.value = '';
            }
        }
        
        // Điền các điểm dừng
        resetRouteStops();
        if (schedule.stops && schedule.stops.length > 0) {
            schedule.stops.forEach((stop, idx) => {
                let row;
                if (idx === 0) {
                    row = document.querySelector('#route-stops-container .route-row');
                } else {
                    document.getElementById('btn-add-stop').click();
                    const rows = document.querySelectorAll('#route-stops-container .route-row');
                    row = rows[rows.length - 1];
                }
                
                row.querySelector('.col-dest input[type="text"]').value = stop.name;
                row.querySelectorAll('.col-time input[type="time"]')[0].value = stop.arrival;
                row.querySelectorAll('.col-time input[type="time"]')[1].value = stop.departure;
                row.querySelector('.col-type select').value = stop.type;
            });
        }
        
        // Hiện nút Xoá
        const btnDel = document.getElementById('btn-delete-schedule');
        if(btnDel) btnDel.style.display = 'inline-block';
        
        // Mở form sửa
        document.getElementById('add-modal').classList.add('show');
    });
}

// Logic xoá Lịch tải với Modal Xác nhận Tự thiết kế (Custom Confirmation popup)
const btnDeleteSchedule = document.getElementById('btn-delete-schedule');
const confirmDeleteModal = document.getElementById('confirm-delete-modal');
const btnConfirmDeleteOk = document.getElementById('btn-confirm-delete-ok');
const btnConfirmDeleteCancel = document.getElementById('btn-confirm-delete-cancel');

if (btnDeleteSchedule && confirmDeleteModal && btnConfirmDeleteOk && btnConfirmDeleteCancel) {
    btnDeleteSchedule.addEventListener('click', () => {
        if (!editingScheduleId) return;
        confirmDeleteModal.classList.add('show');
    });

    btnConfirmDeleteCancel.addEventListener('click', () => {
        confirmDeleteModal.classList.remove('show');
    });

    btnConfirmDeleteOk.addEventListener('click', () => {
        schedules = schedules.filter(s => s.id !== editingScheduleId);
        renderTable(getFilteredSchedules());
        confirmDeleteModal.classList.remove('show');
        closeModal();
    });

    // Đóng modal xác nhận xoá khi click ra ngoài vùng modal-content
    confirmDeleteModal.addEventListener('click', (e) => {
        if (e.target === confirmDeleteModal) {
            confirmDeleteModal.classList.remove('show');
        }
    });
}

renderTable(getFilteredSchedules());

// ==================== EXCEL IMPORT/EXPORT LOGIC ==================== //

// 1. Tải file mẫu (Hỗ trợ cột Trạng thái mới)
const btnDownloadTemplate = document.getElementById('btn-download-template');
if (btnDownloadTemplate) {
    btnDownloadTemplate.addEventListener('click', () => {
        if (typeof XLSX === 'undefined') {
            alert("Hệ thống đang tải thư viện Excel. Vui lòng thử lại sau vài giây.");
            return;
        }
        const ws_data = [
            ["Tuyến xuất", "Tên tuyến", "Tải trọng", "Tên Kho", "Loại hình", "Tới điểm", "Rời điểm", "Loại tuyến", "Trạng thái"],
            ["Nội Thành", "HCM_LĐ_01", "Tải 8 tấn", "Kho Trung Chuyển Hồ Chí Minh 20", "Phân loại", "13:00", "14:00", "Nội Thành", "Đang hoạt động"],
            ["Nội Thành", "HCM_LĐ_01", "Tải 8 tấn", "Kho Chuyển Tiếp Lâm Đồng", "Giao và Lấy", "21:00", "22:30", "Nội Thành", "Đang hoạt động"],
            ["Liên Vùng", "HN_HP_02", "Container (40T)", "Kho Trung Chuyển Hải Phòng", "Giao", "08:00", "09:00", "Miền Bắc", "Đang hoạt động"],
            ["Nội Vùng", "HCM_VT_08", "Tải Van", "Bưu cục Vũng Tàu", "Lấy", "09:00", "10:00", "Nội Vùng", "Bản nháp"]
        ];
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        
        ws['!cols'] = [
            { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 35 }, { wch: 15 }, 
            { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 15 }
        ];
        
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "LichTai_Template.xlsx");
    });
}

// 2. Nhập dữ liệu từ file
const excelFileInput = document.getElementById('excel-file-input');
const btnImportExcel = document.getElementById('btn-import-excel');

if (btnImportExcel && excelFileInput) {
    btnImportExcel.addEventListener('click', () => {
        if (typeof XLSX === 'undefined') {
            alert("Hệ thống đang tải thư viện Excel. Vui lòng thử lại sau vài giây.");
            return;
        }
        excelFileInput.click();
    });

    excelFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (json.length < 2) {
                    alert("File Excel không có dữ liệu!");
                    return;
                }

                // Tự động phát hiện nếu file tải lên là danh sách Tọa độ kho (Location.xlsx)
                const headerRowTemp = json[0];
                const findColTemp = (keywords) => {
                    for (let i = 0; i < headerRowTemp.length; i++) {
                        const h = headerRowTemp[i] ? headerRowTemp[i].toString().toLowerCase() : "";
                        if (keywords.some(k => h.includes(k))) return i;
                    }
                    return -1;
                };
                
                let idxWarehouseName = findColTemp(["warehouse_name", "tên kho", "tên bưu cục"]);
                let idxLatitude = findColTemp(["latitude", "vĩ độ", "lat"]);
                let idxLongitude = findColTemp(["longitude", "kinh độ", "lng"]);
                let idxRouteTemp = findColTemp(["tên tuyến", "mã xe"]);
                
                if (idxWarehouseName !== -1 && idxLatitude !== -1 && idxLongitude !== -1 && idxRouteTemp === -1) {
                    const customCoords = {};
                    for (let i = 1; i < json.length; i++) {
                        const row = json[i];
                        if (row && row[idxWarehouseName] && row[idxLatitude] != null && row[idxLongitude] != null) {
                            const name = row[idxWarehouseName].toString().trim();
                            customCoords[name] = {
                                lat: parseFloat(row[idxLatitude]),
                                lng: parseFloat(row[idxLongitude])
                            };
                        }
                    }
                    
                    // Lưu trữ tùy biến vĩnh viễn vào localStorage
                    localStorage.setItem('GHN_WAREHOUSE_COORDINATES_CUSTOM', JSON.stringify(customCoords));
                    
                    // Cập nhật mảng tọa độ hiện tại trong bộ nhớ ứng dụng
                    Object.assign(WAREHOUSE_COORDINATES, customCoords);
                    
                    alert(`Đã cập nhật danh bạ tọa độ thành công cho ${Object.keys(customCoords).length} kho hàng từ file Excel!`);
                    excelFileInput.value = '';
                    return;
                }
                
                const today = new Date().toISOString().split('T')[0];
                const groupedSchedules = {};
                
                // Hàm chuẩn hoá Trọng tải
                const standardizePayload = (rawPayload) => {
                    if (!rawPayload) return "Chưa xác định";
                    const str = rawPayload.toString().toLowerCase().trim();
                    
                    if (str.includes("van")) return "Tải Van";
                    if (str.includes("container") || str.includes("40t")) return "Container (40T)";
                    
                    const numMatch = str.match(/(\d+[.,]?\d*)/);
                    if (!numMatch) {
                        // Trả về exact match nếu có, còn ko trả về Chưa xác định
                        const exactOptions = ["Tải Van", "Tải 2 tấn", "Tải 5 tấn", "Tải 6 tấn 5", "Tải 8 tấn", "Tải 15 tấn", "Container (40T)"];
                        const match = exactOptions.find(opt => opt.toLowerCase() === str);
                        return match || "Chưa xác định";
                    }
                    
                    let num = parseFloat(numMatch[1].replace(',', '.'));
                    
                    if (num > 100) {
                        if (num <= 1500) return "Tải Van";
                        if (num <= 2000) return "Tải 2 tấn";
                        if (num <= 5000) return "Tải 5 tấn";
                        if (num <= 6500) return "Tải 6 tấn 5";
                        if (num <= 8000) return "Tải 8 tấn";
                        if (num <= 15000) return "Tải 15 tấn";
                        return "Container (40T)";
                    } else {
                        if (num <= 1.5) return "Tải Van";
                        if (num <= 2) return "Tải 2 tấn";
                        if (num <= 5) return "Tải 5 tấn";
                        if (num <= 6.5) return "Tải 6 tấn 5";
                        if (num <= 8) return "Tải 8 tấn";
                        if (num <= 15) return "Tải 15 tấn";
                        return "Container (40T)";
                    }
                };

                // Nhận diện cột tự động từ dòng tiêu đề (header)
                const headerRow = json[0];
                const findCol = (keywords) => {
                    for (let i = 0; i < headerRow.length; i++) {
                        const h = headerRow[i] ? headerRow[i].toString().toLowerCase() : "";
                        if (keywords.some(k => h.includes(k))) return i;
                    }
                    return -1;
                };

                let idxRoute = findCol(["tên tuyến", "mã xe"]); 
                let idxPayload = findCol(["tải trọng", "trọng tải"]); 
                let idxDest = findCol(["tên kho", "điểm đến"]); 
                let idxType = findCol(["loại hình", "vận hành"]); 
                let idxArr = findCol(["tới điểm", "giờ đến"]); 
                let idxDep = findCol(["rời điểm", "giờ đi"]); 
                let idxExport = findCol(["loại tuyến"]); 
                let idxTuyenXuat = findCol(["tuyến xuất"]);
                let idxStatus = findCol(["trạng thái", "tình trạng"]);
                
                // Fallback cho file template cũ (khi chỉ có cột "Tuyến xuất", thực chất là "Loại tuyến")
                if (idxExport === -1 && idxTuyenXuat !== -1) {
                    idxExport = idxTuyenXuat;
                    idxTuyenXuat = -1;
                }
                
                // Fallback nếu không tìm thấy header chuẩn
                if (idxRoute === -1 && idxPayload === -1 && idxDest === -1) {
                    idxTuyenXuat = 0;
                    idxRoute = 1;
                    idxPayload = 2;
                    idxDest = 3;
                    idxType = 4;
                    idxArr = 5;
                    idxDep = 6;
                    idxExport = 7;
                    idxStatus = 8;
                } else {
                    if (idxRoute === -1) idxRoute = 0;
                    if (idxPayload === -1) idxPayload = 1;
                    if (idxDest === -1) idxDest = 2;
                    if (idxType === -1) idxType = 3;
                    if (idxArr === -1) idxArr = 4;
                    if (idxDep === -1) idxDep = 5;
                }

                for (let i = 1; i < json.length; i++) {
                    const row = json[i];
                    if (!row || row.length === 0 || !row[idxRoute]) continue; // Bỏ qua dòng trống
                    
                    const routeName = row[idxRoute] ? row[idxRoute].toString().trim() : "Chưa xác định";
                    const tuyenXuat = (idxTuyenXuat !== -1 && row[idxTuyenXuat]) ? row[idxTuyenXuat].toString().trim() : "";
                    const exportRoute = (idxExport !== -1 && row[idxExport]) ? row[idxExport].toString().trim() : "";
                    const rawPayload = row[idxPayload] ? row[idxPayload].toString().trim() : "";
                    const payload = standardizePayload(rawPayload);
                    const dest = row[idxDest] ? row[idxDest].toString().trim() : "Không rõ";
                    const rawStatus = (idxStatus !== -1 && row[idxStatus]) ? row[idxStatus].toString().trim().toLowerCase() : "";

                    let status = 'active'; // Mặc định
                    if (rawStatus.includes("nháp") || rawStatus.includes("draft")) status = 'draft';
                    else if (rawStatus.includes("điều chỉnh") || rawStatus.includes("adjust")) status = 'adjust';
                    else if (rawStatus.includes("off")) status = 'off';
                    else if (rawStatus.includes("hoạt động") || rawStatus.includes("active")) status = 'active';

                    let arrival = row[idxArr] != null ? row[idxArr].toString().trim() : "00:00";
                    let departure = row[idxDep] != null ? row[idxDep].toString().trim() : "00:00";
                    
                    // Convert excel time to HH:mm if needed & clean alternate formats (e.g. 13h30, 13.30)
                    const formatTime = (timeStr) => {
                        if (!timeStr) return "00:00";
                        timeStr = timeStr.toString().trim();
                        if (!isNaN(parseFloat(timeStr)) && timeStr.indexOf(':') === -1) {
                            const totalMins = Math.round(parseFloat(timeStr) * 24 * 60);
                            const h = Math.floor(totalMins / 60);
                            const m = totalMins % 60;
                            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                        }
                        // Thay thế "h" hoặc dấu chấm "." bằng dấu ":"
                        let cleanStr = timeStr.replace(/h/gi, ':').replace(/\./g, ':');
                        const match = cleanStr.match(/(\d{1,2}):(\d{2})/);
                        if (match) {
                            const h = parseInt(match[1]).toString().padStart(2, '0');
                            const m = match[2];
                            return `${h}:${m}`;
                        }
                        return timeStr;
                    };
                    
                    arrival = formatTime(arrival);
                    departure = formatTime(departure);
                    
                    // Ràng buộc tính đúng đắn của chuỗi giờ HH:mm để ngăn chặn lỗi RangeError khi render
                    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
                    if (!timeRegex.test(arrival)) arrival = "00:00";
                    if (!timeRegex.test(departure)) departure = "00:00";
                    
                    const type = row[idxType] ? row[idxType].toString().trim() : "Lấy";
                    
                    if (!groupedSchedules[routeName]) {
                        groupedSchedules[routeName] = {
                            id: Date.now() + i, // Unique ID
                            route: routeName,
                            payload: payload,
                            exportRoute: exportRoute,
                            tuyenXuat: tuyenXuat,
                            status: status,
                            stops: []
                        };
                    } else {
                        if (!groupedSchedules[routeName].tuyenXuat && tuyenXuat) {
                            groupedSchedules[routeName].tuyenXuat = tuyenXuat;
                        }
                    }
                    
                    groupedSchedules[routeName].stops.push({
                        name: dest,
                        arrival: arrival,
                        departure: departure,
                        type: type
                    });
                }
                
                let countImported = 0;
                Object.values(groupedSchedules).forEach(sched => {
                    if (sched.stops.length > 0) {
                        sched.type = sched.stops[0].type;
                        sched.arrival = `${today}T${sched.stops[0].arrival}`;
                        sched.departure = `${today}T${sched.stops[0].departure}`;
                    }
                    schedules.unshift(sched);
                    countImported++;
                });
                
                renderTable(getFilteredSchedules());
                alert(`Đã nhập thành công ${countImported} chuyến xe với tổng cộng ${Object.values(groupedSchedules).reduce((a,b)=>a+b.stops.length,0)} điểm dừng!`);
                
            } catch (error) {
                console.error(error);
                alert("Đã xảy ra lỗi khi đọc file Excel. Vui lòng kiểm tra lại định dạng file.");
            } finally {
                excelFileInput.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// Register click event listeners for E2E Interactive Filters
const kpiCardActive = document.getElementById('kpi-card-active');
if (kpiCardActive) {
    kpiCardActive.addEventListener('click', () => {
        if (selectedStatusFilter === 'active') {
            resetFilters();
        } else {
            filterByStatus('active');
        }
    });
}

const kpiCardOff = document.getElementById('kpi-card-off');
if (kpiCardOff) {
    kpiCardOff.addEventListener('click', () => {
        if (selectedStatusFilter === 'off') {
            resetFilters();
        } else {
            filterByStatus('off');
        }
    });
}

const filterIndicator = document.getElementById('filter-indicator');
if (filterIndicator) {
    filterIndicator.addEventListener('click', resetFilters);
}

// Dismiss route popover when clicking outside of it
// Dismiss route popover or search dropdown when clicking outside of them
document.addEventListener('click', (e) => {
    const popover = document.getElementById('kpi-route-popover');
    if (popover) {
        if (!popover.contains(e.target) && !e.target.closest('.kpi-breakdown-item')) {
            closeRoutePopover();
        }
    }
    
    const searchDropdown = document.getElementById('search-dropdown');
    const searchBar = document.querySelector('.search-bar');
    if (searchDropdown && searchBar) {
        if (!searchBar.contains(e.target)) {
            closeSearchDropdown();
        }
    }
});

// Close popover and search dropdown when resizing window to avoid positioning bugs
window.addEventListener('resize', () => {
    closeRoutePopover();
    closeSearchDropdown();
});
