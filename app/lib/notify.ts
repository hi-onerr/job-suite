// Centralized SweetAlert2 notifications — replaces native window.alert so all
// user-facing messages share the app's branding. Client-only (import from
// 'use client' components). SweetAlert2 injects its own CSS automatically.
import Swal from 'sweetalert2'

const PRIMARY = '#1F4E79'
const ACCENT = '#0EA5A4'

export function showError(message: string, title = 'Terjadi kesalahan') {
  return Swal.fire({ icon: 'error', title, text: message, confirmButtonColor: PRIMARY, confirmButtonText: 'OK' })
}

export function showSuccess(message: string, title = 'Berhasil') {
  return Swal.fire({ icon: 'success', title, text: message, confirmButtonColor: ACCENT, confirmButtonText: 'OK' })
}

export function showInfo(message: string, title = 'Info') {
  return Swal.fire({ icon: 'info', title, text: message, confirmButtonColor: PRIMARY, confirmButtonText: 'OK' })
}

// Non-blocking toast for lightweight confirmations.
export function showToast(message: string, icon: 'success' | 'error' | 'info' = 'success', duration = 2600) {
  return Swal.fire({
    toast: true, position: 'top-end', icon, title: message,
    showConfirmButton: false, timer: duration, timerProgressBar: true,
  })
}
