import React, { useEffect, useState } from 'react';
import { Bot, Cpu, BoxIcon, CheckCircle2, RefreshCw, AlertTriangle, Package, Lock } from 'lucide-react';
import { usePlatformStore } from '../../store/usePlatformStore';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import InstallModal from '../InstallModal/InstallModal';
import Topbar from '../Topbar/Topbar';
import styles from './Marketplace.module.css';

const PlatformIcon = ({ id, size = 40 }) => {
  const iconProps = { size, color: 'var(--text-secondary)' };
  if (id?.includes('nemo')) return <Cpu {...iconProps} />;
  return <BoxIcon {...iconProps} />;
};

const SkeletonCard = () => (
  <div className={styles.skeletonCard}>
    <div className={styles.skeleton} style={{ width: '40%', height: '14px', marginBottom: '12px' }} />
    <div className={styles.skeleton} style={{ width: '70%', height: '10px', marginBottom: '8px' }} />
    <div className={styles.skeleton} style={{ width: '90%', height: '10px', marginBottom: '8px' }} />
    <div className={styles.skeleton} style={{ width: '55%', height: '10px' }} />
  </div>
);

const Marketplace = ({ onNavigate }) => {
  const { marketplace, marketplaceStatus, fetchMarketplace, platforms, getConflictFor } = usePlatformStore();
  const requireAuth = useRequireAuth();
  const [installTarget, setInstallTarget] = useState(null);
  const [isInstallOpen, setIsInstallOpen] = useState(false);

  useEffect(() => {
    if (marketplaceStatus === 'idle') {
      fetchMarketplace();
    }
  }, []);

  const handleInstall = (platform) => {
    setInstallTarget(platform);
    setIsInstallOpen(true);
  };

  const verified = marketplace.filter(p => p.verified);
  const community = marketplace.filter(p => !p.verified);

  return (
    <div className={styles.page}>
      <Topbar title="Marketplace" />

      <div className={styles.content}>

        {/* Loading state */}
        {marketplaceStatus === 'loading' && (
          <>
            <div className={styles.sectionLabel}>Fetching from registry...</div>
            <div className={styles.grid}>
              <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          </>
        )}

        {/* Error state */}
        {marketplaceStatus === 'error' && (
          <div className={styles.stateBox}>
            <AlertTriangle size={32} className={styles.stateIcon} />
            <div className={styles.stateTitle}>Registry Unavailable</div>
            <div className={styles.stateDesc}>Cannot reach clawexpress-registry.pages.dev.<br />Check your internet connection and try again.</div>
            <button onClick={fetchMarketplace} style={{ marginTop: '20px', background: 'var(--text-primary)', color: 'var(--app-bg)', border: 'none', padding: '8px 18px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
              Retry
            </button>
          </div>
        )}

        {/* Success state */}
        {marketplaceStatus === 'success' && (
          <>
            {verified.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Verified Platforms</div>
                <div className={styles.grid}>
                  {verified.map(platform => (
                    <div key={platform.id} className={styles.card} style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
                      <div style={{ height: '120px', background: 'linear-gradient(145deg, #1f1f1f, #0a0a0a)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {<PlatformIcon id={platform.id} size={40} />}
                      </div>
                      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                        <div className={styles.cardHeader}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div>
                              <div className={styles.cardName}>
                                {platform.name}
                                <span className={styles.verifiedBadge}>VERIFIED</span>
                              </div>
                              <div className={styles.cardVersion}>{platform.version} · by {platform.author}</div>
                            </div>
                          </div>
                        </div>
                      <div className={styles.cardDesc}>{platform.description}</div>
                      <div className={styles.cardFooter}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span className={styles.methodTag}>{platform.method}</span>
                          {platform.id.includes('openclaw') && <span className={styles.methodTag}>NPM</span>}
                        </div>
                        {(() => {
                          if (platforms.some(p => (p.registryId || p.id) === platform.id)) {
                            return (
                              <button className={styles.installBtn} disabled style={{ backgroundColor: 'var(--border)', color: 'var(--text-muted)' }}>
                                Installed
                              </button>
                            );
                          }
                          const conflict = getConflictFor(platform);
                          if (conflict) {
                            return (
                              <button
                                className={styles.installBtn}
                                disabled
                                title={conflict.reason}
                                style={{ backgroundColor: 'transparent', border: '1px solid var(--status-update)', color: 'var(--status-update)', cursor: 'not-allowed' }}
                              >
                                ⚠ Conflicts with {conflict.conflictingId}
                              </button>
                            );
                          }
                          return (
                            <button className={styles.installBtn} onClick={() => handleInstall(platform)}>
                              Install
                            </button>
                          );
                        })()}
                      </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {community.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Community</div>
                <div className={styles.grid}>
                  {community.map(platform => (
                    <div key={platform.id} className={styles.card} style={{ opacity: 0.8, padding: 0, gap: 0, overflow: 'hidden' }}>
                      <div style={{ height: '120px', background: 'linear-gradient(145deg, #1f1f1f, #0a0a0a)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {<PlatformIcon id={platform.id} size={40} />}
                      </div>
                      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                        <div className={styles.cardHeader}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div>
                              <div className={styles.cardName}>{platform.name}</div>
                              <div className={styles.cardVersion}>{platform.version} · by {platform.author}</div>
                            </div>
                          </div>
                        </div>
                      <div className={styles.cardDesc}>{platform.description}</div>
                      <div className={styles.cardFooter}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span className={styles.methodTag}>{platform.method}</span>
                          {platform.id.includes('openclaw') && <span className={styles.methodTag}>NPM</span>}
                        </div>
                        {(() => {
                          if (platforms.some(p => (p.registryId || p.id) === platform.id)) {
                            return (
                              <button className={styles.installBtn} disabled style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                                Installed
                              </button>
                            );
                          }
                          const conflict = getConflictFor(platform);
                          if (conflict) {
                            return (
                              <button
                                className={styles.installBtn}
                                disabled
                                title={conflict.reason}
                                style={{ backgroundColor: 'transparent', border: '1px solid var(--status-update)', color: 'var(--status-update)', cursor: 'not-allowed' }}
                              >
                                ⚠ Conflicts with {conflict.conflictingId}
                              </button>
                            );
                          }
                          return (
                            <button className={styles.installBtn} style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)' }} onClick={() => handleInstall(platform)}>
                              Install
                            </button>
                          );
                        })()}
                      </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Upcoming Apps Section */}
            <div className={styles.sectionLabel}>Upcoming Platforms</div>
            <div className={styles.grid}>
              {/* OpenFang */}
              <div className={styles.card} style={{ opacity: 0.5, padding: 0, gap: 0, overflow: 'hidden' }}>
                  <div style={{ height: '120px', background: 'linear-gradient(145deg, #1f1f1f, #0a0a0a)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <PlatformIcon id="openfang" size={40} />
                  </div>
                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                    <div className={styles.cardHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div>
                          <div className={styles.cardName}>
                            OpenFang
                            <span className={styles.verifiedBadge} style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>COMING SOON</span>
                          </div>
                          <div className={styles.cardVersion}>Enterprise RPA · by ClawKits</div>
                        </div>
                      </div>
                    </div>
                  <div className={styles.cardDesc}>A powerful Robotic Process Automation (RPA) engine powered by visual-language models.</div>
                  <div className={styles.cardFooter}>
                    <span className={styles.methodTag}>docker</span>
                    <button className={styles.installBtn} disabled style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                      Not Available
                    </button>
                  </div>
                  </div>
              </div>

              {/* ZeroClaw */}
              <div className={styles.card} style={{ opacity: 0.5, padding: 0, gap: 0, overflow: 'hidden' }}>
                  <div style={{ height: '120px', background: 'linear-gradient(145deg, #1f1f1f, #0a0a0a)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <PlatformIcon id="zeroclaw" size={40} />
                  </div>
                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                    <div className={styles.cardHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div>
                          <div className={styles.cardName}>
                            ZeroClaw
                            <span className={styles.verifiedBadge} style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>COMING SOON</span>
                          </div>
                          <div className={styles.cardVersion}>No-code workflows · by ClawKits</div>
                        </div>
                      </div>
                    </div>
                  <div className={styles.cardDesc}>Visual node-based orchestration engine for building complex AI pathways without coding.</div>
                  <div className={styles.cardFooter}>
                    <span className={styles.methodTag}>npm</span>
                    <button className={styles.installBtn} disabled style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                      Not Available
                    </button>
                  </div>
                  </div>
              </div>

              {/* NanoClaw */}
              <div className={styles.card} style={{ opacity: 0.5, padding: 0, gap: 0, overflow: 'hidden' }}>
                  <div style={{ height: '120px', background: 'linear-gradient(145deg, #1f1f1f, #0a0a0a)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <PlatformIcon id="nanoclaw" size={40} />
                  </div>
                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                    <div className={styles.cardHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div>
                          <div className={styles.cardName}>
                            NanoClaw
                            <span className={styles.verifiedBadge} style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>COMING SOON</span>
                          </div>
                          <div className={styles.cardVersion}>Edge compute · by ClawKits</div>
                        </div>
                      </div>
                    </div>
                  <div className={styles.cardDesc}>Ultra-lightweight edge worker for IoT inference and low-power autonomous deployments.</div>
                  <div className={styles.cardFooter}>
                    <span className={styles.methodTag}>binary</span>
                    <button className={styles.installBtn} disabled style={{ backgroundColor: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                      Not Available
                    </button>
                  </div>
                  </div>
              </div>
            </div>
          </>
        )}
      </div>

      <InstallModal isOpen={isInstallOpen} onClose={() => setIsInstallOpen(false)} platform={installTarget} onInstalled={() => { setIsInstallOpen(false); onNavigate?.('installed'); }} />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default Marketplace;
