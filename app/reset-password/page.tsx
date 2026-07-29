'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Briefcase, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react'

function ResetPasswordForm() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) setError('Link reset tidak valid.')
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Password tidak cocok'); return }
    if (password.length < 8) { setError('Password minimal 8 karakter'); return }
    setLoading(true)
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error ?? 'Terjadi kesalahan'); return }
    setSuccess(true)
    setTimeout(() => router.push('/'), 3000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f6fa] px-4">
      <div className="w-full max-w-[360px]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)' }}>
            <Briefcase size={17} className="text-white" />
          </div>
          <span className="font-bold text-gray-900 text-sm">Job Application Suite</span>
        </div>

        <div className="bg-white rounded-2xl p-7 space-y-5"
          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06),0 12px 40px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.06)' }}>

          {success ? (
            <div className="text-center space-y-4 py-2">
              <div className="flex justify-center">
                <CheckCircle2 size={44} className="text-emerald-500" />
              </div>
              <div>
                <h2 className="font-extrabold text-gray-900 text-xl">Password berhasil diubah!</h2>
                <p className="text-sm text-gray-400 mt-1">Kamu akan diarahkan ke halaman masuk...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <h1 className="font-extrabold text-gray-900 text-[1.4rem] tracking-tight leading-none">Buat password baru</h1>
                <p className="text-[13px] text-gray-400 leading-snug">Masukkan password baru untuk akunmu.</p>
              </div>

              {!token ? (
                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 px-3 py-2.5 rounded-xl border border-red-100">
                  <XCircle size={14} className="shrink-0" />
                  Link reset tidak valid. Coba minta reset password lagi.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-2.5">
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      placeholder="Password baru (min. 8 karakter, huruf + angka/simbol)"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="w-full px-3.5 py-2.5 pr-10 rounded-xl text-sm outline-none placeholder:text-gray-300 transition-all"
                      style={{ border: '1.5px solid #e2e8f0' }}
                      onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                      onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' }}
                    />
                    <button type="button" onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition-colors">
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="Konfirmasi password baru"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none placeholder:text-gray-300 transition-all"
                    style={{ border: '1.5px solid #e2e8f0' }}
                    onFocus={e => { e.target.style.borderColor = '#6366f1'; e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)' }}
                    onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' }}
                  />
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button type="submit" disabled={loading}
                    className="w-full py-2.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#7c3aed)', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}>
                    {loading ? 'Menyimpan...' : 'Simpan password baru'}
                  </button>
                </form>
              )}

              <p className="text-xs text-center">
                <a href="/" className="text-indigo-500 hover:text-indigo-600 font-medium transition-colors">← Kembali ke halaman masuk</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
