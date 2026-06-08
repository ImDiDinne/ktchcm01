/* ═══════════════════════════════════════════════════
   charts.js — Chart Rendering Functions
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  const COLORS = ['#fb923c', '#60a5fa', '#34d399', '#a78bfa', '#f87171', '#22d3ee', '#fbbf24'];

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

  // Helper functions for drawing SVG arcs
  function polarToCartesian(cx, cy, r, deg) {
    const rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(cx, cy, r, startAngle, endAngle, color) {
    const s = polarToCartesian(cx, cy, r, endAngle);
    const e = polarToCartesian(cx, cy, r, startAngle);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `<path d="M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>`;
  }

  // Render SVG Donut Chart
  function renderDonutChart(containerId, routes, grandTotal) {
    const donutEl = document.getElementById(containerId);
    if (!donutEl) return;
    donutEl.innerHTML = ''; 
    
    if (grandTotal > 0 && routes && routes.length > 0) {
      let angleStart = 0;
      const slices = routes.map((r, i) => ({
        name: r.name, value: r.total, color: COLORS[i % COLORS.length],
        pct: (r.total / grandTotal * 100)
      }));

      let svgPaths = '';
      slices.forEach(s => {
        let angle = (s.value / grandTotal) * 360;
        if (angle >= 360) angle = 359.99; // Tránh lỗi góc 360 độ khiến SVG biến mất
        svgPaths += describeArc(70, 70, 52, angleStart, angleStart + angle - (angle >= 359.99 ? 0 : 0.5), s.color);
        angleStart += angle;
      });

      donutEl.innerHTML = `
        <svg class="donut-svg" viewBox="0 0 140 140">
          ${svgPaths}
          <circle cx="70" cy="70" r="36" fill="var(--bg-secondary)"/>
          <text x="70" y="66" text-anchor="middle" fill="var(--text-primary)" font-size="15" font-weight="800" font-family="JetBrains Mono">${(grandTotal/1000).toFixed(0)}K</text>
          <text x="70" y="82" text-anchor="middle" fill="var(--text-muted)" font-size="9" font-family="Inter">đơn hàng</text>
        </svg>
        <div class="donut-legend">
          ${slices.map(s => `
            <div class="legend-item">
              <span class="legend-color" style="background:${s.color}"></span>
              <span class="legend-name">${escapeHTML(s.name)}</span>
              <span class="legend-value">${fmt(s.value)}</span>
              <span class="legend-pct">${s.pct.toFixed(1)}%</span>
            </div>
          `).join('')}
        </div>`;
    } else {
      donutEl.innerHTML = '<div style="margin:auto;color:var(--text-muted);font-size:0.9rem">Không có dữ liệu biểu đồ</div>';
    }
  }

  // Render CSS Aging Bar Chart
  function renderAgingBars(containerId, routes, agingKeys, grandTotal) {
    const agingEl = document.getElementById(containerId);
    if (!agingEl) return;
    agingEl.innerHTML = ''; 
    
    if (grandTotal > 0 && routes && routes.length > 0) {
      const agingTotals = agingKeys.map(k => routes.reduce((s, r) => s + ((r.aging || {})[k] || 0), 0));
      const maxAging = Math.max(...agingTotals);

      agingTotals.forEach((v, i) => {
        const barClass = i <= 1 ? 'safe' : i <= 3 ? 'warn' : 'danger';
        const width = maxAging ? (v / maxAging * 100) : 0;
        const item = document.createElement('div');
        item.className = 'bar-item';
        item.innerHTML = `
          <span class="bar-label">${agingKeys[i].replace(/^\d+\.\s*/, '')}h</span>
          <div class="bar-track">
            <div class="bar-fill ${barClass}" style="width:0%"></div>
          </div>
          <span class="bar-count">${fmt(v)}</span>`;
        agingEl.appendChild(item);
        
        // Trigger width animation
        requestAnimationFrame(() => {
          setTimeout(() => {
            const el = item.querySelector('.bar-fill');
            if (el) el.style.width = width + '%';
          }, 100 + i * 40);
        });
      });
    } else {
      agingEl.innerHTML = '<div style="margin:auto;color:var(--text-muted);font-size:0.9rem">Không có dữ liệu thời gian tồn</div>';
    }
  }

  // Render Inbound Hourly Flow Simulation Stack Bar Chart
  function renderFlowChart(containerId, simulation, tAvg) {
    const chartContainer = document.getElementById(containerId);
    if (!chartContainer) return;
    chartContainer.innerHTML = '';
    
    const maxVal = Math.max(...simulation.map(s => Math.max(s.capacity, s.processed + s.queue)), 1);
    const scaleMax = maxVal * 1.15; // 15% top padding
    
    simulation.forEach(s => {
      const wrapper = document.createElement('div');
      wrapper.className = 'flow-chart-bar-wrapper';
      
      const capBottom = (s.capacity / scaleMax) * 100;
      const processedHeight = (s.processed / scaleMax) * 100;
      const queueHeight = (s.queue / scaleMax) * 100;
      
      const hourStr = String(s.hour).padStart(2, '0') + 'h';
      
      const titleText = `Khung giờ: ${String(s.hour).padStart(2, '0')}:00\n` +
                        `• Xe mới đến: ${s.arrived} xe\n` +
                        `• Trạm nhập mở: ${s.stations} trạm\n` +
                        `• Năng suất xử lý: ${s.capacity.toFixed(1)} xe/h\n` +
                        `• Đã dỡ hàng: ${s.processed.toFixed(1)} xe\n` +
                        `• Ùn ứ tồn đọng: ${s.queue.toFixed(1)} xe\n` +
                        `• Hiệu suất trạm: ${s.utilization.toFixed(0)}%`;
      
      wrapper.title = titleText;
      
      wrapper.innerHTML = `
        <div class="flow-chart-bar-cap-line" style="bottom: ${capBottom}%;"></div>
        <div class="flow-chart-bar-stack">
          <div class="flow-bar-segment queue" style="height: ${queueHeight}%;"></div>
          <div class="flow-bar-segment processed" style="height: ${processedHeight}%;"></div>
        </div>
        <span class="flow-chart-label">${hourStr}</span>
      `;
      
      chartContainer.appendChild(wrapper);
    });
  }

  // Expose global methods
  window.charts = {
    renderDonutChart,
    renderAgingBars,
    renderFlowChart
  };

})();
