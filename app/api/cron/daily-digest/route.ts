import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import nodemailer from 'nodemailer'

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })
}

function buildEmail(opts: {
  name: string
  jobs: { company: string; role: string; deadline: string | null; url: string | null; status: string }[]
  archives: { filename: string; publicUrl: string; company: string | null; jobTitle: string | null; kind: string }[]
  appUrl: string
}) {
  const { name, jobs, archives, appUrl } = opts
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const jobRows = jobs.map(j => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f3f4f6">
        <div style="font-weight:600;font-size:14px;color:#1a1a2e">${j.role}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">${j.company}${j.deadline ? ` · Deadline: <strong style="color:#ef4444">${j.deadline}</strong>` : ''}</div>
        ${j.url ? `<a href="${j.url}" style="display:inline-block;margin-top:6px;font-size:12px;color:#6366f1;text-decoration:none;font-weight:600">→ Buka lowongan</a>` : ''}
      </td>
    </tr>`).join('')

  const archiveRows = archives.slice(0, 5).map(a => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f4f6">
        <div style="font-size:13px;color:#1a1a2e;font-weight:500">${a.filename}</div>
        ${a.company ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px">${a.company}${a.jobTitle ? ` · ${a.jobTitle}` : ''}</div>` : ''}
        <a href="${a.publicUrl}" style="display:inline-block;margin-top:4px;font-size:12px;color:#6366f1;font-weight:600;text-decoration:none">↓ Download PDF</a>
      </td>
    </tr>`).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:32px auto;padding:0 16px">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6366f1,#7c3aed);border-radius:16px 16px 0 0;padding:28px 28px 24px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center">
          <span style="color:white;font-size:16px">✦</span>
        </div>
        <span style="color:rgba(255,255,255,0.9);font-size:13px;font-weight:600">Job Application Suite</span>
      </div>
      <h1 style="margin:0;font-size:22px;font-weight:800;color:white;line-height:1.3">Pengingat Apply Hari Ini 🎯</h1>
      <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.8)">${today}</p>
    </div>

    <!-- Body -->
    <div style="background:white;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">

      <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.6">
        Halo <strong>${name}</strong>! Ini ringkasan lowongan yang perlu kamu apply dan CV yang sudah kamu siapkan.
      </p>

      ${jobs.length > 0 ? `
      <!-- Jobs section -->
      <div style="margin-bottom:24px">
        <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1a1a2e">
          📋 Lowongan (${jobs.length})
        </h2>
        <table style="width:100%;border-collapse:collapse">${jobRows}</table>
      </div>` : `
      <div style="background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:24px;text-align:center">
        <p style="margin:0;font-size:13px;color:#9ca3af">Belum ada lowongan yang ditandai untuk diapply.</p>
      </div>`}

      ${archives.length > 0 ? `
      <!-- CV Archive section -->
      <div style="margin-bottom:24px">
        <h2 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1a1a2e">
          📄 CV yang Sudah Siap (${Math.min(archives.length, 5)})
        </h2>
        <table style="width:100%;border-collapse:collapse">${archiveRows}</table>
      </div>` : ''}

      <!-- CTA -->
      <div style="text-align:center;margin-top:24px">
        <a href="${appUrl}" style="display:inline-block;padding:13px 32px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px">
          Buka Job Suite →
        </a>
      </div>

      <hr style="margin:28px 0 16px;border:none;border-top:1px solid #f3f4f6">
      <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;line-height:1.6">
        Kamu menerima email ini karena notifikasi harian aktif di Job Suite.<br>
        Matikan di <a href="${appUrl}" style="color:#6366f1;text-decoration:none">Settings → Notifikasi</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

export async function GET(req: NextRequest) {
  // Allow Vercel Cron (x-vercel-cron header) or requests with matching CRON_SECRET.
  // Middleware already whitelists /api/cron/ from session auth.
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const secret = process.env.CRON_SECRET
  if (!isVercelCron && secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
  }

  const currentHourUTC = new Date().getUTCHours()

  const users = await prisma.user.findMany({
    where: { notifyDigest: true, notifyHourUTC: currentHourUTC },
    select: { id: true, name: true, email: true },
  })

  const appUrl = process.env.NEXTAUTH_URL || 'https://job-suite.vercel.app'
  const transporter = createTransporter()
  const todayStr = new Date().toISOString().slice(0, 10)
  let sent = 0

  for (const user of users) {
    try {
      const [jobs, archives] = await Promise.all([
        prisma.application.findMany({
          where: {
            userId: user.id,
            status: { in: ['saved', 'applied'] },
            OR: [
              { deadline: { lte: todayStr } },
              { deadline: null },
            ],
          },
          orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
          take: 10,
          select: { company: true, role: true, deadline: true, url: true, status: true },
        }),
        prisma.cvArchive.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { filename: true, publicUrl: true, company: true, jobTitle: true, kind: true },
        }),
      ])

      const html = buildEmail({
        name: user.name || 'Pengguna',
        jobs,
        archives,
        appUrl,
      })

      await transporter.sendMail({
        from: `"Job Application Suite" <${process.env.GMAIL_USER}>`,
        to: user.email!,
        subject: `📋 Pengingat Apply — ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })}`,
        html,
      })
      sent++
    } catch (err) {
      console.error(`Failed to send digest to ${user.email}:`, err)
    }
  }

  // ── Per-job reminders ─────────────────────────────────────────────────
  const now = new Date()
  const dueApps = await prisma.application.findMany({
    where: { reminderAt: { lte: now }, reminderSent: false },
    select: {
      id: true,
      company: true,
      role: true,
      deadline: true,
      url: true,
      user: { select: { name: true, email: true } },
    },
  })

  let remindersSent = 0
  for (const app of dueApps) {
    try {
      const html = buildReminderEmail({ app, appUrl })
      await transporter.sendMail({
        from: `"Job Application Suite" <${process.env.GMAIL_USER}>`,
        to: app.user.email,
        subject: `🔔 Pengingat Apply — ${decodeHtmlEntities(app.role)} di ${decodeHtmlEntities(app.company)}`,
        html,
      })
      await prisma.application.update({
        where: { id: app.id },
        data: { reminderSent: true },
      })
      remindersSent++
    } catch (err) {
      console.error(`Failed to send reminder for app ${app.id}:`, err)
    }
  }

  return NextResponse.json({ sent, total: users.length, remindersSent })
}

function decodeHtmlEntities(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function buildReminderEmail(opts: {
  app: { company: string; role: string; deadline: string | null; url: string | null }
  appUrl: string
}) {
  const { app, appUrl } = opts
  const todayWIB = new Date(Date.now() + 7 * 60 * 60 * 1000).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:32px auto;padding:0 16px">
    <div style="background:linear-gradient(135deg,#6366f1,#7c3aed);border-radius:16px 16px 0 0;padding:28px 28px 24px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="color:rgba(255,255,255,0.9);font-size:13px;font-weight:600">Job Application Suite</span>
      </div>
      <h1 style="margin:0;font-size:22px;font-weight:800;color:white;line-height:1.3">🔔 Waktunya Apply!</h1>
      <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.8)">${todayWIB}</p>
    </div>
    <div style="background:white;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.06)">
      <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.6">
        Kamu punya pengingat untuk melamar lowongan berikut:
      </p>
      <div style="background:#f3f4f6;border-radius:12px;padding:20px;margin-bottom:24px">
        <div style="font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:4px">${decodeHtmlEntities(app.role)}</div>
        <div style="font-size:14px;color:#6b7280">${decodeHtmlEntities(app.company)}</div>
        ${app.deadline ? `<div style="font-size:12px;color:#ef4444;margin-top:8px;font-weight:600">Deadline: ${app.deadline}</div>` : ''}
      </div>
      <div style="text-align:center;margin-bottom:24px">
        ${app.url ? `<a href="${app.url}" style="display:inline-block;padding:13px 32px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;margin-bottom:12px">
          Buka Lowongan →
        </a><br>` : ''}
        <a href="${appUrl}" style="display:inline-block;padding:10px 24px;background:#f3f4f6;color:#6366f1;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px">
          Buka Job Suite
        </a>
      </div>
      <hr style="margin:0 0 16px;border:none;border-top:1px solid #f3f4f6">
      <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;line-height:1.6">
        Pengingat ini diatur melalui Job Suite.<br>
        Atur ulang di <a href="${appUrl}" style="color:#6366f1;text-decoration:none">Job Tracker</a>
      </p>
    </div>
  </div>
</body>
</html>`
}
