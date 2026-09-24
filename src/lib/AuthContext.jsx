import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { db } from '@/api/db';
import { supabase } from '@/lib/supabase';

// ログイン状態を配るコンテキスト。
// 公開しているプロパティ名は Base44 版から変えていない（画面側を触らずに済ませるため）。
// 認証の実体は Supabase Auth（Googleログインのみ）。
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  // onAuthStateChange のコールバックから最新のユーザーを見るための参照
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user; }, [user]);

  // silent=true のときは画面全体のスピナーを出さずに裏で確認する
  // （タブ復帰・トークン更新のたびに画面を作り直さないため）
  const checkUserAuth = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setIsLoadingAuth(true);
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);

      if (error.status === 403) {
        // Googleログインは通ったが、このアプリの利用者として登録されていない
        setAuthError({ type: 'user_not_registered', message: error.message, email: error.email });
      } else if (error.status === 401) {
        setAuthError({ type: 'auth_required', message: error.message });
      } else {
        setAuthError({ type: 'unknown', message: error.message || '認証状態の確認に失敗しました' });
      }
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkUserAuth();

    // ログイン／ログアウト／トークン更新を拾って状態を同期する。
    // Supabase は別タブから戻ってきたとき（タブが再表示されたとき）にも SIGNED_IN を出すので、
    // すでに同じユーザーでログイン済みなら何もしない。それ以外の再確認も裏で静かに行う。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        checkUserAuth({ silent: true });
        return;
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        const current = userRef.current;
        if (event === 'SIGNED_IN' && current && session?.user?.id === current.id) return;
        checkUserAuth({ silent: true });
      }
    });

    return () => subscription.unsubscribe();
  }, [checkUserAuth]);

  const logout = useCallback(async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    await db.auth.logout(shouldRedirect ? '/login' : undefined);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      authChecked,
      logout,
      checkUserAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
