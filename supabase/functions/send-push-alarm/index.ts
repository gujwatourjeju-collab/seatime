import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(
  'mailto:badangttae@gmail.com',
  VAPID_PUBLIC,
  VAPID_PRIVATE
)

serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // 현재 시각 기준 ±1분 이내의 미발송 알람 조회
    const now = new Date()
    const from = new Date(now.getTime() - 60000).toISOString()
    const to = new Date(now.getTime() + 60000).toISOString()

    const { data: alarms, error: alarmErr } = await supabase
      .from('push_alarms')
      .select('*')
      .eq('sent', false)
      .gte('alert_at', from)
      .lte('alert_at', to)

    if (alarmErr) throw alarmErr
    if (!alarms || alarms.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let sentCount = 0
    for (const alarm of alarms) {
      const { data: sub } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', alarm.user_id)
        .single()

      if (sub) {
        const payload = JSON.stringify({
          title: alarm.title,
          body: alarm.body,
          tag: 'tide-alarm-' + alarm.alarm_key,
          url: '/seatime/'
        })

        const pushSub = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        }

        try {
          await webpush.sendNotification(pushSub, payload)
          sentCount++
        } catch (e: unknown) {
          const err = e as { statusCode?: number }
          console.error(`Push failed for ${alarm.user_id}:`, err)
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('user_id', alarm.user_id)
          }
        }
      }

      // 발송 완료 표시
      await supabase.from('push_alarms').update({ sent: true }).eq('id', alarm.id)
    }

    // 24시간 지난 알람 정리
    const yesterday = new Date(now.getTime() - 86400000).toISOString()
    await supabase.from('push_alarms').delete().lt('alert_at', yesterday)

    return new Response(JSON.stringify({ sent: sentCount, total: alarms.length }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
