'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import {
  Briefcase, FileText, Mail, Brain, BarChart2,
  Plus, ExternalLink, Trash2, CheckCircle, BookmarkPlus,
  Clock, XCircle, Star, ChevronRight,
  AlertCircle, Upload, User, Settings, Key, LogOut, LogIn,
  Sparkles, TrendingUp, Target, Send, Award, MapPin, Phone, Linkedin, GraduationCap, Lightbulb,
  Pencil, BadgeCheck, Languages, Download, Search, Building2, Sun, Moon, FolderOpen, Link,
  RefreshCw, ClipboardCopy, ArrowLeftRight, CalendarDays, ChevronLeft,
} from 'lucide-react'
import { exportPdf, exportDocx, exportFileName, guessCandidateName, exportPrepPdf, exportPrepDocx, type PrepExportData } from './lib/export'
import { showError, showSuccess, showToast } from './lib/notify'

// ── API KEY PROVIDERS ─────────────────────────────────────────────────────────
// Add a provider here + wire its header on the server to support a new LLM.
interface ApiProvider {
  id: string
  label: string
  placeholder: string
  helpUrl: string
  active: boolean  // false = saved for later, not yet used by backend
}

const API_PROVIDERS: ApiProvider[] = [
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIza...', helpUrl: 'https://aistudio.google.com/app/apikey', active: true },
  { id: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys', active: false },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-...', helpUrl: 'https://platform.openai.com/api-keys', active: false },
]

// Which providers the current user has a key saved for (booleans only — the
// server never returns the key values themselves).
type ConfiguredKeys = Record<string, boolean>

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// ── TYPES ──────────────────────────────────────────────────────────────────
interface JobApplication {
  id: string
  company: string
  role: string
  location: string
  url: string
  jobDesc: string
  status: 'saved' | 'applied' | 'interview' | 'offer' | 'rejected'
  matchScore: number
  analysis?: AnalysisResult | null
  appliedDate?: string
  deadline?: string
  notes?: string
  salary?: string
  documents?: AppDocument[] | null
  prep?: PrepResult | null
  createdAt: string
}

interface PrepResult {
  companyOverview?: string
  industry?: string
  companySize?: string
  salaryMin?: number
  salaryMax?: number
  salarySafe?: number
  salaryCurrency?: string
  salaryRange?: string
  salarySource?: string
  salaryConfidence?: 'high' | 'medium' | 'low'
  salaryDataYear?: string
  salarySources?: { label: string; url?: string; figure: string }[]
  salaryNegotiationTips?: string[]
  keyTips?: string[]
  questions?: {
    question: string
    suggestedAnswer: string
    tip?: string
    category?: string
    sources?: { label: string; url?: string; detail: string }[]
    sourceNote?: string
  }[]
  questionsToRecruiter?: { question: string; context?: string }[]
  _searchSources?: { url: string; title: string }[]
  _searchQueries?: string[]
  _salarySearchSources?: { url: string; title: string }[]
}

type DocType = 'cv' | 'coverletter' | 'email' | 'followup' | 'thankyou'

interface AppDocument {
  type: DocType
  content: string
  createdAt: string
}

interface AnalysisResult {
  score?: number
  strengths?: string[]
  gaps?: string[]
  recommendation?: string
  salaryRange?: string
  keywordsToAdd?: string[]
}

interface CvImprovement {
  suggestions?: string[]
  missingKeywords?: string[]
  rewrittenSummary?: string
}

interface Tab {
  id: string
  label: string
  subtitle: string
  icon: React.ReactNode
}

const TABS: Tab[] = [
  { id: 'tracker', label: 'Job Tracker', subtitle: 'Pantau semua lamaranmu di satu tempat', icon: <Briefcase size={18} /> },
  { id: 'search', label: 'Cari Loker', subtitle: 'Temukan lowongan yang cocok & simpan sekali klik', icon: <Search size={18} /> },
  { id: 'analyze', label: 'Analyze & Generate', subtitle: 'Cek kecocokan & buat dokumen lamaran dengan AI', icon: <BarChart2 size={18} /> },
  { id: 'prep', label: 'Interview Prep', subtitle: 'Riset perusahaan & latihan pertanyaan interview', icon: <Brain size={18} /> },
  { id: 'profile', label: 'My Profile', subtitle: 'CV & profil yang dipakai AI sebagai konteks', icon: <User size={18} /> },
  { id: 'settings', label: 'Settings', subtitle: 'API key & impor data', icon: <Settings size={18} /> },
]

const STATUS_CONFIG = {
  saved: { label: 'Saved', color: 'badge-gray', icon: <Clock size={12} /> },
  applied: { label: 'Applied', color: 'badge-blue', icon: <CheckCircle size={12} /> },
  interview: { label: 'Interview', color: 'badge-yellow', icon: <Star size={12} /> },
  offer: { label: 'Offer!', color: 'badge-green', icon: <Star size={12} /> },
  rejected: { label: 'Rejected', color: 'badge-red', icon: <XCircle size={12} /> },
}

// ── AUTH GATE ────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { status } = useSession()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <SignInScreen />
  }

  return <AppShell />
}

function SignInScreen() {
  const FEATURES = [
    { icon: <Target size={16} />, title: 'Match scoring', desc: 'Skor kecocokan CV vs lowongan' },
    { icon: <Sparkles size={16} />, title: 'AI documents', desc: 'CV, cover letter & email otomatis' },
    { icon: <Brain size={16} />, title: 'Interview prep', desc: 'Riset perusahaan & latihan tanya-jawab' },
    { icon: <TrendingUp size={16} />, title: 'Tracking', desc: 'Pantau status tiap lamaran' },
  ]
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Left — brand / hero */}
      <div className="relative hidden lg:flex flex-col justify-between bg-brand-gradient p-12 text-white overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-0 -left-20 w-80 h-80 rounded-full bg-accent/20 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 bg-white/15 backdrop-blur rounded-xl flex items-center justify-center">
            <Briefcase size={20} />
          </div>
          <span className="font-semibold text-lg">Job Application Suite</span>
        </div>
        <div className="relative space-y-6">
          <h2 className="text-3xl font-bold leading-snug">
            Lamar kerja lebih cerdas,<br />bukan lebih capek.
          </h2>
          <p className="text-white/80 max-w-md">
            Asisten lamaran kerja bertenaga AI — analisis kecocokan, generate dokumen, dan siapkan interview, semua di satu tempat.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md pt-2">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-white/10 backdrop-blur rounded-xl p-3.5 border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-accent bg-white/15 rounded-lg p-1.5">{f.icon}</span>
                  <span className="font-semibold text-sm">{f.title}</span>
                </div>
                <p className="text-xs text-white/70">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} Job Application Suite</p>
      </div>

      {/* Right — sign in */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6 animate-fade-in">
          <div className="lg:hidden w-12 h-12 bg-brand-gradient rounded-2xl flex items-center justify-center">
            <Briefcase size={22} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-2xl">Selamat datang 👋</h1>
            <p className="text-sm text-gray-500 mt-1.5">Masuk untuk mulai melamar kerja dengan bantuan AI.</p>
          </div>
          <button
            onClick={() => signIn('google')}
            className="w-full flex items-center justify-center gap-3 border border-gray-200 bg-white rounded-xl px-4 py-3
                       font-medium text-gray-700 shadow-sm transition-all hover:shadow-md hover:border-gray-300 active:scale-[.99]"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 009 18z"/>
              <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 010-3.44V4.94H.96a9 9 0 000 8.12l3.02-2.34z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 00.96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
            Lanjutkan dengan Google
          </button>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <CheckCircle size={13} className="text-accent" />
            CV dan data kamu privat — hanya untuk akunmu.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── ACCOUNT SWITCHER HELPERS ─────────────────────────────────────────────────
interface KnownAccount { name: string; email: string; image?: string }
const ACCOUNTS_KEY = 'jobsuite_known_accounts'

function loadKnownAccounts(): KnownAccount[] {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]') } catch { return [] }
}
function saveKnownAccount(a: KnownAccount) {
  try {
    const list = loadKnownAccounts().filter(x => x.email !== a.email)
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([a, ...list].slice(0, 5)))
  } catch { /* ignore */ }
}

// ── MAIN APP (authenticated) ──────────────────────────────────────────────────
function AppShell() {
  const { data: session } = useSession()
  const [activeTab, setActiveTab] = useState('tracker')
  const [jobs, setJobs] = useState<JobApplication[]>([])
  const [selectedJob, setSelectedJob] = useState<JobApplication | null>(null)
  const [profile, setProfile] = useState<string>('')
  const [profileStructured, setProfileStructured] = useState<any>(null)
  const [configuredKeys, setConfiguredKeys] = useState<ConfiguredKeys>({})
  const [loading, setLoading] = useState(true)
  const [dark, setDark] = useState(false)
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([])
  const accountPickerRef = useRef<HTMLDivElement>(null)

  // Sync toggle state with the class the anti-flash script already set.
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')) }, [])

  // Save current account to localStorage so it appears in the switcher list.
  useEffect(() => {
    if (!session?.user?.email) return
    saveKnownAccount({
      name: session.user.name || session.user.email,
      email: session.user.email,
      image: session.user.image ?? undefined,
    })
    setKnownAccounts(loadKnownAccounts())
  }, [session?.user?.email])

  // Close picker when clicking outside.
  useEffect(() => {
    if (!showAccountPicker) return
    const handler = (e: MouseEvent) => {
      if (accountPickerRef.current && !accountPickerRef.current.contains(e.target as Node))
        setShowAccountPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAccountPicker])
  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }

  const refreshKeys = useCallback(async () => {
    const res = await fetch('/api/keys')
    if (res.ok) {
      const data = await res.json()
      setConfiguredKeys(data.configured || {})
    }
  }, [])

  // Load all user data from the server on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [jobsRes, profileRes, keysRes] = await Promise.all([
          fetch('/api/applications'),
          fetch('/api/profile'),
          fetch('/api/keys'),
        ])
        if (cancelled) return
        if (jobsRes.ok) setJobs(await jobsRes.json())
        if (profileRes.ok) {
          const p = await profileRes.json()
          setProfile(p.profile || '')
          setProfileStructured(p.structured || null)
        }
        if (keysRes.ok) setConfiguredKeys((await keysRes.json()).configured || {})
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const saveProfile = async (text: string) => {
    setProfile(text)
    setProfileStructured(null) // server clears its cache too; will re-parse with AI
    await fetch('/api/profile', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ profile: text }) })
  }

  const addJob = async (job: Partial<JobApplication>): Promise<JobApplication | null> => {
    const res = await fetch('/api/applications', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(job) })
    if (res.ok) {
      const created = await res.json()
      setJobs(prev => [created, ...prev])
      return created
    }
    return null
  }

  // Pending server writes per application id, flushed after a short pause so
  // typing in a text field doesn't fire a PATCH on every keystroke.
  const pendingUpdates = useRef<Map<string, Partial<JobApplication>>>(new Map())
  const flushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const flushJob = useCallback((id: string) => {
    const updates = pendingUpdates.current.get(id)
    pendingUpdates.current.delete(id)
    const timer = flushTimers.current.get(id)
    if (timer) { clearTimeout(timer); flushTimers.current.delete(id) }
    if (!updates || Object.keys(updates).length === 0) return
    fetch(`/api/applications/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(updates) })
  }, [])

  const updateJob = useCallback((id: string, updates: Partial<JobApplication>) => {
    // Optimistic local update for a responsive UI...
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j))
    setSelectedJob(prev => prev && prev.id === id ? { ...prev, ...updates } : prev)
    // ...but coalesce the persisted write and debounce it.
    pendingUpdates.current.set(id, { ...pendingUpdates.current.get(id), ...updates })
    const existing = flushTimers.current.get(id)
    if (existing) clearTimeout(existing)
    flushTimers.current.set(id, setTimeout(() => flushJob(id), 600))
  }, [flushJob])

  // Flush any pending writes when the app unmounts so edits aren't lost.
  useEffect(() => {
    const timers = flushTimers.current
    const pending = pendingUpdates.current
    return () => {
      timers.forEach(t => clearTimeout(t))
      pending.forEach((updates, id) => {
        if (Object.keys(updates).length) {
          fetch(`/api/applications/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(updates), keepalive: true })
        }
      })
    }
  }, [])

  const deleteJob = (id: string) => {
    // Drop any queued write so it can't fire against the deleted row.
    const timer = flushTimers.current.get(id)
    if (timer) { clearTimeout(timer); flushTimers.current.delete(id) }
    pendingUpdates.current.delete(id)
    setJobs(prev => prev.filter(j => j.id !== id))
    if (selectedJob?.id === id) setSelectedJob(null)
    fetch(`/api/applications/${id}`, { method: 'DELETE' })
  }

  const activeMeta = TABS.find(t => t.id === activeTab)!
  const userName = session?.user?.name || session?.user?.email || 'User'
  const userImage = session?.user?.image

  const switchToAccount = async (email: string) => {
    setShowAccountPicker(false)
    await signOut({ redirect: false })
    signIn('google', { callbackUrl: '/' }, { login_hint: email })
  }

  const addNewAccount = async () => {
    setShowAccountPicker(false)
    await signOut({ redirect: false })
    signIn('google', { callbackUrl: '/' }, { prompt: 'select_account' })
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-white border-r border-gray-100 shadow-sidebar fixed inset-y-0 left-0 z-30">
        <div className="flex items-center gap-3 px-5 h-16 border-b border-gray-100">
          <div className="w-9 h-9 bg-brand-gradient rounded-xl flex items-center justify-center shadow-sm">
            <Briefcase size={18} className="text-white" />
          </div>
          <div className="leading-tight">
            <p className="font-bold text-gray-900 text-sm">Job Suite</p>
            <p className="text-[11px] text-accent font-medium">AI-Powered</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`nav-link w-full ${activeTab === tab.id ? 'nav-link-active' : ''}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100">
          <button onClick={toggleTheme} className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors mb-1">
            {dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? 'Mode terang' : 'Mode gelap'}
          </button>
          <div className="relative" ref={accountPickerRef}>
            {/* Account picker popover */}
            {showAccountPicker && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden z-50">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-4 pt-3 pb-1">Akun</p>
                {knownAccounts.map(acc => {
                  const isCurrent = acc.email === session?.user?.email
                  return (
                    <button
                      key={acc.email}
                      onClick={() => !isCurrent && switchToAccount(acc.email)}
                      disabled={isCurrent}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                        isCurrent ? 'bg-primary/5 cursor-default' : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <Avatar name={acc.name} image={acc.image} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{acc.name}</p>
                        <p className="text-[11px] text-gray-400 truncate">{acc.email}</p>
                      </div>
                      {isCurrent && <CheckCircle size={14} className="text-primary shrink-0" />}
                    </button>
                  )
                })}
                <div className="border-t border-gray-100 p-2">
                  <button
                    onClick={addNewAccount}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-primary font-medium hover:bg-primary/5 transition-colors"
                  >
                    <Plus size={14} /> Tambah akun lain
                  </button>
                  <button
                    onClick={() => { setShowAccountPicker(false); signOut() }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-red-500 font-medium hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={14} /> Keluar
                  </button>
                </div>
              </div>
            )}

            {/* User row — click opens picker */}
            <button
              onClick={() => setShowAccountPicker(o => !o)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <Avatar name={userName} image={userImage} />
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-medium text-gray-900 truncate">{userName}</p>
                <p className="text-[11px] text-gray-400 truncate">{session?.user?.email}</p>
              </div>
              <ArrowLeftRight size={14} className="text-gray-400 shrink-0" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <div className="flex-1 md:ml-64 min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-100">
          <div className="flex items-center justify-between gap-4 px-5 md:px-8 h-16">
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 text-lg leading-tight truncate">{activeMeta.label}</h1>
              <p className="text-xs text-gray-500 truncate">{activeMeta.subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveTab('analyze')} className="btn-primary text-sm hidden sm:inline-flex">
                <Plus size={15} /> Tambah Lowongan
              </button>
              <div className="md:hidden">
                <Avatar name={userName} image={userImage} />
              </div>
            </div>
          </div>
        </header>

        <main className="p-5 md:p-8">
          {loading ? (
            <div className="card text-center py-16">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
              <p className="text-sm text-gray-500">Memuat data kamu...</p>
            </div>
          ) : (
            <div className="animate-fade-in">
              {activeTab === 'tracker' && (
                <TrackerTab
                  jobs={jobs}
                  onUpdate={updateJob}
                  onDelete={deleteJob}
                  onSelect={setSelectedJob}
                  selectedJob={selectedJob}
                  onSwitchToAnalyze={() => setActiveTab('analyze')}
                  profile={profile}
                  configuredKeys={configuredKeys}
                  onGoToProfile={() => setActiveTab('profile')}
                  onGoToSettings={() => setActiveTab('settings')}
                  onGoToSearch={() => setActiveTab('search')}
                />
              )}
              {activeTab === 'search' && (
                <CariLokerTab jobs={jobs} profile={profile} configuredKeys={configuredKeys} onJobAdded={addJob} onGoToSettings={() => setActiveTab('settings')} onGoToProfile={() => setActiveTab('profile')} onGoToTracker={() => setActiveTab('tracker')} />
              )}
              {activeTab === 'analyze' && (
                <AnalyzeTab onJobAdded={addJob} onUpdateJob={updateJob} profile={profile} configuredKeys={configuredKeys} onGoToProfile={() => setActiveTab('profile')} onGoToSettings={() => setActiveTab('settings')} />
              )}
              {activeTab === 'prep' && (
                <PrepTab jobs={jobs} profile={profile} configuredKeys={configuredKeys} onUpdateJob={updateJob} onGoToProfile={() => setActiveTab('profile')} onGoToSettings={() => setActiveTab('settings')} />
              )}
              {activeTab === 'profile' && (
                <ProfileTab
                  profile={profile}
                  onSave={saveProfile}
                  structured={profileStructured}
                  onStructured={setProfileStructured}
                  hasGeminiKey={!!configuredKeys.gemini}
                  onGoToSettings={() => setActiveTab('settings')}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsTab configuredKeys={configuredKeys} onSaved={refreshKeys} />
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── Mobile bottom nav ───────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-100 flex justify-around px-2 py-1.5">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-medium ${
              activeTab === tab.id ? 'text-primary' : 'text-gray-400'
            }`}
          >
            {tab.icon}
            {tab.label.split(' ')[0]}
          </button>
        ))}
      </nav>
    </div>
  )
}

