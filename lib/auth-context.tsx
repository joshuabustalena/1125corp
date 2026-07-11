'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role_id: string | null;
  role_name: string | null;
  branch_id: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signOut: async () => {},
  refreshProfile: async () => {},
});

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';

const DEV_BYPASS_PROFILE: UserProfile = {
  id: 'dev-bypass-admin',
  email: 'admin@1125corp.org',
  full_name: 'System Administrator (dev bypass)',
  role_id: 'dev-bypass-role',
  role_name: 'Administrator',
  branch_id: null,
  phone: null,
  avatar_url: null,
  status: 'active',
};

const DEV_BYPASS_USER = {
  id: 'dev-bypass-admin',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'admin@1125corp.org',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
} as User;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(DEV_BYPASS_AUTH ? DEV_BYPASS_USER : null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(DEV_BYPASS_AUTH ? DEV_BYPASS_PROFILE : null);
  const [loading, setLoading] = useState(!DEV_BYPASS_AUTH);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, roles(name)')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return;

    setProfile({
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      role_id: data.role_id,
      role_name: data.roles?.name ?? null,
      branch_id: data.branch_id,
      phone: data.phone,
      avatar_url: data.avatar_url,
      status: data.status,
    });
  }, []);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    return () => listener.subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    if (DEV_BYPASS_AUTH) {
      setUser(DEV_BYPASS_USER);
      setProfile(DEV_BYPASS_PROFILE);
      return { error: null };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    if (!DEV_BYPASS_AUTH) await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
    setSession(null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
