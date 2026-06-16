// Supabase Edge Function: trigger-scrape
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Xử lý preflight CORS request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const githubToken = Deno.env.get('GITHUB_PAT')
    
    if (!githubToken) {
      return new Response(JSON.stringify({ error: 'Missing GITHUB_PAT' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Gửi tín hiệu kích hoạt GitHub Action: manual_scrape
    const res = await fetch('https://api.github.com/repos/ImDiDinne/ktchcm01/dispatches', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${githubToken}`
      },
      body: JSON.stringify({ event_type: 'manual_scrape' })
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`GitHub API error: ${res.status} ${errorText}`)
    }

    return new Response(JSON.stringify({ success: true, message: 'Đã gửi lệnh kiểm tra lên máy chủ.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error triggering scrape:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
