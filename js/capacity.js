/* ═══════════════════════════════════════════════════
   capacity.js — Capacity Planning & Workforce Management
   KTC HCM01 — Kho Trung Chuyển Hồ Chí Minh 01
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  // ─── Constants ────────────────────────────────────
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1Yw7fOwP4f0b4idAmiXF4m4rmeuggr8C_N7m1IG6YOXs/export?format=csv&gid=1918098715';
  const LS_KEY_FC     = 'capacity_fc_data';
  const LS_KEY_CONF   = 'capacity_config';
  const LS_KEY_ACTUAL = 'capacity_actual_history';

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
  const DEFAULT_CONFIG = {
    productivity: {
      normal:  3000,  // đơn/người/ngày
      bulky:   800,   // đơn/người/ngày
      freight: 300    // đơn/người/ngày
    },
    nvct: {            // Nhân viên chính thức (fixed)
      normal:  180,
      bulky:   35,
      freight: 20
    },
    freelancer: {      // Freelancer (flexible)
      normal:  70,
      bulky:   15,
      freight: 10
    },
    bufferPercent: 10
  };

  // Helper: compute total staff from nvct + freelancer
  function totalStaff(config) {
    return {
      normal:  (config.nvct?.normal || 0)  + (config.freelancer?.normal || 0),
      bulky:   (config.nvct?.bulky || 0)   + (config.freelancer?.bulky || 0),
      freight: (config.nvct?.freight || 0) + (config.freelancer?.freight || 0)
    };
  }

  function loadConfig() {
    try {
      const stored = localStorage.getItem(LS_KEY_CONF);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Backward compat: old format had currentStaff, migrate to nvct+freelancer
        const hasOldFormat = parsed.currentStaff && !parsed.nvct;
        return {
          productivity: {
            normal:  parsed.productivity?.normal  ?? DEFAULT_CONFIG.productivity.normal,
            bulky:   parsed.productivity?.bulky   ?? DEFAULT_CONFIG.productivity.bulky,
            freight: parsed.productivity?.freight ?? DEFAULT_CONFIG.productivity.freight
          },
          nvct: {
            normal:  parsed.nvct?.normal  ?? (hasOldFormat ? Math.round((parsed.currentStaff?.normal || 250) * 0.7) : DEFAULT_CONFIG.nvct.normal),
            bulky:   parsed.nvct?.bulky   ?? (hasOldFormat ? Math.round((parsed.currentStaff?.bulky || 50) * 0.7) : DEFAULT_CONFIG.nvct.bulky),
            freight: parsed.nvct?.freight ?? (hasOldFormat ? Math.round((parsed.currentStaff?.freight || 30) * 0.7) : DEFAULT_CONFIG.nvct.freight)
          },
          freelancer: {
            normal:  parsed.freelancer?.normal  ?? (hasOldFormat ? Math.round((parsed.currentStaff?.normal || 250) * 0.3) : DEFAULT_CONFIG.freelancer.normal),
            bulky:   parsed.freelancer?.bulky   ?? (hasOldFormat ? Math.round((parsed.currentStaff?.bulky || 50) * 0.3) : DEFAULT_CONFIG.freelancer.bulky),
            freight: parsed.freelancer?.freight ?? (hasOldFormat ? Math.round((parsed.currentStaff?.freight || 30) * 0.3) : DEFAULT_CONFIG.freelancer.freight)
          },
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

  // ─── Parse Actual History paste ────────────────────
  // Format: Date\tVol_Normal\tVol_Bulky\tVol_Freight\tStaff_Normal\tStaff_Bulky\tStaff_Freight
  function parseActualPaste(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.trim().split('\n').map(l => l.replace(/\r/g, ''));
    if (lines.length < 2) return [];

    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 7) continue;

      const dateStr = cols[0].trim();
      // Skip header rows
      if (dateStr.toLowerCase().includes('ngày') || dateStr.toLowerCase().includes('date') || dateStr === '') continue;
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) continue;

      const volN = parseVNNumber(cols[1]);
      const volB = parseVNNumber(cols[2]);
      const volF = parseVNNumber(cols[3]);
      const stfN = parseVNNumber(cols[4]);
      const stfB = parseVNNumber(cols[5]);
      const stfF = parseVNNumber(cols[6]);

      // Skip rows with zero volume AND zero staff
      if ((volN + volB + volF) === 0 && (stfN + stfB + stfF) === 0) continue;

      result.push({
        date: dateStr,
        volNormal: volN, volBulky: volB, volFreight: volF,
        volTotal: volN + volB + volF,
        staffNormal: stfN, staffBulky: stfB, staffFreight: stfF,
        staffTotal: stfN + stfB + stfF
      });
    }
    return result;
  }

  // ─── Calculate productivity from actual history ────
  function calculateDerivedProductivity() {
    if (actualHistory.length === 0) {
      derivedProductivity = null;
      return;
    }

    // Filter days with meaningful data (staff > 0 and volume > 0)
    const validDays = actualHistory.filter(d =>
      d.staffNormal > 0 && d.staffBulky > 0 && d.staffFreight > 0 &&
      d.volNormal > 0 && d.volBulky > 0 && d.volFreight > 0
    );

    // If strict filter removes too many, allow partial
    const useDays = validDays.length >= 5 ? validDays : actualHistory.filter(d =>
      (d.staffNormal > 0 && d.volNormal > 0) ||
      (d.staffBulky > 0 && d.volBulky > 0) ||
      (d.staffFreight > 0 && d.volFreight > 0)
    );

    if (useDays.length === 0) {
      derivedProductivity = null;
      return;
    }

    // Calculate productivity per person per day for each valid day
    let sumProdN = 0, countN = 0;
    let sumProdB = 0, countB = 0;
    let sumProdF = 0, countF = 0;
    let maxVol = 0, peakDate = '';

    // For max staff seen
    let maxStaffN = 0, maxStaffB = 0, maxStaffF = 0;

    useDays.forEach(d => {
      if (d.staffNormal > 0 && d.volNormal > 0) {
        sumProdN += d.volNormal / d.staffNormal;
        countN++;
      }
      if (d.staffBulky > 0 && d.volBulky > 0) {
        sumProdB += d.volBulky / d.staffBulky;
        countB++;
      }
      if (d.staffFreight > 0 && d.volFreight > 0) {
        sumProdF += d.volFreight / d.staffFreight;
        countF++;
      }
      if (d.volTotal > maxVol) {
        maxVol = d.volTotal;
        peakDate = d.date;
      }
      if (d.staffNormal > maxStaffN) maxStaffN = d.staffNormal;
      if (d.staffBulky > maxStaffB)  maxStaffB = d.staffBulky;
      if (d.staffFreight > maxStaffF) maxStaffF = d.staffFreight;
    });

    const avgProdN = countN > 0 ? Math.round(sumProdN / countN) : null;
    const avgProdB = countB > 0 ? Math.round(sumProdB / countB) : null;
    const avgProdF = countF > 0 ? Math.round(sumProdF / countF) : null;

    derivedProductivity = {
      normal: avgProdN,
      bulky: avgProdB,
      freight: avgProdF,
      maxCapacity: maxVol,
      peakDate: peakDate,
      sampleDays: useDays.length,
      maxStaff: { normal: maxStaffN, bulky: maxStaffB, freight: maxStaffF }
    };

    console.log('[Capacity] Derived productivity from actual:', derivedProductivity);
  }

  // ─── Apply derived productivity to config ──────────
  function applyDerivedProductivity() {
    if (!derivedProductivity) return;
    const cfg = loadConfig();
    if (derivedProductivity.normal) cfg.productivity.normal = derivedProductivity.normal;
    if (derivedProductivity.bulky)  cfg.productivity.bulky  = derivedProductivity.bulky;
    if (derivedProductivity.freight) cfg.productivity.freight = derivedProductivity.freight;
    // Distribute max staff seen into NVCT (70%) + Freelancer (30%)
    if (derivedProductivity.maxStaff) {
      const ms = derivedProductivity.maxStaff;
      cfg.nvct.normal      = Math.round(ms.normal * 0.7);
      cfg.nvct.bulky       = Math.round(ms.bulky * 0.7);
      cfg.nvct.freight     = Math.round(ms.freight * 0.7);
      cfg.freelancer.normal  = ms.normal - cfg.nvct.normal;
      cfg.freelancer.bulky   = ms.bulky  - cfg.nvct.bulky;
      cfg.freelancer.freight = ms.freight - cfg.nvct.freight;
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

    const fc      = [];
    const actual  = [];

    // ── Find FC date header row (column[8] === 'FC - Đơn tạo') ──
    let fcHeaderIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][8] && rows[i][8].trim() === 'FC - Đơn tạo') {
        fcHeaderIdx = i;
        break;
      }
    }

    if (fcHeaderIdx === -1) {
      console.warn('[Capacity] Could not find FC date header row');
      return { fc: [], actual: [] };
    }

    // Extract FC date columns (column 9 onward)
    const fcDates = [];
    for (let c = 9; c < rows[fcHeaderIdx].length; c++) {
      const val = (rows[fcHeaderIdx][c] || '').trim();
      if (val && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
        fcDates.push({ col: c, date: val });
      }
    }

    // ── Find HCM01 FC total row (column[8] === 'HCM01', after fcHeaderIdx) ──
    let hcm01FcIdx = -1;
    for (let i = fcHeaderIdx + 1; i < rows.length; i++) {
      if (rows[i][8] && rows[i][8].trim() === 'HCM01') {
        hcm01FcIdx = i;
        break;
      }
    }

    if (hcm01FcIdx === -1) {
      console.warn('[Capacity] Could not find HCM01 FC row');
      return { fc: [], actual: [] };
    }

    // The breakdown rows follow immediately after HCM01 row
    const fcNormalRow  = rows[hcm01FcIdx + 1];
    const fcBulkyRow   = rows[hcm01FcIdx + 2];
    const fcFreightRow = rows[hcm01FcIdx + 3];

    // Validate breakdown rows by checking percentage markers
    const isNormalRow  = fcNormalRow  && (fcNormalRow[7]  || '').indexOf('80') !== -1;
    const isBulkyRow   = fcBulkyRow   && (fcBulkyRow[7]   || '').indexOf('12') !== -1;
    const isFreightRow = fcFreightRow && (fcFreightRow[7] || '').indexOf('8')  !== -1;

    if (!isNormalRow) {
      console.warn('[Capacity] FC Normal row validation failed, proceeding with positional fallback');
    }

    // Build FC data
    fcDates.forEach(({ col, date }) => {
      const total   = parseVNNumber(rows[hcm01FcIdx][col]);
      const normal  = fcNormalRow  ? parseVNNumber(fcNormalRow[col])  : Math.round(total * 0.80);
      const bulky   = fcBulkyRow   ? parseVNNumber(fcBulkyRow[col])   : Math.round(total * 0.12);
      const freight = fcFreightRow ? parseVNNumber(fcFreightRow[col]) : Math.round(total * 0.08);

      fc.push({
        date,
        normal,
        bulky,
        freight,
        total: total || (normal + bulky + freight)
      });
    });

    // ── Find Actual date header row (column[8] contains 'Actual - Đơn tạo') ──
    let actualHeaderIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][8] && rows[i][8].trim().indexOf('Actual - Đơn tạo') !== -1) {
        actualHeaderIdx = i;
        break;
      }
    }

    if (actualHeaderIdx !== -1) {
      // Find actual HCM01 row
      let hcm01ActualIdx = -1;
      for (let i = actualHeaderIdx + 1; i < rows.length; i++) {
        if (rows[i][0] && rows[i][0].trim() === 'Kho Trung Chuyển Hồ Chí Minh 01') {
          hcm01ActualIdx = i;
          break;
        }
      }

      if (hcm01ActualIdx !== -1) {
        // Extract actual dates from header
        const actualDates = [];
        for (let c = 9; c < rows[actualHeaderIdx].length; c++) {
          const val = (rows[actualHeaderIdx][c] || '').trim();
          if (val && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) {
            actualDates.push({ col: c, date: val });
          }
        }

        // Find Normal/Bulky/Freight sub-rows
        const actNormalRow  = rows[hcm01ActualIdx + 1];
        const actBulkyRow   = rows[hcm01ActualIdx + 2];
        const actFreightRow = rows[hcm01ActualIdx + 3];

        actualDates.forEach(({ col, date }) => {
          const total   = parseVNNumber(rows[hcm01ActualIdx][col]);
          const normal  = actNormalRow  ? parseVNNumber(actNormalRow[col])  : 0;
          const bulky   = actBulkyRow   ? parseVNNumber(actBulkyRow[col])   : 0;
          const freight = actFreightRow ? parseVNNumber(actFreightRow[col]) : 0;

          actual.push({
            date,
            normal,
            bulky,
            freight,
            total: total || (normal + bulky + freight)
          });
        });
      }
    }

    return { fc, actual };
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
  function calculateCapacity(dayData, config) {
    if (!dayData || !config) return null;

    const staff = totalStaff(config);

    const reqNormal  = Math.ceil(dayData.normal  / config.productivity.normal);
    const reqBulky   = Math.ceil(dayData.bulky   / config.productivity.bulky);
    const reqFreight = Math.ceil(dayData.freight  / config.productivity.freight);

    const reqSubtotal = reqNormal + reqBulky + reqFreight;
    const requiredTotal = Math.ceil(reqSubtotal * (1 + config.bufferPercent / 100));

    const nvctTotal = (config.nvct?.normal || 0) + (config.nvct?.bulky || 0) + (config.nvct?.freight || 0);
    const flTotal   = (config.freelancer?.normal || 0) + (config.freelancer?.bulky || 0) + (config.freelancer?.freight || 0);
    const currentTotal = nvctTotal + flTotal;

    const maxCapacity = (staff.normal  * config.productivity.normal) +
                        (staff.bulky   * config.productivity.bulky) +
                        (staff.freight * config.productivity.freight);

    // Freelancer delta: how many FL needed vs current FL
    const flNeeded = Math.max(0, requiredTotal - nvctTotal);
    const flDelta  = flNeeded - flTotal;

    const delta = requiredTotal - currentTotal;
    const gapPercent = maxCapacity > 0 ? ((dayData.total - maxCapacity) / maxCapacity) * 100 : 0;

    return {
      date:          dayData.date,
      fc:            dayData,
      reqNormal,
      reqBulky,
      reqFreight,
      reqSubtotal,
      requiredTotal,
      currentTotal,
      nvctTotal,
      flTotal,
      flNeeded,
      flDelta,
      maxCapacity,
      delta,
      gapPercent
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
    renderCapacityChart(allCalc, 0, 30);
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

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
          <div style="background:rgba(96,165,250,0.1);padding:8px 10px;border-radius:6px;border:1px solid rgba(96,165,250,0.2);">
            <div style="font-size:0.62rem;color:var(--text-muted);">Normal (< 5kg)</div>
            <div style="font-size:1rem;font-weight:800;font-family:'JetBrains Mono',monospace;color:${COLORS.normal};">${dp.normal ? formatNumber(dp.normal) : '—'}</div>
            <div style="font-size:0.58rem;color:var(--text-muted);">đơn/người/ngày</div>
          </div>
          <div style="background:rgba(251,191,36,0.1);padding:8px 10px;border-radius:6px;border:1px solid rgba(251,191,36,0.2);">
            <div style="font-size:0.62rem;color:var(--text-muted);">Bulky (5-15kg)</div>
            <div style="font-size:1rem;font-weight:800;font-family:'JetBrains Mono',monospace;color:${COLORS.bulky};">${dp.bulky ? formatNumber(dp.bulky) : '—'}</div>
            <div style="font-size:0.58rem;color:var(--text-muted);">đơn/người/ngày</div>
          </div>
          <div style="background:rgba(251,146,60,0.1);padding:8px 10px;border-radius:6px;border:1px solid rgba(251,146,60,0.2);">
            <div style="font-size:0.62rem;color:var(--text-muted);">Freight (> 15kg)</div>
            <div style="font-size:1rem;font-weight:800;font-family:'JetBrains Mono',monospace;color:${COLORS.freight};">${dp.freight ? formatNumber(dp.freight) : '—'}</div>
            <div style="font-size:0.58rem;color:var(--text-muted);">đơn/người/ngày</div>
          </div>
        </div>

        <div style="display:flex;gap:12px;font-size:0.68rem;color:var(--text-secondary);font-family:'JetBrains Mono',monospace;">
          <span>📈 Max xử lý: <strong style="color:var(--green);">${formatNumber(dp.maxCapacity)}</strong> đơn (${dp.peakDate})</span>
        </div>

        <div style="display:flex;gap:12px;font-size:0.68rem;color:var(--text-secondary);font-family:'JetBrains Mono',monospace;">
          <span>👥 Max NS: N:${dp.maxStaff?.normal || '—'} B:${dp.maxStaff?.bulky || '—'} F:${dp.maxStaff?.freight || '—'}</span>
        </div>

        <button id="cap-btn-apply-derived" class="filter-btn" style="border-color:var(--green);color:var(--green);font-weight:600;cursor:pointer;font-size:0.72rem;width:100%;text-align:center;">
          ⚡ Áp Dụng Năng Suất Actual → Config
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
          applyBtn.textContent = '⚡ Áp Dụng Năng Suất Actual → Config';
          applyBtn.style.color = 'var(--green)';
        }, 2000);
      };
    }
  }

  // ─── Update control values in UI ──────────────────
  function updateControlValues(config) {
    const setSlider = (id, valId, value, suffix) => {
      const slider = document.getElementById(id);
      const label  = document.getElementById(valId);
      if (slider) slider.value = value;
      if (label)  label.textContent = `${formatNumber(value)}${suffix}`;
    };

    setSlider('cap-prod-normal',  'cap-prod-normal-val',  config.productivity.normal,  ' đơn/người');
    setSlider('cap-prod-bulky',   'cap-prod-bulky-val',   config.productivity.bulky,   ' đơn/người');
    setSlider('cap-prod-freight', 'cap-prod-freight-val', config.productivity.freight,  ' đơn/người');
    setSlider('cap-buffer',       'cap-buffer-val',       config.bufferPercent,         '%');

    const setInput = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };

    setInput('cap-nvct-normal',  config.nvct.normal);
    setInput('cap-nvct-bulky',   config.nvct.bulky);
    setInput('cap-nvct-freight', config.nvct.freight);
    setInput('cap-fl-normal',    config.freelancer.normal);
    setInput('cap-fl-bulky',     config.freelancer.bulky);
    setInput('cap-fl-freight',   config.freelancer.freight);
  }

  // ─── Render: KPIs ────────────────────────────────
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
      const staff = totalStaff(config);
      const t = staff.normal + staff.bulky + staff.freight;
      elCapSub.textContent = `${t} NS (NVCT:${config.nvct.normal+config.nvct.bulky+config.nvct.freight} + FL:${config.freelancer.normal+config.freelancer.bulky+config.freelancer.freight})`;
    }

    // Staff Needed
    const elStaff = document.getElementById('cap-kpi-staff-needed');
    if (elStaff) elStaff.textContent = formatNumber(todayCalc.requiredTotal);

    const elStaffSub = document.getElementById('cap-kpi-sub-staff');
    if (elStaffSub) elStaffSub.textContent = `N:${todayCalc.reqNormal} B:${todayCalc.reqBulky} F:${todayCalc.reqFreight} +${config.bufferPercent}% buffer`;

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
  let chartPage = 0;
  const CHART_PAGE_SIZE = 30;

  function renderCapacityChart(allCalc, startIdx, count) {
    const container = document.getElementById('cap-chart-container');
    if (!container) return;
    container.innerHTML = '';

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

    // Navigation buttons
    const navContainer = document.createElement('div');
    navContainer.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-top:12px; padding: 0 4px;';

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex; gap:14px; font-size:0.68rem; color:var(--text-muted); font-family:"JetBrains Mono",monospace;';
    legend.innerHTML = `
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${COLORS.normal};display:inline-block;border-radius:2px;"></span> Normal</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${COLORS.bulky};display:inline-block;border-radius:2px;"></span> Bulky</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:${COLORS.freight};display:inline-block;border-radius:2px;"></span> Freight</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:12px;height:2px;border-top:2px dashed ${COLORS.capLine};display:inline-block;"></span> Capacity</span>
    `;

    const navBtns = document.createElement('div');
    navBtns.style.cssText = 'display:flex; gap:8px;';

    const btnPrev = document.createElement('button');
    btnPrev.className = 'filter-btn';
    btnPrev.style.cssText = 'padding:4px 12px; font-size:0.7rem; cursor:pointer;';
    btnPrev.textContent = '← Trước';
    btnPrev.disabled = startIdx === 0;
    btnPrev.onclick = () => {
      const newStart = Math.max(0, startIdx - CHART_PAGE_SIZE);
      chartPage = Math.floor(newStart / CHART_PAGE_SIZE);
      renderCapacityChart(allCalc, newStart, CHART_PAGE_SIZE);
    };

    const btnNext = document.createElement('button');
    btnNext.className = 'filter-btn';
    btnNext.style.cssText = 'padding:4px 12px; font-size:0.7rem; cursor:pointer;';
    btnNext.textContent = 'Sau →';
    btnNext.disabled = startIdx + count >= allCalc.length;
    btnNext.onclick = () => {
      const newStart = startIdx + CHART_PAGE_SIZE;
      if (newStart < allCalc.length) {
        chartPage = Math.floor(newStart / CHART_PAGE_SIZE);
        renderCapacityChart(allCalc, newStart, CHART_PAGE_SIZE);
      }
    };

    const pageInfo = document.createElement('span');
    pageInfo.style.cssText = 'font-size:0.68rem; color:var(--text-muted); font-family:"JetBrains Mono",monospace;';
    pageInfo.textContent = `${startIdx + 1}–${Math.min(startIdx + count, allCalc.length)} / ${allCalc.length} ngày`;

    navBtns.appendChild(btnPrev);
    navBtns.appendChild(pageInfo);
    navBtns.appendChild(btnNext);

    navContainer.appendChild(legend);
    navContainer.appendChild(navBtns);
    container.appendChild(navContainer);
  }

  // ─── Render: Staffing Table ───────────────────────
  function renderStaffingTable(allCalc) {
    const tbody = document.getElementById('cap-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    allCalc.forEach(calc => {
      const dayName     = getDayOfWeek(calc.date);
      const weekendFlag = isWeekend(calc.date);

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
      if (weekendFlag) {
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
        <td style="text-align:left; padding:8px 10px; ${monoStyle} font-weight:600; color:var(--text-primary);">${calc.date}</td>
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

    // Try to refresh from sheet in background
    fetchFromSheet().then(success => {
      renderCapacityDashboard();
    }).catch(() => {
      if (hadCache) renderCapacityDashboard();
    });

    // If we had cache, render immediately while fetch happens
    if (hadCache || hadActual) {
      renderCapacityDashboard();
    }

    // ── Productivity sliders ──
    const prodSliders = [
      { id: 'cap-prod-normal',  valId: 'cap-prod-normal-val',  key: 'normal',  suffix: ' đơn/người' },
      { id: 'cap-prod-bulky',   valId: 'cap-prod-bulky-val',   key: 'bulky',   suffix: ' đơn/người' },
      { id: 'cap-prod-freight', valId: 'cap-prod-freight-val', key: 'freight', suffix: ' đơn/người' }
    ];

    prodSliders.forEach(({ id, valId, key, suffix }) => {
      const slider = document.getElementById(id);
      if (slider) {
        slider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          const label = document.getElementById(valId);
          if (label) label.textContent = `${formatNumber(val)}${suffix}`;

          const cfg = loadConfig();
          cfg.productivity[key] = val;
          saveConfig(cfg);
          renderCapacityDashboard();
        });
      }
    });

    // ── NVCT number inputs ──
    const nvctInputs = [
      { id: 'cap-nvct-normal',  key: 'normal' },
      { id: 'cap-nvct-bulky',   key: 'bulky' },
      { id: 'cap-nvct-freight', key: 'freight' }
    ];

    nvctInputs.forEach(({ id, key }) => {
      const input = document.getElementById(id);
      if (input) {
        input.addEventListener('change', (e) => {
          const val = parseInt(e.target.value, 10);
          if (isNaN(val) || val < 0) return;
          const cfg = loadConfig();
          cfg.nvct[key] = val;
          saveConfig(cfg);
          renderCapacityDashboard();
        });
      }
    });

    // ── Freelancer number inputs ──
    const flInputs = [
      { id: 'cap-fl-normal',  key: 'normal' },
      { id: 'cap-fl-bulky',   key: 'bulky' },
      { id: 'cap-fl-freight', key: 'freight' }
    ];

    flInputs.forEach(({ id, key }) => {
      const input = document.getElementById(id);
      if (input) {
        input.addEventListener('change', (e) => {
          const val = parseInt(e.target.value, 10);
          if (isNaN(val) || val < 0) return;
          const cfg = loadConfig();
          cfg.freelancer[key] = val;
          saveConfig(cfg);
          renderCapacityDashboard();
        });
      }
    });

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
