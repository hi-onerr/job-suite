const COMMON = new Set([
  'password', '12345678', '123456789', 'password1', 'iloveyou',
  'qwerty123', 'admin123', 'letmein1', 'welcome1', 'monkey123',
])

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password minimal 8 karakter'
  if (COMMON.has(pw.toLowerCase())) return 'Password terlalu umum, gunakan yang lebih unik'
  const hasLetter = /[a-zA-Z]/.test(pw)
  const hasNonLetter = /[^a-zA-Z]/.test(pw)
  if (!hasLetter || !hasNonLetter) return 'Password harus mengandung huruf dan angka/simbol'
  return null
}
