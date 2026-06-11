/* ═══════════════════════════════════════════════════
   capacity.js — Capacity Planning & Workforce Management
   KTC HCM01 — Kho Trung Chuyển Hồ Chí Minh 01
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ─── Constants ────────────────────────────────────
  // Using gviz/tq endpoint for proper CORS support from GitHub Pages
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1RCdEDrhCwHKBQAsTNqZO-4vnxft9lcqa7Fe9IK8auZ8/gviz/tq?tqx=out:csv&gid=1731657616';
  const LS_KEY_FC     = 'capacity_fc_data';
  const LS_KEY_CONF   = 'capacity_config';
  const LS_KEY_ACTUAL = 'capacity_actual_history';

  // Actual data sheet (dates as columns, transposed layout)
  const ACTUAL_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1RCdEDrhCwHKBQAsTNqZO-4vnxft9lcqa7Fe9IK8auZ8/gviz/tq?tqx=out:csv&gid=0';

  const DAY_NAMES_VI = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

  const COLORS = {
    normal:  '#60a5fa', // blue
    bulky:   '#fbbf24', // yellow
    freight: '#fb923c', // orange
    over:    'rgba(248, 113, 113, 0.35)',
    capLine: '#34d399'  // green dashed
  };

  // ─── Formatting helpers ───────────────────────────
  const fmt = n => n != null ? n.toLocaleString('vi-VN') : '0';

  const escapeHTML = str => {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  };

  // ─── Vietnamese number parsing ────────────────────
  // "410.897" → 410897, "1.234,56%" → 1234.56
  function parseVNNumber(str) {
    if (str == null) return 0;
    str = String(str).trim();
    if (str === '' || str === '-' || str === '—') return 0;
    // Remove surrounding quotes
    str = str.replace(/^["']|["']$/g, '');
    // Remove % sign
    str = str.replace(/%/g, '');
    // Vietnamese: dot = thousands, comma = decimal
    // Remove thousand separators (dots)
    str = str.replace(/\./g, '');
    // Replace comma decimal separator with period
    str = str.replace(/,/g, '.');
    const n = parseFloat(str);
    return isNaN(n) ? 0 : n;
  }

  function formatNumber(n) {
    if (n == null || isNaN(n)) return '0';
    return Math.round(n).toLocaleString('vi-VN');
  }

  // ─── Date helpers (Vietnamese timezone GMT+7) ─────
  function getVNNow() {
    const now = new Date();
    const tzOffset = 7 * 60; // GMT+7 in minutes
    return new Date(now.getTime() + (now.getTimezoneOffset() + tzOffset) * 60 * 1000);
  }

  function getTodayString() {
    const d = getVNNow();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function parseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const s = dateStr.trim();
    const parts = s.split('/');
    if (parts.length !== 3) return null;
    const day   = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year  = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    return new Date(year, month, day);
  }

  function getDayOfWeek(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return '—';
    return DAY_NAMES_VI[d.getDay()];
  }

  function isWeekend(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return false;
    return d.getDay() === 0 || d.getDay() === 6;
  }

  function formatDateShort(dateStr) {
    // DD/MM/YYYY → DD/MM
    if (!dateStr) return '—';
    const parts = dateStr.split('/');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return dateStr;
  }

  // ─── Configuration management ─────────────────────
  // Productivity is NOT stored here — it is always derived from Actual data.
  const DEFAULT_CONFIG = {
    nvct: 235,            // NVCT tổng (cố định)
    freelancer: 95,       // Freelancer tổng (linh hoạt)
    bufferPercent: 10
  };

  function loadConfig() {
    try {
      const stored = localStorage.getItem(LS_KEY_CONF);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Backward compat: old format had objects, flatten to numbers
        let nvctVal = parsed.nvct;
        let flVal   = parsed.freelancer;
        // If old object format, sum them
        if (typeof nvctVal === 'object' && nvctVal !== null) {
          nvctVal = (nvctVal.normal || 0) + (nvctVal.bulky || 0) + (nvctVal.freight || 0);
        }
        if (typeof flVal === 'object' && flVal !== null) {
          flVal = (flVal.normal || 0) + (flVal.bulky || 0) + (flVal.freight || 0);
        }
        // Also handle old currentStaff format
        if (parsed.currentStaff && nvctVal == null) {
          const cs = parsed.currentStaff;
          const total = (cs.normal || 0) + (cs.bulky || 0) + (cs.freight || 0);
          nvctVal = Math.round(total * 0.7);
          flVal   = total - nvctVal;
        }
        return {
          nvct:          nvctVal ?? DEFAULT_CONFIG.nvct,
          freelancer:    flVal   ?? DEFAULT_CONFIG.freelancer,
          bufferPercent: parsed.bufferPercent ?? DEFAULT_CONFIG.bufferPercent
        };
      }
    } catch (e) {
      console.warn('[Capacity] Error loading config:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  function saveConfig(config) {
    try {
      localStorage.setItem(LS_KEY_CONF, JSON.stringify(config));
    } catch (e) {
      console.warn('[Capacity] Error saving config:', e);
    }
  }

  // ─── FC Data management ───────────────────────────
  let fcData = [];     // Array of { date, normal, bulky, freight, total }
  let actualData = []; // Array of { date, normal, bulky, freight, total }

  // ─── Actual History (with staff) ──────────────────
  // Array of { date, volNormal, volBulky, volFreight, volTotal, staffNormal, staffBulky, staffFreight, staffTotal }
  let actualHistory = [];
  // Derived productivity from actual data
  let derivedProductivity = null; // { normal, bulky, freight, maxCapacity, peakDate, sampleDays }

  function saveFCData() {
    try {
      localStorage.setItem(LS_KEY_FC, JSON.stringify({ fc: fcData, actual: actualData, ts: Date.now() }));
    } catch (e) {
      console.warn('[Capacity] Error saving FC data:', e);
    }
  }

  function loadFCData() {
    try {
      const stored = localStorage.getItem(LS_KEY_FC);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.fc && Array.isArray(parsed.fc) && parsed.fc.length > 0) {
          fcData = parsed.fc;
          actualData = parsed.actual || [];
          return true;
        }
      }
    } catch (e) {
      console.warn('[Capacity] Error loading FC data:', e);
    }
    return false;
  }

  function saveActualHistory() {
    try {
      localStorage.setItem(LS_KEY_ACTUAL, JSON.stringify({ data: actualHistory, ts: Date.now() }));
    } catch (e) {
      console.warn('[Capacity] Error saving actual history:', e);
    }
  }

  function loadActualHistory() {
    try {
      const stored = localStorage.getItem(LS_KEY_ACTUAL);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) {
          actualHistory = parsed.data;
          calculateDerivedProductivity();
          return true;
        }
      }
    } catch (e) {
      console.warn('[Capacity] Error loading actual history:', e);
    }
    return false;
  }

  // ─── Fetch Actual data from Google Sheet (transposed layout) ───
  async function fetchActualFromSheet() {
    try {
      console.log('[Capacity] Fetching Actual data from sheet...');
      const resp = await fetch(ACTUAL_SHEET_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const csvText = await resp.text();

      const lines = csvText.split('\n').map(l => l.replace(/\r/g, ''));
      if (lines.length < 26) {
        console.warn('[Capacity] Actual sheet too few rows');
        return false;
      }

      // Parse CSV rows (handle commas in quoted fields)
      function csvSplit(line) {
        const result = [];
        let current = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { result.push(current); current = ''; }
          else { current += ch; }
        }
        result.push(current);
        return result;
      }

      // Row 0 (line index 0): Header with dates starting from col 1
      // Row 1 (line index 1): HCM01 total volume
      // Row 16 (line index 16): NHân sự header
      // Row 17 (line index 17): HCM01 total staff
      // Row 18 (line index 18): NVCT
      // Row 19 (line index 19): Freelancers

      const headerCols = csvSplit(lines[0]); // dates
      const volCols    = csvSplit(lines[1]); // HCM01 volume total
      
      // Find staff section: look for row starting with "Nhân sự" or "HCM01" after a gap
      let staffRowIdx = -1;
      let nvctRowIdx  = -1;
      let flRowIdx    = -1;
      
      for (let i = 2; i < lines.length; i++) {
        const firstCell = csvSplit(lines[i])[0].trim();
        if (firstCell.toLowerCase().includes('nhân sự')) {
          // Next rows: HCM01 total, NVCT, Freelancers
          staffRowIdx = i + 1;
          nvctRowIdx  = i + 2;
          flRowIdx    = i + 3;
          break;
        }
      }

      if (staffRowIdx < 0) {
        console.warn('[Capacity] Could not find Nhân sự section in sheet');
        return false;
      }

      const staffCols = csvSplit(lines[staffRowIdx]);
      const nvctCols  = csvSplit(lines[nvctRowIdx]);
      const flCols    = csvSplit(lines[flRowIdx]);

      // Transpose: dates are columns, starting from col 1
      const result = [];
      for (let c = 1; c < headerCols.length; c++) {
        const dateStr = headerCols[c].trim();
        if (!dateStr || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) continue;

        const vol   = parseVNNumber(volCols[c] || '0');
        const staff = parseVNNumber(staffCols[c] || '0');
        const nvct  = parseVNNumber(nvctCols[c] || '0');
        const fl    = parseVNNumber(flCols[c] || '0');

        if (vol === 0 && staff === 0) continue; // Skip empty days

        result.push({
          date: dateStr,
          volNormal: 0, volBulky: 0, volFreight: 0, // Not split in this mode
          volTotal: vol,
          staffNormal: 0, staffBulky: 0, staffFreight: 0,
          staffTotal: staff,
          nvct: nvct,
          freelancer: fl
        });
      }

      if (result.length > 0) {
        actualHistory = result;
        calculateDerivedProductivity();
        saveActualHistory();
        console.log(`[Capacity] Loaded ${result.length} days of Actual data from sheet`);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[Capacity] Error fetching actual sheet:', err.message);
      return false;
    }
  }

  // ─── Parse Actual History paste ────────────────────
  // Format NEW: Date\tVolTotal\tStaffTotal (3 cols, kho chung)
  // Format LEGACY: Date\tVol_N\tVol_B\tVol_F\tStf_N\tStf_B\tStf_F (7 cols)
  function parseActualPaste(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.trim().split('\n').map(l => l.replace(/\r/g, ''));
    if (lines.length < 2) return [];

    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 3) continue;

      const dateStr = cols[0].trim();
      // Skip header rows
      if (dateStr.toLowerCase().includes('ngày') || dateStr.toLowerCase().includes('date') || dateStr === '') continue;
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) continue;

      if (cols.length >= 7) {
        // Legacy 7-column format
        const volN = parseVNNumber(cols[1]);
        const volB = parseVNNumber(cols[2]);
        const volF = parseVNNumber(cols[3]);
        const stfN = parseVNNumber(cols[4]);
        const stfB = parseVNNumber(cols[5]);
        const stfF = parseVNNumber(cols[6]);
        if ((volN + volB + volF) === 0 && (stfN + stfB + stfF) === 0) continue;
        result.push({
          date: dateStr,
          volNormal: volN, volBulky: volB, volFreight: volF,
          volTotal: volN + volB + volF,
          staffNormal: stfN, staffBulky: stfB, staffFreight: stfF,
          staffTotal: stfN + stfB + stfF
        });
      } else {
        // Simplified 3-column format: Date, VolTotal, StaffTotal
        const volTotal   = parseVNNumber(cols[1]);
        const staffTotal = parseVNNumber(cols[2]);
        if (volTotal === 0 && staffTotal === 0) continue;
        result.push({
          date: dateStr,
          volNormal: 0, volBulky: 0, volFreight: 0,
          volTotal,
          staffNormal: 0, staffBulky: 0, staffFreight: 0,
          staffTotal
        });
      }
    }
    return result;
  }

  // ─── Calculate productivity from actual history ────
  function calculateDerivedProductivity() {
    if (actualHistory.length === 0) {
      derivedProductivity = null;
      return;
    }

    // Filter days with staffTotal > 0 and volTotal > 0
    const useDays = actualHistory.filter(d =>
      d.staffTotal > 0 && d.volTotal > 0
    );

    if (useDays.length === 0) {
      derivedProductivity = null;
      return;
    }

    // Calculate single unified productivity = volTotal / staffTotal per day
    let sumProd = 0, countProd = 0;
    let maxVol = 0, peakDate = '';
    let maxStaffTotal = 0;

    useDays.forEach(d => {
      if (d.staffTotal > 0 && d.volTotal > 0) {
        sumProd += d.volTotal / d.staffTotal;
        countProd++;
      }
      if (d.volTotal > maxVol) {
        maxVol = d.volTotal;
        peakDate = d.date;
      }
      if (d.staffTotal > maxStaffTotal) maxStaffTotal = d.staffTotal;
    });

    const avgProd = countProd > 0 ? Math.round(sumProd / countProd) : null;

    derivedProductivity = {
      avgProductivity: avgProd,   // tấn/người/ca (or đơn/người/ca depending on input)
      maxCapacity: maxVol,
      peakDate: peakDate,
      sampleDays: useDays.length,
      maxStaff: maxStaffTotal
    };

    console.log('[Capacity] Derived productivity from actual:', derivedProductivity);
  }

  // ─── Apply derived staff to config ─────────────────
  function applyDerivedProductivity() {
    if (!derivedProductivity) return;
    const cfg = loadConfig();
    // Distribute max staff seen into NVCT (70%) + Freelancer (30%)
    if (derivedProductivity.maxStaff) {
      const ms = derivedProductivity.maxStaff;
      cfg.nvct       = Math.round(ms * 0.7);
      cfg.freelancer = ms - cfg.nvct;
    }
    saveConfig(cfg);
  }

  // ─── CSV Parsing ──────────────────────────────────
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  function parseCSV(csvText) {
    if (!csvText || typeof csvText !== 'string') return { fc: [], actual: [] };

    const lines = csvText.split('\n').map(l => l.replace(/\r/g, ''));
    const rows  = lines.map(l => parseCSVLine(l));

    const fc = [];

    // New sheet structure (transposed, dates as columns):
    // Row 0: Header with dates starting from col 1
    // Row 1: HCM01 total
    // Row 2: Hàng <5kg (Normal)
    // Row 3: Hàng vừa 5-15kg (Bulky)
    // Row 4: Hàng to >15kg (Freight)
    if (rows.length < 5) {
      console.warn('[Capacity] FC sheet too few rows:', rows.length);
      return { fc: [], actual: [] };
    }

    const headerRow  = rows[0];

    // Find data rows by label in col 0
    let hcm01Row = null, normalRow = null, bulkyRow = null, freightRow = null;
    for (let i = 1; i < rows.length; i++) {
      const label = (rows[i][0] || '').trim().toLowerCase();
      if (label === 'hcm01') hcm01Row = rows[i];
      else if (label.includes('<5kg') || label.includes('< 5kg')) normalRow = rows[i];
      else if (label.includes('5-15kg') || label.includes('vừa')) bulkyRow = rows[i];
      else if (label.includes('>15kg') || label.includes('> 15kg') || label.includes('hàng to')) freightRow = rows[i];
    }

    // Fallback: use positional rows if labels not found
    if (!hcm01Row && rows.length > 1) hcm01Row = rows[1];
    if (!normalRow && rows.length > 2) normalRow = rows[2];
    if (!bulkyRow && rows.length > 3) bulkyRow = rows[3];
    if (!freightRow && rows.length > 4) freightRow = rows[4];

    // Parse dates from header and extract values
    for (let c = 1; c < headerRow.length; c++) {
      const dateStr = (headerRow[c] || '').trim();
      if (!dateStr || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) continue;

      const total   = parseVNNumber(hcm01Row[c] || '0');
      const normal  = normalRow  ? parseVNNumber(normalRow[c] || '0')  : Math.round(total * 0.80);
      const bulky   = bulkyRow   ? parseVNNumber(bulkyRow[c] || '0')   : Math.round(total * 0.12);
      const freight = freightRow ? parseVNNumber(freightRow[c] || '0') : Math.round(total * 0.08);

      if (total === 0 && normal === 0) continue; // Skip empty

      fc.push({
        date: dateStr,
        normal,
        bulky,
        freight,
        total: total || (normal + bulky + freight)
      });
    }

    console.log(`[Capacity] Parsed ${fc.length} FC records from sheet`);
    return { fc, actual: [] };
  }

  // ─── Paste parsing (Tab-separated from Google Sheets) ──
  function parsePasteData(text) {
    if (!text || typeof text !== 'string') return [];

    const lines = text.trim().split('\n').map(l => l.replace(/\r/g, ''));
    if (lines.length < 2) return [];

    // First line is header: Date\tNormal\tBulky\tFreight
    const result = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 4) continue;

      const date    = cols[0].trim();
      const normal  = parseVNNumber(cols[1]);
      const bulky   = parseVNNumber(cols[2]);
      const freight = parseVNNumber(cols[3]);

      if (date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
        result.push({
          date,
          normal,
          bulky,
          freight,
          total: normal + bulky + freight
        });
      }
    }
    return result;
  }

  // ─── Fetch from Google Sheets ─────────────────────
  async function fetchFromSheet() {
    updateHeartbeat('loading');
    try {
      const response = await fetch(SHEET_URL, {
        mode: 'cors',
        cache: 'no-cache'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const csvText = await response.text();
      const parsed  = parseCSV(csvText);

      if (parsed.fc.length > 0) {
        fcData     = parsed.fc;
        actualData = parsed.actual;
        saveFCData();
        updateHeartbeat('connected');
        console.log(`[Capacity] Loaded ${fcData.length} FC records, ${actualData.length} actual records from sheet`);
        return true;
      } else {
        console.warn('[Capacity] Sheet returned no FC data');
        updateHeartbeat('error');
        return false;
      }
    } catch (err) {
      console.warn('[Capacity] CORS/fetch error:', err.message);
      updateHeartbeat('error');
      return false;
    }
  }

  // ─── Heartbeat UI ─────────────────────────────────
  function updateHeartbeat(status) {
    const el = document.getElementById('capacity-heartbeat');
    if (!el) return;

    const dot  = el.querySelector('.pulse-dot');
    const text = el.querySelector('span:last-child');
    if (!dot || !text) return;

    dot.className = 'pulse-dot';
    switch (status) {
      case 'loading':
        dot.classList.add('yellow');
        text.textContent = 'Capacity: Đang tải dữ liệu FC...';
        break;
      case 'connected':
        dot.classList.add('green');
        text.textContent = `Capacity: Đã tải ${fcData.length} ngày FC | ${new Date().toLocaleTimeString('vi-VN')}`;
        break;
      case 'error':
        dot.className = 'pulse-dot';
        dot.style.background = 'var(--red)';
        dot.style.boxShadow  = '0 0 6px var(--red)';
        text.textContent = 'Capacity: Lỗi tải — sử dụng dữ liệu cache hoặc dán thủ công';
        break;
      default:
        dot.classList.add('green');
        text.textContent = 'Capacity: Sẵn sàng';
    }
  }

  // ─── Find today's index ───────────────────────────
  function findTodayIndex() {
    if (fcData.length === 0) return -1;

    const today = getVNNow();
    today.setHours(0, 0, 0, 0);

    let bestIdx = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < fcData.length; i++) {
      const d = parseDate(fcData[i].date);
      if (!d) continue;
      d.setHours(0, 0, 0, 0);
      const diff = d.getTime() - today.getTime();
      // Prefer today or nearest future date
      if (diff >= 0 && diff < bestDiff) {
        bestDiff = diff;
        bestIdx  = i;
      }
    }

    // If no future date found, return the last available
    if (bestIdx === -1 && fcData.length > 0) {
      bestIdx = fcData.length - 1;
    }
    return bestIdx;
  }

  // ─── Core Calculations ────────────────────────────
  // Uses unified staff (nvct + freelancer as single numbers)
  // Productivity comes from derivedProductivity (auto-calculated from actual data)
  function calculateCapacity(dayData, config) {
    if (!dayData || !config) return null;

    const nvct = config.nvct || 0;
    const fl   = config.freelancer || 0;
    const currentTotal = nvct + fl;

    // Get productivity from derived data (tấn/người/ca)
    const prod = derivedProductivity?.avgProductivity || 0;

    // Required staff = FC_total / productivity
    const requiredRaw = prod > 0 ? dayData.total / prod : 0;
    const requiredTotal = prod > 0 ? Math.ceil(requiredRaw * (1 + config.bufferPercent / 100)) : 0;

    // Max capacity = current total staff * productivity
    const maxCapacity = prod > 0 ? Math.round(currentTotal * prod) : 0;

    // Freelancer delta
    const flNeeded = Math.max(0, requiredTotal - nvct);
    const flDelta  = flNeeded - fl;

    const delta = requiredTotal - currentTotal;
    const gapPercent = maxCapacity > 0 ? ((dayData.total - maxCapacity) / maxCapacity) * 100 : 0;

    return {
      date:          dayData.date,
      fc:            dayData,
      requiredTotal,
      currentTotal,
      nvctTotal:     nvct,
      flTotal:       fl,
      flNeeded,
      flDelta,
      maxCapacity,
      delta,
      gapPercent,
      productivity:  prod
    };
  }

  function calculateAllDays(config) {
    return fcData.map(day => calculateCapacity(day, config)).filter(Boolean);
  }

  // ─── Render: Main Entry Point ─────────────────────
  function renderCapacityDashboard() {
    const config  = loadConfig();
    const allCalc = calculateAllDays(config);

    // Always render derived productivity panel
    renderDerivedPanel();

    if (allCalc.length === 0) {
      const container = document.getElementById('cap-chart-container');
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted);">Chưa có dữ liệu FC. Vui lòng tải từ Google Sheets hoặc dán dữ liệu thủ công.</div>';
      }
      return;
    }

    updateControlValues(config);
    renderKPIs(allCalc, config);

    // Initialize chartStartIdx once if not yet done
    if (!hasInitializedStartIdx && allCalc.length > 0) {
      const todayIdx = findTodayIndex();
      if (todayIdx >= 0) {
        chartStartIdx = Math.max(0, todayIdx - 7);
      } else {
        chartStartIdx = 0;
      }
      hasInitializedStartIdx = true;
    }

    // Ensure bounds
    if (chartStartIdx >= allCalc.length) {
      chartStartIdx = Math.max(0, allCalc.length - CHART_PAGE_SIZE);
    }

    renderCapacityChart(allCalc, chartStartIdx, CHART_PAGE_SIZE);
    renderStaffingTable(allCalc);
    renderAdvisoryPanel(allCalc, config);
  }

  // ─── Render: Derived Productivity Panel ────────────
  function renderDerivedPanel() {
    const panel = document.getElementById('cap-derived-panel');
    if (!panel) return;

    if (!derivedProductivity || actualHistory.length === 0) {
      panel.innerHTML = `
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.78rem;">
          <div style="font-size:1.5rem;margin-bottom:8px;">📊</div>
          Chưa có dữ liệu Actual.<br>
          Bấm <strong>"📊 Dán Actual Data"</strong> để hệ thống tự tính năng suất từ lịch sử.
        </div>`;
      return;
    }

    const dp = derivedProductivity;
    panel.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="font-size:0.72rem;color:var(--green);font-weight:700;">
          ✅ Tự động tính từ ${dp.sampleDays} ngày Actual
        </div>

        <div style="background:rgba(52,211,153,0.08);padding:14px;border-radius:8px;border:1px solid rgba(52,211,153,0.2);text-align:center;">
          <div style="font-size:0.62rem;color:var(--text-muted);margin-bottom:4px;">Năng Suất Trung Bình</div>
          <div style="font-size:1.6rem;font-weight:900;font-family:'JetBrains Mono',monospace;color:var(--green);">${dp.avgProductivity ? formatNumber(dp.avgProductivity) : '—'}</div>
          <div style="font-size:0.65rem;color:var(--text-muted);">tấn/người/ca</div>
        </div>

        <div style="display:flex;gap:12px;font-size:0.68rem;color:var(--text-secondary);font-family:'JetBrains Mono',monospace;">
          <span>📈 Max xử lý: <strong style="color:var(--green);">${formatNumber(dp.maxCapacity)}</strong> tấn (${dp.peakDate})</span>
        </div>
        <div style="display:flex;gap:12px;font-size:0.68rem;color:var(--text-secondary);font-family:'JetBrains Mono',monospace;">
          <span>👥 Max NS: <strong>${dp.maxStaff || '—'}</strong> người</span>
        </div>

        <button id="cap-btn-apply-derived" class="filter-btn" style="border-color:var(--green);color:var(--green);font-weight:600;cursor:pointer;font-size:0.72rem;width:100%;text-align:center;">
          ⚡ Áp Dụng NS Actual → Config
        </button>
      </div>`;

    // Bind apply button
    const applyBtn = document.getElementById('cap-btn-apply-derived');
    if (applyBtn) {
      applyBtn.onclick = () => {
        applyDerivedProductivity();
        renderCapacityDashboard();
        applyBtn.textContent = '✅ Đã áp dụng!';
        applyBtn.style.color = 'var(--text-primary)';
        setTimeout(() => {
          applyBtn.textContent = '⚡ Áp Dụng NS Actual → Config';
          applyBtn.style.color = 'var(--green)';
        }, 2000);
      };
    }
  }

  // ─── Update control values in UI ──────────────────
  function updateControlValues(config) {
    // Buffer slider
    const bufSlider = document.getElementById('cap-buffer');
    const bufLabel  = document.getElementById('cap-buffer-val');
    if (bufSlider) bufSlider.value = config.bufferPercent;
    if (bufLabel)  bufLabel.textContent = `${config.bufferPercent}%`;

    // Staff inputs (flat numbers)
    const setInput = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    setInput('cap-nvct-total',  config.nvct);
    setInput('cap-fl-total',    config.freelancer);
  }

  // ─── Render: KPIs ────────────────────────────
  function renderKPIs(allCalc, config) {
    const todayIdx = findTodayIndex();
    const todayCalc = todayIdx >= 0 && todayIdx < allCalc.length ? allCalc[todayIdx] : allCalc[0];
    if (!todayCalc) return;

    // FC Today
    const elFcToday = document.getElementById('cap-kpi-fc-today');
    if (elFcToday) elFcToday.textContent = formatNumber(todayCalc.fc.total);

    const elFcSub = document.getElementById('cap-kpi-sub-fc');
    if (elFcSub) elFcSub.textContent = `Ngày ${todayCalc.date} (${getDayOfWeek(todayCalc.date)})`;

    // Max Capacity
    const elCapMax = document.getElementById('cap-kpi-capacity-max');
    if (elCapMax) elCapMax.textContent = formatNumber(todayCalc.maxCapacity);

    const elCapSub = document.getElementById('cap-kpi-sub-max');
    if (elCapSub) {
      const t = config.nvct + config.freelancer;
      elCapSub.textContent = `${t} NS (NVCT:${config.nvct} + FL:${config.freelancer}) × ${todayCalc.productivity ? formatNumber(todayCalc.productivity) + ' t/ng' : 'chưa có NS'}`;
    }

    // Staff Needed
    const elStaff = document.getElementById('cap-kpi-staff-needed');
    if (elStaff) elStaff.textContent = todayCalc.requiredTotal > 0 ? formatNumber(todayCalc.requiredTotal) : '—';

    const elStaffSub = document.getElementById('cap-kpi-sub-staff');
    if (elStaffSub) {
      if (todayCalc.productivity > 0) {
        elStaffSub.textContent = `FC:${formatNumber(todayCalc.fc.total)} ÷ ${formatNumber(todayCalc.productivity)} t/ng +${config.bufferPercent}% buffer`;
      } else {
        elStaffSub.textContent = 'Cần dán Actual để tính năng suất';
        elStaffSub.style.color = 'var(--yellow)';
      }
    }

    // Gap %
    const elGap = document.getElementById('cap-kpi-gap-pct');
    if (elGap) {
      const gapVal = todayCalc.gapPercent;
      const sign = gapVal > 0 ? '+' : '';
      elGap.textContent = `${sign}${gapVal.toFixed(1)}%`;
      elGap.style.color = gapVal > 0 ? 'var(--red)' : 'var(--green)';
    }

    const elGapSub = document.getElementById('cap-kpi-sub-gap');
    if (elGapSub) {
      if (todayCalc.flDelta > 0) {
        elGapSub.textContent = `Cần thêm ${todayCalc.flDelta} Freelancer`;
        elGapSub.style.color = 'var(--red)';
      } else if (todayCalc.flDelta < 0) {
        elGapSub.textContent = `Dư ${Math.abs(todayCalc.flDelta)} Freelancer — có thể giảm`;
        elGapSub.style.color = 'var(--green)';
      } else {
        elGapSub.textContent = 'Cân bằng — đủ nhân sự';
        elGapSub.style.color = 'var(--text-muted)';
      }
    }
  }

  // ─── Render: Capacity Chart (CSS-only bars) ───────
  let chartStartIdx = 0;
  let hasInitializedStartIdx = false;
  const CHART_PAGE_SIZE = 30;

  function renderCapacityChart(allCalc, startIdx, count) {
    const container = document.getElementById('cap-chart-container');
    if (!container) return;
    container.innerHTML = '';

    // Update global tracker
    chartStartIdx = startIdx;

    const slice = allCalc.slice(startIdx, startIdx + count);
    if (slice.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-muted);">Không có dữ liệu cho khoảng ngày này.</div>';
      return;
    }

    const maxFC       = Math.max(...slice.map(c => c.fc.total), 1);
    const maxCapacity = slice[0].maxCapacity;
    const scaleMax    = Math.max(maxFC, maxCapacity) * 1.15;

    // Chart area wrapper
    const chartArea = document.createElement('div');
    chartArea.className = 'flow-chart-container';
    chartArea.style.height    = '260px';
    chartArea.style.gap       = '4px';
    chartArea.style.position  = 'relative';
    chartArea.style.alignItems = 'flex-end';

    // Capacity line (horizontal dashed)
    const capLinePos = (maxCapacity / scaleMax) * 100;
    const capLine = document.createElement('div');
    capLine.style.cssText = `
      position: absolute;
      bottom: calc(${capLinePos}% + 30px);
      left: 0; right: 0;
      height: 2px;
      border-top: 2px dashed ${COLORS.capLine};
      opacity: 0.6;
      z-index: 5;
      pointer-events: none;
    `;
    const capLabel = document.createElement('div');
    capLabel.style.cssText = `
      position: absolute;
      bottom: calc(${capLinePos}% + 32px);
      right: 4px;
      font-size: 0.6rem;
      font-family: 'JetBrains Mono', monospace;
      color: ${COLORS.capLine};
      z-index: 6;
      pointer-events: none;
      background: var(--bg-secondary);
      padding: 0 4px;
    `;
    capLabel.textContent = `Capacity: ${formatNumber(maxCapacity)}`;

    chartArea.appendChild(capLine);
    chartArea.appendChild(capLabel);

    // Bars
    slice.forEach(calc => {
      const wrapper = document.createElement('div');
      wrapper.className = 'flow-chart-bar-wrapper';
      wrapper.style.cursor  = 'help';
      wrapper.style.minWidth = slice.length > 20 ? '28px' : '36px';

      const totalHeight   = (calc.fc.total / scaleMax) * 100;
      const normalPct     = calc.fc.total > 0 ? (calc.fc.normal  / calc.fc.total) * totalHeight : 0;
      const bulkyPct      = calc.fc.total > 0 ? (calc.fc.bulky   / calc.fc.total) * totalHeight : 0;
      const freightPct    = calc.fc.total > 0 ? (calc.fc.freight / calc.fc.total) * totalHeight : 0;
      const isOver        = calc.fc.total > maxCapacity;
      const isWeekendDay  = isWeekend(calc.date);

      const tooltipText = `📅 ${calc.date} (${getDayOfWeek(calc.date)})\n` +
                           `────────────────────\n` +
                           `FC Tổng: ${formatNumber(calc.fc.total)}\n` +
                           `  Normal: ${formatNumber(calc.fc.normal)}\n` +
                           `  Bulky: ${formatNumber(calc.fc.bulky)}\n` +
                           `  Freight: ${formatNumber(calc.fc.freight)}\n` +
                           `────────────────────\n` +
                           `Capacity Max: ${formatNumber(calc.maxCapacity)}\n` +
                           `NS Cần: ${calc.requiredTotal} (NVCT:${calc.nvctTotal} + FL cần:${calc.flNeeded})\n` +
                           `FL hiện: ${calc.flTotal} | FL tăng/giảm: ${calc.flDelta > 0 ? '+' : ''}${calc.flDelta}\n` +
                           `Gap: ${calc.gapPercent > 0 ? '+' : ''}${calc.gapPercent.toFixed(1)}%`;

      wrapper.title = tooltipText;

      const overBg = isOver ? `background: ${COLORS.over};` : '';

      wrapper.innerHTML = `
        <div class="flow-chart-bar-stack" style="height: 100%; display: flex; flex-direction: column; justify-content: flex-end; max-width: 22px; ${overBg} border-radius: 4px 4px 0 0; overflow: hidden;">
          <div style="height: ${freightPct}%; background: ${COLORS.freight}; width: 100%; transition: height 0.4s ease;"></div>
          <div style="height: ${bulkyPct}%; background: ${COLORS.bulky}; width: 100%; transition: height 0.4s ease;"></div>
          <div style="height: ${normalPct}%; background: ${COLORS.normal}; width: 100%; border-radius: 0 0 0 0; transition: height 0.4s ease;"></div>
        </div>
        <span class="flow-chart-label" style="
          font-size: 0.58rem;
          transform: rotate(-55deg);
          transform-origin: left top;
          margin-top: 6px;
          margin-left: 10px;
          white-space: nowrap;
          color: ${isWeekendDay ? 'var(--accent)' : 'var(--text-muted)'};
          font-weight: ${isWeekendDay ? '700' : '400'};
        ">${formatDateShort(calc.date)}</span>
      `;

      chartArea.appendChild(wrapper);
    });

    container.appendChild(chartArea);

    // Update header navigation elements
    const displayEl = document.getElementById('cap-date-range-display');
    if (displayEl && slice.length > 0) {
      displayEl.textContent = `${slice[0].date} – ${slice[slice.length - 1].date}`;
    }

    const btnPrevHeader = document.getElementById('cap-chart-prev');
    const btnNextHeader = document.getElementById('cap-chart-next');
    if (btnPrevHeader) btnPrevHeader.disabled = startIdx === 0;
    if (btnNextHeader) btnNextHeader.disabled = startIdx + count >= allCalc.length;

    // Centered Legend at the bottom
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; justify-content:center; gap:14px; font-size:0.68rem; color:var(--text-muted); font-family:"JetBrains Mono",monospace; margin-top:12px;';
    legend.innerHTML = `
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${COLORS.normal};display:inline-block;border-radius:2px;"></span> &lt;5kg</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${COLORS.bulky};display:inline-block;border-radius:2px;"></span> 5-15kg</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${COLORS.freight};display:inline-block;border-radius:2px;"></span> &gt;15kg</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:2px;border-top:2px dashed ${COLORS.capLine};display:inline-block;"></span> Capacity</span>
    `;
    container.appendChild(legend);
  }

  // ─── Render: Staffing Table ───────────────────────
  function renderStaffingTable(allCalc) {
    const tbody = document.getElementById('cap-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const todayStr = getTodayString();

    allCalc.forEach(calc => {
      const dayName     = getDayOfWeek(calc.date);
      const weekendFlag = isWeekend(calc.date);
      const isToday     = calc.date === todayStr;

      // FL Delta badge
      let deltaBadge;
      if (calc.flDelta > 0) {
        deltaBadge = `<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:0.68rem; font-weight:700; font-family:'JetBrains Mono',monospace; background:rgba(248,113,113,0.15); color:var(--red); border:1px solid rgba(248,113,113,0.3);">+${calc.flDelta}</span>`;
      } else if (calc.flDelta < 0) {
        deltaBadge = `<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:0.68rem; font-weight:700; font-family:'JetBrains Mono',monospace; background:rgba(52,211,153,0.15); color:var(--green); border:1px solid rgba(52,211,153,0.3);">${calc.flDelta}</span>`;
      } else {
        deltaBadge = `<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:0.68rem; font-weight:700; font-family:'JetBrains Mono',monospace; background:rgba(96,165,250,0.1); color:var(--blue); border:1px solid rgba(96,165,250,0.2);">0</span>`;
      }

      const tr = document.createElement('tr');
      if (isToday) {
        tr.id = 'cap-row-today';
        tr.style.background = 'rgba(52, 211, 153, 0.15)';
        tr.style.outline = '1.5px solid var(--green)';
      } else if (weekendFlag) {
        tr.style.background = 'rgba(251, 146, 60, 0.04)';
      }

      const monoStyle  = "font-family:'JetBrains Mono',monospace; font-size:0.72rem;";
      const centerCell = "text-align:center; padding:8px 6px;";
      const rightCell  = "text-align:right; padding:8px 6px;";

      // Highlight if over capacity
      const totalStyle = calc.fc.total > calc.maxCapacity
        ? `${monoStyle} font-weight:700; color:var(--red);`
        : `${monoStyle} color:var(--text-secondary);`;

      tr.innerHTML = `
        <td style="text-align:left; padding:8px 10px; ${monoStyle} font-weight:600; color:var(--text-primary);">${isToday ? '🎯 ' : ''}${calc.date}</td>
        <td style="${centerCell} font-size:0.72rem; color:${weekendFlag ? 'var(--accent)' : 'var(--text-muted)'}; font-weight:${weekendFlag ? '600' : '400'};">${dayName}</td>
        <td style="${rightCell} ${monoStyle} color:${COLORS.normal};">${formatNumber(calc.fc.normal)}</td>
        <td style="${rightCell} ${monoStyle} color:${COLORS.bulky};">${formatNumber(calc.fc.bulky)}</td>
        <td style="${rightCell} ${monoStyle} color:${COLORS.freight};">${formatNumber(calc.fc.freight)}</td>
        <td style="${rightCell} ${totalStyle}">${formatNumber(calc.fc.total)}</td>
        <td style="${rightCell} ${monoStyle} color:var(--green);">${formatNumber(calc.maxCapacity)}</td>
        <td style="${centerCell} ${monoStyle} font-weight:700; color:var(--text-primary);">${calc.requiredTotal}</td>
        <td style="${centerCell} ${monoStyle} color:var(--text-muted);">${calc.nvctTotal}</td>
        <td style="${centerCell} ${monoStyle} color:var(--yellow);">${calc.flTotal}</td>
        <td style="${centerCell} ${monoStyle} font-weight:600; color:var(--blue-light);">${calc.flNeeded}</td>
        <td style="${centerCell}">${deltaBadge}</td>
      `;

      tbody.appendChild(tr);
    });

    // Auto scroll to today's row in the table
    setTimeout(() => {
      const todayRow = document.getElementById('cap-row-today');
      if (todayRow) {
        todayRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  }

  // ─── Render: Advisory Panel ───────────────────────
  function renderAdvisoryPanel(allCalc, config) {
    const container = document.getElementById('cap-advisory-list');
    if (!container) return;
    container.innerHTML = '';

    if (allCalc.length === 0) return;

    const advises = [];

    // ── 1. Weekly summaries ──
    const weekGroups = {};
    allCalc.forEach(calc => {
      const d = parseDate(calc.date);
      if (!d) return;
      // ISO week number approximation
      const oneJan = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
      const key = `W${weekNum}`;
      if (!weekGroups[key]) weekGroups[key] = { days: [], totalFC: 0, maxDelta: -Infinity, sumDelta: 0 };
      weekGroups[key].days.push(calc);
      weekGroups[key].totalFC += calc.fc.total;
      weekGroups[key].sumDelta += calc.delta;
      if (calc.delta > weekGroups[key].maxDelta) weekGroups[key].maxDelta = calc.delta;
    });

    Object.entries(weekGroups).forEach(([weekKey, wk]) => {
      const avgFC    = wk.totalFC / wk.days.length;
      const avgDelta = wk.sumDelta / wk.days.length;
      const dateRange = `${wk.days[0].date} → ${wk.days[wk.days.length - 1].date}`;

      let type = 'info';
      let emoji = '📊';
      if (avgDelta > 10) { type = 'warning'; emoji = '🔴'; }
      else if (avgDelta > 0) { type = 'info'; emoji = '🟡'; }
      else { type = 'success'; emoji = '🟢'; }

      advises.push({
        type,
        title: `${emoji} ${weekKey}: ${dateRange}`,
        message: `FC trung bình: <strong>${formatNumber(Math.round(avgFC))} đơn/ngày</strong>. ` +
                 `Nhân sự cần bổ sung trung bình: <strong>${avgDelta > 0 ? '+' : ''}${Math.round(avgDelta)} người/ngày</strong>. ` +
                 `Ngày đỉnh điểm cần thêm tối đa <strong>${wk.maxDelta > 0 ? '+' : ''}${wk.maxDelta} người</strong>.`
      });
    });

    // ── 2. Peak day warning ──
    let peakDay = allCalc[0];
    allCalc.forEach(c => { if (c.fc.total > peakDay.fc.total) peakDay = c; });

    advises.push({
      type: 'warning',
      title: `⚡ Ngày cao điểm: ${peakDay.date} (${getDayOfWeek(peakDay.date)})`,
      message: `FC đạt đỉnh <strong>${formatNumber(peakDay.fc.total)} đơn</strong>. ` +
               `Cần tổng cộng <strong>${peakDay.requiredTotal} nhân sự</strong> ` +
               `(hiện có ${peakDay.currentTotal}). ` +
               (peakDay.delta > 0
                 ? `<strong style="color:var(--red);">Thiếu ${peakDay.delta} người!</strong> Cần tuyển hoặc huy động thêm.`
                 : `<strong style="color:var(--green);">Đủ nhân sự.</strong>`)
    });

    // ── 3. Trend analysis ──
    if (allCalc.length >= 7) {
      const firstWeek = allCalc.slice(0, 7);
      const lastWeek  = allCalc.slice(-7);
      const avgFirst  = firstWeek.reduce((s, c) => s + c.fc.total, 0) / firstWeek.length;
      const avgLast   = lastWeek.reduce((s, c) => s + c.fc.total, 0) / lastWeek.length;
      const trendPct  = ((avgLast - avgFirst) / avgFirst) * 100;

      let trendType, trendEmoji, trendMsg;
      if (trendPct > 5) {
        trendType  = 'warning';
        trendEmoji = '📈';
        trendMsg   = `FC có xu hướng <strong>TĂNG ${trendPct.toFixed(1)}%</strong> so với tuần đầu. Cần chuẩn bị tăng cường nhân sự.`;
      } else if (trendPct < -5) {
        trendType  = 'success';
        trendEmoji = '📉';
        trendMsg   = `FC có xu hướng <strong>GIẢM ${Math.abs(trendPct).toFixed(1)}%</strong>. Có thể xem xét giảm ca hoặc luân chuyển nhân sự.`;
      } else {
        trendType  = 'info';
        trendEmoji = '📊';
        trendMsg   = `FC <strong>ổn định</strong> (biến động ${trendPct > 0 ? '+' : ''}${trendPct.toFixed(1)}%). Giữ nguyên bố trí nhân sự hiện tại.`;
      }

      advises.push({
        type: trendType,
        title: `${trendEmoji} Phân tích xu hướng FC`,
        message: trendMsg + ` TB tuần đầu: ${formatNumber(Math.round(avgFirst))} → TB tuần cuối: ${formatNumber(Math.round(avgLast))}.`
      });
    }

    // ── 4. Days with critical shortage ──
    const criticalDays = allCalc.filter(c => c.delta > 20);
    if (criticalDays.length > 0) {
      const dateList = criticalDays.slice(0, 5).map(c => `${c.date} (+${c.delta})`).join(', ');
      advises.push({
        type: 'warning',
        title: `🚨 Cảnh báo thiếu hụt nhân sự nghiêm trọng (${criticalDays.length} ngày)`,
        message: `Các ngày cần bổ sung >20 người: <strong>${dateList}</strong>${criticalDays.length > 5 ? ` và ${criticalDays.length - 5} ngày khác` : ''}. ` +
                 `Cần lên kế hoạch tuyển dụng hoặc thuê ngoài ngay!`
      });
    }

    // Render advisory cards
    advises.forEach(adv => {
      const card = document.createElement('div');
      card.className = `kpi-card dock-advisory-card ${adv.type}`;
      card.style.padding = '12px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '4px';

      let titleColor = 'var(--text-primary)';
      if (adv.type === 'warning') titleColor = 'var(--red)';
      else if (adv.type === 'info') titleColor = 'var(--yellow)';
      else if (adv.type === 'success') titleColor = 'var(--green)';

      card.innerHTML = `
        <div style="font-weight: 700; color: ${titleColor}; font-size: 0.78rem;">${adv.title}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.5;">${adv.message}</div>
      `;
      container.appendChild(card);
    });
  }

  // ─── Event Handlers Setup ─────────────────────────
  function initCapacity() {
    const config = loadConfig();

    // Load cached data first
    const hadCache = loadFCData();
    const hadActual = loadActualHistory();
    if (hadCache) {
      updateHeartbeat('connected');
    }

    // Try to refresh FC from sheet in background
    fetchFromSheet().then(success => {
      renderCapacityDashboard();
    }).catch(() => {
      if (hadCache) renderCapacityDashboard();
    });

    // Also auto-fetch Actual data from sheet
    fetchActualFromSheet().then(success => {
      if (success) {
        console.log('[Capacity] Actual data refreshed from sheet');
        renderCapacityDashboard();
      }
    }).catch(err => {
      console.warn('[Capacity] Actual sheet fetch failed:', err);
    });

    // If we had cache, render immediately while fetch happens
    if (hadCache || hadActual) {
      renderCapacityDashboard();
    }

    // ── Chart header prev button ──
    const btnPrevHeader = document.getElementById('cap-chart-prev');
    if (btnPrevHeader) {
      btnPrevHeader.onclick = () => {
        const config = loadConfig();
        const allCalc = calculateAllDays(config);
        chartStartIdx = Math.max(0, chartStartIdx - CHART_PAGE_SIZE);
        renderCapacityChart(allCalc, chartStartIdx, CHART_PAGE_SIZE);
      };
    }

    // ── Chart header next button ──
    const btnNextHeader = document.getElementById('cap-chart-next');
    if (btnNextHeader) {
      btnNextHeader.onclick = () => {
        const config = loadConfig();
        const allCalc = calculateAllDays(config);
        chartStartIdx = Math.min(allCalc.length - CHART_PAGE_SIZE, chartStartIdx + CHART_PAGE_SIZE);
        if (chartStartIdx + CHART_PAGE_SIZE > allCalc.length) {
          chartStartIdx = Math.max(0, allCalc.length - CHART_PAGE_SIZE);
        }
        renderCapacityChart(allCalc, chartStartIdx, CHART_PAGE_SIZE);
      };
    }

    // ── NVCT total input ──
    const nvctInput = document.getElementById('cap-nvct-total');
    if (nvctInput) {
      nvctInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 0) return;
        const cfg = loadConfig();
        cfg.nvct = val;
        saveConfig(cfg);
        renderCapacityDashboard();
      });
    }

    // ── Freelancer total input ──
    const flInput = document.getElementById('cap-fl-total');
    if (flInput) {
      flInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 0) return;
        const cfg = loadConfig();
        cfg.freelancer = val;
        saveConfig(cfg);
        renderCapacityDashboard();
      });
    }

    // ── Buffer slider ──
    const bufferSlider = document.getElementById('cap-buffer');
    if (bufferSlider) {
      bufferSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const label = document.getElementById('cap-buffer-val');
        if (label) label.textContent = `${val}%`;

        const cfg = loadConfig();
        cfg.bufferPercent = val;
        saveConfig(cfg);
        renderCapacityDashboard();
      });
    }

    // ── Paste button → shows modal ──
    const btnPaste = document.getElementById('cap-btn-paste');
    if (btnPaste) {
      btnPaste.addEventListener('click', () => {
        const modal = document.getElementById('cap-paste-modal');
        if (modal) modal.style.display = 'flex';
      });
    }

    // ── Apply paste ──
    const btnApplyPaste = document.getElementById('cap-btn-apply-paste');
    if (btnApplyPaste) {
      btnApplyPaste.addEventListener('click', () => {
        const textarea = document.getElementById('cap-paste-textarea');
        if (!textarea) return;

        const parsed = parsePasteData(textarea.value);
        if (parsed.length > 0) {
          fcData = parsed;
          actualData = [];
          saveFCData();
          updateHeartbeat('connected');
          renderCapacityDashboard();

          // Close modal
          const modal = document.getElementById('cap-paste-modal');
          if (modal) modal.style.display = 'none';
          textarea.value = '';
        } else {
          alert('Không thể phân tích dữ liệu. Vui lòng kiểm tra định dạng:\nDate\\tNormal\\tBulky\\tFreight');
        }
      });
    }

    // ── Close paste modal ──
    const btnCloseModal = document.getElementById('cap-btn-close-paste');
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => {
        const modal = document.getElementById('cap-paste-modal');
        if (modal) modal.style.display = 'none';
      });
    }

    // Also close with cancel button
    const btnCancelPaste = document.getElementById('cap-btn-cancel-paste');
    if (btnCancelPaste) {
      btnCancelPaste.addEventListener('click', () => {
        const modal = document.getElementById('cap-paste-modal');
        if (modal) modal.style.display = 'none';
      });
    }

    // ── Actual Data paste button → shows actual modal ──
    const btnPasteActual = document.getElementById('cap-btn-paste-actual');
    if (btnPasteActual) {
      btnPasteActual.addEventListener('click', () => {
        const modal = document.getElementById('cap-actual-modal');
        if (modal) modal.style.display = 'flex';
      });
    }

    // ── Apply actual paste ──
    const btnApplyActual = document.getElementById('cap-btn-apply-actual');
    if (btnApplyActual) {
      btnApplyActual.addEventListener('click', () => {
        const textarea = document.getElementById('cap-actual-textarea');
        if (!textarea) return;

        const parsed = parseActualPaste(textarea.value);
        if (parsed.length > 0) {
          actualHistory = parsed;
          calculateDerivedProductivity();
          saveActualHistory();
          updateHeartbeat('connected');
          renderCapacityDashboard();

          // Close modal
          const modal = document.getElementById('cap-actual-modal');
          if (modal) modal.style.display = 'none';
          textarea.value = '';

          // Show feedback
          alert(`✅ Đã nhập ${parsed.length} ngày Actual!\n\nNăng suất tự động:\n` +
            `• Normal: ${derivedProductivity?.normal ? formatNumber(derivedProductivity.normal) : '—'} đơn/người/ngày\n` +
            `• Bulky: ${derivedProductivity?.bulky ? formatNumber(derivedProductivity.bulky) : '—'} đơn/người/ngày\n` +
            `• Freight: ${derivedProductivity?.freight ? formatNumber(derivedProductivity.freight) : '—'} đơn/người/ngày\n\n` +
            `Bấm "⚡ Áp Dụng" trên panel để cập nhật vào cấu hình.`);
        } else {
          alert('Không thể phân tích dữ liệu Actual.\n\nĐịnh dạng cần:\nNgày\tVol_Normal\tVol_Bulky\tVol_Freight\tNS_Normal\tNS_Bulky\tNS_Freight\n01/06/2026\t280715\t48033\t56861\t200\t45\t28');
        }
      });
    }

    // ── Close actual modal ──
    const btnCancelActual = document.getElementById('cap-btn-cancel-actual');
    if (btnCancelActual) {
      btnCancelActual.addEventListener('click', () => {
        const modal = document.getElementById('cap-actual-modal');
        if (modal) modal.style.display = 'none';
      });
    }

    // ── Refresh button ──
    const btnRefresh = document.getElementById('cap-btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', async () => {
        btnRefresh.disabled = true;
        btnRefresh.textContent = 'Đang tải...';
        const success = await fetchFromSheet();
        btnRefresh.disabled = false;
        btnRefresh.textContent = 'Tải Lại FC';
        if (success) {
          renderCapacityDashboard();
        } else {
          alert('Không thể tải dữ liệu từ Google Sheets. Vui lòng thử lại hoặc dán dữ liệu thủ công.');
        }
      });
    }

    // ── Date range select ──
    const dateRangeSelect = document.getElementById('cap-date-range');
    if (dateRangeSelect) {
      dateRangeSelect.addEventListener('change', (e) => {
        const range = parseInt(e.target.value, 10);
        const config = loadConfig();
        const allCalc = calculateAllDays(config);
        const todayIdx = findTodayIndex();
        const startIdx = Math.max(0, todayIdx);
        const count = isNaN(range) ? allCalc.length : range;
        renderCapacityChart(allCalc, startIdx, count);
      });
    }
  }

  // ─── Expose public API ────────────────────────────
  window.capacity = {
    initCapacity,
    renderCapacityDashboard,
    fetchFromSheet
  };

})();
