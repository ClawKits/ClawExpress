import React, { useState, useEffect } from 'react';
import { X, Copy, Check, LogOut, Loader2, AlertTriangle, Bell, BellOff } from 'lucide-react';
import useAuthStore from '../../store/useAuthStore';
import styles from './AuthModal.module.css';

const API_BASE = 'https://clawexpress-api.pages.dev/api/v1';

const AuthModal = ({ isOpen, onClose }) => {
  const {
    user, sessionToken, loading, error,
    loginWithGoogle, loginWithCode, logout, clearError,
    subscribeNewsletter,
  } = useAuthStore();

  const [tokenInput, setTokenInput]         = useState('');
  const [copied, setCopied]                 = useState(false);
  const [localLoading, setLocalLoading]     = useState(false);
  const [success, setSuccess]               = useState(false);
  const [localError, setLocalError]         = useState('');
  // Newsletter popup: shown after new user auth
  const [showNewsletter, setShowNewsletter] = useState(false);
  const [newsletterDone, setNewsletterDone] = useState(false);
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');

  // Reset all local state each time modal is opened fresh
  useEffect(() => {
    if (isOpen) {
      setTokenInput('');
      setCopied(false);
      setLocalLoading(false);
      setSuccess(false);
      setLocalError('');
      setShowNewsletter(false);
      setNewsletterDone(false);
      setNewsletterLoading(false);
      clearError();
      // Use hardcoded client ID, can be overridden by env variable
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '729585652188-c8ooqf6pa8vgvoqu9fp0fvsbbvp41keo.apps.googleusercontent.com';
      setGoogleClientId(clientId);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const redirectUri = encodeURIComponent('http://127.0.0.1:4012/callback');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&response_type=code&redirect_uri=${redirectUri}&scope=email%20profile&nonce=ce2026`;

  const startAuthFlow = async (openBrowser = true) => {
    setLocalLoading(true);
    try {
      if (window.electron && window.electron.ipcRenderer) {
        const result = await window.electron.ipcRenderer.invoke('open-auth-window', { authUrl, openBrowser });

        if (result && result.success && result.code) {
          setSuccess(true);
          const authResult = await loginWithCode(result.code, decodeURIComponent(redirectUri));

          if (authResult?.success) {
            if (authResult?.is_new_user && authResult?.user?.newsletter_subscribed === 0) {
              setTimeout(() => setShowNewsletter(true), 1200);
            } else {
              setTimeout(() => { onClose(); setSuccess(false); }, 1500);
            }
          } else {
            setSuccess(false);
            setLocalError(authResult?.error || 'Authentication failed');
          }
        } else {
          if (result && result.reason) {
            console.warn('Auth Error:', result.reason);
            // Only set error if not cancelled by timeout when they just copy and abandon
            if (openBrowser || result.reason !== 'Timeout waiting for authentication') {
              setLocalError(result.reason);
            }
          }
        }
      } else {
        if (openBrowser) window.open(authUrl, '_blank');
      }
    } catch (err) {
      console.error(err);
      if (openBrowser) setLocalError(err.message);
    } finally {
      if (openBrowser) setLocalLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(authUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Start local Node.js Http server silently so callback works!
    startAuthFlow(false);
  };

  const handleOpenGoogle = () => {
    startAuthFlow(true);
  };

  const handleManualLogin = async (e) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setLocalLoading(true);
    await loginWithGoogle(tokenInput.trim());
    setLocalLoading(false);
  };

  // Newsletter handlers
  const handleSubscribe = async () => {
    setNewsletterLoading(true);
    await subscribeNewsletter();
    setNewsletterLoading(false);
    setNewsletterDone(true);
    setTimeout(() => { onClose(); setSuccess(false); setShowNewsletter(false); setNewsletterDone(false); }, 1500);
  };

  const handleSkipNewsletter = () => {
    onClose();
    setSuccess(false);
    setShowNewsletter(false);
  };

  // ── Newsletter Popup (shown after new user auth) ──────────────────────────
  if (showNewsletter) {
    return (
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <div className={styles.logoBox}>
              <img src="./logo.png" alt="ClawExpress Logo" className={styles.logoImage} />
            </div>
          </div>

          <div className={styles.newsletterContent}>
            <div className={styles.newsletterIcon}>🎉</div>
            <h2 className={styles.newsletterTitle}>Welcome aboard!</h2>
            <p className={styles.newsletterDesc}>
              Would you like to receive product updates, tips, and news from ClawExpress?
              We only send relevant content — no spam, ever.
            </p>

            {newsletterDone ? (
              <div className={styles.newsletterSuccess}>
                <Check size={20} />
                <span>You're subscribed!</span>
              </div>
            ) : (
              <div className={styles.newsletterActions}>
                <button
                  id="newsletter-subscribe-btn"
                  className={styles.subscribeBtn}
                  onClick={handleSubscribe}
                  disabled={newsletterLoading}
                >
                  {newsletterLoading
                    ? <Loader2 size={16} className={styles.spin} />
                    : <Bell size={16} />
                  }
                  {newsletterLoading ? 'Subscribing...' : 'Yes, keep me updated'}
                </button>
                <button
                  id="newsletter-skip-btn"
                  className={styles.skipBtn}
                  onClick={handleSkipNewsletter}
                >
                  <BellOff size={14} />
                  No thanks
                </button>
              </div>
            )}

            <p className={styles.newsletterHint}>
              You can change this anytime in Settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Auth Modal ───────────────────────────────────────────────────────
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <button className={styles.closeBtn} onClick={() => { clearError(); setLocalError(''); setTokenInput(''); onClose(); }}>
          <X size={20} />
        </button>

        <div className={styles.header}>
          <div className={styles.logoBox}>
            <img src="./logo.png" alt="ClawExpress Logo" className={styles.logoImage} />
          </div>
        </div>

        {user ? (
          <div className={styles.userProfile}>
            <img
              src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=333&color=fff`}
              className={styles.userAvatar}
              alt="Avatar"
            />
            <div className={styles.userName}>{user.name}</div>
            <div className={styles.userEmail}>{user.email}</div>
            <div className={styles.badgeActive}>Status: Active Account</div>

            {/* Newsletter status + toggle */}
            <NewsletterToggle />

            <button className={styles.logoutBtn} onClick={logout}>
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        ) : (
          <div className={styles.authContent}>
            <button
              className={styles.googleBtn}
              onClick={handleOpenGoogle}
              disabled={localLoading || loading || success || !googleClientId}
              style={success ? { backgroundColor: 'var(--green)', color: '#fff', borderColor: 'var(--green)' } : {}}
            >
              {success ? (
                <Check size={18} style={{ marginRight: 8 }} />
              ) : (localLoading || loading) ? (
                <Loader2 size={18} className={styles.spin} style={{ marginRight: 8 }} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: 8 }}>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              {success ? 'Authentication Successful!' : (localLoading || loading) ? 'Authenticating...' : 'Sign in with Google'}
            </button>

            {(error || localError) && (
              <div className={styles.errorBox}>
                <AlertTriangle size={16} />
                <span>{error || localError}</span>
              </div>
            )}

            <div className={styles.divider}>
              <span>OR COPY LINK</span>
            </div>

            <div className={styles.linkSection}>
              <p className={styles.linkDesc}>Or authenticate using this link:</p>
              <div className={styles.urlBox}>
                <div className={styles.urlText}>{authUrl}</div>
                <button className={styles.iconBtn} onClick={handleCopy} title="Copy Auth Link">
                  {copied ? <Check size={16} color="var(--green)" /> : <Copy size={16} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Newsletter Toggle (shown in user profile when already logged in) ──────────
function NewsletterToggle() {
  const { user, subscribeNewsletter, unsubscribeNewsletter } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const isSubscribed = user?.newsletter_subscribed === 1;

  const toggle = async () => {
    setLoading(true);
    if (isSubscribed) await unsubscribeNewsletter();
    else await subscribeNewsletter();
    setLoading(false);
  };

  return (
    <button
      className={`${styles.newsletterToggle} ${isSubscribed ? styles.subscribed : ''}`}
      onClick={toggle}
      disabled={loading}
      title={isSubscribed ? 'Unsubscribe from newsletter' : 'Subscribe to newsletter'}
    >
      {loading
        ? <Loader2 size={14} className={styles.spin} />
        : isSubscribed ? <Bell size={14} /> : <BellOff size={14} />
      }
      {isSubscribed ? 'Receiving updates' : 'Subscribe to updates'}
    </button>
  );
}

export default AuthModal;
