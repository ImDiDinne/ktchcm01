// Supabase Edge Function: telegram-webhook
// Nhận tin nhắn từ Telegram Webhook, bắt mã chuyến đi, ghi vào Supabase
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TRIP_REGEX = /\b(E\d{6}[A-Z0-9]{8})\b/

// Danh sách Chat ID được phép (để trống = chấp nhận tất cả)
const ALLOWED_CHAT_IDS = ['-1001681377844', '-1001374377435', '6566588973']

Deno.serve(async (req) => {
  try {
    const body = await req.json()
    const message = body?.message

    if (!message || !message.text) {
      return new Response(JSON.stringify({ ok: true, action: 'ignored' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Lọc nhóm chat
    const chatId = String(message.chat?.id || '')
    if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(chatId)) {
      return new Response(JSON.stringify({ ok: true, action: 'filtered' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Tìm mã chuyến đi
    const match = message.text.match(TRIP_REGEX)
    if (!match) {
      return new Response(JSON.stringify({ ok: true, action: 'no_trip_code' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const tripCode = match[1]

    // Kết nối Supabase (dùng biến môi trường tự động của Edge Function)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Upsert vào bảng unloading_trips
    const { error } = await supabase
      .from('unloading_trips')
      .upsert({ code: tripCode, started_at: new Date().toISOString() })

    if (error) {
      console.error('Supabase error:', error)
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    console.log(`✅ Ghi nhận xe ${tripCode} từ nhóm ${message.chat?.title || chatId}`)

    return new Response(JSON.stringify({ ok: true, action: 'recorded', code: tripCode }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (e) {
    console.error('Error:', e)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
