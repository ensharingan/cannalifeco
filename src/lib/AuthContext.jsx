import React, { createContext, useState, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Switching browser tabs makes Supabase revalidate the session and fire
  // SIGNED_IN / TOKEN_REFRESHED even though the signed-in user has not changed.
  // Tracking the current id lets us ignore those, instead of replacing `user`
  // with a fresh object and re-rendering (and unmounting) the whole app.
  const currentUserIdRef = useRef(null);
  const profileLoadedForRef = useRef(null);
  const initialisedRef = useRef(false);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) return;
    // The profile only changes when the user changes. Re-fetching it on every
    // tab focus is what replaced the object and cascaded a re-render.
    if (profileLoadedForRef.current === userId) return;
    profileLoadedForRef.current = userId;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (!error && data) {
        setProfile(data);
      }
    } catch (err) {
      console.error('Error loading profile:', err);
      profileLoadedForRef.current = null;
    }
  }, []);

  const applySession = useCallback((session) => {
    const nextUser = session && session.user ? session.user : null;
    const nextId = nextUser ? nextUser.id : null;

    if (nextId && nextId === currentUserIdRef.current) {
      // Same person, refreshed token. Nothing downstream needs to know.
      return;
    }

    currentUserIdRef.current = nextId;

    if (nextUser) {
      setUser(nextUser);
      setIsAuthenticated(true);
      loadProfile(nextId);
    } else {
      profileLoadedForRef.current = null;
      setUser(null);
      setProfile(null);
      setIsAuthenticated(false);
    }
  }, [loadProfile]);

  const clearSession = useCallback(() => {
    currentUserIdRef.current = null;
    profileLoadedForRef.current = null;
    setUser(null);
    setProfile(null);
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
      initialisedRef.current = true;
      setIsLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // A refresh that produced no session means the token really is dead.
        if (event === 'TOKEN_REFRESHED' && !session) {
          console.warn('Token refresh failed — logging out');
          clearSession();
          setIsLoadingAuth(false);
          return;
        }

        // A successful token refresh is routine background housekeeping.
        // Reacting to it is what wiped half-captured forms on tab switch.
        if (event === 'TOKEN_REFRESHED') return;

        // Fired on window focus. Only matters if the user actually changed,
        // which applySession works out for itself.
        if (event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
          applySession(session);
          return;
        }

        if (event === 'SIGNED_OUT') {
          clearSession();
          setIsLoadingAuth(false);
          return;
        }

        applySession(session);

        // Never flip back to a loading state once the app has started —
        // a loading gate mid-session blanks whatever the user was working on.
        if (!initialisedRef.current) {
          initialisedRef.current = true;
          setIsLoadingAuth(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [applySession, clearSession]);

  const login = useCallback(async (email, password) => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError({ type: 'auth_required', message: error.message });
        throw error;
      }
      return data;
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  const register = useCallback(async (email, password, fullName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (_) {
      // Sign out even if the API call fails (e.g. expired token)
    }
    clearSession();
  }, [clearSession]);

  const resetPassword = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/#/reset-password`,
    });
    if (error) throw error;
  }, []);

  const navigateToLogin = useCallback(() => { window.location.hash = '#/login'; }, []);
  const checkAppState = useCallback(() => {}, []);

  // A fresh object here re-renders every consumer on every render of this
  // provider, which is half of why a background refresh was so expensive.
  const value = useMemo(() => ({
    user,
    profile,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    appPublicSettings: null,
    login,
    register,
    logout,
    navigateToLogin,
    resetPassword,
    checkAppState,
  }), [
    user, profile, isAuthenticated, isLoadingAuth, isLoadingPublicSettings,
    authError, login, register, logout, navigateToLogin, resetPassword, checkAppState,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
