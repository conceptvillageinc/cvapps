import { adminClient } from './_lib/guard.js';

// ============================================================================
// GET /api/recurring-projects  （Vercel cron: 毎月1日 00:00 UTC = 9:00 JST）
//
// 定期売上のひな形から、今月分の案件を生成する。
// 実際の処理は DB 関数 generate_recurring_projects
// （supabase/migrations/0005_recurring_projects.sql）。
//
// 呼び出し元の確認: Vercel は cron からのリクエストに
// 「Authorization: Bearer <CRON_SECRET>」を付ける。
// この環境変数が未設定なら、外部から誰でも叩けてしまうので拒否する。
// （同じ月に2回走っても二重生成はされないが、念のため）
// ============================================================================

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'CRON_SECRET が未設定です。Vercel の環境変数に登録してください' });
    return;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const admin = adminClient();
    const { data, error } = await admin.rpc('generate_recurring_projects');
    if (error) throw new Error(error.message);
    res.status(200).json({ created: data, month: new Date().toISOString().slice(0, 7) });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
}
