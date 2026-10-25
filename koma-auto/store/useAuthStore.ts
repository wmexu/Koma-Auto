import { create } from 'zustand';
import { User } from 'firebase/auth';

interface UserProfile {
  name: string;
  email: string;
  dob: string;
  clientType: string;
  role?: 'customer' | 'wholesale' | 'courier' | 'manager' | 'director' | string;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  userProfile: UserProfile | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  setLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  userProfile: null,
  isLoading: true, // true by default until Firebase checks initial auth state
  setUser: (user) => set({ user }),
  setUserProfile: (profile) => set({ userProfile: profile }),
  setLoading: (isLoading) => set({ isLoading }),
}));
