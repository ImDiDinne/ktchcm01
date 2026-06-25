/* ═══════════════════════════════════════════════════
   inbound.js — Inbound / TripScan Logic & Simulation
   ═══════════════════════════════════════════════════ */
(function() {
  'use strict';

  window.tripScanData = [];
  window.selectedInboundDate = '';
  window.unloadingTripsMap = {};

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

  function parseDateDDMMYYYY(str) {
    if (!str) return null;
    const safeStr = String(str);
    const parts = safeStr.split('/');
    if (parts.length === 3) {
      return {
        day: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10) - 1,
        year: parseInt(parts[2], 10)
      };
    }
    return null;
  }

  function isSameDay(date1Str, date2Str) {
    if (!date1Str || !date2Str) return false;
    const d1 = parseDateDDMMYYYY(date1Str);
    const d2 = parseDateDDMMYYYY(date2Str);
    if (!d1 || !d2) return String(date1Str).trim() === String(date2Str).trim();
    return d1.day === d2.day && d1.month === d2.month && d1.year === d2.year;
  }

  function getTripHour(trip) {
    if (trip.time) {
      const parts = String(trip.time).split(':');
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

  function getDurationMinutes(arrivalTimeStr, syncedAtStr) {
    if (!arrivalTimeStr || !syncedAtStr) return 0;
    try {
      const arrParts = String(arrivalTimeStr).split(':');
      if (arrParts.length < 2) return 0;
      const arrH = parseInt(arrParts[0], 10);
      const arrM = parseInt(arrParts[1], 10);
      const arrS = arrParts.length > 2 ? parseInt(arrParts[2], 10) : 0;
      
      const spaceParts = String(syncedAtStr).split(' ');
      const syncTimeStr = spaceParts[0];
      const syncParts = String(syncTimeStr).split(':');
      if (syncParts.length < 2) return 0;
      const syncH = parseInt(syncParts[0], 10);
      const syncM = parseInt(syncParts[1], 10);
      const syncS = syncParts.length > 2 ? parseInt(syncParts[2], 10) : 0;
      
      const arrTotalSeconds = arrH * 3600 + arrM * 60 + arrS;
      const syncTotalSeconds = syncH * 3600 + syncM * 60 + syncS;
      
      let diffSeconds = syncTotalSeconds - arrTotalSeconds;
      if (diffSeconds < 0) {
        diffSeconds += 24 * 3600;
      }
      return Math.floor(diffSeconds / 60);
    } catch(e) {
      console.error("Error calculating duration:", e);
      return 0;
    }
  }

  function getWaitTimeMinutes(trip) {
    if (trip.remainingMinutes !== undefined) return trip.remainingMinutes;
    if (!trip.time) return 0;
    
    const todayStr = getTodayString();
    const targetDateStr = window.selectedInboundDate || todayStr;
    
    if (!isSameDay(trip.date, targetDateStr)) return 0;
    
    const parts = String(trip.time).split(':');
    if (parts.length < 2) return 0;
    
    const tripHour = parseInt(parts[0], 10);
    const tripMin = parseInt(parts[1], 10);
    const tripSec = parts.length > 2 ? parseInt(parts[2], 10) : 0;
    
    if (isSameDay(targetDateStr, todayStr)) {
      const ss = (trip.status || '').toLowerCase();
      const isCompleted = ss === 'đã nhận' || ss === 'đã giao' || ss === 'received' || ss === 'completed';
      if (isCompleted && trip.syncedAt) {
        return getDurationMinutes(trip.time, trip.syncedAt);
      }
      
      const now = new Date();
      const tzOffset = 7 * 60;
      const localTime = new Date(now.getTime() + (now.getTimezoneOffset() + tzOffset) * 60 * 1000);
      
      const tripDateObj = new Date(localTime);
      tripDateObj.setHours(tripHour, tripMin, tripSec, 0);
      
      const diffMs = localTime - tripDateObj;
      if (diffMs < 0) return 0;
      return Math.floor(diffMs / (1000 * 60));
    } else {
      if (trip.syncedAt) {
        return getDurationMinutes(trip.time, trip.syncedAt);
      }
      return 0;
    }
  }

  // Local Storage configs
  function getDockTAvg() {
    const stored = localStorage.getItem('dock_sim_t_avg');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= 15 && parsed <= 90) return parsed;
    }
    return 30;
  }

  function saveDockTAvg(val) {
    localStorage.setItem('dock_sim_t_avg', val);
  }

  function getDockStations() {
    const stored = localStorage.getItem('dock_sim_stations');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === 24) {
          return parsed.map(n => {
            const num = parseInt(n, 10);
            return isNaN(num) ? 0 : num;
          });
        }
      } catch(e) {}
    }
    return Array(24).fill(0).map((_, h) => {
      if (h >= 6 && h < 18) return 4;
      if (h >= 18 && h < 24) return 3;
      return 2;
    });
  }

  function saveDockStations(stations) {
    localStorage.setItem('dock_sim_stations', JSON.stringify(stations));
  }

  // Supabase Unloading Trips Map Fetcher
  async function fetchSupabaseUnloadingTrips() {
    window.unloadingTripsMap = {};
    if (!window.supabaseClient) {
      setTimeout(fetchSupabaseUnloadingTrips, 500);
      return;
    }
    
    try {
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - 14); // 14 days limit
      const isoStr = dateLimit.toISOString();
      
      const { data, error } = await window.supabaseClient
        .from('unloading_trips')
        .select('*')
        .gte('started_at', isoStr)
        .order('started_at', { ascending: false })
        .limit(5000);

      if (error) throw error;

      if (Array.isArray(data)) {
        data.forEach(item => {
          if (item.code && item.started_at) {
            window.unloadingTripsMap[item.code] = {
              started_at: item.started_at,
              unloaded_at: item.unloaded_at || null
            };
          }
        });
        console.log(`Loaded ${data.length} unloading records from Supabase.`);
      }
    } catch(e) {
      console.error("Error fetching unloading trips from Supabase:", e);
    }
  }

  // ── Auto-Complete: Tự động chuyển trạng thái cho xe bị kẹt "Đang nhập" quá lâu ──
  async function autoCompleteStuckTrips() {
    if (!window.supabaseClient) return;
    
    const tAvg = getDockTAvg();
    // Ngưỡng auto-complete = tAvg * 2, tối thiểu 60 phút
    const thresholdMin = Math.max(tAvg * 2, 60);
    const now = Date.now();
    const stuckCodes = [];
    
    for (const [code, tripData] of Object.entries(window.unloadingTripsMap)) {
      if (tripData.unloaded_at) continue; // Đã xong rồi, bỏ qua
      
      const startedAt = new Date(tripData.started_at).getTime();
      const elapsedMin = (now - startedAt) / (1000 * 60);
      
      if (elapsedMin >= thresholdMin) {
        stuckCodes.push(code);
      }
    }
    
    if (stuckCodes.length === 0) return;
    
    console.log(`🔄 Auto-Complete: Phát hiện ${stuckCodes.length} chuyến xe bị kẹt > ${thresholdMin} phút:`, stuckCodes);
    
    // Batch update Supabase
    for (const code of stuckCodes) {
      try {
        const tripData = window.unloadingTripsMap[code];
        // Tính unloaded_at = started_at + tAvg phút (ước lượng thời gian thực tế)
        const estimatedEnd = new Date(new Date(tripData.started_at).getTime() + tAvg * 60 * 1000).toISOString();
        
        const { error } = await window.supabaseClient
          .from('unloading_trips')
          .update({ unloaded_at: estimatedEnd })
          .eq('code', code)
          .is('unloaded_at', null); // Chỉ update nếu chưa có unloaded_at (tránh race condition)
        
        if (error) {
          console.error(`❌ Auto-Complete lỗi cho ${code}:`, error);
        } else {
          // Cập nhật local map ngay
          window.unloadingTripsMap[code].unloaded_at = estimatedEnd;
          window.unloadingTripsMap[code].autoCompleted = true;
          console.log(`✅ Auto-Complete: ${code} → Đã nhận (tự động sau ${Math.round((now - new Date(tripData.started_at).getTime()) / 60000)} phút)`);
        }
      } catch (e) {
        console.error(`❌ Auto-Complete exception cho ${code}:`, e);
      }
    }
  }

  function calculateAverageProcessingTime(trips) {
    let totalMin = 0;
    let count = 0;
    trips.forEach(t => {
      const s = (t.status || '').toLowerCase();
      const isCompleted = s === 'đã nhận' || s === 'đã giao' || s === 'received' || s === 'completed';
      if (isCompleted && t.syncedAt) {
        totalMin += getDurationMinutes(t.time, t.syncedAt);
        count++;
      } else if (t.code && window.unloadingTripsMap[t.code]) {
        const tripData = window.unloadingTripsMap[t.code];
        const startedAt = new Date(tripData.started_at);
        const endAt = tripData.unloaded_at ? new Date(tripData.unloaded_at) : new Date();
        const elapsed = Math.floor((endAt.getTime() - startedAt.getTime()) / (1000 * 60));
        if (elapsed > 0) {
          totalMin += elapsed;
          count++;
        }
      }
    });
    return count > 0 ? (totalMin / count).toFixed(1) : '—';
  }

  function getTodayTrips() {
    const targetDateStr = window.selectedInboundDate || getTodayString();
    const trips = window.tripScanData.filter(t => isSameDay(t.date, targetDateStr));
    const isViewingToday = isSameDay(targetDateStr, getTodayString());
    
    trips.forEach(t => {
      if (t.code && window.unloadingTripsMap[t.code]) {
        // CÓ trong Telegram bot
        const tripData = window.unloadingTripsMap[t.code];
        if (tripData.unloaded_at) {
          // Đã xong
          t.status = 'Đã nhận';
          if (tripData.autoCompleted) {
            t.autoCompleted = true;
          }
        } else {
          // Kiểm tra có bị kẹt quá lâu không
          const startedAt = new Date(tripData.started_at);
          const elapsedMin = Math.floor((Date.now() - startedAt.getTime()) / (1000 * 60));
          const tAvg = getDockTAvg();
          const thresholdMin = Math.max(tAvg * 2, 60);
          
          if (elapsedMin >= thresholdMin) {
            // Đã quá lâu → hiển thị là Đã nhận (tự động) trong khi chờ Supabase cập nhật
            t.status = 'Đã nhận';
            t.autoCompleted = true;
          } else {
            // Đang nhập (Chưa có log kết thúc)
            t.status = 'Đang nhập';
            if (isViewingToday) {
              // User requested to simulate 30 mins
              t.remainingMinutes = tAvg - elapsedMin;
            }
          }
        }
      } else {
        // KHÔNG có trong Telegram bot → kiểm tra status từ TripScan (trips_cache)
        const cachedStatus = (t.status || '').toLowerCase();
        const isAlreadyUnloading = cachedStatus === 'đang nhập' || cachedStatus === 'đang xử lý' || cachedStatus === 'đang nhận';
        const isAlreadyReceived = cachedStatus === 'đã nhận' || cachedStatus === 'đã giao';
        
        if (isAlreadyReceived) {
          t.status = 'Đã nhận';
        } else if (isAlreadyUnloading) {
          // TripScan ghi "Đang Nhập" nhưng Telegram bot không bắt được → fallback
          t.status = 'Đang nhập';
          if (isViewingToday && t.time) {
            const parts = t.time.split(':');
            if (parts.length >= 2) {
              const now = new Date();
              const tzOffset = 7 * 60;
              const localTime = new Date(now.getTime() + (now.getTimezoneOffset() + tzOffset) * 60 * 1000);
              const arrivalDate = new Date(localTime);
              arrivalDate.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), parts.length > 2 ? parseInt(parts[2], 10) : 0, 0);
              const diffMs = localTime - arrivalDate;
              if (diffMs > 0) {
                const tAvg = getDockTAvg();
                const elapsed = Math.floor(diffMs / (1000 * 60));
                t.remainingMinutes = tAvg - elapsed;
              }
            }
          }
        } else {
          // Thực sự chưa có thông tin → Chờ dỡ
          t.status = 'Chờ dỡ';
          if (isViewingToday && t.time) {
            const parts = t.time.split(':');
            if (parts.length >= 2) {
              const now = new Date();
              const tzOffset = 7 * 60;
              const localTime = new Date(now.getTime() + (now.getTimezoneOffset() + tzOffset) * 60 * 1000);
              
              const arrivalDate = new Date(localTime);
              arrivalDate.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), parts.length > 2 ? parseInt(parts[2], 10) : 0, 0);
              
              const diffMs = localTime - arrivalDate;
              if (diffMs > 0) {
                t.remainingMinutes = Math.floor(diffMs / (1000 * 60));
              } else {
                t.remainingMinutes = 0;
              }
            }
          }
        }
      }
    });
    
    return trips;
  }

  // Handle status update of trip manually
  async function handleStatusChange(selectEl) {
    const code = selectEl.dataset.tripCode;
    const val = selectEl.value;
    
    if (!window.supabaseClient) {
      alert("Supabase client is not initialised.");
      return;
    }
    
    selectEl.disabled = true;
    
    try {
      if (val === 'waiting') {
        // DELETE record from Supabase
        const { error } = await window.supabaseClient
          .from('unloading_trips')
          .delete()
          .eq('code', code);
        if (error) throw error;
      } else {
        let payload = { code: code };
        if (val === 'unloading') {
          payload.started_at = new Date().toISOString();
          payload.unloaded_at = null;
        } else {
          const tAvg = getDockTAvg();
          payload.started_at = new Date(Date.now() - (tAvg + 5) * 60 * 1000).toISOString();
          payload.unloaded_at = new Date().toISOString();
        }
        
        const { error } = await window.supabaseClient
          .from('unloading_trips')
          .upsert(payload);
        if (error) throw error;
      }
      
      await fetchSupabaseUnloadingTrips();
      runDockSimulation();
      
    } catch (e) {
      console.error("Lỗi cập nhật trạng thái chuyến xe:", e);
      alert(`❌ Cập nhật thất bại!\n\nLỗi: ${e.message}\n\nHướng dẫn: Hãy đảm bảo ní đã bật quyền ghi (RLS Policy) cho role 'anon' trên bảng 'unloading_trips' trong Supabase.`);
      await fetchSupabaseUnloadingTrips();
      runDockSimulation();
    } finally {
      selectEl.disabled = false;
    }
  }

  function getStatusBadge(status, trip) {
    if (!status) return '—';
    const s = status.toLowerCase();
    let bg = 'rgba(255,255,255,0.05)';
    let fg = 'var(--text-muted)';
    let text = status;
    
    const isWaiting = s === 'đăng chờ' || s === 'đang chờ' || s === 'chờ dỡ' || s === 'waiting';
    const isUnloading = s === 'đang nhập' || s === 'đang xử lý' || s === 'unloading' || s === 'processing';
    const isReceived = s === 'đã nhận' || s === 'đã giao' || s === 'completed' || s === 'received';

    if (isWaiting) {
      bg = 'rgba(255, 100, 100, 0.15)';
      fg = 'var(--red)';
    } else if (isUnloading) {
      bg = 'rgba(251, 191, 36, 0.15)';
      fg = 'var(--yellow)';
      if (trip && trip.remainingMinutes != null) {
        text = `Đang nhập (Còn ${trip.remainingMinutes}p)`;
      }
    } else if (isReceived) {
      bg = 'rgba(52, 211, 153, 0.15)';
      fg = 'var(--green)';
      if (trip && trip.autoCompleted) {
        text = `Đã nhận (Tự động)`;
      }
    }
    
    // Button Check log cho trạng thái đang nhập
    let checkBtn = '';
    if (isUnloading) {
      checkBtn = `<button onclick="triggerScrape(this)" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); cursor: pointer; margin-left: 4px; padding: 2px 6px; font-size: 0.65rem; transition: all 0.2s;" title="Tự động dò tìm log kết thúc trên GHN" onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='var(--accent-light)';" onmouseout="this.style.background='rgba(255,255,255,0.05)';this.style.color='var(--text-muted)';">🔄 Dò Log</button>`;
    }
    
    // Status select dropdown for managers/operators if logged in
    if (window.currentUser && trip && trip.code) {
      const optionWaiting = `<option value="waiting" ${isWaiting ? 'selected' : ''} style="background: #1e293b; color: var(--yellow);">⏳ Đang Chờ</option>`;
      const optionUnloading = `<option value="unloading" ${isUnloading ? 'selected' : ''} style="background: #1e293b; color: var(--blue-light);">🚚 Đang Nhập</option>`;
      const optionReceived = `<option value="received" ${isReceived ? 'selected' : ''} style="background: #1e293b; color: var(--green);">✅ Đã Nhận</option>`;
      
      return `
        <div style="display: inline-flex; align-items: center;">
        <select 
          data-trip-code="${escapeHTML(trip.code)}"
          onchange="window.inbound.handleStatusChange(this)"
          style="
            display: inline-block; 
            padding: 2px 16px 2px 4px; 
            border-radius: 4px; 
            font-size: 0.65rem; 
            font-weight: 600; 
            max-width: 100%;
            background: ${bg} url('data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;10&quot; height=&quot;6&quot; viewBox=&quot;0 0 10 6&quot;><path fill=&quot;${encodeURIComponent(fg)}&quot; d=&quot;M0 0l5 5 5-5z&quot;/></svg>') no-repeat right 4px center; 
            background-size: 7px 4px;
            color: ${fg};
            border: 1px solid rgba(255,255,255,0.05);
            outline: none;
            cursor: pointer;
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
          "
        >
          ${optionWaiting}
          ${optionUnloading}
          ${optionReceived}
        </select>${checkBtn}
        </div>
      `;
    }
    
    return `<div style="display: inline-flex; align-items: center;"><span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 600; background: ${bg}; color: ${fg}; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(text)}</span>${checkBtn}</div>`;
  }

  function populateInboundDates() {
    const selectEl = document.getElementById('inbound-date-select');
    if (!selectEl) return;
    
    const uniqueDates = [...new Set(window.tripScanData.map(t => t.date))].filter(Boolean);
    
    uniqueDates.sort((a, b) => {
      const strA = String(a);
      const strB = String(b);
      const d1 = parseDateDDMMYYYY(strA);
      const d2 = parseDateDDMMYYYY(strB);
      if (!d1 || !d2) return strB.localeCompare(strA);
      const t1 = new Date(d1.year, d1.month, d1.day).getTime();
      const t2 = new Date(d2.year, d2.month, d2.day).getTime();
      return t2 - t1;
    });
    
    const previousValue = selectEl.value || window.selectedInboundDate;
    selectEl.innerHTML = '';
    
    const todayStr = getTodayString();
    if (!uniqueDates.includes(todayStr)) {
      uniqueDates.unshift(todayStr);
    }
    
    uniqueDates.forEach(dateStr => {
      const option = document.createElement('option');
      option.value = dateStr;
      option.textContent = dateStr === todayStr ? `Hôm nay (${dateStr})` : dateStr;
      selectEl.appendChild(option);
    });
    
    if (previousValue && uniqueDates.includes(previousValue)) {
      selectEl.value = previousValue;
      window.selectedInboundDate = previousValue;
    } else {
      const datesWithData = uniqueDates.filter(d => window.tripScanData.some(t => isSameDay(t.date, d)));
      const defaultDate = datesWithData.length > 0 ? datesWithData[0] : todayStr;
      selectEl.value = defaultDate;
      window.selectedInboundDate = defaultDate;
    }
  }

  function updateDaySummaryBanner(todayTrips) {
    const banner = document.getElementById('dock-day-summary-banner');
    if (!banner) return;
    
    const targetDateStr = window.selectedInboundDate || getTodayString();
    const isToday = isSameDay(targetDateStr, getTodayString());
    const titleLabel = isToday ? `Hôm Nay (${targetDateStr})` : `Ngày ${targetDateStr}`;
    
    const totalTrips = todayTrips.length;
    const overdueTripsCount = todayTrips.filter(t => getWaitTimeMinutes(t) > 30).length;
    const slaPercent = totalTrips > 0 ? ((totalTrips - overdueTripsCount) / totalTrips * 100).toFixed(1) : '100.0';
    const avgTime = calculateAverageProcessingTime(todayTrips);
    
    const titleEl = document.getElementById('dock-summary-title');
    if (titleEl) titleEl.textContent = `📊 Tình Hình Tổng Quan ${titleLabel}`;
    
    const textEl = document.getElementById('dock-summary-text');
    if (textEl) {
      textEl.innerHTML = `
        Tổng số xe đến trạm: <strong>${totalTrips} xe</strong>. 
        Số xe chờ/xử lý quá hạn (>30p): <strong style="color: ${overdueTripsCount > 0 ? 'var(--red)' : 'var(--green)'};">${overdueTripsCount} xe</strong>. 
        Tỷ lệ hoàn thành đúng SLA: <strong style="color: ${parseFloat(slaPercent) >= 95 ? 'var(--green)' : 'var(--yellow)'};">${slaPercent}%</strong>. 
        Thời gian chờ/dỡ trung bình: <strong>${avgTime} phút/xe</strong>.
      `;
    }
  }

  function renderDockKPIs(todayTrips) {
    const targetDateStr = window.selectedInboundDate || getTodayString();
    const isToday = isSameDay(targetDateStr, getTodayString());
    const titleLabel = isToday ? "Hôm Nay" : targetDateStr;

    const totalTrips = todayTrips.length;
    const waitingCount = todayTrips.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s === 'đang chờ' || s === 'đăng chờ' || s === 'chờ dỡ' || s === 'waiting';
    }).length;
    const enteringCount = todayTrips.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s === 'đang nhập' || s === 'đang xử lý' || s === 'unloading' || s === 'processing';
    }).length;
    const receivedCount = todayTrips.filter(t => {
      const s = (t.status || '').toLowerCase();
      return s === 'đã nhận' || s === 'đã giao' || s === 'received' || s === 'completed';
    }).length;
    const overdueTripsCount = todayTrips.filter(t => {
      const wt = getWaitTimeMinutes(t);
      return wt > 30 && wt < 9999; // Bỏ qua giá trị bất thường
    }).length;

    const kpiCards = document.querySelectorAll('#tab-content-dock .kpi-card');
    if (kpiCards.length >= 5) {
      kpiCards[0].querySelector('.kpi-label').textContent = `Tổng Chuyến ${titleLabel}`;
      kpiCards[4].querySelector('.kpi-label').textContent = `Chờ Quá Hạn (>30p)`;
    }

    const totalTripsEl = document.getElementById('dock-total-trips');
    const totalTripsSub = document.getElementById('dock-sub-total');
    if (totalTripsEl) totalTripsEl.textContent = totalTrips;
    if (totalTripsSub) totalTripsSub.textContent = `${totalTrips} xe tải trong ngày`;
    
    const waitingEl = document.getElementById('dock-total-waiting');
    const waitingSub = document.getElementById('dock-sub-waiting');
    if (waitingEl) waitingEl.textContent = waitingCount;
    if (waitingSub) waitingSub.textContent = `${waitingCount} xe chờ dỡ`;
    
    const enteringEl = document.getElementById('dock-total-entering');
    const enteringSub = document.getElementById('dock-sub-entering');
    if (enteringEl) enteringEl.textContent = enteringCount;
    if (enteringSub) enteringSub.textContent = `${enteringCount} xe đang nhập`;
    
    const receivedEl = document.getElementById('dock-total-received');
    const receivedSub = document.getElementById('dock-sub-received');
    if (receivedEl) receivedEl.textContent = receivedCount;
    if (receivedSub) receivedSub.textContent = `${receivedCount} xe đã hoàn tất`;

    const overdueKpi = document.getElementById('dock-overdue-count');
    const overdueSub = document.getElementById('dock-sub-overdue');
    if (overdueKpi) overdueKpi.textContent = overdueTripsCount;
    if (overdueSub) overdueSub.textContent = `> 30p chờ (${overdueTripsCount} xe)`;
  }

  function renderAdvisory(simulation, tAvg) {
    const container = document.getElementById('dock-advisory-list');
    if (!container) return;
    container.innerHTML = '';
    
    const advisories = [];
    
    simulation.forEach(s => {
      const hourStr = String(s.hour).padStart(2, '0') + ':00';
      
      if (s.queue > 0) {
        const neededStations = Math.ceil((s.queue * tAvg) / 60);
        advisories.push({
          type: 'warning',
          hour: s.hour,
          title: `⚠️ Ùn Ứ Khung Giờ ${hourStr}`,
          message: `Lượng xe dồn ứ là <strong>${s.queue.toFixed(1)} xe</strong>. Khuyến nghị mở thêm ít nhất <strong>${neededStations} trạm</strong> (tổng ${s.stations + neededStations} trạm) để giải tỏa nghẽn.`
        });
      }
      else if (s.utilization < 30 && s.stations > 1 && s.arrived > 0) {
        const optStations = Math.max(1, Math.ceil((s.arrived * tAvg) / 60));
        const savedStations = s.stations - optStations;
        if (savedStations > 0) {
          advisories.push({
            type: 'info',
            hour: s.hour,
            title: `💡 Dư Thừa Trạm Khung Giờ ${hourStr}`,
            message: `Hiệu suất sử dụng trạm chỉ đạt <strong>${s.utilization.toFixed(0)}%</strong>. Có thể đóng bớt <strong>${savedStations} trạm</strong> (giảm về ${optStations} trạm) để tối ưu hóa nhân sự.`
          });
        }
      }
    });
    
    advisories.sort((a, b) => {
      if (a.type === 'warning' && b.type !== 'warning') return -1;
      if (a.type !== 'warning' && b.type === 'warning') return 1;
      return a.hour - b.hour;
    });
    
    const displayed = advisories.slice(0, 5);
    
    if (displayed.length > 0) {
      displayed.forEach(adv => {
        const card = document.createElement('div');
        card.className = `kpi-card dock-advisory-card ${adv.type}`;
        card.style.padding = '12px';
        card.style.marginBottom = '8px';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '4px';
        
        let titleColor = 'var(--text-primary)';
        if (adv.type === 'warning') titleColor = 'var(--red)';
        else if (adv.type === 'info') titleColor = 'var(--yellow)';
        
        card.innerHTML = `
          <div style="font-weight: 600; color: ${titleColor}; font-size: 0.76rem;">${adv.title}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.3;">${adv.message}</div>
        `;
        container.appendChild(card);
      });
    } else {
      container.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 0.76rem; border: 1px dashed var(--border); border-radius: var(--radius-sm);">
          Vận hành tối ưu. Không có cảnh báo hoặc khuyến nghị điều phối tại thời điểm này.
        </div>
      `;
    }
  }

  function renderOverdueTable(todayTrips) {
    const tbody = document.getElementById('dock-overdue-body');
    const badge = document.getElementById('dock-overdue-badge');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const overdueTrips = todayTrips.filter(t => {
      const waitMin = getWaitTimeMinutes(t);
      return waitMin > 30;
    });
    
    if (badge) {
      badge.textContent = overdueTrips.length;
    }
    
    if (overdueTrips.length > 0) {
      overdueTrips.sort((a, b) => getWaitTimeMinutes(b) - getWaitTimeMinutes(a));
      overdueTrips.forEach(t => {
        const waitMin = getWaitTimeMinutes(t);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align: left; padding: 6px 10px; font-weight: 600; color: var(--red);">${escapeHTML(t.vehicle || t.code || 'N/A')}</td>
          <td style="text-align: right; padding: 6px 10px; font-family: 'JetBrains Mono', monospace; color: var(--yellow);">${waitMin} phút</td>
          <td style="text-align: right; padding: 6px 10px; color: var(--text-muted);">${escapeHTML(t.slot || 'N/A')}</td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">Không có xe chờ lâu</td></tr>`;
    }
  }

  function renderTodayTripsTable(todayTrips) {
    const targetDateStr = window.selectedInboundDate || getTodayString();
    const isToday = isSameDay(targetDateStr, getTodayString());
    const titleLabel = isToday ? "Hôm Nay" : targetDateStr;

    const titleEl = document.querySelector('#tab-content-dock .table-card .card-title');
    if (titleEl) {
      titleEl.textContent = `Danh Sách Chi Tiết Xe Tải ${titleLabel} (TripScan)`;
    }

    const tbody = document.getElementById('dock-trips-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (todayTrips.length > 0) {
      todayTrips.sort((a, b) => {
        const timeA = a.time || '';
        const timeB = b.time || '';
        return timeB.localeCompare(timeA);
      });
      
      todayTrips.forEach(t => {
        const waitMin = getWaitTimeMinutes(t);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align: left; padding-left: 10px; font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(t.code || 'N/A')}">${escapeHTML(t.code || 'N/A')}</td>
          <td style="text-align: left; font-weight: 600; font-size: 0.72rem; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(t.vehicle || 'N/A')}">${escapeHTML(t.vehicle || 'N/A')}</td>
          <td style="text-align: center; font-size: 0.7rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(t.capacity || '—')}</td>
          <td style="text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;">${escapeHTML(t.slot || '—')}</td>
          <td style="text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;">${escapeHTML(t.time || '—')}</td>
          <td style="text-align: right; font-size: 0.68rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(t.username || '')}">${escapeHTML(t.username ? (t.username.split(' - ')[1] || t.username) : '—')}</td>
          <td style="text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 0.72rem; color: ${waitMin > 30 ? 'var(--red)' : 'var(--text-muted)'};">${waitMin} phút</td>
          <td style="text-align: center; padding-right: 6px;">${getStatusBadge(t.status, t)}</td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">Không có chuyến xe nào trong ngày</td></tr>`;
    }
  }

  function renderDockConfigGrid() {
    const container = document.getElementById('dock-config-inputs');
    if (!container) return;
    container.innerHTML = '';
    
    const stations = getDockStations();
    for (let h = 0; h < 24; h++) {
      const hourStr = String(h).padStart(2, '0');
      const item = document.createElement('div');
      item.className = 'dock-config-item';
      item.innerHTML = `
        <label>${hourStr}:00</label>
        <input type="number" min="0" max="40" value="${stations[h]}" data-hour="${h}" id="dock-stations-h${h}">
      `;
      container.appendChild(item);
    }
  }

  function runDockSimulation() {
    const todayTrips = getTodayTrips();
    const arrivals = Array(24).fill(0);
    todayTrips.forEach(t => {
      arrivals[getTripHour(t)]++;
    });
    
    const stations = getDockStations();
    const tAvg = getDockTAvg();
    
    const simulation = [];
    let lastQueue = 0;
    
    for (let t = 0; t < 24; t++) {
      const S_t = stations[t];
      const A_t = arrivals[t];
      
      const capacity = S_t * (60 / tAvg); 
      const totalLoad = A_t + lastQueue;
      const processed = Math.min(capacity, totalLoad);
      const queue = Math.max(0, totalLoad - capacity);
      const utilization = capacity > 0 ? Math.min(100, (totalLoad / capacity) * 100) : 0;
      
      simulation.push({
        hour: t,
        arrived: A_t,
        stations: S_t,
        capacity: capacity,
        processed: processed,
        queue: queue,
        utilization: utilization
      });
      
      lastQueue = queue;
    }
    
    renderDockKPIs(todayTrips);
    updateDaySummaryBanner(todayTrips);
    if (window.charts && window.charts.renderFlowChart) {
      window.charts.renderFlowChart('dock-flow-chart', simulation, tAvg);
    }
    renderAdvisory(simulation, tAvg);
    renderOverdueTable(todayTrips);
    renderTodayTripsTable(todayTrips);

    // Removed Telegram Auto Alert logic per user request

    // Trigger prediction update
    if (window.prediction && window.prediction.renderPredictionDashboard) {
      window.prediction.renderPredictionDashboard();
    }
  }

  async function checkAndTriggerCloudSync() {
    // Không cần check GitHub PAT ở client nữa vì đã xử lý qua Edge Function
    // Tìm timestamp cập nhật mới nhất từ dữ liệu cache
    let latestUpdate = 0;
    window.tripScanData.forEach(t => {
      if (t.updated_at) {
        const ms = new Date(t.updated_at).getTime();
        if (ms > latestUpdate) latestUpdate = ms;
      }
    });

    const now = Date.now();
    const staleTimeMs = 5 * 60 * 1000; // 5 phút

    if (latestUpdate > 0 && (now - latestUpdate) > staleTimeMs) {
      const lastTriggered = parseInt(localStorage.getItem('last_github_sync_trigger') || '0', 10);
      if (now - lastTriggered > 3 * 60 * 1000) { // Cooldown 3 phút
        localStorage.setItem('last_github_sync_trigger', String(now));
        console.log(`Dữ liệu TripScan cũ (${Math.round((now - latestUpdate) / 60000)} phút trước). Tự động gửi yêu cầu GitHub Actions đồng bộ...`);
        
        // Hiển thị trạng thái đang đồng bộ trên Heartbeat
        const heartbeatEl = document.getElementById('inbound-heartbeat');
        if (heartbeatEl) {
          heartbeatEl.innerHTML = `<span class="pulse-dot yellow"></span><span>TripScan: 🔄 Đang gửi yêu cầu đồng bộ dữ liệu mới...</span>`;
        }

        try {
          const repo = 'ImDiDinne/ktchcm01';
          const { error: invokeErr } = await window.supabaseClient.functions.invoke('github-proxy', {
            body: {
              url: `https://api.github.com/repos/${repo}/actions/workflows/sync_trips.yml/dispatches`,
              method: 'POST',
              body: { ref: 'main' }
            }
          });

          if (!invokeErr) {
            console.log("Successfully triggered GitHub Actions sync workflow!");
            // Đợi 15 giây rồi tự động tải lại dữ liệu mới từ Supabase
            setTimeout(async () => {
              try {
                await fetchSupabaseUnloadingTrips();
                const { data: freshData, error: freshErr } = await window.supabaseClient
                  .from('trips_cache')
                  .select('*')
                  .order('id', { ascending: false })
                  .limit(30000);
                if (!freshErr && Array.isArray(freshData)) {
                  window.tripScanData = freshData;
                  window.inboundLastFetched = Date.now();
                  populateInboundDates();
                  runDockSimulation();
                  console.log("Dữ liệu đã tự động cập nhật sau đồng bộ đám mây.");
                }
              } catch (e) {
                console.error("Lỗi tự động tải lại dữ liệu sau sync:", e);
              }
            }, 15000);
          } else {
            console.error("Failed to trigger GitHub Actions sync:", await response.text());
          }
        } catch (e) {
          console.error("Error triggering GitHub Actions sync:", e);
        }
      }
    }
  }

  async function fetchTripScanData() {
    const refreshBtn = document.getElementById('btn-refresh-trips');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ ĐANG TẢI DỮ LIỆU...';
    }

    try {
      await fetchSupabaseUnloadingTrips();
      await autoCompleteStuckTrips();

      if (!window.supabaseClient) {
        setTimeout(fetchTripScanData, 500);
        return;
      }

      const { data, error } = await window.supabaseClient
        .from('trips_cache')
        .select('*')
        .order('id', { ascending: false })
        .limit(30000);

      if (error) throw error;
      
      if (Array.isArray(data)) {
        window.tripScanData = data;
        window.inboundLastFetched = Date.now(); // Record sync timestamp
        console.log(`Fetched ${window.tripScanData.length} trips from Supabase cache.`);
        populateInboundDates();
        runDockSimulation();
        
        // Kích hoạt cơ chế tự động đồng bộ đám mây nếu dữ liệu bị cũ
        checkAndTriggerCloudSync();
      } else {
        console.error('Invalid TripScan data structure:', data);
      }
    } catch (err) {
      console.error('Failed to fetch TripScan data:', err);
      const advisoryList = document.getElementById('dock-advisory-list');
      if (advisoryList) {
        advisoryList.innerHTML = `
          <div class="kpi-card dock-advisory-card warning" style="padding: 12px; margin-bottom: 8px;">
            <div style="font-weight: 600; color: var(--red); margin-bottom: 4px;">⚠️ Lỗi Kết Nối</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">Không thể tải dữ liệu từ TripScan. (Lỗi: ${escapeHTML(err.message)})</div>
          </div>
        `;
      }
    } finally {
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 CẬP NHẬT DỮ LIỆU TRIPSCAN';
      }
    }
  }

  // ── Supabase Realtime: Cập nhật trạng thái xe TỨC THÌ ──
  let realtimeChannel = null;

  function subscribeRealtimeUnloadingTrips() {
    if (realtimeChannel) return; // Đã subscribe rồi
    if (!window.supabaseClient) {
      setTimeout(subscribeRealtimeUnloadingTrips, 1000);
      return;
    }

    try {
      realtimeChannel = window.supabaseClient
        .channel('unloading_trips_changes')
        .on('postgres_changes', 
          { event: '*', schema: 'public', table: 'unloading_trips' },
          (payload) => {
            const { eventType, new: newRow, old: oldRow } = payload;
            console.log(`⚡ Realtime: ${eventType} trên unloading_trips`, newRow || oldRow);

            if (eventType === 'INSERT' || eventType === 'UPDATE') {
              if (newRow && newRow.code && newRow.started_at) {
                window.unloadingTripsMap[newRow.code] = {
                  started_at: newRow.started_at,
                  unloaded_at: newRow.unloaded_at || null
                };
              }
            } else if (eventType === 'DELETE') {
              if (oldRow && oldRow.code) {
                delete window.unloadingTripsMap[oldRow.code];
              }
            }

            // Re-render ngay lập tức
            runDockSimulation();
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Realtime: Đã kết nối bảng unloading_trips — trạng thái xe cập nhật tức thì.');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('❌ Realtime: Lỗi kết nối. Sẽ thử lại sau 5s.');
            realtimeChannel = null;
            setTimeout(subscribeRealtimeUnloadingTrips, 5000);
          } else if (status === 'TIMED_OUT') {
            console.warn('⏳ Realtime: Timeout kết nối. Sẽ thử lại sau 10s.');
            realtimeChannel = null;
            setTimeout(subscribeRealtimeUnloadingTrips, 10000);
          }
        });
    } catch (e) {
      console.error('❌ Realtime subscription error:', e);
      realtimeChannel = null;
    }
  }

  // Khởi tạo Realtime subscription khi module load
  subscribeRealtimeUnloadingTrips();

  // Expose global methods
  window.inbound = {
    fetchTripScanData,
    runDockSimulation,
    getDockTAvg,
    saveDockTAvg,
    getDockStations,
    saveDockStations,
    renderDockConfigGrid,
    handleStatusChange,
    populateInboundDates,
    subscribeRealtimeUnloadingTrips
  };

})();

// triggerScrape function
window.triggerScrape = async function(btnElement) {
  if (btnElement.disabled) return;
  
  // Disable button
  const originalText = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = '⏳ Đang dò...';
  btnElement.style.opacity = '0.7';
  
  // Trigger Supabase Edge Function
  try {
    const supabaseUrl = 'https://baizmeqkxslajxuzyfnu.supabase.co';
    const response = await fetch(`${supabaseUrl}/functions/v1/trigger-scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      console.log("Đã gửi lệnh Dò Log thành công!");
    } else {
      const data = await response.json();
      alert("❌ Lỗi khi gọi hàm: " + (data.error || response.statusText));
    }
  } catch (err) {
    alert("❌ Lỗi kết nối: " + err.message);
  } finally {
    // Reset button after 5 seconds to prevent spam
    setTimeout(() => {
      btnElement.innerHTML = originalText;
      btnElement.disabled = false;
      btnElement.style.opacity = '1';
    }, 5000);
  }
}
