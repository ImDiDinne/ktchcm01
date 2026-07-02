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
    // 1. Verify Authorization Header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Validate JWT and Check Role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const role = user.user_metadata?.role
    if (role !== 'manager') {
      return new Response(JSON.stringify({ error: 'Forbidden. Only managers can trigger.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

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
