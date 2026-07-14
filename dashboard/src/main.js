// src/main.js
import { fetchTrips } from "./api.js";
import { renderSLAChart, renderPeakHourChart, renderTable } from "./charts.js";

async function init() {
  const trips = await fetchTrips(7);
  // Compute simple stats for demo purposes
  const daily = {};
  trips.forEach(t => {
    const date = t.date || "unknown";
    if (!daily[date]) daily[date] = { total: 0, completed: 0 };
    daily[date].total++;
    if (t.status === "Đã nhận") daily[date].completed++;
  });
  const slaData = Object.entries(daily).map(([date, v]) => ({ date, sla: v.total ? (v.completed / v.total) * 100 : 0 }));
  const peakHours = {};
  trips.forEach(t => {
    const hour = t.time ? parseInt(t.time.split(":")[0]) : null;
    if (hour !== null) {
      peakHours[hour] = (peakHours[hour] || 0) + 1;
    }
  });
  const peakData = Object.entries(peakHours).map(([hour, cnt]) => ({ hour: parseInt(hour), count: cnt }));

  renderSLAChart(slaData);
  renderPeakHourChart(peakData);
  renderTable(daily);
}

init();
