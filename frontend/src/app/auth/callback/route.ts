import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const error = searchParams.get('error');

  // 1. 處理錯誤情況
  if (error || !token) {
    // 導回首頁並顯示錯誤
    return NextResponse.redirect(new URL('/?error=auth_failed', request.url));
  }

  // 2. 設定 Cookie
  const cookieStore = cookies();
  
  // 計算過期時間 (例如 7 天)
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  // 設定 auth_token Cookie
  cookieStore.set('auth_token', token, {
    httpOnly: true, // 重要：防止 XSS，前端 JS 無法讀取
    // 在生產環境 (HTTPS) 必須為 true，本地開發 (HTTP) 必須為 false
    // 這樣才能在 localhost 正常儲存
    secure: process.env.NODE_ENV === 'production', 
    sameSite: 'lax', // 允許 OAuth 重定向後的 Cookie 寫入
    path: '/',
    expires: expires,
  });

  // 3. 登入成功，導向儀表板
  return NextResponse.redirect(new URL('/dashboard/streamer', request.url));
}