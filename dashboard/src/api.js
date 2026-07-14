// src/api.js
// Simple wrapper to fetch trips data from Supabase REST API
export async function fetchTrips(days = 7) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const now = new Date();
  const dates = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    dates.push(`${day}/${month}/${year}`);
  }
  const results = [];
  for (const date of dates) {
    const url = `${supabaseUrl}/rest/v1/trips_cache?date=eq.${date}`;
    const resp = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (resp.ok) {
      const json = await resp.json();
      results.push(...json);
    }
  }
  return results;
}
