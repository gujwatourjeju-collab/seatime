import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Google Play 서비스 계정 키 (JSON) — Supabase secrets에 설정
const GOOGLE_SA_KEY = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY") || "{}");
const PACKAGE_NAME = "com.badangttae.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Google OAuth2 토큰 발급 (서비스 계정)
async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = btoa(
    JSON.stringify({
      iss: GOOGLE_SA_KEY.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  // RS256 서명
  const keyData = GOOGLE_SA_KEY.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(`${header}.${claim}`)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, purchase_token, product_id } = await req.json();
    if (!user_id || !purchase_token || !product_id) {
      return new Response(JSON.stringify({ verified: false, error: "missing params" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Google Play Developer API로 구독 상태 확인
    const accessToken = await getGoogleAccessToken();
    const verifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptions/${product_id}/tokens/${purchase_token}`;
    const gRes = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const gData = await gRes.json();

    // 구독 상태 체크 (0 = 활성)
    const isActive =
      gData.paymentState !== undefined &&
      (gData.paymentState === 1 || gData.paymentState === 2) &&
      (!gData.expiryTimeMillis || parseInt(gData.expiryTimeMillis) > Date.now());

    if (!isActive) {
      return new Response(JSON.stringify({ verified: false, error: "subscription not active" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Supabase에 구독 정보 저장
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const expiresAt = gData.expiryTimeMillis
      ? new Date(parseInt(gData.expiryTimeMillis)).toISOString()
      : null;

    await supabase.from("user_subscriptions").upsert(
      {
        user_id,
        plan: "pro",
        source: "google",
        google_token: purchase_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    return new Response(JSON.stringify({ verified: true, expires_at: expiresAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verify-purchase error:", e);
    return new Response(JSON.stringify({ verified: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