// ── AVATAR ───────────────────────────────────────────────────────────────────
function Avatar({ name, image, size = 'md' }: { name: string; image?: string | null; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm'
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={name} className={`${cls} rounded-full object-cover ring-2 ring-white shadow-sm shrink-0`} referrerPolicy="no-referrer" />
  }
  return (
    <div className={`${cls} rounded-full bg-accent-gradient text-white flex items-center justify-center font-semibold shadow-sm shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

// ── ONBOARDING CHECKLIST ──────────────────────────────────────────────────────
// Shown to brand-new users until the 3 setup steps are done, so the first screen
// isn't an empty tracker.
function OnboardingChecklist({ hasKey, hasProfile, hasJobs, onKey, onProfile, onSearch }: {
  hasKey: boolean; hasProfile: boolean; hasJobs: boolean
  onKey: () => void; onProfile: () => void; onSearch: () => void
}) {
  const steps = [
    { done: hasKey, title: 'Pasang Gemini API key', desc: 'Wajib untuk semua fitur AI.', cta: 'Buka Settings', onClick: onKey },
    { done: hasProfile, title: 'Upload CV / profil', desc: 'Jadi konteks AI untuk analisis & dokumen.', cta: 'Upload CV', onClick: onProfile },
    { done: hasJobs, title: 'Tambah lowongan pertama', desc: 'Cari loker atau analisis satu lowongan.', cta: 'Cari Loker', onClick: onSearch },
  ]
  const done = steps.filter(s => s.done).length
  if (done === steps.length) return null
  const pct = Math.round((done / steps.length) * 100)
  return (
    <div className="card overflow-hidden p-0 animate-fade-in">
      <div className="bg-brand-gradient px-6 py-5 text-white">
        <h2 className="font-bold text-lg">Selamat datang! 👋 Siapkan 3 hal ini dulu</h2>
        <p className="text-sm text-white/80 mt-0.5">Sebentar aja, langsung bisa melamar kerja dengan bantuan AI.</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 bg-white/20 rounded-full h-2 overflow-hidden">
            <div className="h-2 bg-white rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-medium text-white/90">{done}/{steps.length}</span>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {steps.map((s, i) => (
          <div key={i} className={`flex items-center gap-3 rounded-xl p-3 ${s.done ? 'bg-green-50/60' : 'bg-slate-50'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${s.done ? 'bg-green-500 text-white' : 'bg-white border border-gray-200 text-gray-400 font-semibold text-sm'}`}>
              {s.done ? <CheckCircle size={16} /> : i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${s.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{s.title}</p>
              {!s.done && <p className="text-xs text-gray-500">{s.desc}</p>}
            </div>
            {!s.done && (
              <button onClick={s.onClick} className="btn-primary text-xs whitespace-nowrap">{s.cta}</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── DASHBOARD INSIGHTS ────────────────────────────────────────────────────────
// Conversion funnel + upcoming deadlines, derived entirely from the jobs list.
function DashboardInsights({ jobs }: { jobs: JobApplication[] }) {
  const c = (s: string) => jobs.filter(j => j.status === s).length
  const total = jobs.length
  // Treat interview/offer as having passed the earlier stages.
  const applied = c('applied') + c('interview') + c('offer')
  const interview = c('interview') + c('offer')
  const offer = c('offer')
  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0
  const funnel = [
    { label: 'Tersimpan', value: total, of: total, tone: 'bg-gray-400' },
    { label: 'Dilamar', value: applied, of: total, tone: 'bg-blue-500' },
    { label: 'Interview', value: interview, of: applied, tone: 'bg-amber-500' },
    { label: 'Offer', value: offer, of: interview, tone: 'bg-green-500' },
  ]

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const upcoming = jobs
    .filter(j => j.deadline)
    .map(j => ({ job: j, d: new Date(j.deadline!) }))
    .filter(x => !isNaN(x.d.getTime()) && x.d >= today)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .slice(0, 5)
  const daysUntil = (d: Date) => Math.round((d.getTime() - today.getTime()) / 86400000)

  if (total === 0) return null
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><TrendingUp size={15} className="text-primary" /> Funnel Lamaran</h3>
        <div className="space-y-2.5">
          {funnel.map((f, i) => (
            <div key={f.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-600">{f.label}</span>
                <span className="text-gray-400">{f.value}{i > 0 && f.of > 0 && <span className="ml-1">· {pct(f.value, f.of)}% dari tahap sebelumnya</span>}</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all ${f.tone}`} style={{ width: `${pct(f.value, total)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2"><Clock size={15} className="text-primary" /> Deadline Mendekat</h3>
        {upcoming.length === 0 ? (
          <p className="text-xs text-gray-400">Belum ada deadline yang diisi. Tambahkan di detail lamaran.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map(({ job, d }) => {
              const n = daysUntil(d)
              const tone = n <= 3 ? 'text-red-600 bg-red-50' : n <= 7 ? 'text-amber-600 bg-amber-50' : 'text-gray-500 bg-gray-50'
              return (
                <li key={job.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{decodeHtml(job.role)}</p>
                    <p className="text-[11px] text-gray-400 truncate">{decodeHtml(job.company)}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${tone}`}>
                    {n === 0 ? 'Hari ini' : n === 1 ? 'Besok' : `${n} hari lagi`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── CALENDAR VIEW ────────────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  saved: 'bg-gray-400', applied: 'bg-blue-500', interview: 'bg-amber-500',
  offer: 'bg-green-500', rejected: 'bg-red-400',
}
const MONTH_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const DAY_ID = ['Sen','Sel','Rab','Kam','Jum','Sab','Min']

function CalendarView({ jobs, onSelect }: { jobs: JobApplication[]; onSelect: (job: JobApplication) => void }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const jobDate = (j: JobApplication) => (j.appliedDate || j.createdAt || '').slice(0, 10)

  // Map date string → jobs array
  const byDate = useMemo(() => {
    const map: Record<string, JobApplication[]> = {}
    jobs.forEach(j => {
      const d = jobDate(j)
      if (d) { if (!map[d]) map[d] = []; map[d].push(j) }
    })
    return map
  }, [jobs])

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7  // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStr = now.toISOString().slice(0, 10)

  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  const fmt = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const selectedJobs = selectedDate ? (byDate[selectedDate] || []) : []

  return (
    <div className="space-y-4">
      {/* Calendar card */}
      <div className="card p-0 overflow-hidden">
        {/* Month nav */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronLeft size={18} className="text-gray-500" />
          </button>
          <h3 className="font-semibold text-gray-900">{MONTH_ID[month]} {year}</h3>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronRight size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAY_ID.map(d => (
            <div key={d} className="text-center py-2 text-[11px] font-semibold text-gray-400">{d}</div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (!day) return <div key={i} className="min-h-[72px] border-b border-r border-gray-50" />
            const dateStr = fmt(day)
            const dayJobs = byDate[dateStr] || []
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            return (
              <button
                key={i}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`min-h-[72px] p-2 border-b border-r border-gray-50 flex flex-col items-start gap-1 transition-colors text-left
                  ${isSelected ? 'bg-primary/8 ring-1 ring-inset ring-primary/30' : 'hover:bg-gray-50'}
                `}
              >
                <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full
                  ${isToday ? 'bg-primary text-white' : isSelected ? 'text-primary' : 'text-gray-700'}`}>
                  {day}
                </span>
                {/* Status dots */}
                {dayJobs.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 w-full">
                    {dayJobs.slice(0, 3).map((j, idx) => (
                      <span key={idx} className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[j.status] || 'bg-gray-300'}`} title={j.role} />
                    ))}
                    {dayJobs.length > 3 && (
                      <span className="text-[10px] text-gray-400 font-medium leading-none mt-0.5">+{dayJobs.length - 3}</span>
                    )}
                  </div>
                )}
                {/* Mini count badge */}
                {dayJobs.length > 0 && (
                  <span className="text-[10px] text-gray-400 leading-none">{dayJobs.length} job{dayJobs.length > 1 ? 's' : ''}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap px-1">
        {Object.entries(STATUS_DOT).map(([s, dot]) => (
          <span key={s} className="flex items-center gap-1.5 text-xs text-gray-500 capitalize">
            <span className={`w-2.5 h-2.5 rounded-full ${dot}`} /> {s}
          </span>
        ))}
      </div>

      {/* Selected day jobs panel */}
      {selectedDate && (
        <div className="card animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CalendarDays size={16} className="text-primary" />
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </h3>
            <span className="text-xs text-gray-400">{selectedJobs.length} lamaran</span>
          </div>
          {selectedJobs.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Tidak ada lamaran pada hari ini.</p>
          ) : (
            <div className="space-y-2">
              {selectedJobs.map(j => (
                <button
                  key={j.id}
                  onClick={() => onSelect(j)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 border border-gray-100 hover:border-primary/30 transition-all text-left group"
                >
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[j.status]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{decodeHtml(j.role)}</p>
                    <p className="text-xs text-gray-500 truncate">{decodeHtml(j.company)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={STATUS_CONFIG[j.status].color}>{STATUS_CONFIG[j.status].label}</span>
                    {j.matchScore > 0 && (
                      <span className="text-xs text-gray-400">{j.matchScore}%</span>
                    )}
                    <ChevronRight size={14} className="text-gray-300 group-hover:text-primary transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── TRACKER TAB ─────────────────────────────────────────────────────────────
function TrackerTab({ jobs, onUpdate, onDelete, onSelect, selectedJob, onSwitchToAnalyze, profile, configuredKeys, onGoToProfile, onGoToSettings, onGoToSearch }: {
  jobs: JobApplication[]
  onUpdate: (id: string, updates: Partial<JobApplication>) => void
  onDelete: (id: string) => void
  onSelect: (job: JobApplication | null) => void
  selectedJob: JobApplication | null
  onSwitchToAnalyze: () => void
  profile: string
  configuredKeys: ConfiguredKeys
  onGoToProfile: () => void
  onGoToSettings: () => void
  onGoToSearch: () => void
}) {
  const [filter, setFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'list' | 'board' | 'calendar'>('list')
  const [modalJobId, setModalJobId] = useState<string | null>(null)
  const modalJob = jobs.find(j => j.id === modalJobId) || null
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const todayStr = () => new Date().toISOString().slice(0, 10)
  const applyPreset = (preset: 'today' | '7d' | 'month') => {
    const today = new Date()
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    if (preset === 'today') { setDateFrom(fmt(today)); setDateTo(fmt(today)) }
    else if (preset === '7d') { const d = new Date(today); d.setDate(d.getDate() - 6); setDateFrom(fmt(d)); setDateTo(fmt(today)) }
    else { setDateFrom(fmt(new Date(today.getFullYear(), today.getMonth(), 1))); setDateTo(fmt(today)) }
  }
  const clearDate = () => { setDateFrom(''); setDateTo('') }

  const jobDate = (j: JobApplication) => (j.appliedDate || j.createdAt || '').slice(0, 10)

  const filtered = jobs.filter(j => {
    if (filter !== 'all' && j.status !== filter) return false
    const d = jobDate(j)
    if (dateFrom && d < dateFrom) return false
    if (dateTo && d > dateTo) return false
    return true
  })

  const count = (s: string) => jobs.filter(j => j.status === s).length
  const avgMatch = jobs.length
    ? Math.round(jobs.reduce((a, j) => a + (j.matchScore || 0), 0) / jobs.length)
    : 0
  const STATS: { label: string; value: string | number; Icon: typeof Briefcase; tone: string }[] = [
    { label: 'Total Lamaran', value: jobs.length, Icon: Briefcase, tone: 'text-primary bg-blue-50' },
    { label: 'Applied', value: count('applied'), Icon: Send, tone: 'text-blue-600 bg-blue-50' },
    { label: 'Interview', value: count('interview'), Icon: Star, tone: 'text-amber-600 bg-amber-50' },
    { label: 'Offer', value: count('offer'), Icon: Award, tone: 'text-green-600 bg-green-50' },
    { label: 'Rata-rata Match', value: `${avgMatch}%`, Icon: Target, tone: 'text-accent bg-teal-50' },
  ]

  return (
    <div className="space-y-6">
    <OnboardingChecklist
      hasKey={!!configuredKeys.gemini}
      hasProfile={!!profile}
      hasJobs={jobs.length > 0}
      onKey={onGoToSettings}
      onProfile={onGoToProfile}
      onSearch={onGoToSearch}
    />
    {/* Stat cards */}
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {STATS.map(({ label, value, Icon, tone }) => (
        <div key={label} className="card card-hover p-4">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${tone}`}><Icon size={18} /></div>
          <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
          <p className="text-xs text-gray-500 mt-1.5">{label}</p>
        </div>
      ))}
    </div>

    <DashboardInsights jobs={jobs} />

    {/* View toggle */}
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
        <button onClick={() => setViewMode('list')} className={`px-3 py-1.5 rounded-md font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-white' : 'text-gray-600 hover:text-primary'}`}>List</button>
        <button onClick={() => setViewMode('board')} className={`px-3 py-1.5 rounded-md font-medium transition-colors ${viewMode === 'board' ? 'bg-primary text-white' : 'text-gray-600 hover:text-primary'}`}>Board</button>
        <button onClick={() => setViewMode('calendar')} className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'calendar' ? 'bg-primary text-white' : 'text-gray-600 hover:text-primary'}`}>
          <CalendarDays size={13} /> Kalender
        </button>
      </div>
      {viewMode === 'board' && <p className="text-xs text-gray-400">Seret kartu antar kolom untuk ubah status</p>}
    </div>

    {viewMode === 'list' ? (
    <div className="grid grid-cols-12 gap-6">
      {/* Job List */}
      <div className="col-span-12 lg:col-span-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">
            Applications ({filtered.length}{filtered.length !== jobs.length ? ` / ${jobs.length}` : ''})
          </h2>
          <button onClick={onSwitchToAnalyze} className="btn-primary text-sm flex items-center gap-1">
            <Plus size={14} /> Add Job
          </button>
        </div>

        {/* Status filter */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {['all', 'saved', 'applied', 'interview', 'offer', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-xs px-3 py-1 rounded-full transition-colors capitalize ${
                filter === s ? 'bg-primary text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary'
              }`}
            >
              {s === 'all' ? `All (${jobs.length})` : `${s} (${jobs.filter(j => j.status === s).length})`}
            </button>
          ))}
        </div>

        {/* Date filter */}
        <div className="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
              <Clock size={12} /> Filter tanggal
            </p>
            {(dateFrom || dateTo) && (
              <button onClick={clearDate} className="text-[11px] text-red-400 hover:text-red-600 transition-colors">
                Reset
              </button>
            )}
          </div>
          {/* Quick presets */}
          <div className="flex gap-1.5">
            {[
              { label: 'Hari ini', key: 'today' as const },
              { label: '7 hari', key: '7d' as const },
              { label: 'Bulan ini', key: 'month' as const },
            ].map(({ label, key }) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                  key === 'today' && dateFrom === todayStr() && dateTo === todayStr()
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-primary hover:text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Manual range */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <span className="text-xs text-gray-400 shrink-0">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          {(dateFrom || dateTo) && (
            <p className="text-[11px] text-primary font-medium">
              {filtered.length} lamaran ditemukan
            </p>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="card text-center py-12">
            <Briefcase size={32} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No applications yet</p>
            <button onClick={onSwitchToAnalyze} className="btn-primary text-sm mt-3">
              Add your first job
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(job => (
              <div
                key={job.id}
                onClick={() => onSelect(job)}
                className={`card cursor-pointer hover:border-primary/30 transition-all p-4 ${
                  selectedJob?.id === job.id ? 'border-primary/50 bg-blue-50/30' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={STATUS_CONFIG[job.status].color}>{STATUS_CONFIG[job.status].label}</span>
                      {job.matchScore > 0 && (
                        <span className={`text-xs font-medium ${job.matchScore >= 75 ? 'text-green-600' : job.matchScore >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {job.matchScore}% match
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-gray-900 text-sm truncate">{decodeHtml(job.role)}</p>
                    <p className="text-xs text-gray-500">{decodeHtml(job.company)} · {job.location}</p>
                  </div>
                  <ChevronRight size={16} className="text-gray-400 flex-shrink-0 mt-1" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Job Detail */}
      <div className="col-span-12 lg:col-span-7">
        {selectedJob ? (
          <JobDetail job={selectedJob} onUpdate={onUpdate} onDelete={onDelete} profile={profile} />
        ) : (
          <div className="card h-full min-h-[16rem] flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <FileText size={22} className="text-slate-400" />
            </div>
            <p className="text-gray-500 text-sm font-medium">Pilih lowongan untuk lihat detail</p>
            <p className="text-gray-400 text-xs mt-1">Klik salah satu kartu di sebelah kiri</p>
          </div>
        )}
      </div>
    </div>
    ) : viewMode === 'board' ? (
      <KanbanBoard jobs={jobs} onUpdate={onUpdate} onOpen={setModalJobId} />
    ) : (
      <CalendarView jobs={jobs} onSelect={job => { onSelect(job); setViewMode('list') }} />
    )}

    {modalJob && (
      <JobDetailModal
        job={modalJob}
        onUpdate={onUpdate}
        onDelete={(id) => { onDelete(id); setModalJobId(null) }}
        onClose={() => setModalJobId(null)}
        profile={profile}
      />
    )}
    </div>
  )
}

// ── KANBAN BOARD ─────────────────────────────────────────────────────────────
const KANBAN_COLUMNS: { status: JobApplication['status']; label: string; accent: string }[] = [
  { status: 'saved', label: 'Saved', accent: 'border-t-gray-300' },
  { status: 'applied', label: 'Applied', accent: 'border-t-blue-400' },
  { status: 'interview', label: 'Interview', accent: 'border-t-amber-400' },
  { status: 'offer', label: 'Offer', accent: 'border-t-green-400' },
  { status: 'rejected', label: 'Rejected', accent: 'border-t-red-400' },
]

function KanbanBoard({ jobs, onUpdate, onOpen }: {
  jobs: JobApplication[]
  onUpdate: (id: string, updates: Partial<JobApplication>) => void
  onOpen: (id: string) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const drop = (status: JobApplication['status']) => {
    if (dragId) {
      const job = jobs.find(j => j.id === dragId)
      if (job && job.status !== status) onUpdate(dragId, { status })
    }
    setDragId(null); setOverCol(null)
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {KANBAN_COLUMNS.map(col => {
        const items = jobs.filter(j => j.status === col.status)
        return (
          <div
            key={col.status}
            onDragOver={e => { e.preventDefault(); setOverCol(col.status) }}
            onDragLeave={() => setOverCol(prev => prev === col.status ? null : prev)}
            onDrop={() => drop(col.status)}
            className={`rounded-xl border-t-2 ${col.accent} bg-slate-50/60 p-2.5 min-h-[8rem] transition-colors ${overCol === col.status ? 'bg-blue-50 ring-2 ring-primary/30' : ''}`}
          >
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-xs font-semibold text-gray-700">{col.label}</span>
              <span className="text-xs text-gray-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map(job => (
                <div
                  key={job.id}
                  draggable
                  onDragStart={() => setDragId(job.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null) }}
                  onClick={() => onOpen(job.id)}
                  className={`bg-white rounded-lg border border-gray-100 p-3 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all ${dragId === job.id ? 'opacity-50' : ''}`}
                >
                  <p className="font-medium text-gray-900 text-xs leading-snug line-clamp-2">{decodeHtml(job.role)}</p>
                  <p className="text-[11px] text-gray-500 mt-1 truncate">{decodeHtml(job.company)}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {job.matchScore > 0 && (
                      <span className={`text-[10px] font-semibold ${job.matchScore >= 75 ? 'text-green-600' : job.matchScore >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{job.matchScore}%</span>
                    )}
                    {job.deadline && <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><Clock size={9} /> {job.deadline}</span>}
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-[11px] text-gray-300 text-center py-4">Kosong</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── JOB DETAIL MODAL ─────────────────────────────────────────────────────────
function JobDetailModal({ job, onUpdate, onDelete, onClose, profile }: {
  job: JobApplication
  onUpdate: (id: string, updates: Partial<JobApplication>) => void
  onDelete: (id: string) => void
  onClose: () => void
  profile: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex justify-end mb-2">
          <button onClick={onClose} className="text-white/90 hover:text-white text-sm inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5 transition-colors">
            <XCircle size={16} /> Tutup
          </button>
        </div>
        <JobDetail job={job} onUpdate={onUpdate} onDelete={onDelete} profile={profile} />
      </div>
    </div>
  )
}

// ── JOB DETAIL ───────────────────────────────────────────────────────────────
function JobDetail({ job, onUpdate, onDelete, profile }: {
  job: JobApplication
  onUpdate: (id: string, updates: Partial<JobApplication>) => void
  onDelete: (id: string) => void
  profile: string
}) {
  return (
    <div className="space-y-4">
    <div className="card space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-bold text-gray-900 text-lg">{decodeHtml(job.role)}</h2>
          <p className="text-gray-600">{decodeHtml(job.company)} · {job.location}</p>
          {job.url && (
            <a href={job.url} target="_blank" rel="noopener noreferrer"
               className="text-xs text-primary flex items-center gap-1 mt-1 hover:underline">
              View job posting <ExternalLink size={10} />
            </a>
          )}
        </div>
        <button onClick={() => onDelete(job.id)} className="text-gray-400 hover:text-red-500 transition-colors">
          <Trash2 size={16} />
        </button>
      </div>

      {/* Match Score */}
      {job.matchScore > 0 && (
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">ATS Match Score</span>
            <span className={`font-bold text-lg ${job.matchScore >= 75 ? 'text-green-600' : job.matchScore >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>
              {job.matchScore}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${job.matchScore >= 75 ? 'bg-green-500' : job.matchScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${job.matchScore}%` }}
            />
          </div>
        </div>
      )}

      {/* Saved AI analysis */}
      {job.analysis && (job.analysis.strengths?.length || job.analysis.gaps?.length || job.analysis.recommendation) && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            {!!job.analysis.strengths?.length && (
              <div>
                <p className="text-xs font-medium text-green-700 mb-2">Kelebihan</p>
                <ul className="space-y-1">
                  {job.analysis.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                      <CheckCircle size={10} className="text-green-500 mt-0.5 flex-shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!job.analysis.gaps?.length && (
              <div>
                <p className="text-xs font-medium text-red-600 mb-2">Kekurangan</p>
                <ul className="space-y-1">
                  {job.analysis.gaps.map((g, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                      <XCircle size={10} className="text-red-400 mt-0.5 flex-shrink-0" /> {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {job.analysis.recommendation && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-800">{job.analysis.recommendation}</p>
            </div>
          )}
          {job.analysis.salaryRange && (
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-xs font-medium text-green-700">Estimasi Gaji</p>
              <p className="text-sm font-bold text-green-800">{job.analysis.salaryRange}</p>
            </div>
          )}
        </div>
      )}

      {/* Status & Info */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Company</label>
          <input
            type="text"
            value={job.company || ''}
            onChange={e => onUpdate(job.id, { company: e.target.value })}
            placeholder="e.g. PT Bank Mandiri"
            className="input text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Role</label>
          <input
            type="text"
            value={job.role || ''}
            onChange={e => onUpdate(job.id, { role: e.target.value })}
            placeholder="e.g. IT Project Manager"
            className="input text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Status</label>
          <select
            value={job.status}
            onChange={e => onUpdate(job.id, { status: e.target.value as JobApplication['status'] })}
            className="input text-sm"
          >
            <option value="saved">Saved</option>
            <option value="applied">Applied</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Expected Salary</label>
          <input
            type="text"
            value={job.salary || ''}
            onChange={e => onUpdate(job.id, { salary: e.target.value })}
            placeholder="e.g. Rp 150,000,000"
            className="input text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Applied Date</label>
          <input
            type="date"
            value={job.appliedDate || ''}
            onChange={e => onUpdate(job.id, { appliedDate: e.target.value })}
            className="input text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Deadline</label>
          <input
            type="date"
            value={job.deadline || ''}
            onChange={e => onUpdate(job.id, { deadline: e.target.value })}
            className="input text-sm"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Notes</label>
        <textarea
          value={job.notes || ''}
          onChange={e => onUpdate(job.id, { notes: e.target.value })}
          placeholder="Add notes about this application..."
          rows={3}
          className="textarea text-sm"
        />
      </div>

      {/* Job Desc preview */}
      {job.jobDesc && (
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Job Description</label>
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 max-h-32 overflow-y-auto">
            {job.jobDesc.slice(0, 500)}...
          </div>
        </div>
      )}
    </div>

    {/* Continue the application: generate tailored documents from this saved job */}
    <DocumentGenerator
      jobDesc={job.jobDesc}
      company={decodeHtml(job.company)}
      role={decodeHtml(job.role)}
      location={job.location}
      profile={profile}
      savedDocs={job.documents}
      onSaveDocs={docs => onUpdate(job.id, { documents: docs })}
      analysis={job.analysis}
      baseScore={job.matchScore}
    />

    {/* Interview prep cached on this job */}
    {job.prep && <InterviewPrepPanel prep={job.prep} role={decodeHtml(job.role)} company={decodeHtml(job.company)} />}
    </div>
  )
}

function InterviewPrepPanel({ prep, role, company }: { prep: PrepResult; role: string; company: string }) {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)

  const exportData: PrepExportData = { role, company, ...prep }
  const fileName = `${[role, company].filter(Boolean).map(s => s.replace(/[^A-Za-z0-9]+/g, '_')).join('_InterviewPrep_')}`

  const handleExport = async (kind: 'pdf' | 'docx') => {
    setExporting(kind)
    try {
      if (kind === 'pdf') await exportPrepPdf(exportData, fileName)
      else await exportPrepDocx(exportData, fileName)
    } catch { showError('Export gagal. Coba lagi.') }
    setExporting(null)
  }

  return (
    <div className="card overflow-hidden p-0">
      {/* Header bar */}
      <div className="bg-gradient-to-r from-primary to-accent px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <Brain size={18} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-white text-sm">Interview Preparation</p>
            <p className="text-white/70 text-xs">Cached · klik untuk lihat / export</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* PDF button */}
          <button
            onClick={() => handleExport('pdf')}
            disabled={!!exporting}
            className="inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur border border-white/25 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {exporting === 'pdf'
              ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Download size={13} />}
            PDF
          </button>
          {/* DOCX button */}
          <button
            onClick={() => handleExport('docx')}
            disabled={!!exporting}
            className="inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur border border-white/25 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {exporting === 'docx'
              ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <FileText size={13} />}
            DOCX
          </button>
          {/* Toggle */}
          <button
            onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-1 text-white/80 hover:text-white text-xs px-2 py-1.5 transition-colors"
          >
            <ChevronRight size={15} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            {open ? 'Tutup' : 'Lihat'}
          </button>
        </div>
      </div>

      {/* Body — collapsible */}
      {open && (
        <div className="p-5 space-y-5">
          {/* Company + Salary row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(prep.companyOverview || prep.industry || prep.companySize) && (
              <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5"><Briefcase size={12} /> Company</p>
                {prep.companyOverview && <p className="text-sm text-gray-600 leading-relaxed">{prep.companyOverview}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {prep.industry && <span><b className="text-gray-700">Industry:</b> {prep.industry}</span>}
                  {prep.companySize && <span><b className="text-gray-700">Size:</b> {prep.companySize}</span>}
                </div>
              </div>
            )}
            {(prep.salaryRange || prep.salaryMin != null || prep.salaryNegotiationTips?.length) && (
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5 mb-3"><BarChart2 size={12} /> Salary Insights</p>
                <SalaryInsightCard prep={prep} />
              </div>
            )}
          </div>

          {/* Key Tips */}
          {prep.keyTips?.length && (
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 flex items-center gap-1.5"><Target size={12} /> Preparation Tips</p>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {prep.keyTips.map((t, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600 bg-blue-50 rounded-lg px-3 py-2">
                    <CheckCircle size={13} className="text-primary mt-0.5 shrink-0" /> {stripMd(t)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Q&A */}
          {prep.questions?.length && (
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-3 flex items-center gap-1.5"><Brain size={12} /> Interview Q&A ({prep.questions.length} pertanyaan)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {prep.questions.map((q, i) => (
                  <QuestionCard key={i} q={q} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* Questions to Ask the Recruiter */}
          {prep.questionsToRecruiter?.length && (
            <div>
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Send size={12} /> Pertanyaan untuk Recruiter / Interviewer
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {prep.questionsToRecruiter.map((q, i) => (
                  <div key={i} className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                    <p className="font-medium text-gray-800 text-sm mb-1.5 flex items-start gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-xs shrink-0 mt-0.5">{i + 1}</span>
                      {q.question}
                    </p>
                    {q.context && (
                      <p className="text-xs text-emerald-700 italic pl-7 flex items-center gap-1"><Lightbulb size={11} /> {stripMd(q.context!)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── DOCUMENT GENERATOR ───────────────────────────────────────────────────────
// Shared by the Analyze tab (intake) and the Job Detail panel (continue from a
// saved job). Generates CV / cover letter / email via /api/generate and, when
// given onSaveDocs, persists the latest of each type against the application.
const DOC_TYPES: { type: DocType; label: string; icon: React.ReactNode }[] = [
  { type: 'cv', label: 'CV', icon: <FileText size={16} /> },
  { type: 'coverletter', label: 'Cover Letter', icon: <FileText size={16} /> },
  { type: 'email', label: 'Email', icon: <Mail size={16} /> },
  { type: 'followup', label: 'Follow-up', icon: <Send size={16} /> },
  { type: 'thankyou', label: 'Thank You', icon: <BadgeCheck size={16} /> },
]

function DocumentGenerator({ jobDesc, company, role, location, profile, savedDocs, onSaveDocs, analysis, baseScore }: {
  jobDesc: string
  company: string
  role: string
  location: string
  profile: string
  savedDocs?: AppDocument[] | null
  onSaveDocs?: (docs: AppDocument[]) => void
  analysis?: AnalysisResult | null
  baseScore?: number
}) {
  const [activeGen, setActiveGen] = useState<DocType | null>(null)
  const [generatedContent, setGeneratedContent] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [atsScore, setAtsScore] = useState<number | null>(null)
  const [scoring, setScoring] = useState(false)
  const [improve, setImprove] = useState<CvImprovement | null>(null)
  const [improving, setImproving] = useState(false)
  // Track the previous CV version so user can revert if score drops after regenerate
  const [prevContent, setPrevContent] = useState<string | null>(null)
  const [prevAtsScore, setPrevAtsScore] = useState<number | null>(null)
  // Monotonic counter to discard stale rescore results when user regenerates quickly
  const rescoreGen = useRef(0)

  const runImprove = async () => {
    if (!jobDesc || !profile) return
    setImproving(true)
    setImprove(null)

    const slowTimer = setTimeout(() => {
      showToast('AI sedang menganalisis CV-mu... biasanya 15–30 detik, mohon tunggu', 'info', 8000)
    }, 8000)

    try {
      const res = await fetch('/api/improve-cv', {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({ jobDesc, profile, analysis }),
      })
      const data = await res.json()
      if (!res.ok) { showError(data.error || 'Gagal membuat saran.'); return }
      setImprove(data)
      showToast('Saran perbaikan CV siap!', 'success')
    } catch {
      showError('Gagal membuat saran. Periksa koneksi atau API key.')
    } finally {
      clearTimeout(slowTimer)
      setImproving(false)
    }
  }

  const savedFor = (type: DocType) => savedDocs?.find(d => d.type === type)?.content

  // Replace the latest doc of this type, keeping the others.
  const upsert = (type: DocType, content: string) => {
    if (!onSaveDocs) return
    const next = [
      ...(savedDocs || []).filter(d => d.type !== type),
      { type, content, createdAt: new Date().toISOString() },
    ]
    onSaveDocs(next)
  }

  // Re-score a generated CV against the job to show the ATS improvement.
  // Strip markdown formatting before scoring — STAR markers (** S ** etc.) and
  // ## headers confuse the scoring model and produce artificially low scores.
  const rescore = async (cvText: string) => {
    rescoreGen.current += 1
    const myGen = rescoreGen.current
    setScoring(true)
    setAtsScore(null)
    try {
      const plain = cvText
        .replace(/\*\*[STAR]\*\*/g, '')
        .replace(/#{1,3}\s*/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-rescore': '1' },
        body: JSON.stringify({ jobDesc, profile: plain }),
      })
      const data = await res.json()
      // Discard if a newer rescore was started while this one was in-flight
      if (myGen === rescoreGen.current && res.ok && typeof data.score === 'number') {
        setAtsScore(data.score)
      }
    } catch { /* non-blocking */ }
    if (myGen === rescoreGen.current) setScoring(false)
  }

  const DOC_LABEL: Record<DocType, string> = {
    cv: 'CV', coverletter: 'Cover Letter', email: 'Email', followup: 'Follow-up', thankyou: 'Thank You',
  }

  const revertToPrev = () => {
    if (!prevContent) return
    setGeneratedContent(prevContent)
    upsert('cv', prevContent)
    setAtsScore(prevAtsScore)
    setPrevContent(null)
    setPrevAtsScore(null)
    showToast('Kembali ke versi CV sebelumnya', 'success')
  }

  const generate = async (type: DocType) => {
    if (!jobDesc) return
    // Save current CV before overwriting so user can revert if score drops
    if (type === 'cv' && generatedContent) {
      setPrevContent(generatedContent)
      setPrevAtsScore(atsScore)
    }
    setActiveGen(type)
    setGenLoading(true)
    setGeneratedContent('')
    setAtsScore(null)

    // Notify if AI is taking >10s
    const slowTimer = setTimeout(() => {
      showToast('Masih proses... AI sedang berpikir keras, mohon tunggu sebentar', 'info', 7000)
    }, 10000)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ type, jobDesc, company, role, location, profile, analysis }),
      })
      const data = await res.json()
      if (!res.ok) { showError(data.error || 'Generation failed.'); return }
      setGeneratedContent(data.content)
      upsert(type, data.content)
      if (type === 'cv') rescore(data.content)
      showToast(`${DOC_LABEL[type]} selesai dibuat!`, 'success')
    } catch (e) {
      showError('Generation failed. Periksa koneksi atau API key.')
    } finally {
      clearTimeout(slowTimer)
      setGenLoading(false)
    }
  }

  // Clicking a type shows its saved draft if present, otherwise generates.
  const select = (type: DocType) => {
    setAtsScore(null)
    // Switching doc type or loading a saved draft invalidates any stored prev version
    // (prevAtsScore was for the previous render's CV content, which no longer applies)
    if (type !== 'cv' || activeGen !== 'cv') {
      setPrevContent(null)
      setPrevAtsScore(null)
    }
    const existing = savedFor(type)
    if (existing) { setActiveGen(type); setGeneratedContent(existing) }
    else generate(type)
  }

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-900 mb-3">Generate Documents</h3>
      {!profile && (
        <p className="text-xs text-amber-600 flex items-center gap-1 mb-3">
          <AlertCircle size={12} /> Upload CV/profile dulu agar dokumen sesuai pengalamanmu.
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {DOC_TYPES.map(({ type, label, icon }) => (
          <button
            key={type}
            onClick={() => select(type)}
            disabled={genLoading || !jobDesc}
            className={`relative flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium border transition-all ${
              activeGen === type ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-700 hover:border-primary hover:text-primary'
            }`}
          >
            {icon} {label}
            {savedFor(type) && (
              <CheckCircle size={12} className={`absolute -top-1.5 -right-1.5 rounded-full bg-white ${activeGen === type ? 'text-white bg-primary' : 'text-green-500'}`} />
            )}
          </button>
        ))}
      </div>

      {/* AI CV improvement — actionable, honest edits to raise ATS fit */}
      {profile && jobDesc && (
        <div className="mb-4 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              <Sparkles size={14} className="text-accent" /> Perbaiki CV-ku
            </p>
            <button onClick={runImprove} disabled={improving} className="btn-accent text-xs flex items-center gap-1.5">
              {improving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {improving ? 'Menganalisis CV...' : improve ? 'Analisis ulang' : 'Kasih saran'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Saran konkret + ringkasan yang ditulis ulang agar lebih cocok dengan lowongan ini.</p>

          {improving && (
            <div className="text-center py-4">
              <div className="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full mx-auto" />
            </div>
          )}

          {improve && !improving && (
            <div className="mt-3 space-y-3">
              {!!improve.suggestions?.length && (
                <ul className="space-y-1.5">
                  {improve.suggestions.map((s, i) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                      <Lightbulb size={12} className="text-amber-500 mt-0.5 flex-shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              )}
              {!!improve.missingKeywords?.length && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Keyword untuk ditambahkan (jika relevan)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {improve.missingKeywords.map((k, i) => (
                      <span key={i} className="text-[11px] rounded-full px-2.5 py-1 bg-white border border-teal-200 text-teal-700">{k}</span>
                    ))}
                  </div>
                </div>
              )}
              {improve.rewrittenSummary && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-gray-500">Ringkasan yang ditulis ulang</p>
                    <button onClick={() => { navigator.clipboard.writeText(improve.rewrittenSummary!); showSuccess('Ringkasan disalin.', 'Tersalin') }} className="text-xs text-primary hover:underline">Copy</button>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed bg-white rounded-lg p-2.5 border border-gray-100">{improve.rewrittenSummary}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {genLoading && (
        <div className="text-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-gray-500">Generating with AI...</p>
        </div>
      )}

      {generatedContent && !genLoading && activeGen && (
        <div>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p className="text-xs font-medium text-gray-500">{DOC_TYPES.find(d => d.type === activeGen)?.label} Content</p>
            <div className="flex items-center gap-2">
              {/* Regenerate */}
              <button
                onClick={() => generate(activeGen)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-primary border border-gray-200 hover:border-primary/40 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all"
              >
                <RefreshCw size={12} /> Regenerate
              </button>
              {/* Copy */}
              <button
                onClick={() => { navigator.clipboard.writeText(generatedContent); showSuccess('Konten disalin ke clipboard.', 'Tersalin!') }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-primary border border-gray-200 hover:border-primary/40 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all"
              >
                <ClipboardCopy size={12} /> Copy
              </button>
              {/* PDF — red gradient pill */}
              <button
                onClick={() => exportPdf(generatedContent, exportFileName(activeGen!, company, guessCandidateName(generatedContent, profile)), activeGen!)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-r from-rose-500 to-orange-400 hover:from-rose-600 hover:to-orange-500 shadow-sm hover:shadow-md px-3.5 py-1.5 rounded-lg transition-all"
              >
                <Download size={12} /> PDF
              </button>
              {/* DOCX — blue gradient pill */}
              <button
                onClick={() => exportDocx(generatedContent, exportFileName(activeGen!, company, guessCandidateName(generatedContent, profile)), activeGen!)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-r from-primary to-accent hover:from-[#1a4470] hover:to-[#0d9494] shadow-sm hover:shadow-md px-3.5 py-1.5 rounded-lg transition-all"
              >
                <FileText size={12} /> DOCX
              </button>
            </div>
          </div>
          {activeGen === 'cv' && (scoring || atsScore !== null) && (() => {
            // Reference score: prefer the score of the previous generation, fall back to job baseScore
            const refScore = prevAtsScore ?? (typeof baseScore === 'number' && baseScore > 0 ? baseScore : null)
            const dropped = !scoring && atsScore !== null && refScore !== null && atsScore < refScore
            const canRevert = dropped && prevContent !== null
            return (
              <div className="mb-2 space-y-2">
                {/* Score row */}
                <div className="flex items-center gap-2 rounded-lg bg-teal-50 border border-teal-100 px-3 py-2 text-xs">
                  <Target size={13} className="text-accent flex-shrink-0" />
                  {scoring ? (
                    <span className="text-gray-600">Mengukur ulang skor ATS CV ini...</span>
                  ) : (
                    <span className="text-gray-700 flex-1">
                      Skor ATS CV ini: <span className="font-bold text-accent">{atsScore}%</span>
                      {refScore !== null && (
                        <>
                          {' '}
                          <span className="text-gray-400">(sebelum: {refScore}%</span>
                          {atsScore! > refScore
                            ? <span className="text-green-600 font-medium">, naik {atsScore! - refScore} poin ✓)</span>
                            : atsScore! === refScore
                              ? <span className="text-gray-400">, sama)</span>
                              : <span className="text-amber-600 font-medium">, turun {refScore - atsScore!} poin)</span>}
                        </>
                      )}
                    </span>
                  )}
                </div>

                {/* Revert banner — only when score dropped AND previous CV version exists */}
                {canRevert && (
                  <div className="flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <AlertCircle size={14} className="text-amber-500 shrink-0" />
                    <p className="text-xs text-amber-800 flex-1 leading-relaxed">
                      Versi baru ini skornya lebih rendah dari versi sebelumnya
                      {prevAtsScore !== null ? <> (<span className="font-semibold">{prevAtsScore}%</span> → <span className="font-semibold">{atsScore}%</span>)</> : ''}.
                      Mau balik ke versi yang lebih baik?
                    </p>
                    <button
                      onClick={revertToPrev}
                      className="shrink-0 text-xs font-semibold bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap flex items-center gap-1.5">
                      <ChevronLeft size={13} /> Pakai versi lama {prevAtsScore !== null ? `(${prevAtsScore}%)` : ''}
                    </button>
                  </div>
                )}

                {/* First-gen score lower than job baseScore — offer to revert to original profile */}
                {!canRevert && !scoring && atsScore !== null && refScore !== null && atsScore < refScore && (
                  <div className="flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <AlertCircle size={14} className="text-amber-500 shrink-0" />
                    <p className="text-xs text-amber-800 flex-1 leading-relaxed">
                      CV hasil AI ini skornya lebih rendah dari profilmu yang asli
                      {' '}(<span className="font-semibold">{refScore}%</span> → <span className="font-semibold">{atsScore}%</span>).
                      Mau regenerate ulang, atau pakai profil aslimu langsung?
                    </p>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => generate(activeGen!)}
                        className="text-xs font-medium bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg px-2.5 py-1.5 transition-colors flex items-center gap-1.5 whitespace-nowrap">
                        <RefreshCw size={11} /> Regenerate lagi
                      </button>
                      <button
                        onClick={() => {
                          setGeneratedContent(profile)
                          upsert('cv', profile)
                          setAtsScore(typeof baseScore === 'number' ? baseScore : null)
                          showToast('Menggunakan profil asli sebagai CV', 'success')
                        }}
                        className="text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 rounded-lg px-2.5 py-1.5 transition-colors flex items-center gap-1.5 whitespace-nowrap">
                        <ChevronLeft size={11} /> Profil asli ({refScore}%)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
          <textarea
            value={generatedContent}
            onChange={e => setGeneratedContent(e.target.value)}
            onBlur={() => activeGen && upsert(activeGen, generatedContent)}
            rows={12}
            className="textarea text-xs font-mono"
          />
          {onSaveDocs && (
            <p className="text-xs text-green-600 flex items-center gap-1.5 mt-2">
              <CheckCircle size={12} /> Tersimpan ke lamaran ini
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── ANALYZE TAB ──────────────────────────────────────────────────────────────
function AnalyzeTab({ onJobAdded, onUpdateJob, profile, configuredKeys, onGoToProfile, onGoToSettings }: { onJobAdded: (job: Partial<JobApplication>) => Promise<JobApplication | null>; onUpdateJob: (id: string, updates: Partial<JobApplication>) => void; profile: string; configuredKeys: ConfiguredKeys; onGoToProfile: () => void; onGoToSettings: () => void }) {
  const hasGeminiKey = !!configuredKeys.gemini
  const [url, setUrl] = useState('')
  const [jobDesc, setJobDesc] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [location, setLocation] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetchLoading, setFetchLoading] = useState(false)
  const [imgLoading, setImgLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [docs, setDocs] = useState<AppDocument[]>([])  // generated docs for this job
  const [savedJobId, setSavedJobId] = useState<string | null>(null)  // history entry for this job
  const imgInputRef = useRef<HTMLInputElement>(null)

  // Create or update this job's history entry in the tracker (auto-save).
  const persist = async (matchScore: number, analysis: AnalysisResult | null) => {
    const payload: Partial<JobApplication> = {
      company: company || 'Unknown Company',
      role: role || 'Unknown Role',
      location: location || 'Unknown',
      url, jobDesc, status: 'saved', matchScore, analysis,
    }
    if (savedJobId) {
      onUpdateJob(savedJobId, payload)
    } else {
      const created = await onJobAdded(payload)
      if (created?.id) setSavedJobId(created.id)
    }
  }

  // A changed job description starts a fresh history entry on the next analyze.
  useEffect(() => { setSavedJobId(null); setDocs([]) }, [jobDesc])

  const fetchJobDesc = async () => {
    if (!url) return
    setFetchLoading(true)
    try {
      const res = await fetch('/api/fetch-job', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ url })
      })
      const data = await res.json()
      if (data.blocked) {
        showError(`${data.error}\n\n${data.detail}`)
      } else if (data.jobDesc) {
        if (data.jobDesc) setJobDesc(data.jobDesc)
        if (data.company) setCompany(data.company)
        if (data.role) setRole(data.role)
        if (data.location) setLocation(data.location)
        showToast('Berhasil fetch loker!', 'success')
      } else {
        showError('Gagal mengambil konten loker. Coba copy-paste deskripsi secara manual.')
      }
    } catch {
      showError('Gagal fetch. Periksa koneksi internet.')
    } finally {
      setFetchLoading(false)
    }
  }

  // Read a job-poster image and let Gemini vision extract the details.
  const extractFromImage = async (file: File) => {
    setImgLoading(true)
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const base64 = dataUrl.split(',')[1] || ''
      const res = await fetch('/api/extract-job', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ image: base64, mimeType: file.type }),
      })
      const data = await res.json()
      if (!res.ok) { showError(data.error || 'Gagal membaca gambar.'); return }
      if (data.jobDesc) setJobDesc(data.jobDesc)
      if (data.company) setCompany(data.company)
      if (data.role) setRole(data.role)
      if (data.location) setLocation(data.location)
      if (!data.jobDesc && !data.role) showError('Tidak ada info loker terbaca dari gambar ini.')
    } catch (e) {
      showError('Gagal membaca gambar. Coba paste teksnya manual.')
    } finally {
      setImgLoading(false)
    }
  }

  const analyze = async () => {
    if (!jobDesc) return
    setLoading(true)
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ jobDesc, profile })
      })
      const data = await res.json()
      if (!res.ok) {
        showError(data.error || 'Analysis failed.')
        return
      }
      setResult(data)
      // Auto-save to history (Job Tracker) — fire-and-forget, don't block UI.
      persist(data.score || 0, {
        strengths: data.strengths, gaps: data.gaps,
        recommendation: data.recommendation, salaryRange: data.salaryRange,
        keywordsToAdd: data.keywordsToAdd,
      }).catch(() => { /* non-critical */ })
    } catch (e) {
      showError('Analysis failed. Periksa koneksi atau API key.')
    } finally {
      setLoading(false)
    }
  }

  // Persist generated docs to the tracked job once it exists; keep them locally
  // either way so the merge in DocumentGenerator stays correct.
  const handleSaveDocs = (next: AppDocument[]) => {
    setDocs(next)
    if (savedJobId) onUpdateJob(savedJobId, { documents: next })
  }

  const saveToTracker = async () => {
    if (!jobDesc) return
    await persist(result?.score || 0, result)
  }

  return (
    <div className="space-y-4">
      {!hasGeminiKey && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
          <Key size={16} className="flex-shrink-0" />
          <span>Gemini API key belum diset. Fitur AI tidak akan jalan tanpa key.</span>
          <button onClick={onGoToSettings} className="ml-auto btn-primary text-xs whitespace-nowrap">Buka Settings</button>
        </div>
      )}
      {!profile && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>CV/profile belum diupload. AI akan bekerja tanpa konteks Anda.</span>
          <button onClick={onGoToProfile} className="ml-auto btn-primary text-xs whitespace-nowrap">Upload CV</button>
        </div>
      )}
    <div className="grid grid-cols-12 gap-6">
      {/* Input Panel */}
      <div className="col-span-12 lg:col-span-5 space-y-4">
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Job Input</h2>

          {/* URL Fetch */}
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-500 block mb-1">Job URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://linkedin.com/jobs/..."
                className="input text-sm flex-1"
              />
              <button
                onClick={fetchJobDesc}
                disabled={fetchLoading || !url}
                className="btn-secondary text-sm px-3 whitespace-nowrap"
              >
                {fetchLoading ? '...' : 'Fetch'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <AlertCircle size={10} /> Some sites block auto-fetch. Paste manually if needed.
            </p>
          </div>

          {/* Image poster → AI extract (for image-only vacancies, e.g. Instagram) */}
          <div className="mb-4">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <span className="h-px bg-gray-200 flex-1" /> atau loker berupa gambar <span className="h-px bg-gray-200 flex-1" />
            </div>
            <input
              ref={imgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) extractFromImage(f); e.target.value = '' }}
            />
            <button
              onClick={() => imgInputRef.current?.click()}
              disabled={imgLoading}
              className="btn-secondary text-sm w-full flex items-center justify-center gap-2"
            >
              {imgLoading
                ? (<><div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" /> Membaca gambar dengan AI...</>)
                : (<><Upload size={14} /> Upload gambar poster loker</>)}
            </button>
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <Sparkles size={10} /> AI membaca poster (JPG/PNG) lalu mengisi otomatis company, role & deskripsi.
            </p>
          </div>

          {/* Manual Fields */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Company *</label>
              <input value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Meratus Group" className="input text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Role *</label>
              <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Business Analyst" className="input text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-500 block mb-1">Location</label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Jakarta, Indonesia" className="input text-sm" />
            </div>
          </div>

          {/* Job Desc */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Job Description *</label>
            <textarea
              value={jobDesc}
              onChange={e => setJobDesc(e.target.value)}
              placeholder="Paste job description here..."
              rows={8}
              className="textarea text-sm"
            />
          </div>

          <div className="flex gap-2 mt-3">
            <button onClick={analyze} disabled={loading || !jobDesc} className="btn-primary text-sm flex-1">
              {loading ? 'Analyzing...' : 'Analyze Match'}
            </button>
            <button onClick={saveToTracker} disabled={!jobDesc} className="btn-secondary text-sm">
              Simpan
            </button>
          </div>
          {savedJobId && (
            <p className="text-xs text-green-600 flex items-center gap-1.5 mt-2">
              <CheckCircle size={12} /> Tersimpan otomatis ke Job Tracker
            </p>
          )}
        </div>
      </div>

      {/* Results Panel */}
      <div className="col-span-12 lg:col-span-7 space-y-4">
        {/* Analysis Result */}
        {result && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Analysis Result</h3>
              <span className={`text-2xl font-bold ${(result.score ?? 0) >= 75 ? 'text-green-600' : (result.score ?? 0) >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>
                {result.score ?? 0}%
              </span>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
              <div
                className={`h-3 rounded-full ${(result.score ?? 0) >= 75 ? 'bg-green-500' : (result.score ?? 0) >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${result.score ?? 0}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs font-medium text-green-700 mb-2">Strengths</p>
                <ul className="space-y-1">
                  {result.strengths?.map((s: string, i: number) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                      <CheckCircle size={10} className="text-green-500 mt-0.5 flex-shrink-0" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-red-600 mb-2">Gaps</p>
                <ul className="space-y-1">
                  {result.gaps?.map((g: string, i: number) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                      <XCircle size={10} className="text-red-400 mt-0.5 flex-shrink-0" /> {g}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {result.recommendation && (
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-blue-800">{result.recommendation}</p>
              </div>
            )}

            {result.salaryRange && (
              <div className="mt-3 bg-green-50 rounded-lg p-3">
                <p className="text-xs font-medium text-green-700">Estimated Salary Range</p>
                <p className="text-sm font-bold text-green-800">{result.salaryRange}</p>
              </div>
            )}
          </div>
        )}

        {/* Generate Buttons */}
        <DocumentGenerator
          jobDesc={jobDesc}
          company={company}
          role={role}
          location={location}
          profile={profile}
          savedDocs={docs}
          onSaveDocs={handleSaveDocs}
          analysis={result}
          baseScore={result?.score}
        />
      </div>
    </div>
    </div>
  )
}

// ── SEARCH TAB (auto-search loker via Adzuna) ─────────────────────────────────
interface JobHit {
  externalId: string
  title: string
  company: string
  location: string
  description: string
  url: string
  salary?: string
  created?: string
  category?: string
}

const STOPWORDS = new Set('and the for with you your our are was were have has had will can dari dan yang untuk pada dengan atau ini itu akan dalam adalah para juga tidak lebih dari job role work team based more from about into over than then they them their'.split(/\s+/))

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || []).filter(t => !STOPWORDS.has(t))
}

// Fast, free relevance estimate so we can sort hits by fit without an AI call
// per result. The precise ATS score still comes from the Analyze tab.
function computeMatch(profile: string, hit: JobHit): number | null {
  const pset = new Set(tokenize(profile))
  if (pset.size === 0) return null
  // Weight the title heavily — it's the strongest signal of role fit.
  const jset = new Set(tokenize(`${hit.title} ${hit.title} ${hit.title} ${hit.description}`))
  if (jset.size === 0) return 0
  let overlap = 0
  jset.forEach(t => { if (pset.has(t)) overlap++ })
  return Math.max(8, Math.min(98, Math.round((overlap / jset.size) * 100 * 1.6)))
}

function SearchTab({ onJobAdded, jobs, profile, configuredKeys, onGoToSettings, onGoToTracker }: {
  onJobAdded: (job: Partial<JobApplication>) => Promise<JobApplication | null>
  jobs: JobApplication[]
  profile: string
  configuredKeys: ConfiguredKeys
  onGoToSettings: () => void
  onGoToTracker: () => void
}) {
  const hasAdzuna = !!configuredKeys.adzuna
  const [what, setWhat] = useState('')
  const [where, setWhere] = useState('')
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<JobHit[] | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  // Rank hits by the local match estimate (highest fit first).
  const ranked = useMemo(() => {
    if (!hits) return []
    return hits
      .map(h => ({ hit: h, score: computeMatch(profile, h) }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  }, [hits, profile])

  // A hit already in the tracker (matched by URL) shouldn't offer "Simpan" again.
  const savedUrls = useMemo(() => new Set(jobs.map(j => j.url).filter(Boolean)), [jobs])

  const search = async () => {
    if (!what.trim()) return
    setLoading(true)
    setHits(null)
    try {
      const res = await fetch('/api/search-jobs', {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({ what, where }),
      })
      const data = await res.json()
      if (!res.ok) { showError(data.error || 'Pencarian gagal.'); return }
      setHits(data.jobs || [])
    } catch {
      showError('Pencarian gagal. Periksa koneksi.')
    } finally {
      setLoading(false)
    }
  }

  const saveHit = async (hit: JobHit) => {
    setSavingId(hit.externalId)
    const created = await onJobAdded({
      company: hit.company, role: hit.title, location: hit.location,
      url: hit.url, jobDesc: hit.description || hit.title, status: 'saved', matchScore: 0,
    })
    if (created) {
      setSavedIds(prev => new Set(prev).add(hit.externalId))
      showSuccess('Loker disimpan ke Job Tracker. Buka Analyze untuk skor ATS akuratnya.', 'Tersimpan')
    } else {
      showError('Gagal menyimpan loker.')
    }
    setSavingId(null)
  }

  return (
    <div className="space-y-4">
      {!hasAdzuna && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <Search size={16} className="flex-shrink-0" />
          <span>Adzuna belum diset. Masukkan App ID & App Key (gratis) di Settings untuk mulai mencari loker.</span>
          <button onClick={onGoToSettings} className="ml-auto btn-primary text-xs whitespace-nowrap">Buka Settings</button>
        </div>
      )}
      {!profile && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>Upload CV/profile dulu supaya hasil pencarian bisa diurutkan berdasarkan kecocokan dengan kamu.</span>
        </div>
      )}

      {/* Search bar */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-gray-500 block mb-1">Kata kunci / posisi *</label>
            <input value={what} onChange={e => setWhat(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="mis. Business Analyst" className="input text-sm" />
          </div>
          <div className="md:col-span-5">
            <label className="text-xs font-medium text-gray-500 block mb-1">Lokasi (opsional)</label>
            <input value={where} onChange={e => setWhere(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="mis. Jakarta" className="input text-sm" />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button onClick={search} disabled={loading || !what.trim() || !hasAdzuna} className="btn-primary text-sm w-full">
              {loading ? '...' : (<><Search size={14} /> Cari</>)}
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="card text-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Mencari loker yang cocok...</p>
        </div>
      )}

      {hits && !loading && hits.length === 0 && (
        <div className="card text-center py-12">
          <Search size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Tidak ada loker ditemukan. Coba kata kunci lain.</p>
        </div>
      )}

      {ranked.length > 0 && !loading && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{ranked.length} loker · diurutkan berdasarkan kecocokan dengan profilmu</p>
          {ranked.map(({ hit, score }) => {
            const already = savedIds.has(hit.externalId) || (!!hit.url && savedUrls.has(hit.url))
            return (
              <div key={hit.externalId} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {score !== null && (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${score >= 70 ? 'bg-green-50 text-green-700' : score >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                          {score}% cocok
                        </span>
                      )}
                      {hit.salary && <span className="text-xs text-green-600 font-medium">{hit.salary}</span>}
                    </div>
                    <p className="font-semibold text-gray-900 text-sm">{hit.title}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                      <Building2 size={12} className="text-gray-400" /> {hit.company}
                      {hit.location && <><span className="text-gray-300">·</span><MapPin size={12} className="text-gray-400" /> {hit.location}</>}
                    </p>
                    {hit.description && <p className="text-xs text-gray-500 mt-2 line-clamp-2">{hit.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                  {hit.url && (
                    <a href={hit.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                      Lihat loker <ExternalLink size={11} />
                    </a>
                  )}
                  {already ? (
                    <button onClick={onGoToTracker} className="ml-auto text-xs text-green-600 flex items-center gap-1 hover:underline">
                      <CheckCircle size={13} /> Tersimpan — lihat di Tracker
                    </button>
                  ) : (
                    <button onClick={() => saveHit(hit)} disabled={savingId === hit.externalId}
                      className="ml-auto btn-secondary text-xs flex items-center gap-1">
                      {savingId === hit.externalId ? '...' : (<><Plus size={13} /> Simpan ke Tracker</>)}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── SALARY BAR ───────────────────────────────────────────────────────────────
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function stripMd(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold** → plain
    .replace(/\*(.*?)\*/g, '$1')        // *italic* → plain
    .replace(/#{1,3}\s*/g, '')          // ## headers
    .trim()
}

function fmtSalary(n: number, currency = 'IDR'): string {
  if (currency === 'IDR') {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}jt`
    return n.toLocaleString('id-ID')
  }
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
  return n.toLocaleString()
}

const CONFIDENCE_CONFIG = {
  high:   { label: 'Data real · akurat',     bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500' },
  medium: { label: 'Data sebagian real',      bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  low:    { label: 'Estimasi AI · tidak pasti', bg: 'bg-red-100', text: 'text-red-600',    dot: 'bg-red-400'   },
}

function SalaryInsightCard({ prep }: { prep: PrepResult }) {
  const {
    salaryMin, salaryMax, salarySafe, salaryCurrency: cur = 'IDR',
    salaryRange, salarySource, salaryConfidence = 'low',
    salaryDataYear, salarySources, salaryNegotiationTips,
  } = prep

  const hasBar = salaryMin != null && salaryMax != null && salaryMax > salaryMin
  const safePct = hasBar && salarySafe != null
    ? Math.max(5, Math.min(95, ((salarySafe - salaryMin!) / (salaryMax! - salaryMin!)) * 100))
    : null
  const conf = CONFIDENCE_CONFIG[salaryConfidence]

  return (
    <div className="space-y-3">
      {/* Confidence badge */}
      <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${conf.bg} ${conf.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
        {conf.label}
        {salaryDataYear && <span className="font-normal opacity-70">· {salaryDataYear}</span>}
      </div>

      {/* Gross disclaimer */}
      <p className="text-[10px] text-gray-400 italic">Semua angka = gaji kotor (gross) sebelum pajak & potongan.</p>

      {/* Bar */}
      {hasBar ? (
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>{cur} {fmtSalary(salaryMin!, cur)}</span>
            <span className="text-gray-600 font-medium text-[11px]">Market Range</span>
            <span>{cur} {fmtSalary(salaryMax!, cur)}</span>
          </div>
          <div className="relative h-3 bg-gray-100 rounded-full overflow-visible">
            <div className="absolute left-0 top-0 h-3 rounded-full bg-gradient-to-r from-green-300 via-emerald-400 to-green-500" style={{ width: '100%' }} />
            {safePct != null && (
              <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${safePct}%` }}>
                <div className="w-5 h-5 -ml-2.5 rounded-full bg-white border-[3px] border-primary shadow-md flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                </div>
              </div>
            )}
          </div>
          {safePct != null && salarySafe != null && (
            <div className="relative mt-1" style={{ paddingLeft: `${Math.max(0, Math.min(70, safePct - 8))}%` }}>
              <div className="inline-flex items-center gap-1 bg-primary text-white text-xs font-semibold px-2.5 py-1 rounded-lg shadow-sm whitespace-nowrap">
                <Target size={10} /> Nilai aman: {cur} {salarySafe.toLocaleString('id-ID')}
              </div>
            </div>
          )}
        </div>
      ) : salaryRange ? (
        <div className="bg-green-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Market Range</p>
          <p className="font-bold text-green-700 text-sm">{salaryRange}</p>
        </div>
      ) : null}

      {/* Per-source breakdown */}
      {salarySources && salarySources.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Sumber data:</p>
          {salarySources.map((s, i) => (
            <div key={i} className="flex items-start justify-between gap-2 text-[11px]">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium shrink-0">{s.label}</a>
              ) : (
                <span className="text-gray-500 font-medium shrink-0">{s.label}</span>
              )}
              <span className="text-gray-600 text-right">{s.figure}</span>
            </div>
          ))}
        </div>
      )}

      {/* Source note */}
      {salarySource && (
        <p className="text-[10px] text-gray-400 italic leading-relaxed border-t border-gray-100 pt-2">{salarySource}</p>
      )}

      {/* Verify links */}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {[
          { label: 'Glassdoor Salary', q: 'glassdoor salary' },
          { label: 'LinkedIn Salary', q: 'linkedin salary insights' },
          { label: 'JobStreet', q: 'jobstreet salary' },
          { label: 'Indeed Salary', q: 'indeed salary' },
        ].map(link => (
          <a key={link.label}
            href={`https://www.google.com/search?q=${encodeURIComponent(`${prep.industry ?? ''} ${link.q}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-primary border border-gray-200 rounded px-1.5 py-0.5 hover:border-primary transition-colors">
            {link.label} ↗
          </a>
        ))}
      </div>

      {/* Negotiation Tips */}
      {salaryNegotiationTips?.length && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-600 mb-2">Tips Negosiasi</p>
          <ul className="space-y-1.5">
            {salaryNegotiationTips.map((t, i) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                <Star size={10} className="text-yellow-400 mt-0.5 shrink-0" /> {stripMd(t)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── CARI LOKER TAB (wrapper: keyword search + best-fit finder) ───────────────
function CariLokerTab({ jobs, profile, configuredKeys, onJobAdded, onGoToSettings, onGoToProfile, onGoToTracker }: {
  jobs: JobApplication[]
  profile: string
  configuredKeys: ConfiguredKeys
  onJobAdded: (data: Partial<JobApplication>) => Promise<JobApplication | null>
  onGoToSettings: () => void
  onGoToProfile: () => void
  onGoToTracker: () => void
}) {
  const [mode, setMode] = useState<'search' | 'bestfit'>('search')
  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="inline-flex bg-gray-100 rounded-xl p-1 gap-1">
        <button onClick={() => setMode('search')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'search' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}>
          <Search size={14} className="inline mr-1.5 -mt-0.5" /> Cari Loker
        </button>
        <button onClick={() => setMode('bestfit')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'bestfit' ? 'bg-white shadow text-primary' : 'text-gray-500 hover:text-gray-700'}`}>
          <Sparkles size={14} className="inline mr-1.5 -mt-0.5" /> Best Fit Finder
        </button>
      </div>

      {mode === 'search' && (
        <SearchTab onJobAdded={onJobAdded} jobs={jobs} profile={profile} configuredKeys={configuredKeys}
          onGoToSettings={onGoToSettings} onGoToTracker={onGoToTracker} />
      )}
      {mode === 'bestfit' && (
        <BestFitTab profile={profile} configuredKeys={configuredKeys} onJobAdded={onJobAdded}
          onGoToSettings={onGoToSettings} onGoToProfile={onGoToProfile} />
      )}
    </div>
  )
}

interface FitRanking {
  index: number
  score: number
  strengths: string[]
  gaps: string[]
  verdict: string
  job: { title: string; company: string; description: string; location: string; url: string }
}

function BestFitTab({ profile, configuredKeys, onJobAdded, onGoToSettings, onGoToProfile }: {
  profile: string
  configuredKeys: ConfiguredKeys
  onJobAdded: (data: Partial<JobApplication>) => Promise<JobApplication | null>
  onGoToSettings: () => void
  onGoToProfile: () => void
}) {
  const [urls, setUrls] = useState<string[]>(['', ''])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ rankings: FitRanking[]; total: number } | null>(null)
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  const [savedIdxs, setSavedIdxs] = useState<Set<number>>(new Set())

  const validUrls = urls.map(u => u.trim()).filter(u => u.startsWith('http'))

  const setUrl = (i: number, val: string) => setUrls(prev => prev.map((u, idx) => idx === i ? val : u))
  const addUrl = () => setUrls(prev => [...prev, ''])
  const removeUrl = (i: number) => setUrls(prev => prev.filter((_, idx) => idx !== i))

  const analyze = async () => {
    if (validUrls.length === 0) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/compare-jobs', {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify({ urls: validUrls, profile }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { showError(data.hint || data.error || 'Gagal menganalisis.'); return }
      setResult(data)
    } catch {
      showError('Gagal menghubungi server. Periksa koneksi.')
    } finally {
      setLoading(false)
    }
  }

  const saveJob = async (r: FitRanking, idx: number) => {
    setSavingIdx(idx)
    const created = await onJobAdded({
      company: r.job.company, role: r.job.title, location: r.job.location,
      url: r.job.url, jobDesc: r.job.description, status: 'saved', matchScore: r.score,
    })
    if (created) {
      setSavedIdxs(prev => new Set(prev).add(idx))
      showToast(`"${r.job.title}" disimpan ke Tracker`, 'success')
    } else {
      showError('Gagal menyimpan.')
    }
    setSavingIdx(null)
  }

  const RANK_BADGE = ['🥇', '🥈', '🥉']
  const scoreColor = (s: number) => s >= 70 ? 'text-green-600 bg-green-50 border-green-200'
    : s >= 50 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-500 bg-red-50 border-red-200'

  return (
    <div className="space-y-5">
      {!configuredKeys.gemini && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
          <Key size={16} className="shrink-0" />
          <span>Gemini API key belum diset — fitur ini butuh AI.</span>
          <button onClick={onGoToSettings} className="ml-auto btn-primary text-xs whitespace-nowrap">Buka Settings</button>
        </div>
      )}
      {!profile && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0" />
          <span>Upload CV/profil dulu — AI butuh profilmu untuk menilai kecocokan.</span>
          <button onClick={onGoToProfile} className="ml-auto btn-primary text-xs whitespace-nowrap">Upload CV</button>
        </div>
      )}

      {/* URL inputs */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-1">Best Fit Finder</h2>
        <p className="text-xs text-gray-500 mb-4">
          Paste link-link loker yang mau dibandingkan. AI akan fetch setiap job, lalu ranking mana yang paling cocok dengan profilmu.
        </p>

        <div className="space-y-2 mb-3">
          {urls.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              <Linkedin size={14} className={`shrink-0 ${u.startsWith('http') ? 'text-blue-500' : 'text-gray-300'}`} />
              <input
                value={u}
                onChange={e => setUrl(i, e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyze()}
                placeholder={`https://linkedin.com/jobs/view/…  (loker ${i + 1})`}
                className={`input text-sm flex-1 ${u.startsWith('http') ? 'border-blue-200 bg-blue-50/20' : ''}`}
              />
              {urls.length > 1 && (
                <button onClick={() => removeUrl(i)}
                  className="shrink-0 text-gray-300 hover:text-red-400 transition-colors p-1">
                  <XCircle size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button onClick={addUrl} disabled={urls.length >= 10}
            className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-40">
            <Plus size={13} /> Tambah loker lain
          </button>
          <button
            onClick={analyze}
            disabled={loading || validUrls.length === 0 || !profile || !configuredKeys.gemini}
            className="btn-primary text-sm">
            {loading
              ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block mr-1.5" />Menganalisis…</>
              : <><Sparkles size={14} className="inline mr-1.5 -mt-0.5" />Bandingkan {validUrls.length > 0 ? `${validUrls.length} Loker` : ''}</>
            }
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="card text-center py-14">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="font-medium text-gray-500 text-sm">Mengambil data {validUrls.length} loker dari LinkedIn…</p>
          <p className="text-xs text-gray-400 mt-1">AI akan rank setiap posisi terhadap profilmu</p>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-gray-700">
            {result.rankings.length} loker dibandingkan · diurutkan dari yang paling cocok
          </p>

          {result.rankings.map((r, i) => (
            <div key={i} className={`card overflow-hidden border-2 transition-all ${i === 0 ? 'border-primary/30 bg-purple-50/20' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="text-2xl leading-none shrink-0">{RANK_BADGE[i] ?? `#${i + 1}`}</span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-semibold text-gray-900 text-sm">{r.job.title}</p>
                      {i === 0 && <span className="text-[10px] font-bold px-2 py-0.5 bg-primary text-white rounded-full">Posisi terkuatmu</span>}
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                      {r.job.company && <><Building2 size={11} />{r.job.company}</>}
                      {r.job.location && <><MapPin size={11} />{r.job.location}</>}
                    </p>

                    <p className="text-xs text-gray-600 mt-2 italic">"{r.verdict}"</p>

                    <div className="flex flex-wrap gap-4 mt-3">
                      <div>
                        <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-1.5">Keunggulanmu</p>
                        <div className="flex flex-wrap gap-1">
                          {r.strengths.map((s, si) => (
                            <span key={si} className="text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">{s}</span>
                          ))}
                        </div>
                      </div>
                      {r.gaps.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wide mb-1.5">Yang kurang</p>
                          <div className="flex flex-wrap gap-1">
                            {r.gaps.map((g, gi) => (
                              <span key={gi} className="text-[11px] bg-red-50 text-red-600 border border-red-200 rounded-full px-2 py-0.5">{g}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3 shrink-0">
                  <div className={`text-center border rounded-xl px-3 py-2 ${scoreColor(r.score)}`}>
                    <p className="text-xl font-bold leading-none">{r.score}</p>
                    <p className="text-[10px] font-medium mt-0.5">fit score</p>
                  </div>
                  <div className="flex gap-2">
                    {r.job.url && (
                      <a href={r.job.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-gray-500 hover:text-primary border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors">
                        <ExternalLink size={12} className="inline mr-1 -mt-0.5" /> Lihat
                      </a>
                    )}
                    <button
                      onClick={() => saveJob(r, i)}
                      disabled={savingIdx === i || savedIdxs.has(i)}
                      className={`text-xs rounded-lg px-2.5 py-1.5 transition-colors border ${savedIdxs.has(i) ? 'bg-green-50 border-green-200 text-green-700' : 'btn-primary border-transparent'}`}>
                      {savingIdx === i ? '…'
                        : savedIdxs.has(i) ? <><CheckCircle size={11} className="inline mr-1 -mt-0.5" />Tersimpan</>
                        : <><BookmarkPlus size={11} className="inline mr-1 -mt-0.5" />Simpan</>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${r.score >= 70 ? 'bg-green-500' : r.score >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ width: `${r.score}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {result && !loading && result.rankings.length === 0 && (
        <div className="card text-center py-12">
          <Search size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-gray-400">Gagal mengambil data dari URL yang diberikan.</p>
          <p className="text-xs text-gray-300 mt-1">Pastikan link valid dan bisa dibuka secara publik (tanpa login).</p>
        </div>
      )}
    </div>
  )
}

// ── PREP TAB ─────────────────────────────────────────────────────────────────
const CATEGORY_STYLE: Record<string, { bg: string; text: string }> = {
  'Behavioral':            { bg: 'bg-blue-100',   text: 'text-blue-700' },
  'Technical':             { bg: 'bg-cyan-100',   text: 'text-cyan-700' },
  'Situational':           { bg: 'bg-amber-100',  text: 'text-amber-700' },
  'Motivational':          { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Case / Problem-Solving':{ bg: 'bg-orange-100', text: 'text-orange-700' },
  'Culture Fit':           { bg: 'bg-pink-100',   text: 'text-pink-700' },
  'Role-Specific':         { bg: 'bg-green-100',  text: 'text-green-700' },
}

const SOURCE_ICON: Record<string, string> = {
  'Glassdoor Interview Reviews': '⭐',
  'LinkedIn Interview Insights':  '💼',
  'Job Description':              '📄',
  'STAR Framework':               '🎯',
  'Company Values':               '🏢',
  'Industry Standard':            '📊',
  'Case Interview Pattern':       '🧩',
  'Role Competency Model':        '🔑',
}

function QuestionCard({ q, index }: { q: { question: string; suggestedAnswer: string; tip?: string; category?: string; sources?: { label: string; url?: string; detail: string }[]; sourceNote?: string }; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const catStyle = CATEGORY_STYLE[q.category ?? ''] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
  const hasSources = !!(q.sources?.length || q.sourceNote)
  const hasRealUrls = q.sources?.some(s => !!s.url)

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Question header */}
      <div className="p-4">
        <div className="flex items-start gap-2.5 mb-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs shrink-0 mt-0.5 font-semibold">{index + 1}</span>
          <div className="min-w-0 flex-1">
            {q.category && (
              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mb-1.5 ${catStyle.bg} ${catStyle.text}`}>{q.category}</span>
            )}
            <p className="font-semibold text-gray-800 text-sm leading-snug">{q.question}</p>
          </div>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed pl-8">{stripMd(q.suggestedAnswer)}</p>
        {q.tip && (
          <p className="text-xs text-primary mt-2 pl-8 italic flex items-center gap-1">
            <Lightbulb size={10} /> {stripMd(q.tip)}
          </p>
        )}
      </div>

      {/* Source attribution footer */}
      {hasSources && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors w-full text-left"
          >
            <span>{q.sources?.slice(0, 3).map(s => SOURCE_ICON[s.label] ?? '📌').join(' ')}</span>
            <span className="truncate">{q.sources?.map(s => s.label).join(' · ')}</span>
            {hasRealUrls && <span className="text-[10px] text-green-600 font-semibold ml-1 shrink-0">· live</span>}
            <ChevronRight size={12} className={`ml-auto transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} />
          </button>

          {expanded && (
            <div className="mt-3 space-y-3">
              {q.sourceNote && (
                <p className="text-[11px] text-gray-600 italic border-l-2 border-primary/40 pl-2.5 leading-relaxed">{q.sourceNote}</p>
              )}
              {q.sources?.map((s, si) => (
                <div key={si} className="flex items-start gap-2">
                  <span className="text-sm shrink-0 mt-0.5">{SOURCE_ICON[s.label] ?? '📌'}</span>
                  <div className="min-w-0 flex-1">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] font-semibold text-primary hover:underline break-all">{s.label}</a>
                    ) : (
                      <span className="text-[11px] font-semibold text-gray-700">{s.label}</span>
                    )}
                    <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PrepResults({ data, role = '', company = '' }: { data: PrepResult; role?: string; company?: string }) {
  // Always use Google search redirects — direct Glassdoor/LinkedIn URLs need a
  // company ID we don't have, and both sites require login for full content.
  const gSearch = (extra: string) =>
    `https://www.google.com/search?q=${encodeURIComponent(`${company} ${role} ${extra}`)}`

  const researchLinks = [
    {
      label: 'Glassdoor',
      icon: '⭐',
      url: gSearch('interview questions glassdoor'),
      color: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100',
    },
    {
      label: 'LinkedIn',
      icon: '💼',
      url: gSearch('interview questions linkedin'),
      color: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100',
    },
    {
      label: 'Indeed',
      icon: '📋',
      url: gSearch('interview questions indeed'),
      color: 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100',
    },
    {
      label: 'Interview experience',
      icon: '🔍',
      url: gSearch('interview experience tips'),
      color: 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100',
    },
  ]

  return (
    <div className="space-y-4">
      {/* Research quick links */}
      <div className="card py-3 px-4">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Riset manual · buka langsung di:</p>
        <div className="flex flex-wrap gap-2">
          {researchLinks.map(link => (
            <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${link.color}`}>
              <span>{link.icon}</span> {link.label}
            </a>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Link di atas membuka Google Search → pilih hasil Glassdoor/LinkedIn dan login sendiri. Glassdoor tidak punya API publik, jadi integrasi otomatis tidak memungkinkan.</p>
      </div>

      {/* Live search sources (when Gemini grounding found real URLs) */}
      {!!data._searchSources?.length && (
        <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <span className="text-base shrink-0">🌐</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-green-800 mb-1">Sumber live dari Google Search yang digunakan AI:</p>
            <div className="flex flex-col gap-1">
              {data._searchSources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-green-700 hover:text-green-900 hover:underline truncate">
                  {s.title || s.url}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm">
            <Briefcase size={15} className="text-primary" /> Company Overview
          </h3>
          <div className="space-y-2 text-sm text-gray-600">
            {data.companyOverview && <p className="text-xs leading-relaxed">{data.companyOverview}</p>}
            {data.industry && <p className="text-xs"><span className="font-medium text-gray-700">Industry:</span> {data.industry}</p>}
            {data.companySize && <p className="text-xs"><span className="font-medium text-gray-700">Size:</span> {data.companySize}</p>}
          </div>
        </div>
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm">
            <BarChart2 size={15} className="text-primary" /> Salary Insights
          </h3>
          <SalaryInsightCard prep={data} />
        </div>
        <div className="card">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm">
            <Lightbulb size={15} className="text-primary" /> Key Tips
          </h3>
          <ul className="space-y-2">
            {data.keyTips?.map((tip: string, i: number) => (
              <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                <CheckCircle size={11} className="text-primary mt-0.5 shrink-0" /> {stripMd(tip)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Brain size={16} className="text-primary" /> Top {data.questions?.length ?? 10} Interview Questions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.questions?.map((q: any, i: number) => (
            <QuestionCard key={i} q={q} index={i} />
          ))}
        </div>
      </div>

      {!!data.questionsToRecruiter?.length && (
        <div className="card border-emerald-200">
          <h3 className="font-semibold text-emerald-800 mb-4 flex items-center gap-2">
            <Send size={16} className="text-emerald-600" /> Pertanyaan yang Bisa Kamu Tanyakan ke Recruiter
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.questionsToRecruiter.map((q: any, i: number) => (
              <div key={i} className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                <p className="font-medium text-gray-800 text-sm mb-1.5 flex items-start gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-xs shrink-0 mt-0.5">{i+1}</span>
                  {q.question}
                </p>
                {q.context && <p className="text-xs text-emerald-700 italic pl-7 flex items-center gap-1"><Lightbulb size={10} /> {stripMd(q.context)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PrepTab({ jobs, profile, configuredKeys, onUpdateJob, onGoToProfile, onGoToSettings }: { jobs: JobApplication[]; profile: string; configuredKeys: ConfiguredKeys; onUpdateJob: (id: string, updates: Partial<JobApplication>) => void; onGoToProfile: () => void; onGoToSettings: () => void }) {
  const hasGeminiKey = !!configuredKeys.gemini
  const [selectedJobId, setSelectedJobId] = useState('')
  const [loading, setLoading] = useState(false)
  const [prepData, setPrepData] = useState<PrepResult | null>(null)

  const selectedJob = jobs.find(j => j.id === selectedJobId)

  useEffect(() => {
    setPrepData(selectedJob?.prep ?? null)
  }, [selectedJobId, selectedJob?.prep])

  const generatePrep = async () => {
    if (!selectedJob) return
    setLoading(true)
    setPrepData(null)
    const slowTimer = setTimeout(() => {
      showToast('Interview prep sedang digenerate... mohon tunggu sebentar', 'info', 7000)
    }, 10000)
    try {
      const res = await fetch('/api/prep', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ jobDesc: selectedJob.jobDesc, company: selectedJob.company, role: selectedJob.role, profile })
      })
      const data = await res.json()
      clearTimeout(slowTimer)
      if (!res.ok) { showError(data.error || 'Failed to generate prep.'); return }
      setPrepData(data)
      onUpdateJob(selectedJob.id, { prep: data })
      showToast('Interview Prep selesai dibuat!', 'success')
    } catch {
      clearTimeout(slowTimer)
      showError('Failed to generate prep. Periksa koneksi atau API key.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {!hasGeminiKey && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
          <Key size={16} className="shrink-0" />
          <span>Gemini API key belum diset. Fitur AI tidak akan jalan tanpa key.</span>
          <button onClick={onGoToSettings} className="ml-auto btn-primary text-xs whitespace-nowrap">Buka Settings</button>
        </div>
      )}
      {!profile && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0" />
          <span>CV/profile belum diupload. AI akan bekerja tanpa konteks kamu.</span>
          <button onClick={onGoToProfile} className="ml-auto btn-primary text-xs whitespace-nowrap">Upload CV</button>
        </div>
      )}

      <div className="flex gap-4" style={{ minHeight: '72vh' }}>
        {/* ── Left: job picker ── */}
        <div className="w-72 shrink-0 flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">
            Loker kamu · {jobs.length}
          </p>
          {jobs.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-10 text-center flex-1">
              <Briefcase size={28} className="text-gray-200 mb-2" />
              <p className="text-xs text-gray-400">Belum ada loker.<br />Tambah dulu di Job Tracker.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1">
              {jobs.map(j => {
                const cfg = STATUS_CONFIG[j.status as keyof typeof STATUS_CONFIG]
                const active = selectedJobId === j.id
                return (
                  <button
                    key={j.id}
                    onClick={() => setSelectedJobId(j.id)}
                    className={`w-full text-left rounded-xl border px-3 py-3 transition-all ${
                      active
                        ? 'border-primary bg-purple-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-gray-900 truncate leading-tight">{decodeHtml(j.role)}</p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{decodeHtml(j.company)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 mt-0.5">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg?.color}`}>{cfg?.label}</span>
                        {j.prep && (
                          <span className="text-[10px] text-emerald-600 flex items-center gap-0.5 font-medium">
                            <CheckCircle size={9} /> Prep ready
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Right: prep panel ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto">
          {!selectedJob ? (
            <div className="card flex-1 flex flex-col items-center justify-center text-center py-20">
              <Brain size={52} className="text-gray-200 mb-4" />
              <p className="font-semibold text-gray-400 text-lg">Pilih loker dulu</p>
              <p className="text-sm text-gray-300 mt-1 max-w-xs">Klik salah satu loker di sebelah kiri untuk melihat atau membuat materi interview prep</p>
            </div>
          ) : (
            <>
              <div className="card flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{decodeHtml(selectedJob.role)}</p>
                  <p className="text-sm text-gray-500 truncate">{decodeHtml(selectedJob.company)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {prepData && !loading && (
                    <p className="text-xs text-gray-400 flex items-center gap-1 hidden md:flex">
                      <CheckCircle size={11} className="text-emerald-500" /> Tersimpan
                    </p>
                  )}
                  <button onClick={generatePrep} disabled={loading} className="btn-primary text-sm whitespace-nowrap">
                    {loading ? 'Generating...' : prepData ? 'Generate Ulang' : 'Generate Prep'}
                  </button>
                </div>
              </div>

              {loading && (
                <div className="card flex-1 flex flex-col items-center justify-center py-16">
                  <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mb-4" />
                  <p className="text-gray-500 text-sm">Menyiapkan materi interview kamu...</p>
                  <p className="text-gray-400 text-xs mt-1">Biasanya butuh 15–30 detik</p>
                </div>
              )}

              {!loading && !prepData && (
                <div className="card flex-1 flex flex-col items-center justify-center py-16 text-center">
                  <Sparkles size={40} className="text-gray-200 mb-4" />
                  <p className="font-semibold text-gray-400">Belum ada prep untuk loker ini</p>
                  <p className="text-sm text-gray-300 mt-1 mb-5 max-w-xs">Klik Generate Prep di atas — AI akan riset perusahaan, buat 10 pertanyaan interview beserta jawaban, dan tips negosiasi gaji.</p>
                  <button onClick={generatePrep} disabled={loading} className="btn-primary text-sm">
                    Generate Prep Sekarang
                  </button>
                </div>
              )}

              {!loading && prepData && <PrepResults data={prepData} role={selectedJob.role} company={selectedJob.company} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── PROFILE TAB ───────────────────────────────────────────────────────────────
const PROFILE_SECTIONS: { key: string; label: string; re: RegExp | null; icon: typeof User; tip: string }[] = [
  { key: 'contact',    label: 'Kontak',                 re: null, icon: Mail,          tip: 'Tambahkan email & LinkedIn agar recruiter mudah menghubungi.' },
  { key: 'summary',    label: 'Ringkasan',              re: /summary|ringkasan|profil|objective|tentang/i,                          icon: User,          tip: 'Tulis ringkasan 2–3 kalimat: peran, tahun pengalaman, dan keunggulanmu.' },
  { key: 'experience', label: 'Pengalaman Kerja',       re: /experience|pengalaman|work history|employment|riwayat pekerjaan/i,      icon: Briefcase,     tip: 'Rinci pengalaman kerja dengan pencapaian + angka (mis. "98% resolution rate").' },
  { key: 'education',  label: 'Pendidikan',             re: /education|pendidikan|university|universitas|degree|sarjana|gelar|s1|s2/i, icon: GraduationCap, tip: 'Cantumkan pendidikan / gelar terakhir beserta institusinya.' },
  { key: 'skills',     label: 'Keahlian',               re: /skills|keahlian|kompetensi|technical|kemampuan|tools/i,                  icon: Sparkles,      tip: 'Daftar skill teknis & tools yang relevan dengan target role.' },
  { key: 'extras',     label: 'Sertifikasi / Prestasi', re: /certification|sertifik|achievement|prestasi|award|license|lisensi|penghargaan/i, icon: Award,  tip: 'Tambahkan sertifikasi, lisensi, atau penghargaan yang kamu punya.' },
  { key: 'projects',   label: 'Proyek',                 re: /project|proyek|portofolio|portfolio|personal project|volunteer/i,                   icon: FolderOpen, tip: 'Tambahkan seksi PROJECTS di CV-mu dengan nama, tech stack, dan deskripsi singkat.' },
]

function analyzeProfile(text: string) {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]
  const linkedin = text.match(/linkedin\.com\/[\w/-]+/i)?.[0]
  const phone = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/)?.[0]
  const sections = PROFILE_SECTIONS.map(s => ({
    ...s,
    present: s.key === 'contact' ? !!(email || linkedin || phone) : s.re!.test(text),
  }))
  const present = sections.filter(s => s.present).length
  const score = Math.round((present / sections.length) * 100)
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return { sections, present, total: sections.length, score, words, chars: text.length, email, linkedin, phone }
}

// ── CV PARSER ────────────────────────────────────────────────────────────────
// Heuristic parser: turns raw CV text into structured profile fields by
// detecting section headings (PROFESSIONAL SUMMARY, EXPERIENCE, EDUCATION, …).
const CV_HEADERS: { key: string; re: RegExp }[] = [
  { key: 'summary',        re: /^(professional\s+summary|summary|profile|profil|ringkasan|objective|about(\s+me)?|tentang(\s+saya)?)\s*:?\s*$/i },
  { key: 'experience',     re: /^(work\s+|professional\s+|relevant\s+)?(experience|employment|work\s+history)\s*:?\s*$|^(pengalaman(\s+kerja)?|riwayat\s+pekerjaan)\s*:?\s*$/i },
  { key: 'education',      re: /^(education|academic(\s+background)?)\s*:?\s*$|^(pendidikan|riwayat\s+pendidikan)\s*:?\s*$/i },
  { key: 'skills',         re: /^((technical|core|key)\s+)?skills?\s*:?\s*$|^(keahlian|kompetensi|kemampuan)\s*:?\s*$/i },
  { key: 'certifications', re: /^((key|professional)\s+)?(certifications?|licenses?)\s*:?\s*$|^(sertifik\w*|lisensi)\s*:?\s*$/i },
  { key: 'languages',      re: /^languages?\s*:?\s*$|^bahasa\s*:?\s*$/i },
  { key: 'achievements',   re: /^(achievements?|awards?)\s*:?\s*$|^(prestasi|penghargaan)\s*:?\s*$/i },
  { key: 'projects',       re: /^(projects?|personal\s+projects?|proyek|portofolio|portfolio|volunteer)\s*:?\s*$/i },
]

const DATE_RE = /(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\w*\b[^\n]*\b(?:19|20)\d{2}\b)|(?:\b(?:19|20)\d{2}\b\s*[–-])|(?:\b(?:present|sekarang|ongoing|now)\b)/i

function splitList(s: string): string[] {
  return s
    .split(/[·••\n,;]|(?:\s[|/]\s)/)
    .map(x => x.replace(/^[-–•\s]+/, '').trim())
    .filter(x => x.length > 1 && x.length < 70)
    .filter((v, i, a) => a.findIndex(o => o.toLowerCase() === v.toLowerCase()) === i)
    .slice(0, 40)
}

// For "·"-delimited lists (certs, languages): join wrapped lines first so a PDF
// line-break in the middle of an entry doesn't split it, then split on bullets only.
function splitBullets(lines: string[]): string[] {
  return lines.join(' ')
    .split(/\s*[·••|;]\s*/)
    .map(x => x.replace(/^[-–•\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter(x => x.length > 1 && x.length < 90)
    .filter((v, i, a) => a.findIndex(o => o.toLowerCase() === v.toLowerCase()) === i)
    .slice(0, 40)
}

interface ParsedCv {
  name: string
  headline: string
  location?: string
  email?: string
  linkedin?: string
  phone?: string
  summary?: string
  experience: string[]
  education: string[]
  skills: string[]
  certifications: string[]
  languages: string[]
  projects: string[]
  hasSections: boolean
}

function parseCv(text: string): ParsedCv {
  const lines = text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim())
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]
  const linkedin = text.match(/linkedin\.com\/[\w/-]+/i)?.[0]
  const phone = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/)?.[0]

  const headerKey = (l: string): string | null => {
    if (!l || l.length > 40) return null
    for (const h of CV_HEADERS) if (h.re.test(l)) return h.key
    return null
  }

  // Intro = everything before the first detected section heading.
  let firstHeader = lines.findIndex(l => headerKey(l))
  if (firstHeader === -1) firstHeader = Math.min(lines.length, 4)
  const intro = lines.slice(0, firstHeader).filter(Boolean)
  const name = intro[0] || ''
  const headline = intro.slice(1).find(l => !/@|linkedin\.com|\+?\d{6}/i.test(l)) || ''
  const locLine = intro.find(l => /[A-Z][a-z]+,\s*[A-Z][a-z]+/.test(l))
  const location = locLine?.match(/([A-Z][\w.]+(?:\s[A-Z][\w.]+)*,\s*[A-Z][\w ]+?)(?:\s*[·|]|\s+\S+@|$)/)?.[1]?.trim()

  // Collect each section's lines.
  const sec: Record<string, string[]> = {}
  let cur: string | null = null
  for (let i = firstHeader; i < lines.length; i++) {
    const k = headerKey(lines[i])
    if (k) { cur = k; sec[k] = sec[k] || []; continue }
    if (cur && lines[i]) sec[cur].push(lines[i])
  }

  // Languages may be embedded as a line inside the skills block.
  let skillLines = sec.skills || []
  const langLines: string[] = sec.languages ? [...sec.languages] : []
  const li = skillLines.findIndex(l => /(native|proficiency|fluent|mother tongue|bahasa ibu|natif)/i.test(l))
  if (li >= 0) {
    langLines.push(skillLines[li])
    const drop = new Set<number>([li])
    // also drop a short wrapped continuation (e.g. "New Zealand" after "...Auckland,")
    const next = skillLines[li + 1]
    if (next && !next.includes(',') && next.split(' ').length <= 3) drop.add(li + 1)
    skillLines = skillLines.filter((_, i) => !drop.has(i))
  }
  const langText = langLines.join(' · ').replace(/^languages?\s*/i, '').replace(/open to relocation[^·]*/i, '')

  const certs = [...(sec.certifications || []), ...(sec.achievements || [])]

  return {
    name, headline, location, email, linkedin, phone,
    summary: sec.summary?.join(' ').trim() || undefined,
    experience: sec.experience || [],
    education: sec.education || [],
    skills: splitList(skillLines.join(', ')).filter(s => !/^(new zealand|auckland)$/i.test(s) && !/relocation/i.test(s)),
    certifications: splitBullets(certs),
    languages: splitBullets([langText]),
    projects: sec.projects || [],
    hasSections: Object.keys(sec).length > 0,
  }
}

// Render a section's lines with a small hierarchy: role title (line before a
// date) bold, company/date line as muted subtitle, the rest as body/bullets.
function EntryLines({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-1">
      {lines.map((l, i) => {
        const isDate = DATE_RE.test(l)
        const isBullet = /^[•\-–*]/.test(l)
        const isTitle = !isDate && !isBullet && DATE_RE.test(lines[i + 1] || '') && l.length < 90
        if (isTitle) return <p key={i} className="text-sm font-semibold text-gray-900 pt-4 first:pt-0">{l}</p>
        if (isDate) return <p key={i} className="text-xs font-medium text-gray-500">{l}</p>
        if (isBullet) return <p key={i} className="text-sm text-gray-600 leading-relaxed pl-4 -indent-3">{l.replace(/^[•\-–*]\s*/, '• ')}</p>
        return <p key={i} className="text-sm text-gray-600 leading-relaxed">{l}</p>
      })}
    </div>
  )
}

// Shape of the AI-parsed profile (from /api/parse-profile).
interface StructuredProfile {
  name?: string; headline?: string; location?: string
  email?: string; linkedin?: string; phone?: string; summary?: string
  experience?: { title?: string; company?: string; period?: string; location?: string; bullets?: string[] }[]
  education?: { school?: string; degree?: string; period?: string }[]
  projects?: { name?: string; description?: string; tech?: string[]; period?: string; url?: string }[]
  skills?: string[]; languages?: string[]; certifications?: string[]
}

// One experience/education entry with a timeline dot.
function EntryCard({ title, subtitle, bullets }: { title?: string; subtitle?: string; bullets?: string[] }) {
  return (
    <div className="relative pl-5 pb-1">
      <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-accent ring-4 ring-teal-50" />
      <span className="absolute left-[4px] top-4 bottom-0 w-px bg-gray-100" />
      {title && <p className="font-semibold text-gray-900 text-sm">{title}</p>}
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      {bullets && bullets.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {bullets.map((b, i) => (
            <li key={i} className="text-sm text-gray-600 leading-relaxed flex gap-2">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Chips({ items, tone = 'slate' }: { items: string[]; tone?: 'slate' | 'teal' }) {
  const cls = tone === 'teal' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-700'
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((s, i) => <span key={i} className={`text-xs rounded-full px-3 py-1.5 ${cls}`}>{s}</span>)}
    </div>
  )
}

function ProfileBlock({ icon, title, action, children, className = '' }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <span className="text-primary">{icon}</span> {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function ProfileTab({ profile, onSave, structured, onStructured, hasGeminiKey, onGoToSettings }: {
  profile: string
  onSave: (text: string) => void
  structured: StructuredProfile | null
  onStructured: (s: StructuredProfile | null) => void
  hasGeminiKey: boolean
  onGoToSettings: () => void
}) {
  const [text, setText] = useState(profile)
  const [saved, setSaved] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [aiParsing, setAiParsing] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit'>(profile ? 'view' : 'edit')
  const triedRef = useRef(false)

  // Ask Gemini to structure the CV. With no arg it parses the stored profile.
  const parseWithAI = useCallback(async (body?: string) => {
    setAiParsing(true)
    try {
      const res = await fetch('/api/parse-profile', {
        method: 'POST', headers: JSON_HEADERS,
        body: JSON.stringify(body ? { text: body } : {}),
      })
      const data = await res.json()
      if (res.ok && data.structured) onStructured(data.structured)
      else showError(data.error || 'Gagal menyusun profil dengan AI.')
    } catch {
      showError('Gagal menyusun profil dengan AI. Periksa koneksi.')
    }
    setAiParsing(false)
  }, [onStructured])

  // Auto-structure once on open if a key exists and we don't have it cached yet.
  useEffect(() => {
    if (!triedRef.current && hasGeminiKey && profile && !structured) {
      triedRef.current = true
      parseWithAI()
    }
  }, [hasGeminiKey, profile, structured, parseWithAI])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.name.toLowerCase().endsWith('.pdf')) {
      setParsing(true)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/parse-pdf', { method: 'POST', body: form })
        const data = await res.json()
        if (data.text) {
          setText(data.text)
        } else {
          showError('Gagal membaca PDF: ' + (data.error || 'unknown error'))
        }
      } catch {
        showError('Gagal membaca PDF. Coba paste teks secara manual.')
      }
      setParsing(false)
    } else {
      const reader = new FileReader()
      reader.onload = (ev) => setText(ev.target?.result as string ?? '')
      reader.readAsText(file)
    }
    e.target.value = ''
  }

  const handleSave = () => {
    onSave(text)
    setSaved(true)
    setMode('view')
    triedRef.current = true
    if (hasGeminiKey) parseWithAI(text)   // re-structure the edited CV
    setTimeout(() => setSaved(false), 2000)
  }

  const cv = useMemo(() => parseCv(text), [text])
  const ins = useMemo(() => analyzeProfile(text), [text])
  const dirty = text !== profile

  // Prefer AI-structured data; fall back to the heuristic parse.
  const s = structured || {}
  const display = {
    location: s.location || cv.location,
    email: s.email || cv.email,
    linkedin: s.linkedin || cv.linkedin,
    phone: s.phone || cv.phone,
    summary: s.summary || cv.summary,
    skills: (s.skills?.length ? s.skills : cv.skills) || [],
    languages: (s.languages?.length ? s.languages : cv.languages) || [],
    certifications: (s.certifications?.length ? s.certifications : cv.certifications) || [],
  }
  const expEntries = s.experience?.length ? s.experience : null
  const eduEntries = s.education?.length ? s.education : null
  const projEntries = s.projects?.length ? s.projects : null
  const name = s.name || cv.name || 'Profil kamu'
  const headline = s.headline || cv.headline || 'Lengkapi CV-mu agar AI bisa membantu lebih maksimal'

  const strength =
    ins.score >= 100 ? { label: 'Lengkap', text: 'text-green-700', bar: 'bg-green-500' } :
    ins.score >= 67  ? { label: 'Bagus',   text: 'text-blue-700',  bar: 'bg-blue-500' } :
    ins.score >= 34  ? { label: 'Cukup',   text: 'text-amber-700', bar: 'bg-amber-500' } :
                       { label: 'Perlu dilengkapi', text: 'text-red-600', bar: 'bg-red-500' }

  const missing = ins.sections.filter(s => !s.present)

  // Completeness card — shown in both modes.
  const completenessCard = (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-semibold text-gray-900">Kelengkapan Profil</h3>
        <span className={`text-sm font-bold ${strength.text}`}>{strength.label}</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">{ins.present} dari {ins.total} bagian terisi</p>
      <div className="w-full bg-gray-100 rounded-full h-2.5 mb-5 overflow-hidden">
        <div className={`h-2.5 rounded-full transition-all ${strength.bar}`} style={{ width: `${ins.score}%` }} />
      </div>
      <div className="space-y-2">
        {ins.sections.map(s => (
          <div key={s.key} className="flex items-center gap-3">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${s.present ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
              <s.icon size={14} />
            </div>
            <span className={`text-sm flex-1 ${s.present ? 'text-gray-700' : 'text-gray-400'}`}>{s.label}</span>
            {s.present ? <CheckCircle size={16} className="text-green-500" /> : <XCircle size={16} className="text-gray-300" />}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* ── Profile header ─────────────────────────────────────────────── */}
      <div className="card overflow-hidden p-0">
        {/* Banner */}
        <div className="relative h-32 bg-brand-gradient">
          <div className="absolute inset-0 opacity-[0.15]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }} />
          <div className="absolute -top-12 -right-8 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute bottom-0 left-1/4 w-44 h-44 rounded-full bg-accent/25 blur-2xl" />
          {profile && (
            <button
              onClick={() => setMode(mode === 'view' ? 'edit' : 'view')}
              className="absolute top-4 right-4 inline-flex items-center gap-1.5 text-sm font-medium text-white bg-white/15 hover:bg-white/25 backdrop-blur px-3.5 py-2 rounded-lg border border-white/20 transition-colors"
            >
              {mode === 'view' ? <><Pencil size={14} /> Edit profil</> : <>Lihat profil</>}
            </button>
          )}
        </div>

        {/* Identity */}
        <div className="relative z-10 px-6 pb-6">
          <div className="-mt-14 mb-4">
            <div className="w-24 h-24 rounded-2xl bg-accent-gradient text-white flex items-center justify-center text-4xl font-bold shadow-lg ring-4 ring-white">
              {name.charAt(0).toUpperCase()}
            </div>
          </div>

          <h2 className="font-bold text-gray-900 text-2xl">{name}</h2>
          <p className="text-sm text-gray-600 mt-1">{headline}</p>

          {/* Contact row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-gray-500">
            {display.location && <span className="inline-flex items-center gap-1.5"><MapPin size={13} className="text-gray-400" /> {display.location}</span>}
            {display.email && <span className="inline-flex items-center gap-1.5"><Mail size={13} className="text-gray-400" /> {display.email}</span>}
            {display.linkedin && (
              <a href={`https://${display.linkedin.replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                <Linkedin size={13} className="text-gray-400" /> {display.linkedin}
              </a>
            )}
            {display.phone && <span className="inline-flex items-center gap-1.5"><Phone size={13} className="text-gray-400" /> {display.phone.trim()}</span>}
          </div>

          {/* Stat pills */}
          {profile && (
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
              {display.skills.length > 0 && <span className="badge-blue">{display.skills.length} Keahlian</span>}
              {display.certifications.length > 0 && <span className="badge-green">{display.certifications.length} Sertifikasi</span>}
              {display.languages.length > 0 && <span className="badge-gray">{display.languages.length} Bahasa</span>}
              {(projEntries?.length || cv.projects.length > 0) && <span className="badge-blue">{projEntries?.length || cv.projects.length} Proyek</span>}
              <span className={`badge-${ins.score >= 100 ? 'green' : ins.score >= 67 ? 'blue' : ins.score >= 34 ? 'yellow' : 'red'}`}>
                {ins.score}% lengkap
              </span>

              {/* AI control */}
              <span className="ml-auto flex items-center gap-2">
                {aiParsing ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-primary font-medium">
                    <span className="animate-spin w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full" /> Menyusun dengan AI…
                  </span>
                ) : structured ? (
                  <span className="inline-flex items-center gap-2 text-xs text-gray-400">
                    <span className="inline-flex items-center gap-1 text-accent font-medium"><Sparkles size={12} /> Disusun AI</span>
                    <button onClick={() => parseWithAI(text)} className="hover:text-primary underline">Susun ulang</button>
                  </span>
                ) : hasGeminiKey ? (
                  <button onClick={() => parseWithAI(text)} className="btn-accent text-xs"><Sparkles size={13} /> Susun dengan AI</button>
                ) : (
                  <button onClick={onGoToSettings} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-primary">
                    <Sparkles size={12} /> Set Gemini key untuk hasil rapi
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {mode === 'view' ? (
        // ── VIEW: structured profile parsed from the CV ──────────────────
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 space-y-6">
            {display.summary && (
              <ProfileBlock icon={<User size={16} />} title="Tentang">
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{display.summary}</p>
              </ProfileBlock>
            )}
            {(expEntries || cv.experience.length > 0) && (
              <ProfileBlock icon={<Briefcase size={16} />} title="Pengalaman Kerja">
                {expEntries ? (
                  <div className="space-y-5">
                    {expEntries.map((e, i) => (
                      <EntryCard key={i} title={e.title} subtitle={[e.company, e.period, e.location].filter(Boolean).join(' · ')} bullets={e.bullets} />
                    ))}
                  </div>
                ) : <EntryLines lines={cv.experience} />}
              </ProfileBlock>
            )}
            {(eduEntries || cv.education.length > 0) && (
              <ProfileBlock icon={<GraduationCap size={16} />} title="Pendidikan">
                {eduEntries ? (
                  <div className="space-y-5">
                    {eduEntries.map((e, i) => (
                      <EntryCard key={i} title={e.school} subtitle={[e.degree, e.period].filter(Boolean).join(' · ')} />
                    ))}
                  </div>
                ) : <EntryLines lines={cv.education} />}
              </ProfileBlock>
            )}
            {(projEntries || cv.projects.length > 0) && (
              <ProfileBlock icon={<FolderOpen size={16} />} title="Proyek">
                {projEntries ? (
                  <div className="space-y-5">
                    {projEntries.map((p, i) => (
                      <div key={i} className="relative pl-5 pb-1">
                        <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-blue-50" />
                        <span className="absolute left-[4px] top-4 bottom-0 w-px bg-gray-100" />
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-gray-900 text-sm">{p.name}</p>
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-primary hover:text-accent transition-colors">
                              <Link size={13} />
                            </a>
                          )}
                        </div>
                        {p.period && <p className="text-xs text-gray-400 mt-0.5">{p.period}</p>}
                        {p.description && <p className="text-sm text-gray-600 mt-1 leading-relaxed">{p.description}</p>}
                        {p.tech && p.tech.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {p.tech.map((t, j) => <span key={j} className="text-xs bg-blue-50 text-primary px-2 py-0.5 rounded-full">{t}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <EntryLines lines={cv.projects} />}
              </ProfileBlock>
            )}
            {!cv.hasSections && !structured && (
              <ProfileBlock icon={<FileText size={16} />} title="Isi CV">
                <p className="text-xs text-amber-600 mb-3 flex items-start gap-1.5">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  Belum bisa memilah CV jadi bagian. Tambahkan judul seksi seperti <b>EXPERIENCE</b>, <b>EDUCATION</b>, <b>SKILLS</b> di CV-mu — atau klik <b>Susun dengan AI</b> di atas.
                </p>
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-sans max-h-80 overflow-y-auto scrollbar-thin">{text}</pre>
              </ProfileBlock>
            )}
          </div>
          <div className="col-span-12 lg:col-span-4 space-y-6">
            {display.skills.length > 0 && (
              <ProfileBlock icon={<Sparkles size={16} />} title="Keahlian">
                <Chips items={display.skills} tone="teal" />
              </ProfileBlock>
            )}
            {display.languages.length > 0 && (
              <ProfileBlock icon={<Languages size={16} />} title="Bahasa">
                <Chips items={display.languages} />
              </ProfileBlock>
            )}
            {display.certifications.length > 0 && (
              <ProfileBlock icon={<Award size={16} />} title="Sertifikasi & Prestasi">
                <ul className="space-y-2">
                  {display.certifications.map((c, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                      <BadgeCheck size={15} className="text-accent mt-0.5 shrink-0" /> {c}
                    </li>
                  ))}
                </ul>
              </ProfileBlock>
            )}
            {completenessCard}
          </div>
        </div>
      ) : (
        // ── EDIT: upload + raw text ──────────────────────────────────────
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-7 space-y-4">
            <div className="card">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center">
                  <FileText size={18} className="text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">CV / Profil</h3>
                  <p className="text-xs text-gray-500">Upload CV — datanya otomatis dipilah jadi profil di bawah</p>
                </div>
              </div>

              {/* LinkedIn import guide */}
              <div className="mb-4 rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-sky-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#0A66C2] flex items-center justify-center shrink-0">
                    <Linkedin size={18} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900 mb-0.5">Import dari LinkedIn</p>
                    <p className="text-xs text-gray-500 mb-3">LinkedIn memblokir akses otomatis, tapi kamu bisa export PDF profil sendiri lalu upload di sini — semua data terisi otomatis.</p>
                    <ol className="space-y-1.5 mb-3">
                      {([
                        <span key={0}>Buka profil LinkedIn-mu di browser</span>,
                        <span key={1}>Klik <b>More</b> (···) → <b>Save to PDF</b></span>,
                        <span key={2}>Upload PDF yang didownload ke kolom di bawah</span>,
                      ] as React.ReactNode[]).map((step, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-600 list-none">
                          <span className="w-4 h-4 rounded-full bg-[#0A66C2] text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="text-[11px] text-gray-400 italic">Atau copy-paste teks profil LinkedIn langsung ke kotak teks di bawah.</p>
                  </div>
                </div>
              </div>

              {/* File Upload */}
              <label className={`flex items-center gap-3 border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors mb-4 ${parsing ? 'border-primary/40 bg-blue-50' : 'border-gray-200 hover:border-primary/40 hover:bg-slate-50'}`}>
                {parsing
                  ? <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                  : <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center"><Upload size={18} className="text-gray-500" /></div>
                }
                <div>
                  <p className="text-sm font-medium text-gray-700">{parsing ? 'Membaca PDF...' : 'Upload CV atau LinkedIn PDF'}</p>
                  <p className="text-xs text-gray-400">Mendukung .pdf dan .txt — atau paste teks di bawah</p>
                </div>
                <input type="file" accept=".pdf,.txt" onChange={handleFile} className="hidden" disabled={parsing} />
              </label>

              {/* Text area */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Isi CV / Profil (teks)</label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={`Paste isi CV kamu di sini...\n\nTips: beri judul seksi (EXPERIENCE, EDUCATION, SKILLS) agar otomatis terpilah.`}
                  rows={16}
                  className="textarea text-sm font-mono scrollbar-thin"
                />
              </div>

              <div className="flex items-center justify-between mt-3">
                <p className="text-xs text-gray-400">≈ {ins.words} kata · {ins.chars} karakter</p>
                <button onClick={handleSave} disabled={!text.trim() || !dirty} className="btn-primary text-sm">
                  {saved ? '✓ Tersimpan!' : dirty ? 'Simpan Profile' : 'Tersimpan'}
                </button>
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-5 space-y-6">
            {completenessCard}
            {/* Suggestions */}
            <div className="card bg-gradient-to-br from-blue-50/60 to-teal-50/60 border-blue-100/60">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                  <Lightbulb size={16} className="text-amber-500" />
                </div>
                <h3 className="font-semibold text-gray-900">{missing.length ? 'Saran perbaikan' : 'Profil kamu mantap! 🎉'}</h3>
              </div>
              {missing.length ? (
                <ul className="space-y-2.5">
                  {missing.map(s => (
                    <li key={s.key} className="text-xs text-gray-600 flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      <span><span className="font-medium text-gray-800">{s.label}:</span> {s.tip}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-600">Semua bagian penting sudah ada. AI bisa memberi hasil paling akurat dengan profil selengkap ini.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── SETTINGS TAB ──────────────────────────────────────────────────────────────
function SettingsTab({ configuredKeys, onSaved }: { configuredKeys: ConfiguredKeys; onSaved: () => void }) {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [show, setShow] = useState<Record<string, boolean>>({})
  const [importing, setImporting] = useState(false)
  // Adzuna needs two values; stored server-side as a single "app_id:app_key" string.
  const [adzunaId, setAdzunaId] = useState('')
  const [adzunaKey, setAdzunaKey] = useState('')
  const [adzunaSaved, setAdzunaSaved] = useState(false)

  const saveAdzuna = async () => {
    if (!adzunaId.trim() || !adzunaKey.trim()) return
    await fetch('/api/keys', {
      method: 'PUT', headers: JSON_HEADERS,
      body: JSON.stringify({ adzuna: `${adzunaId.trim()}:${adzunaKey.trim()}` }),
    })
    setAdzunaId(''); setAdzunaKey('')
    setAdzunaSaved(true)
    onSaved()
    setTimeout(() => setAdzunaSaved(false), 2000)
  }

  const removeAdzuna = async () => {
    await fetch('/api/keys', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ adzuna: '' }) })
    onSaved()
  }

  // Only send providers the user actually typed a value for, so blank fields
  // don't wipe an already-saved key.
  const handleSave = async () => {
    const payload: Record<string, string> = {}
    for (const [id, val] of Object.entries(keys)) {
      if (val?.trim()) payload[id] = val.trim()
    }
    if (Object.keys(payload).length === 0) return
    await fetch('/api/keys', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(payload) })
    setKeys({})
    setSaved(true)
    onSaved()
    setTimeout(() => setSaved(false), 2000)
  }

  const removeKey = async (id: string) => {
    await fetch('/api/keys', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ [id]: '' }) })
    onSaved()
  }

  // One-time migration of old browser localStorage data into the account.
  const importLocalData = async () => {
    setImporting(true)
    try {
      const applications = JSON.parse(localStorage.getItem('job-applications') || '[]')
      const profile = localStorage.getItem('user-profile') || ''
      const apiKeys = JSON.parse(localStorage.getItem('api-keys') || '{}')
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ applications, profile, apiKeys }),
      })
      const data = await res.json()
      if (res.ok) {
        showSuccess(`Imported: ${data.summary.applications} applications, profile ${data.summary.profile ? 'yes' : 'no'}, ${data.summary.keys} API key(s). Reload to see them.`, 'Impor berhasil')
        onSaved()
      } else {
        showError(data.error || 'Import failed.')
      }
    } catch {
      showError('Import failed — no valid local data found.')
    }
    setImporting(false)
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
            <Key size={16} className="text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">API Keys</h2>
            <p className="text-xs text-gray-500">Disimpan terenkripsi di server, terikat ke akun kamu.</p>
          </div>
        </div>

        <div className="space-y-4 mt-4">
          {API_PROVIDERS.map(p => (
            <div key={p.id}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  {p.label}
                  {p.active
                    ? <span className="badge-green text-[10px]">aktif</span>
                    : <span className="badge-gray text-[10px]">segera hadir</span>}
                  {configuredKeys[p.id]
                    ? <span className="badge-blue text-[10px]">tersimpan</span>
                    : null}
                </label>
                <a href={p.helpUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                  Ambil key <ExternalLink size={10} />
                </a>
              </div>
              <div className="flex gap-2">
                <input
                  type={show[p.id] ? 'text' : 'password'}
                  value={keys[p.id] || ''}
                  onChange={e => setKeys({ ...keys, [p.id]: e.target.value })}
                  placeholder={configuredKeys[p.id] ? '•••••••• (key tersimpan — isi untuk ganti)' : p.placeholder}
                  className="input text-sm flex-1 font-mono"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShow({ ...show, [p.id]: !show[p.id] })}
                  className="btn-secondary text-xs px-3 whitespace-nowrap"
                >
                  {show[p.id] ? 'Sembunyikan' : 'Lihat'}
                </button>
                {configuredKeys[p.id] && (
                  <button
                    type="button"
                    onClick={() => removeKey(p.id)}
                    className="btn-secondary text-xs px-3 whitespace-nowrap text-red-600"
                  >
                    Hapus
                  </button>
                )}
              </div>
              {!p.active && (
                <p className="text-xs text-gray-400 mt-1">Tersimpan untuk nanti — backend belum memakai provider ini.</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-5">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <AlertCircle size={11} /> Key dienkripsi (AES-256-GCM) sebelum disimpan dan tidak pernah dikirim balik ke browser.
          </p>
          <button onClick={handleSave} className="btn-primary text-sm">
            {saved ? '✓ Tersimpan!' : 'Simpan Keys'}
          </button>
        </div>
      </div>

      {/* Adzuna — job search source */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
              <Search size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                Adzuna — Cari Loker
                {configuredKeys.adzuna
                  ? <span className="badge-green text-[10px]">tersimpan</span>
                  : <span className="badge-gray text-[10px]">belum diset</span>}
              </h2>
              <p className="text-xs text-gray-500">Sumber lowongan untuk tab Cari Loker. Gratis untuk pemakaian pribadi.</p>
            </div>
          </div>
          <a href="https://developer.adzuna.com/" target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 whitespace-nowrap">
            Daftar & ambil key <ExternalLink size={10} />
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">App ID</label>
            <input value={adzunaId} onChange={e => setAdzunaId(e.target.value)} autoComplete="off"
              placeholder={configuredKeys.adzuna ? '•••••• (tersimpan — isi untuk ganti)' : 'mis. a1b2c3d4'} className="input text-sm font-mono" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">App Key</label>
            <input type="password" value={adzunaKey} onChange={e => setAdzunaKey(e.target.value)} autoComplete="off"
              placeholder={configuredKeys.adzuna ? '••••••••' : 'mis. 0f1e2d3c...'} className="input text-sm font-mono" />
          </div>
        </div>
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <AlertCircle size={11} /> Kedua nilai dienkripsi sebelum disimpan.
          </p>
          <div className="flex items-center gap-2">
            {configuredKeys.adzuna && (
              <button onClick={removeAdzuna} className="btn-secondary text-xs px-3 text-red-600">Hapus</button>
            )}
            <button onClick={saveAdzuna} disabled={!adzunaId.trim() || !adzunaKey.trim()} className="btn-primary text-sm">
              {adzunaSaved ? '✓ Tersimpan!' : 'Simpan Adzuna'}
            </button>
          </div>
        </div>
      </div>

      {/* One-time data import */}
      <div className="card">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
            <Upload size={16} className="text-amber-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900">Import data lama</h2>
            <p className="text-xs text-gray-500">Pindahkan aplikasi, profile, dan key dari penyimpanan browser lama ke akun ini. Jalankan sekali saja.</p>
          </div>
        </div>
        <button onClick={importLocalData} disabled={importing} className="btn-secondary text-sm">
          {importing ? 'Importing...' : 'Import dari browser ini'}
        </button>
      </div>
    </div>
  )
}
