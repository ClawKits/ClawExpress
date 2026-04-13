import React, { useState, useEffect } from 'react';
import { Globe, CheckCircle, RefreshCw, Key, PackageSearch, Search, ChevronLeft, ChevronRight, Download, Star, User } from 'lucide-react';
import Dropdown from '../Dropdown/Dropdown';
import { toast } from '../Toast/Toast';
import styles from './SkillsPage.module.css';

const SkillsPage = () => {
  const [skills, setSkills] = useState([]); // Track installed skills for comparison
  const [hubSkills, setHubSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(null);
  const [selectedApp, setSelectedApp] = useState('All');
  const [sortOrder, setSortOrder] = useState('downloads');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [statsMap, setStatsMap] = useState({});
  const pageSize = 12;

  const getSkillApp = (skill) => skill.metadata?.app || 'OpenClaw';
  const availableApps = ['All', ...new Set(hubSkills.map(getSkillApp))];
  
  const filteredHubSkills = hubSkills.filter(s => {
    const matchesApp = selectedApp === 'All' || getSkillApp(s) === selectedApp;
    const term = searchQuery.toLowerCase();
    const matchesSearch = !term || s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term);
    return matchesApp && matchesSearch;
  });

  const totalPages = Math.ceil(filteredHubSkills.length / pageSize) || 1;
  const paginatedSkills = filteredHubSkills.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const paginatedSkillIds = paginatedSkills.map(s => s.id).join(',');
  
  useEffect(() => {
    const fetchStats = async () => {
      const slugs = paginatedSkillIds.split(',').filter(Boolean);
      if (!slugs.length) return;
      try {
        const newStats = {};
        for (const slug of slugs) {
           try {
             const r = await fetch(`https://clawhub.ai/api/skill?slug=${slug}`);
             if (r.ok) {
               const j = await r.json();
               if (j?.skill?.stats) {
                 newStats[slug] = j.skill.stats;
               }
             }
           } catch (e) {
             console.error('Failed fetching stats for', slug, e);
           }
        }
        
        if (Object.keys(newStats).length > 0) {
          setStatsMap(prev => ({ ...prev, ...newStats }));
        } else {
          // If empty, toast to let us know it failed to find any stats
          toast.error('Stats frontend block returned empty.');
        }
      } catch (err) {
        toast.error('Frontend Stats Error: ' + err.message);
      }
    };
    fetchStats();
  }, [paginatedSkillIds]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [filteredHubSkills.length, totalPages, currentPage]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const localPromise = window.electron.ipcRenderer.invoke('skills-fetch-local');
      
      const hubPromise = fetch(`https://clawhub.ai/api/plugins`)
        .then(r => r.json())
        .then(data => {
            const rawItems = Array.isArray(data) ? data : (data.items || data.results || data.plugins || []);
            return rawItems
                .filter(item => item.family === 'skill' || item.family === 'code-plugin' || !item.family)
                .map(item => ({
                    id: item.slug || item.name,
                    name: item.displayName || item.slug || item.name,
                    author: item.ownerHandle || 'Unknown',
                    description: item.summary || 'No description provided.',
                    version: item.latestVersion || '1.0.0',
                    installed: false,
                    official: item.isOfficial || false,
                    repository: item.repository || '',
                    raw: item
                }));
        })
        .catch(e => {
            console.error('Direct hub fetch failed:', e);
            toast.error('Failed to fetch from Hub: ' + e.message);
            return [];
        });

      const [hubParsed, localRes] = await Promise.all([hubPromise, localPromise]);
      
      setHubSkills(hubParsed);
      setCurrentPage(1);

      if (localRes && localRes.success) {
         setSkills(localRes.data);
      }
    } catch (e) {
      toast.error('Failed to communicate with the backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [sortOrder]);

  const installSkill = async (hubSkill) => {
    setInstalling(hubSkill.id);
    try {
      const res = await window.electron.ipcRenderer.invoke('skills-install', { id: hubSkill.id, sourceMd: hubSkill.sourceMd });
      if (res.success) {
        toast.success(`Installed ${hubSkill.name} successfully!`);
        // Refresh local skills strictly to visually mark as installed
        const localRes = await window.electron.ipcRenderer.invoke('skills-fetch-local');
        if (localRes.success) setSkills(localRes.data);
      } else {
        toast.error('Failed to install skill: ' + res.error);
      }
    } catch (e) {
      toast.error('Error installing skill.');
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <h1 className={styles.title}><Globe size={28} style={{ color: '#3b82f6' }} /> ClawHub Registry</h1>
        <p className={styles.subtitle}>
          Discover and install remote OpenClaw skills. Once installed, these prompts and tools become native capabilities for your Agent directly within the OpenClaw configuration.
        </p>
      </div>

      <div className={styles.tabs} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>
          <PackageSearch size={18} /> Discover
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, marginLeft: '16px' }}>
          <div style={{ position: 'relative', width: '220px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Search plugins..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 12px 6px 32px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--card-bg)',
                color: 'white',
                fontSize: '13px'
              }}
            />
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Dropdown
            value={sortOrder}
            options={[
              { label: 'Most Downloads', value: 'downloads' },
              { label: 'GitHub Stars', value: 'stars' }
            ]}
            onChange={setSortOrder}
            minWidth="140px"
          />

          <Dropdown
            value={selectedApp}
            options={availableApps}
            onChange={setSelectedApp}
            minWidth="130px"
          />

          <button 
            className={styles.tab}
            onClick={fetchData}
            style={{ background: 'transparent', marginLeft: '6px' }}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {loading ? (
          <div className={styles.emptyState}>Connecting to ClawHub Public Registry...</div>
        ) : paginatedSkills.length === 0 ? (
          <div className={styles.emptyState}>No skills found matching your criteria.</div>
        ) : (
          paginatedSkills.map((skill) => {
            const isInstalled = skills.some(s => s.id === skill.id);
            
            return (
              <div key={skill.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div className={styles.cardIcon}>
                      {skill.metadata?.openclaw?.emoji || '🌐'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.cardTitle} title={skill.name}>{skill.name || skill.id}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <User size={10} /> {skill.author}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className={styles.cardBody}>
                  <div className={styles.cardDesc}>
                    {skill.description || 'No description provided.'}
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                     <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }} title="Downloads">
                        <Download size={13} /> {statsMap[skill.id]?.downloads ?? '-'}
                     </div>
                     <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }} title="GitHub Stars">
                        <Star size={13} /> {statsMap[skill.id]?.stars ?? '-'}
                     </div>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <button 
                    className={`${styles.btnAction} ${isInstalled ? styles.btnSecondary : styles.btnPrimary}`}
                    onClick={() => !isInstalled && installSkill(skill)}
                    disabled={isInstalled || installing === skill.id}
                    style={{ 
                      opacity: isInstalled ? 0.7 : 1, 
                      flex: 1, 
                      background: isInstalled ? 'transparent' : 'var(--status-running)', 
                      color: isInstalled ? 'var(--text-muted)' : '#000',
                      border: isInstalled ? '1px dashed var(--border)' : 'none'
                    }}
                  >
                    {installing === skill.id ? (
                      <><RefreshCw size={14} className="spin" /> Installing...</>
                    ) : isInstalled ? (
                      <><CheckCircle size={14} /> Installed</>
                    ) : (
                      <><Key size={14} /> Install to Workspace</>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!loading && filteredHubSkills.length > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '24px', padding: '16px 0' }}>
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '6px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)' }}
          >
            <ChevronLeft size={16} /> Previous
          </button>
          
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Page <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{currentPage}</span> of {totalPages}
          </div>

          <button 
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '6px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', color: currentPage === totalPages ? 'var(--text-muted)' : 'var(--text-primary)' }}
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default SkillsPage;
