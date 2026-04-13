import { toast } from '../components/Toast/Toast';
import useAuthStore from '../store/useAuthStore';

/**
 * useRequireAuth — wraps any action with an authentication guard.
 *
 * Usage:
 *   const requireAuth = useRequireAuth();
 *   <button onClick={requireAuth(() => startPlatform())}>Start</button>
 *
 * Behaviour:
 *   - User IS logged in  → executes the action normally
 *   - User NOT logged in → opens global auth modal + shows toast hint
 */
const AUTH_DISABLED = import.meta.env.VITE_DISABLE_AUTH === 'true';

export function useRequireAuth() {
  const { user, openAuthModal } = useAuthStore();

  return function requireAuth(action) {
    return function (...args) {
      if (AUTH_DISABLED || user) {
        return action(...args);
      }
      // Not authenticated
      openAuthModal();
      toast.info('Please sign in to perform this action.', 3000);
    };
  };
}
