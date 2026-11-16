"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getCustomerMe,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
  AuthApiError,
} from "../../lib/api/auth";
import { AUTH_STATE_CHANGED_EVENT } from "../../lib/rbac";
import type {
  CustomerUser,
  LoginPayload,
  LoginResponse,
  RegisterPayload,
  RegisterResponse,
} from "../../types/auth";

interface AuthContextType {
  user: CustomerUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (payload: LoginPayload) => Promise<LoginResponse>;
  register: (payload: RegisterPayload) => Promise<RegisterResponse>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<CustomerUser | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async (): Promise<CustomerUser | null> => {
    try {
      const profile = await getCustomerMe();
      setUser(profile);
      return profile;
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 401) {
        setUser(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const profile = await getCustomerMe();
        if (mounted) {
          setUser(profile);
        }
      } catch {
        if (mounted) {
          setUser(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void initAuth();

    function handleAuthChanged() {
      void refreshUser();
    }
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthChanged);

    return () => {
      mounted = false;
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthChanged);
    };
  }, [refreshUser]);

  const login = useCallback(
    async (payload: LoginPayload): Promise<LoginResponse> => {
      const response = await loginCustomer(payload);
      // After login, refresh profile so user state is up to date
      await refreshUser();
      return response;
    },
    [refreshUser]
  );

  const register = useCallback(
    async (payload: RegisterPayload): Promise<RegisterResponse> => {
      return await registerCustomer(payload);
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutCustomer();
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: Boolean(user),
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
