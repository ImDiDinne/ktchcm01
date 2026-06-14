import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    console.log("Đang lấy dữ liệu từ Google Apps Script...");
    const gscript_url = 'https://script.google.com/macros/s/AKfycbxpLqnIOLSV6MkEhss1vPVh7AxBZqVUv6F0xGmMGNtv1A55XVElUgBkoJuvJXgv2cHP/exec?action=getTrips';
    
    const resp = await fetch(gscript_url);
    if (!resp.ok) {
      throw new Error(`Google Apps Script trả về lỗi HTTP ${resp.status}`);
    }
    
    const result = await resp.json();
    if (result.status !== "success" || !result.data) {
      throw new Error("Dữ liệu trả về không đúng cấu trúc");
    }

    const trips = result.data;
    console.log(`Đã tải ${trips.length} chuyến xe.`);

    // Lọc trùng lặp ID
    const uniqueTripsMap = new Map();
    for (const t of trips) {
      if (t.id) {
        uniqueTripsMap.set(t.id, t);
      }
    }
    const uniqueTrips = Array.from(uniqueTripsMap.values());
    console.log(`Lọc trùng lặp còn ${uniqueTrips.length} dòng. Bắt đầu đẩy lên Supabase...`);

    if (uniqueTrips.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'Không có dữ liệu để đồng bộ' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Kết nối Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Đẩy theo batch 1000 dòng
    const batchSize = 1000;
    for (let i = 0; i < uniqueTrips.length; i += batchSize) {
      const batch = uniqueTrips.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('trips_cache')
        .upsert(batch, { onConflict: 'id' });
        
      if (error) {
        throw new Error(`Supabase Upsert Error: ${error.message}`);
      }
    }

    console.log(`✅ Đã đồng bộ thành công ${uniqueTrips.length} dòng!`);
    return new Response(JSON.stringify({ ok: true, synced_count: uniqueTrips.length }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('Error during sync:', e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
})
