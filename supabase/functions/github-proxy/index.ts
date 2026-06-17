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
    const { url, method, body } = await req.json()
    const githubPat = Deno.env.get('GITHUB_PAT')

    if (!githubPat) {
      throw new Error('GITHUB_PAT is not configured in Supabase Edge Functions')
    }

    // Only allow specific github API domains to prevent abuse
    if (!url.startsWith('https://api.github.com/')) {
       throw new Error('Invalid URL provided to proxy')
    }

    const githubReq = await fetch(url, {
      method: method || 'GET',
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Supabase-Edge-Function-Proxy'
      },
      body: body ? JSON.stringify(body) : undefined
    })

    const data = await githubReq.text()

    return new Response(data, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: githubReq.status
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    })
  }
})
