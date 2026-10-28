import { create } from 'zustand';
import { User } from 'firebase/auth';

export interface UserProfile {
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
  isProfileLoaded: boolean;
  isProfileLoading: boolean;
  setUser: (user: User | null) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  setLoading: (isLoading: boolean) => void;
  setProfileLoaded: (isLoaded: boolean) => void;
  setProfileLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  userProfile: null,
  isLoading: true, // true by default until Firebase checks initial auth state
  isProfileLoaded: false,
  isProfileLoading: true,
  setUser: (user) =>
    set((state) => ({
      user,
      // When user changes (or signs in), reset profile loaded status so we don't flash old state
      ...(user
        ? { isProfileLoading: true, isProfileLoaded: false }
        : { userProfile: null, isProfileLoading: false, isProfileLoaded: true }),
    })),
  setUserProfile: (profile) =>
    set({
      userProfile: profile,
      isProfileLoading: false,
      isProfileLoaded: true,
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setProfileLoaded: (isProfileLoaded) => set({ isProfileLoaded }),
  setProfileLoading: (isProfileLoading) => set({ isProfileLoading }),
}));
