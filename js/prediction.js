/* ═══════════════════════════════════════════════════
   prediction.js — Predictive Capacity Planning Logic
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  window.predictionData = [];

  const fmt = n => n != null ? n.toLocaleString('vi-VN') : '0';
  
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

  // Helper date & string functions
  function getTodayString() {
    const now = new Date();
    const tzOffset = 7 * 60; // GMT+7
    const localTime = new Date(now.getTime() + (now.getTimezoneOffset() + tzOffset) * 60 * 1000);
    const day = String(localTime.getDate()).padStart(2, '0');
    const month = String(localTime.getMonth() + 1).padStart(2, '0');
    const year = localTime.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function getTripHour(trip) {
    if (trip.time && typeof trip.time === 'string') {
      const parts = trip.time.split(':');
      if (parts.length > 0) {
        const hour = parseInt(parts[0], 10);
        if (!isNaN(hour) && hour >= 0 && hour <= 23) return hour;
      }
    }
    if (trip.slot && typeof trip.slot === 'string') {
      const parts = trip.slot.split(':');
      if (parts.length > 0) {
        const hour = parseInt(parts[0], 10);
        if (!isNaN(hour) && hour >= 0 && hour <= 23) return hour;
      }
    }
    return 0;
  }

  function parseCapacity(capacityStr) {
    if (!capacityStr) return 0;
    // Extract numeric values from string (e.g., "2.5 tấn" -> 2.5)
    const match = capacityStr.toString().replace(',', '.').match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }

  // Local Storage Settings
  function getPredictionTAvg() {
    const stored = localStorage.getItem('pred_sim_t_avg');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 15 && parsed <= 90) return parsed;
    }
    return 30;
  }

  function savePredictionTAvg(val) {
    localStorage.setItem('pred_sim_t_avg', val);
  }

  function getPredictionUTarget() {
    const stored = localStorage.getItem('pred_sim_u_target');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 50 && parsed <= 100) return parsed;
    }
    return 80; // Default 80% utilization target
  }

  function savePredictionUTarget(val) {
    localStorage.setItem('pred_sim_u_target', val);
  }

  // Calculate prediction matrices
  function calculatePrediction() {
    if (!window.tripScanData || window.tripScanData.length === 0) {
      window.predictionData = [];
      return;
    }

    const todayStr = getTodayString();
    
    // Group unique dates in history
    const uniqueDates = [...new Set(window.tripScanData.map(t => t.date))].filter(Boolean);
    // Exclude today to avoid incomplete statistics
    const historicalDates = uniqueDates.filter(d => d !== todayStr);
    
    // Fallback to all dates if only today is present
    const datesToUse = historicalDates.length > 0 ? historicalDates : uniqueDates;
    const numDays = datesToUse.length || 1;

    // Initialize hourly matrices
    const hourlyCounts = Array(24).fill(0).map(() => ({}));
    const hourlyCapacities = Array(24).fill(0).map(() => ({}));

    datesToUse.forEach(d => {
      for (let h = 0; h < 24; h++) {
        hourlyCounts[h][d] = 0;
        hourlyCapacities[h][d] = 0;
      }
    });

    // Populate data
    window.tripScanData.forEach(t => {
      if (t.date && datesToUse.includes(t.date)) {
        const h = getTripHour(t);
        if (hourlyCounts[h] && t.date in hourlyCounts[h]) {
          hourlyCounts[h][t.date]++;
          
          const cap = parseCapacity(t.capacity);
          hourlyCapacities[h][t.date] += cap;
        }
      }
    });

    // Compute averages
    const prediction = [];
    const tAvg = getPredictionTAvg();
    const uTarget = getPredictionUTarget() / 100;

    for (let h = 0; h < 24; h++) {
      let sumTrips = 0;
      let sumCapacity = 0;
      
      datesToUse.forEach(d => {
        sumTrips += hourlyCounts[h][d] || 0;
        sumCapacity += hourlyCapacities[h][d] || 0;
      });

      const avgArrivals = sumTrips / numDays;
      const avgCapacity = sumCapacity / numDays;

      // S_rec formula: ceiling of (AvgArrivals * T_avg) / (60 * U_target)
      let recDocks = 0;
      if (avgArrivals > 0.05) {
        recDocks = Math.max(1, Math.ceil((avgArrivals * tAvg) / (60 * uTarget)));
      }

      // Cap recommended doors at 8 for physical capacity safety
      if (recDocks > 8) {
        recDocks = 8;
      }

      prediction.push({
        hour: h,
        avgArrivals: avgArrivals,
        avgCapacity: avgCapacity,
        recDocks: recDocks,
        workloadMinutes: avgArrivals * tAvg
      });
    }

    window.predictionData = prediction;
    window.predictionDaysCount = numDays;
  }

  function getShiftName(hour) {
    if (hour >= 6 && hour < 14) return 'Ca 1 (Sáng)';
    if (hour >= 14 && hour < 22) return 'Ca 2 (Chiều)';
    return 'Ca 3 (Đêm)';
  }

  function renderPredictionDashboard() {
    calculatePrediction();

    const data = window.predictionData;
    if (data.length === 0) {
      const mainContainer = document.getElementById('tab-content-prediction');
      if (mainContainer) {
        mainContainer.innerHTML = '<div style="text-align:center;padding:100px;color:var(--text-muted);">Không có dữ liệu lịch sử để lập dự báo. Vui lòng cập nhật dữ liệu TripScan!</div>';
      }
      return;
    }

    const tAvg = getPredictionTAvg();
    const uTarget = getPredictionUTarget();

    // 1. Update Sliders Display
    const sliderT = document.getElementById('pred-sim-t-avg');
    const labelT = document.getElementById('pred-sim-t-avg-val');
    if (sliderT && labelT) {
      sliderT.value = tAvg;
      labelT.textContent = `${tAvg} phút`;
    }

    const sliderU = document.getElementById('pred-sim-u-target');
    const labelU = document.getElementById('pred-sim-u-target-val');
    if (sliderU && labelU) {
      sliderU.value = uTarget;
      labelU.textContent = `${uTarget}%`;
    }

    // 2. Compute KPI Metrics
    const totalPredictedTrips = data.reduce((s, h) => s + h.avgArrivals, 0);
    const totalEstCapacity = data.reduce((s, h) => s + h.avgCapacity, 0);
    const totalWorkloadHours = data.reduce((s, h) => s + h.workloadMinutes, 0) / 60;
    
    // Find peak hour and peak docks
    let peakHour = 0;
    let maxArrivals = 0;
    let maxDocks = 0;

    data.forEach(h => {
      if (h.avgArrivals > maxArrivals) {
        maxArrivals = h.avgArrivals;
        peakHour = h.hour;
      }
      if (h.recDocks > maxDocks) {
        maxDocks = h.recDocks;
      }
    });

    // Update KPI UI
    const kpiTripsEl = document.getElementById('pred-kpi-trips');
    if (kpiTripsEl) kpiTripsEl.textContent = totalPredictedTrips.toFixed(1);

    const kpiWorkloadEl = document.getElementById('pred-kpi-workload');
    if (kpiWorkloadEl) kpiWorkloadEl.textContent = totalWorkloadHours.toFixed(1) + 'h';

    const kpiPeakHourEl = document.getElementById('pred-kpi-peakhour');
    if (kpiPeakHourEl) kpiPeakHourEl.textContent = `${String(peakHour).padStart(2, '0')}:00 - ${String((peakHour + 1) % 24).padStart(2, '0')}:00`;

    const kpiPeakDocksEl = document.getElementById('pred-kpi-peakdocks');
    if (kpiPeakDocksEl) kpiPeakDocksEl.textContent = `${maxDocks} cửa`;

    // 3. Render AI Advisory Recommendations
    renderAdvisoryPanel(data, peakHour, maxArrivals, maxDocks);

    // 4. Render 24h Vertical Chart
    renderPredictionChart(data);

    // 5. Render Shift Table
    renderShiftPlanningTable(data);
  }

  function renderAdvisoryPanel(data, peakHour, maxArrivals, maxDocks) {
    const container = document.getElementById('pred-advisory-list');
    if (!container) return;
    container.innerHTML = '';

    const advises = [];

    // Rule 1: High peak hours advising
    const peakHourStr = `${String(peakHour).padStart(2, '0')}:00 - ${String((peakHour + 1) % 24).padStart(2, '0')}:00`;
    advises.push({
      type: 'warning',
      title: `⚡ Khung giờ cao điểm: ${peakHourStr}`,
      message: `Dự kiến xe về đạt đỉnh <strong>${maxArrivals.toFixed(1)} xe/giờ</strong>. Khuyến nghị mở tối thiểu <strong>${maxDocks} cửa tải</strong> để tránh ùn tắc và giải phóng xe nhanh nhất.`
    });

    // Rule 2: Shift-specific planning advice
    // Calculate shift workload
    const shiftStats = {
      'Ca 1': { trips: 0, docksMax: 0, hours: [] },
      'Ca 2': { trips: 0, docksMax: 0, hours: [] },
      'Ca 3': { trips: 0, docksMax: 0, hours: [] }
    };

    data.forEach(h => {
      let shift = 'Ca 3';
      if (h.hour >= 6 && h.hour < 14) shift = 'Ca 1';
      else if (h.hour >= 14 && h.hour < 22) shift = 'Ca 2';

      shiftStats[shift].trips += h.avgArrivals;
      if (h.recDocks > shiftStats[shift].docksMax) {
        shiftStats[shift].docksMax = h.recDocks;
      }
    });

    // Ca 1 Advisory
    advises.push({
      type: 'info',
      title: `🌅 Kế hoạch Ca 1 (06h - 14h)`,
      message: `Tổng lượng xe dự kiến: <strong>${shiftStats['Ca 1'].trips.toFixed(1)} xe</strong>. Khuyên dùng tối đa <strong>${shiftStats['Ca 1'].docksMax} cửa tải</strong>. Bố trí khoảng <strong>${Math.ceil(shiftStats['Ca 1'].trips * 0.7)} nhân sự</strong> vận hành.`
    });

    // Ca 2 Advisory
    advises.push({
      type: 'info',
      title: `🌇 Kế hoạch Ca 2 (14h - 22h)`,
      message: `Tổng lượng xe dự kiến: <strong>${shiftStats['Ca 2'].trips.toFixed(1)} xe</strong>. Khuyên dùng tối đa <strong>${shiftStats['Ca 2'].docksMax} cửa tải</strong>. Cần tăng cường nhân sự dỡ hàng để giải quyết khung giờ cao điểm lúc chiều.`
    });

    // Ca 3 Advisory
    const ca3OffPeakHourStart = 2; // 02:00
    const ca3OffPeakHourEnd = 5; // 05:00
    advises.push({
      type: 'success',
      title: `🌃 Kế hoạch Ca 3 (22h - 06h)`,
      message: `Tổng lượng xe dự kiến: <strong>${shiftStats['Ca 3'].trips.toFixed(1)} xe</strong>. Khung giờ <strong>02h-05h</strong> xe về rất thấp (< 0.8 xe/h), khuyến nghị giảm tối đa còn <strong>1-2 cửa tải</strong> mở để tối ưu hóa điện năng và nhân sự trực đêm.`
    });

    // Render cards
    advises.forEach(adv => {
      const card = document.createElement('div');
      card.className = `kpi-card dock-advisory-card ${adv.type}`;
      card.style.padding = '12px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '4px';

      let titleColor = 'var(--text-primary)';
      if (adv.type === 'warning') titleColor = 'var(--red)';
      else if (adv.type === 'info') titleColor = 'var(--blue)';
      else if (adv.type === 'success') titleColor = 'var(--green)';

      card.innerHTML = `
        <div style="font-weight: 700; color: ${titleColor}; font-size: 0.78rem;">${adv.title}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.4;">${adv.message}</div>
      `;
      container.appendChild(card);
    });
  }

  function renderPredictionChart(data) {
    const chartContainer = document.getElementById('pred-chart-container');
    if (!chartContainer) return;
    chartContainer.innerHTML = '';

    const maxArrivals = Math.max(...data.map(h => h.avgArrivals), 1);
    const scaleMax = maxArrivals * 1.15; // 15% top padding

    data.forEach(h => {
      const wrapper = document.createElement('div');
      wrapper.className = 'flow-chart-bar-wrapper';
      wrapper.style.cursor = 'help';
      
      const barHeight = (h.avgArrivals / scaleMax) * 100;
      const hourStr = String(h.hour).padStart(2, '0') + 'h';

      // Floating indicator dot/badge for recommended doors
      // Represent recommended doors visually at a proportional height
      const recBadgeStyle = h.recDocks > 4 ? 'background: var(--red); color: white;' : h.recDocks >= 2 ? 'background: var(--yellow); color: #0f172a;' : 'background: var(--green); color: #0f172a;';

      const tooltipText = `Khung giờ: ${String(h.hour).padStart(2, '0')}:00 - ${String((h.hour + 1) % 24).padStart(2, '0')}:00\n` +
                          `• Dự báo xe về: ${h.avgArrivals.toFixed(2)} xe/h\n` +
                          `• Khối lượng hàng (ước tính): ~${h.avgCapacity.toFixed(1)} tấn\n` +
                          `• Cửa tải khuyên mở: ${h.recDocks} cửa\n` +
                          `• Tổng thời gian dỡ: ${h.workloadMinutes.toFixed(0)} phút`;

      wrapper.title = tooltipText;

      wrapper.innerHTML = `
        <div class="flow-chart-bar-stack" style="height: 100%; display: flex; flex-direction: column; justify-content: flex-end;">
          <!-- Custom indicator of recommended docks inside the column -->
          <div class="pred-rec-badge" style="
            width: 18px; 
            height: 18px; 
            border-radius: 50%; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-size: 0.62rem; 
            font-weight: 800; 
            margin: 0 auto 6px; 
            ${recBadgeStyle}
            box-shadow: 0 0 6px rgba(255,255,255,0.1);
          ">${h.recDocks}</div>
          <div class="flow-bar-segment processed" style="
            height: ${barHeight}%; 
            background: linear-gradient(180deg, var(--blue), rgba(96, 165, 250, 0.25));
            border-radius: 4px 4px 0 0;
          "></div>
        </div>
        <span class="flow-chart-label" style="transform: rotate(0deg); margin-left: 0; margin-top: 6px;">${hourStr}</span>
      `;

      chartContainer.appendChild(wrapper);
    });
  }

  function renderShiftPlanningTable(data) {
    const tbody = document.getElementById('pred-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    data.forEach(h => {
      const hourStr = `${String(h.hour).padStart(2, '0')}:00 - ${String((h.hour + 1) % 24).padStart(2, '0')}:00`;
      const shiftName = getShiftName(h.hour);
      const estTons = h.avgCapacity > 0 ? `${h.avgCapacity.toFixed(1)} tấn` : '—';
      const workload = `${h.workloadMinutes.toFixed(0)}p`;

      // Status Badge based on arrivals count
      let statusBadge = '<span style="display:inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; background:rgba(52,211,153,0.15); color:var(--green);">Thấp Điểm</span>';
      if (h.avgArrivals >= 3.0) {
        statusBadge = '<span style="display:inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; background:rgba(248,113,113,0.15); color:var(--red);">Cao Điểm</span>';
      } else if (h.avgArrivals >= 1.2) {
        statusBadge = '<span style="display:inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; background:rgba(251,191,36,0.15); color:var(--yellow);">Bình Thường</span>';
      }

      // Recommended Docks Badge
      const recBadgeStyle = h.recDocks > 4 ? 'background: rgba(248,113,113,0.15); color: var(--red); border: 1px solid rgba(248,113,113,0.3);' : h.recDocks >= 2 ? 'background: rgba(251,191,36,0.15); color: var(--yellow); border: 1px solid rgba(251,191,36,0.3);' : 'background: rgba(52,211,153,0.15); color: var(--green); border: 1px solid rgba(52,211,153,0.3);';

      // Specific advice
      let actionAdvice = `Khuyến nghị mở ${h.recDocks} cửa tải.`;
      if (h.recDocks >= 5) {
        actionAdvice = `🔥 Xe về dồn dập, tăng cường tối đa nhân sự, mở ${h.recDocks} cửa dỡ.`;
      } else if (h.recDocks === 1 && h.avgArrivals < 0.5) {
        actionAdvice = `💤 Xe về thưa thớt, duy trì 1 cửa tải chính.`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align: left; padding: 10px; font-family: 'JetBrains Mono', monospace; font-size: 0.76rem; font-weight: 600; color: var(--text-primary);">${hourStr}</td>
        <td style="text-align: center; font-size: 0.72rem; color: var(--text-muted);">${shiftName}</td>
        <td style="text-align: center; font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--blue);">${h.avgArrivals.toFixed(2)} xe</td>
        <td style="text-align: center; font-family: 'JetBrains Mono', monospace; color: var(--text-muted);">${estTons}</td>
        <td style="text-align: center; font-family: 'JetBrains Mono', monospace; color: var(--text-muted);">${workload}</td>
        <td style="text-align: center;">${statusBadge}</td>
        <td style="text-align: center; padding: 4px 0;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.72rem; font-family: 'JetBrains Mono', monospace; ${recBadgeStyle}">
            ${h.recDocks} CỬA
          </span>
        </td>
        <td style="text-align: left; padding-left: 10px; font-size: 0.72rem; color: var(--text-muted);">${actionAdvice}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function initPrediction() {
    // Sliders event listeners
    const sliderT = document.getElementById('pred-sim-t-avg');
    const sliderU = document.getElementById('pred-sim-u-target');

    if (sliderT) {
      sliderT.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const label = document.getElementById('pred-sim-t-avg-val');
        if (label) label.textContent = `${val} phút`;
        savePredictionTAvg(val);
        renderPredictionDashboard();
      });
    }

    if (sliderU) {
      sliderU.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const label = document.getElementById('pred-sim-u-target-val');
        if (label) label.textContent = `${val}%`;
        savePredictionUTarget(val);
        renderPredictionDashboard();
      });
    }
  }

  // Expose global methods
  window.prediction = {
    initPrediction,
    renderPredictionDashboard,
    getPredictionTAvg,
    getPredictionUTarget
  };

})();
