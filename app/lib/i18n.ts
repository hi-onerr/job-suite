export type Lang = 'id' | 'en'

export const TAB_LABELS: Record<string, { id: string; en: string }> = {
  tracker:    { id: 'Job Tracker',        en: 'Job Tracker' },
  search:     { id: 'Cari Loker',         en: 'Find Jobs' },
  compare:    { id: 'Best Fit Finder',    en: 'Best Fit Finder' },
  analyze:    { id: 'Analyze & Generate', en: 'Analyze & Generate' },
  prep:       { id: 'Interview Prep',     en: 'Interview Prep' },
  worldclock: { id: 'World Clock',        en: 'World Clock' },
  profile:    { id: 'My Profile',         en: 'My Profile' },
  settings:   { id: 'Settings',           en: 'Settings' },
}

export const TAB_SUBTITLES: Record<string, { id: string; en: string }> = {
  tracker:    { id: 'Pantau semua lamaranmu di satu tempat',                           en: 'Track all your applications in one place' },
  search:     { id: 'Temukan lowongan yang cocok & simpan sekali klik',                en: 'Find matching jobs & save with one click' },
  compare:    { id: 'Bandingkan beberapa loker & ranking yang paling cocok denganmu', en: 'Compare multiple jobs & rank the best fit for you' },
  analyze:    { id: 'Cek kecocokan & buat dokumen lamaran dengan AI',                  en: 'Check fit & generate application docs with AI' },
  prep:       { id: 'Riset perusahaan & latihan pertanyaan interview',                 en: 'Research companies & practice interview questions' },
  worldclock: { id: 'Jam kerja global — waktu terbaik apply loker luar negeri',        en: 'Global hours — best time to apply for jobs abroad' },
  profile:    { id: 'CV & profil yang dipakai AI sebagai konteks',                     en: 'CV & profile used by AI as context' },
  settings:   { id: 'API key & impor data',                                            en: 'API keys & data import' },
}

const ui = {
  id: {
    addJob: 'Tambah Lowongan',
    accounts: 'Akun',
    addAccount: 'Tambah akun lain',
    signOut: 'Keluar',
    loading: 'Memuat data kamu...',
    darkMode: 'Mode gelap',
    lightMode: 'Mode terang',
    // settings menu
    settings: 'Pengaturan',
    appearance: 'Tampilan',
    appearanceDesc: 'Dark mode & tema warna',
    language: 'Bahasa',
    languageDesc: 'Ganti bahasa tampilan',
    apiKeys: 'API Keys',
    apiKeysDesc: 'Gemini, Groq, dan provider AI lainnya',
    adzunaTitle: 'Adzuna — Cari Loker',
    adzunaDesc: 'Integrasi sumber lowongan kerja',
    passwordTitle: 'Ganti Password',
    setPasswordTitle: 'Set Password',
    passwordDesc: 'Ubah password login akun email',
    setPasswordDesc: 'Tambahkan login tanpa Google',
    importTitle: 'Import Data Lama',
    importDesc: 'Migrasi data dari penyimpanan browser',
    passwordActive: 'aktif',
    saved: 'tersimpan',
    notSet: 'belum diset',
    // new settings
    exportTitle: 'Export Data',
    exportDesc: 'Download semua lamaranmu sebagai CSV atau JSON',
    aiModelTitle: 'Model AI Default',
    aiModelDesc: 'Pilih Gemini, Groq, atau otomatis',
    deleteAccountTitle: 'Hapus Akun',
    deleteAccountDesc: 'Hapus akun dan semua datamu secara permanen',
    mfaTitle: 'Autentikasi Dua Faktor',
    mfaDesc: 'Keamanan tambahan saat login',
    mfaActive: 'aktif',
    mfaInactive: 'nonaktif',
  },
  en: {
    addJob: 'Add Job',
    accounts: 'Accounts',
    addAccount: 'Add another account',
    signOut: 'Sign out',
    loading: 'Loading your data...',
    darkMode: 'Dark mode',
    lightMode: 'Light mode',
    // settings menu
    settings: 'Settings',
    appearance: 'Appearance',
    appearanceDesc: 'Dark mode & color theme',
    language: 'Language',
    languageDesc: 'Change display language',
    apiKeys: 'API Keys',
    apiKeysDesc: 'Gemini, Groq, and other AI providers',
    adzunaTitle: 'Adzuna — Find Jobs',
    adzunaDesc: 'Job search source integration',
    passwordTitle: 'Change Password',
    setPasswordTitle: 'Set Password',
    passwordDesc: 'Change your email login password',
    setPasswordDesc: 'Add password login alongside Google',
    importTitle: 'Import Old Data',
    importDesc: 'Migrate data from browser storage',
    passwordActive: 'active',
    saved: 'saved',
    notSet: 'not set',
    // new settings
    exportTitle: 'Export Data',
    exportDesc: 'Download all your applications as CSV or JSON',
    aiModelTitle: 'Default AI Model',
    aiModelDesc: 'Choose Gemini, Groq, or automatic',
    deleteAccountTitle: 'Delete Account',
    deleteAccountDesc: 'Permanently delete your account and all data',
    mfaTitle: 'Two-Factor Authentication',
    mfaDesc: 'Extra security on login',
    mfaActive: 'active',
    mfaInactive: 'inactive',
  },
} as const

export type UiKey = keyof typeof ui.id

export function t(lang: Lang, key: UiKey): string {
  return ui[lang][key]
}
