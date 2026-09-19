/**
 * ============================================================
 * Supabase 连接配置 —— 部署前唯一需要修改的文件
 * ------------------------------------------------------------
 * 获取位置：Supabase 控制台 → 左下角 Project Settings → API
 *   url     ：Project URL（形如 https://xxxxxxxx.supabase.co）
 *   anonKey ：anon public 公开密钥
 *             （这是前端公开密钥，数据安全由 RLS 行级安全策略保障）
 * 填好后保存即可，三个页面会自动读取本配置。
 * ============================================================
 */
window.SUPABASE_CONFIG = {
  url: 'https://nsvpboqhnemzlblhcugl.supabase.co',
  anonKey: 'sb_publishable_2Exewh6Cqca_yhxPbANXYw_ibe54Gwx'
};
