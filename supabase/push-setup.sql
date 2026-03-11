-- ═══ 바당때 Web Push 알림 테이블 ═══

-- 1. 푸시 구독 정보 테이블
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  endpoint TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS 활성화
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 유저 본인만 자기 구독 조회/수정 가능
CREATE POLICY "Users can manage own push subscriptions"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- service_role은 모든 구독 조회 가능 (Edge Function용)
CREATE POLICY "Service role can read all subscriptions"
  ON push_subscriptions FOR SELECT
  TO service_role
  USING (true);

-- 2. 예약된 푸시 알람 테이블
CREATE TABLE IF NOT EXISTS push_alarms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  alarm_key TEXT NOT NULL,           -- '2026-03-11_14:30' 형식
  alert_at TIMESTAMPTZ NOT NULL,     -- 실제 알림 발송 시각
  title TEXT DEFAULT '바당때',
  body TEXT NOT NULL,
  sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, alarm_key)
);

-- RLS 활성화
ALTER TABLE push_alarms ENABLE ROW LEVEL SECURITY;

-- 유저 본인만 자기 알람 관리 가능
CREATE POLICY "Users can manage own push alarms"
  ON push_alarms FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- service_role은 모든 알람 조회/수정 가능 (Edge Function용)
CREATE POLICY "Service role can manage all alarms"
  ON push_alarms FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_push_alarms_alert ON push_alarms (alert_at) WHERE sent = false;
CREATE INDEX IF NOT EXISTS idx_push_alarms_user ON push_alarms (user_id);

-- ═══ pg_cron 설정 (매 1분마다 Edge Function 호출) ═══
-- Supabase Dashboard > SQL Editor 에서 실행하세요:

-- pg_cron 확장 활성화 (이미 되어있을 수 있음)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 매 1분마다 send-push-alarm Edge Function 호출
-- SELECT cron.schedule(
--   'send-push-alarms',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://raykkfvchlfsjtlkbpji.supabase.co/functions/v1/send-push-alarm',
--     headers := jsonb_build_object(
--       'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
--       'Content-Type', 'application/json'
--     ),
--     body := '{}'
--   );
--   $$
-- );

-- 또는 Supabase의 pg_net + pg_cron 조합:
SELECT cron.schedule(
  'send-push-alarms',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://raykkfvchlfsjtlkbpji.supabase.co/functions/v1/send-push-alarm'::text,
    headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY_HERE", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
