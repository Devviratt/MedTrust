import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { doctorApi } from '../services/api';
import api from '../services/api';
import {
  DS, GlassCard, SectionHeader, StatusBadge, ConfidenceBar, GlassButton,
} from '../components/shared/DesignSystem';
import {
  Shield, AlertTriangle, User, Building,
  FileText, Clock, Activity, Loader2, Award, RefreshCw,
} from 'lucide-react';


export const DoctorProfilePage: React.FC = () => {
  const { id: paramId } = useParams<{ id: string }>();
  const { user }        = useAuthStore();
  const profileId       = paramId || user?.id;

  const [profile, setProfile]           = useState<any>(null);
  const [sessions, setSessions]         = useState<any[]>([]);
  const [impersonation, setImpersonation] = useState<any>(null);
  const [loading, setLoading]           = useState(true);

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const [profileRes, sessRes, histRes] = await Promise.allSettled([
        doctorApi.getProfile(profileId),
        api.get(`/streams/active`).catch(() => ({ data: null })),
        api.get(`/streams/history?limit=10`).catch(() => ({ data: { streams: [] } })),
      ]);
      if (profileRes.status === 'fulfilled') setProfile(profileRes.value.data);

      if (histRes.status === 'fulfilled') {
        setSessions((histRes.value.data?.streams || []).slice(0, 10));
      }

      // Load impersonation for latest active session
      const activeData = sessRes.status === 'fulfilled' ? sessRes.value.data : null;
      if (activeData?.stream_id) {
        const impRes = await api.get(`/doctor/impersonation/${activeData.stream_id}`).catch(() => ({ data: null }));
        setImpersonation(impRes.data);
      }
    } finally {
      setLoading(false);
    }
  }, [profileId, paramId]);

  useEffect(() => { load(); }, [load]);

  const impRisk  = impersonation?.impersonation_risk || 'LOW';
  const impScore = impersonation?.similarity_score ?? 100;
  const verifiedStatus = profile?.verified_status || 'pending';
  const initials = (profile?.full_name || profile?.name || 'DR')
    .split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();

  if (loading) return (
    <div style={{minHeight:'100vh',background:DS.bgGrad,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <Loader2 size={32} style={{color:DS.accent,animation:'spin 0.8s linear infinite'}}/>
    </div>
  );

  if (!profile) return (
    <div style={{minHeight:'100vh',background:DS.bgGrad,display:'flex',alignItems:'center',justifyContent:'center',color:DS.textMute}}>Profile not found.</div>
  );

  const lbl: React.CSSProperties = {fontSize:'0.6rem',color:DS.textMute,letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:'0.2rem'};
  const val: React.CSSProperties = {fontSize:'0.8rem',color:DS.text};
  const trustColor = (t:number|null) => !t?DS.textMute:t>=75?DS.accent:t>=50?DS.warn:DS.danger;

  return (
    <div style={{minHeight:'100vh',background:DS.bgGrad,color:DS.text,padding:'1.25rem'}}>
      <div style={{maxWidth:1200,margin:'0 auto'}}>

        {/* ── 3-column grid ── */}
        <div style={{display:'grid',gridTemplateColumns:'220px 1fr 260px',gap:'1rem',marginBottom:'1rem'}}>

          {/* LEFT — Avatar + badges */}
          <GlassCard style={{padding:'1.25rem',display:'flex',flexDirection:'column',alignItems:'center',gap:'0.875rem'}}>
            {/* Avatar with subtle glow */}
            <div style={{
              width:88,height:88,borderRadius:'50%',flexShrink:0,position:'relative',
              background:`rgba(96,165,250,0.10)`,
              border:'2px solid rgba(96,165,250,0.22)',
              boxShadow:'0 0 20px rgba(96,165,250,0.12)',
              display:'flex',alignItems:'center',justifyContent:'center',
            }}>
              {profile.photo_url
                ? <img src={profile.photo_url} alt="" style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}}/>
                : <span style={{fontSize:'1.6rem',fontWeight:800,color:DS.info}}>{initials}</span>
              }
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontWeight:800,fontSize:'0.95rem',color:DS.text,marginBottom:'0.25rem'}}>{profile.full_name||profile.name}</div>
              <div style={{fontSize:'0.72rem',color:DS.textSub,marginBottom:'0.5rem'}}>{profile.specialization||'Physician'}</div>
              <StatusBadge variant={verifiedStatus==='verified'?'safe':verifiedStatus==='pending'?'warn':'alert'}
                label={verifiedStatus==='verified'?'Identity Verified':verifiedStatus==='pending'?'Pending Review':'Suspended'}
                dot={verifiedStatus==='verified'}/>
            </div>
            {/* Impersonation risk badge */}
            <div style={{
              width:'100%',borderRadius:8,padding:'0.625rem 0.75rem',
              background:impRisk==='HIGH'?DS.dangerDim:impRisk==='MEDIUM'?DS.warnDim:DS.accentDim,
              border:`1px solid ${impRisk==='HIGH'?DS.dangerBdr:impRisk==='MEDIUM'?DS.warnBdr:DS.accentBdr}`,
            }}>
              <div style={{display:'flex',alignItems:'center',gap:'0.4rem',marginBottom:'0.2rem'}}>
                {impRisk==='HIGH'||impRisk==='MEDIUM'
                  ? <AlertTriangle size={12} style={{color:impRisk==='HIGH'?DS.danger:DS.warn}}/>
                  : <Shield size={12} style={{color:DS.accent}}/>
                }
                <span style={{fontSize:'0.6rem',fontWeight:700,letterSpacing:'0.08em',color:impRisk==='HIGH'?DS.danger:impRisk==='MEDIUM'?DS.warn:DS.accent}}>IMPERSONATION RISK: {impRisk}</span>
              </div>
              <div style={{fontSize:'0.68rem',color:DS.textMute}}>Confidence: <span style={{fontFamily:DS.mono,fontWeight:700,color:impRisk==='HIGH'?DS.danger:impRisk==='MEDIUM'?DS.warn:DS.accent}}>{impScore}%</span></div>
            </div>
            <GlassButton variant="ghost" size="sm" icon={<RefreshCw size={11}/>} onClick={load} style={{width:'100%',justifyContent:'center'}}>Refresh</GlassButton>
          </GlassCard>

          {/* CENTER — AI Authenticity Analysis */}
          <GlassCard style={{padding:'1.25rem'}}>
            <SectionHeader icon={<Shield size={11}/>} label="AI Authenticity Analysis" accent={DS.info}/>
            <div style={{display:'flex',flexDirection:'column',gap:'0.5rem',marginBottom:'1.25rem'}}>
              <ConfidenceBar label="Identity Confidence"  value={impScore} color={impRisk==='LOW'?DS.accent:impRisk==='MEDIUM'?DS.warn:DS.danger} height={4}/>
              <ConfidenceBar label="Face Similarity"      value={impersonation?.face_similarity??100}  color={DS.info} height={4}/>
              <ConfidenceBar label="Voice Similarity"     value={impersonation?.voice_similarity??100} color={DS.info} height={4}/>
              <ConfidenceBar label="Biometric Baseline"   value={impersonation?.baseline_established?100:0} color={impersonation?.baseline_established?DS.accent:DS.warn} height={4}/>
            </div>
            <div style={{background:'rgba(255,255,255,0.02)',borderRadius:8,padding:'0.75rem',border:`1px solid ${DS.border}`}}>
              <SectionHeader icon={<Activity size={10}/>} label="Detection Module Summary" accent={DS.textMute}/>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem'}}>
                {[
                  {label:'Face Baseline',   ok:profile.has_face_baseline},
                  {label:'Voice Baseline',  ok:profile.has_voice_baseline},
                  {label:'License Verified',ok:!!profile.license_number},
                  {label:'Active Sessions', ok:(sessions.filter((s:any)=>s.status==='active').length>0)},
                ].map(item=>(
                  <div key={item.label} style={{display:'flex',alignItems:'center',gap:'0.375rem'}}>
                    <span style={{width:6,height:6,borderRadius:'50%',background:item.ok?DS.accent:DS.textMute,flexShrink:0}}/>
                    <span style={{fontSize:'0.68rem',color:item.ok?DS.text:DS.textMute}}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          {/* RIGHT — Profile Details */}
          <GlassCard style={{padding:'1.25rem'}}>
            <SectionHeader icon={<User size={11}/>} label="Profile Details" accent={DS.info}/>
            <div style={{display:'flex',flexDirection:'column',gap:'0.875rem'}}>
              {[
                {label:'Email',        v: profile.email,                                               mono:true},
                {label:'License',      v: profile.license_number||'—',                                 mono:true},
                {label:'Hospital',     v: profile.hospital_name||'—',                                  mono:false},
                {label:'Experience',   v: profile.years_experience>0?`${profile.years_experience} yrs`:'—', mono:false},
                {label:'Risk Score',   v: profile.risk_score!=null?`${profile.risk_score}`:'0',         mono:true},
                {label:'Member Since', v: profile.created_at?new Date(profile.created_at).toLocaleDateString():'—', mono:false},
                {label:'Last Login',   v: profile.last_login?new Date(profile.last_login).toLocaleDateString():'—', mono:false},
              ].map(item=>(
                <div key={item.label}>
                  <div style={lbl}>{item.label}</div>
                  <div style={{...val,fontFamily:item.mono?DS.mono:'inherit',fontSize:item.mono?'0.72rem':'0.8rem',wordBreak:'break-all'}}>{item.v}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Session History */}
        <GlassCard style={{padding:'1.25rem'}}>
          <SectionHeader icon={<Activity size={11}/>} label="Session History" accent={DS.info}
            right={<GlassButton variant="ghost" size="sm" icon={<RefreshCw size={11}/>} onClick={load}/>}/>
          {sessions.length===0
            ? <div style={{textAlign:'center',padding:'2rem',color:DS.textMute,fontSize:'0.85rem'}}>No sessions recorded</div>
            : <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.75rem'}}>
                  <thead>
                    <tr>
                      {['Stream ID','Patient','Status','Trust','ICU Room','Started'].map(h=>(
                        <th key={h} style={{textAlign:'left',padding:'0.35rem 0.625rem',color:DS.textMute,fontWeight:700,fontSize:'0.58rem',letterSpacing:'0.09em',textTransform:'uppercase',borderBottom:`1px solid ${DS.border}`}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s:any)=>(
                      <tr key={s.id} style={{borderBottom:`1px solid ${DS.border}`,transition:'background 0.15s'}}
                        onMouseEnter={e=>(e.currentTarget.style.background='rgba(255,255,255,0.02)')}
                        onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                        <td style={{padding:'0.45rem 0.625rem',color:DS.textMute,fontFamily:DS.mono,fontSize:'0.66rem'}}>{String(s.id).slice(0,12)}…</td>
                        <td style={{padding:'0.45rem 0.625rem',color:DS.textSub}}>{s.patient_name||'—'}</td>
                        <td style={{padding:'0.45rem 0.625rem'}}>
                          <StatusBadge variant={s.status==='active'?'safe':'muted'} label={s.status||'ended'} dot={s.status==='active'}/>
                        </td>
                        <td style={{padding:'0.45rem 0.625rem',fontFamily:DS.mono,fontWeight:700,color:trustColor(s.last_trust)}}>{s.last_trust??'—'}</td>
                        <td style={{padding:'0.45rem 0.625rem',color:DS.textMute,fontSize:'0.7rem'}}>{s.icu_room||'—'}</td>
                        <td style={{padding:'0.45rem 0.625rem',color:DS.textMute,fontSize:'0.62rem',fontFamily:DS.mono}}>{s.started_at?new Date(s.started_at).toLocaleString():'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </GlassCard>

      </div>
    </div>
  );
};
