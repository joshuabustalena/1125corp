'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { logAudit } from '@/lib/audit-log';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role_id: string | null;
  role_name: string | null;
  permissions: string[];
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, roles(name, permissions)')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return;

    setProfile({
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      role_id: data.role_id,
      role_name: data.roles?.name ?? null,
      // A per-account override set on the Access tab of Add/Edit Employee
      // wins over the role's list. NULL means "inherit the role" — an empty
      // array does NOT, it means access was deliberately removed, so the
      // check is Array.isArray and not a truthiness/?? test (?? would let []
      // through correctly but || would silently fall back to the role).
      permissions: Array.isArray(data.permissions_override)
        ? data.permissions_override
        : (data.roles?.permissions ?? []),
      branch_id: data.branch_id,
      phone: data.phone,
      avatar_url: data.avatar_url,
      status: data.status,
    });
  }, []);

  useEffect(() => {
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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      logAudit({ action: 'login', entityType: 'auth', entityId: data.user.id, userId: data.user.id, details: { email } });
    }
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    // Captured before signOut() clears the session — logAudit can't fall
    // back to supabase.auth.getUser() once there's no session left to ask.
    const uid = user?.id ?? null;
    await supabase.auth.signOut();
    if (uid) logAudit({ action: 'logout', entityType: 'auth', entityId: uid, userId: uid });
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
