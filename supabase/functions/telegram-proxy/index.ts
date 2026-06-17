import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { chat_id, text, parse_mode } = await req.json()
    const telegramToken = Deno.env.get('TELEGRAM_BOT_TOKEN')

    if (!telegramToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured in Supabase Edge Functions')
    }

    if (!chat_id || !text) {
      throw new Error('Missing chat_id or text')
    }

    const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`

    const telegramReq = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id,
        text,
        parse_mode: parse_mode || 'HTML'
      })
    })

    const data = await telegramReq.json()

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: telegramReq.status
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    })
  }
})
