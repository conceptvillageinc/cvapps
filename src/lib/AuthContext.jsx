import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
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

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
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
        setAuthError({ type: 'user_not_registered', message: error.message });
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

    // ログイン／ログアウト／トークン更新を拾って状態を同期する
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        checkUserAuth();
      }
    });

    return () => subscription.unsubscribe();
  }, [checkUserAuth]);

  const logout = useCallback(async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    await db.auth.logout(shouldRedirect ? '/login' : undefined);
  }, []);

  const navigateToLogin = useCallback(() => {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authError,
      authChecked,
      logout,
      navigateToLogin,
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
