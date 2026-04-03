/**
 * exportCandidateProfiles
 * Generates a rich candidate profile PDF:
 *   Page 1  – cover summary table (all candidates at a glance)
 *   Page 2+ – one full-profile page per candidate
 *             (headline, summary, ALL work history, education, contact, AI score, notes)
 */
import type { Candidate } from '@/types'

// ── helpers ──────────────────────────────────────────────────────────────────

/** Wrap long text into lines that fit within maxWidth (mm). */
function wrap(doc: any, text: string, maxWidth: number): string[] {
  const safe = String(text ?? '')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return doc.splitTextToSize(safe, maxWidth) as string[]
}

/** Draw a filled rounded-rectangle "chip". Returns new x position. */
function drawChip(
  doc: any,
  text: string,
  x: number,
  y: number,
  opts: { bg: [number, number, number]; fg: [number, number, number]; fontSize?: number },
): number {
  const fs = opts.fontSize ?? 7
  doc.setFontSize(fs)
  const tw = (doc.getStringUnitWidth(text) * fs) / doc.internal.scaleFactor
  const pad = 2.5
  const chipW = tw + pad * 2
  const chipH = fs * 0.55 + pad

  doc.setFillColor(...opts.bg)
  doc.roundedRect(x, y - chipH * 0.72, chipW, chipH, 1.2, 1.2, 'F')
  doc.setTextColor(...opts.fg)
  doc.text(text, x + pad, y)
  return x + chipW + 2
}

/** Draw section heading with a left colour bar. */
function sectionHeading(doc: any, label: string, x: number, y: number, contentRight: number) {
  doc.setFillColor(37, 99, 235)
  doc.rect(x, y - 3.5, 2.5, 5, 'F')
  doc.setTextColor(15, 23, 42)
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text(label.toUpperCase(), x + 5, y)
  doc.setDrawColor(226, 232, 240)
  doc.line(
    x + 5 + (doc.getStringUnitWidth(label.toUpperCase()) * 8.5) / doc.internal.scaleFactor + 2,
    y - 1,
    contentRight,
    y - 1,
  )
  doc.setFont('helvetica', 'normal')
}

/** Clamp a value between min and max. */
function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/** Add a continuation header when a profile overflows onto a new page. */
function addContinuationHeader(doc: any, name: string, pageW: number, ml: number): number {
  doc.setFillColor(248, 250, 252)
  doc.rect(0, 0, pageW, 10, 'F')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(8)
  doc.text(`${name} — continued`, ml, 7)
  doc.setDrawColor(226, 232, 240)
  doc.line(0, 10, pageW, 10)
  return 16
}

// ── main export ───────────────────────────────────────────────────────────────

export async function exportCandidateProfiles(
  candidates: Candidate[],
  subtitle = '',
  title = 'Candidate Profiles',
) {
  const { jsPDF } = await import('jspdf')
  await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()   // 210
  const pageH = doc.internal.pageSize.getHeight()  // 297
  const ml = 14    // left margin
  const mr = 14    // right margin
  const cw = pageW - ml - mr  // content width = 182

  const exported = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 – COVER SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  // Header band
  doc.setFillColor(37, 99, 235)
  doc.rect(0, 0, pageW, 24, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(`RecruitAI — ${title}`, ml, 14)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  const headerRight = subtitle
    ? `${subtitle}  ·  ${candidates.length} candidate${candidates.length !== 1 ? 's' : ''}  ·  ${exported}`
    : `${candidates.length} candidate${candidates.length !== 1 ? 's' : ''}  ·  ${exported}`
  doc.text(headerRight, pageW - mr, 14, { align: 'right' })

  // Stat pills
  const approved = candidates.filter((c) => c.recruiter_decision === 'approved').length
  const rejected = candidates.filter((c) => c.recruiter_decision === 'rejected').length
  const flagged  = candidates.filter((c) => c.recruiter_decision === 'flagged').length
  const pending  = candidates.filter((c) => !c.recruiter_decision).length
  doc.setTextColor(60, 60, 60)
  doc.setFontSize(8.5)
  doc.text(`Approved: ${approved}   Rejected: ${rejected}   Flagged: ${flagged}   Pending: ${pending}`, ml, 30)

  // Summary table – one row per candidate
  const { default: autoTable } = await import('jspdf-autotable')

  autoTable(doc, {
    startY: 34,
    head: [['#', 'Name', 'Current Company', 'Location', 'Phone', 'Email', 'Exp', 'AI Score', 'Decision']],
    body: candidates.map((c, i) => {
      const score = c.recruiter_score_override ?? c.ai_score
      const decision = c.recruiter_decision ?? 'Pending'
      return [
        String(i + 1),
        c.full_name,
        c.current_company ?? '—',
        c.location ?? '—',
        c.phone ?? '—',
        c.email ?? '—',
        c.experience_years != null ? `${c.experience_years.toFixed(1)} yrs` : '—',
        score != null ? `${score.toFixed(1)}/10` : '—',
        decision.charAt(0).toUpperCase() + decision.slice(1),
      ]
    }),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 7 },
      1: { cellWidth: 25 },
      2: { cellWidth: 22 },
      3: { cellWidth: 18 },
      4: { cellWidth: 19 },
      5: { cellWidth: 30 },
      6: { cellWidth: 12 },
      7: { cellWidth: 15 },
      8: { cellWidth: 20 },
    },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 8) {
        const v = String(data.cell.raw ?? '')
        if (v === 'Approved') doc.setTextColor(22, 163, 74)
        else if (v === 'Rejected') doc.setTextColor(220, 38, 38)
        else if (v === 'Flagged') doc.setTextColor(217, 119, 6)
        else doc.setTextColor(100, 116, 139)
      }
    },
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 2+ – ONE PROFILE PER CANDIDATE
  // ══════════════════════════════════════════════════════════════════════════

  for (let ci = 0; ci < candidates.length; ci++) {
    const c = candidates[ci]
    const score = c.recruiter_score_override ?? c.ai_score
    const decision = c.recruiter_decision ?? 'pending'

    doc.addPage()
    let y = 0

    // ── Top colour strip ────────────────────────────────────────────────────
    const stripH = 36
    doc.setFillColor(37, 99, 235)
    doc.rect(0, 0, pageW, stripH, 'F')

    // Avatar circle
    doc.setFillColor(255, 255, 255)
    doc.circle(ml + 9, stripH / 2 - 2, 9, 'F')
    doc.setTextColor(37, 99, 235)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text((c.full_name[0] ?? '?').toUpperCase(), ml + 9, stripH / 2 + 2.5, { align: 'center' })

    // Name + headline + location
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    const nameLines = wrap(doc, c.full_name, pageW - mr - (ml + 22))
    doc.text(nameLines[0] || 'Candidate', ml + 22, stripH / 2 - 8)

    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(186, 210, 255)
    if (c.headline) {
      const headlineLines = wrap(doc, c.headline, pageW - mr - (ml + 22))
      doc.text((headlineLines[0] || '').slice(0, 120), ml + 22, stripH / 2 - 1)
    }
    if (c.location) {
      doc.setFontSize(7.5)
      doc.text(`Location: ${c.location}`.slice(0, 100), ml + 22, stripH / 2 + 6)
    }

    // Candidate index (top right)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(7.5)
    doc.text(`${ci + 1} / ${candidates.length}`, pageW - mr, stripH / 2, { align: 'right' })

    y = stripH + 8

    // ── Score + Decision bar ────────────────────────────────────────────────
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(ml, y - 4, cw, 16, 2, 2, 'F')

    if (score != null) {
      const barTotalW = 55
      const barH = 4
      const barX = ml + 6
      const barY = y + 5
      const filledW = (score / 10) * barTotalW
      const barColor: [number, number, number] =
        score >= 7 ? [22, 163, 74] : score >= 5 ? [234, 179, 8] : [239, 68, 68]

      doc.setTextColor(100, 116, 139)
      doc.setFontSize(7)
      doc.text('AI Score', barX, barY - 1)
      doc.setFillColor(226, 232, 240)
      doc.roundedRect(barX, barY, barTotalW, barH, 1, 1, 'F')
      doc.setFillColor(...barColor)
      doc.roundedRect(barX, barY, clamp(filledW, 1, barTotalW), barH, 1, 1, 'F')
      doc.setTextColor(...barColor)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text(`${score.toFixed(1)}/10`, barX + barTotalW + 3, barY + barH - 0.5)
      doc.setFont('helvetica', 'normal')
    }

    // Experience years (middle)
    if (c.experience_years != null) {
      const metaX = ml + 72
      doc.setTextColor(71, 85, 105)
      doc.setFontSize(8)
      doc.text(`${c.experience_years.toFixed(1)} yrs total experience`, metaX, y + 7)
    }

    // Decision badge (right)
    const decLabel = decision.charAt(0).toUpperCase() + decision.slice(1)
    const decBg: [number, number, number] =
      decision === 'approved' ? [220, 252, 231] :
      decision === 'rejected' ? [254, 226, 226] :
      decision === 'flagged'  ? [254, 243, 199] :
      [241, 245, 249]
    const decFg: [number, number, number] =
      decision === 'approved' ? [21, 128, 61] :
      decision === 'rejected' ? [185, 28, 28] :
      decision === 'flagged'  ? [146, 64, 14] :
      [71, 85, 105]
    doc.setFillColor(...decBg)
    doc.roundedRect(pageW - mr - 30, y - 1, 30, 10, 2, 2, 'F')
    doc.setTextColor(...decFg)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.text(decLabel, pageW - mr - 15, y + 6, { align: 'center' })
    doc.setFont('helvetica', 'normal')

    y += 22

    // ── Contact Info ─────────────────────────────────────────────────────────
    const hasContact = c.email || c.phone || c.linkedin_url
    if (hasContact) {
      sectionHeading(doc, 'Contact Information', ml, y, pageW - mr)
      y += 6
      doc.setFontSize(8.5)

      // Lay out contact details in two columns
      const col2X = ml + cw / 2
      let leftY = y
      let rightY = y

      if (c.phone) {
        doc.setTextColor(37, 99, 235)
        doc.text(`Phone: ${c.phone}`, ml, leftY)
        leftY += 6
      }
      if (c.email) {
        doc.setTextColor(37, 99, 235)
        doc.text(`Email: ${c.email}`, ml, leftY)
        leftY += 6
      }
      if (c.linkedin_url) {
        doc.setTextColor(37, 99, 235)
        const urlText = c.linkedin_url.replace('https://', '').slice(0, 55)
        doc.text(`LinkedIn: ${urlText}`, col2X, rightY)
        rightY += 6
      }

      y = Math.max(leftY, rightY) + 2
    }

    // ── Company + Description ────────────────────────────────────────────────
    if (c.current_company || c.profile_description) {
      if (y > pageH - 45) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, 'Profile Details', ml, y, pageW - mr)
      y += 6

      if (c.current_company) {
        doc.setTextColor(51, 65, 85)
        doc.setFontSize(8.5)
        doc.setFont('helvetica', 'bold')
        doc.text(`Current Company: ${c.current_company}`, ml, y)
        doc.setFont('helvetica', 'normal')
        y += 6
      }

      if (c.profile_description) {
        doc.setTextColor(71, 85, 105)
        doc.setFontSize(8)
        const descLines = wrap(doc, c.profile_description, cw)
        descLines.forEach((line: string) => { doc.text(line, ml, y); y += 4.5 })
      }

      y += 3
    }

    // ── Profile Summary ─────────────────────────────────────────────────────
    if (c.profile_summary) {
      if (y > pageH - 40) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, 'Profile Summary', ml, y, pageW - mr)
      y += 5
      doc.setTextColor(51, 65, 85)
      doc.setFontSize(8.5)
      const summaryLines = wrap(doc, c.profile_summary, cw)
      summaryLines.forEach((line: string) => { doc.text(line, ml, y); y += 5 })
      y += 4
    }

    // ── Resume / CV ──────────────────────────────────────────────────────────
    if (c.resume_url) {
      if (y > pageH - 25) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, 'Resume Link', ml, y, pageW - mr)
      y += 6
      doc.setTextColor(30, 64, 175)
      doc.setFontSize(8)
      const resumeText = c.resume_url.slice(0, 100)
      doc.text(resumeText, ml, y)
      y += 4
    }

    // ── Skills ──────────────────────────────────────────────────────────────
    if (c.skills.length > 0) {
      if (y > pageH - 30) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, 'Skills', ml, y, pageW - mr)
      y += 6
      let chipX = ml
      const startChipY = y
      for (const skill of c.skills) {
        if (chipX + 35 > pageW - mr) {
          chipX = ml
          y += 8
        }
        chipX = drawChip(doc, skill, chipX, startChipY + (y - startChipY), {
          bg: [219, 234, 254],
          fg: [30, 64, 175],
          fontSize: 7.5,
        })
      }
      y += 10
    }

    // ── Work Experience (ALL roles) ───────────────────────────────────────────
    const roles = c.experience ?? []
    if (roles.length > 0) {
      if (y > pageH - 40) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, `Work Experience (${roles.length} role${roles.length !== 1 ? 's' : ''})`, ml, y, pageW - mr)
      y += 6

      for (let ri = 0; ri < roles.length; ri++) {
        const role = roles[ri]
        if (y > pageH - 40) {
          doc.addPage()
          y = addContinuationHeader(doc, c.full_name, pageW, ml)
        }

        // Timeline dot + vertical connector
        doc.setFillColor(37, 99, 235)
        doc.circle(ml + 1.5, y - 0.5, 1.8, 'F')
        if (ri < roles.length - 1) {
          doc.setDrawColor(203, 213, 225)
          doc.setLineWidth(0.3)
          // connector drawn after we know height — skip for simplicity
        }

        // Role title + company
        doc.setTextColor(15, 23, 42)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        const roleTitle = `${role.title}  ·  ${role.company}`
        doc.text(roleTitle, ml + 6, y)
        doc.setFont('helvetica', 'normal')

        // Duration (right-aligned)
        if (role.duration) {
          doc.setTextColor(100, 116, 139)
          doc.setFontSize(7.5)
          doc.text(role.duration, pageW - mr, y, { align: 'right' })
        }
        y += 5.5

        // Role description
        if (role.description) {
          doc.setTextColor(71, 85, 105)
          doc.setFontSize(8)
          const descLines = wrap(doc, role.description, cw - 8)
          descLines.forEach((line: string) => {
            if (y > pageH - 20) {
              doc.addPage()
              y = addContinuationHeader(doc, c.full_name, pageW, ml)
            }
            doc.text(line, ml + 6, y)
            y += 4.5
          })
        }
        y += 4
      }
    }

    // ── Education ────────────────────────────────────────────────────────────
    const edu = c.education ?? []
    if (edu.length > 0) {
      if (y > pageH - 40) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, 'Education', ml, y, pageW - mr)
      y += 6
      for (const e of edu) {
        if (y > pageH - 20) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
        doc.setFillColor(37, 99, 235)
        doc.circle(ml + 1.5, y - 0.5, 1.5, 'F')
        doc.setTextColor(15, 23, 42)
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text(e.degree, ml + 6, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(71, 85, 105)
        doc.setFontSize(8)
        const yearStr = e.year ? ` · ${e.year}` : ''
        doc.text(`${e.institution}${yearStr}`, ml + 6, y + 4.5)
        y += 11
      }
    }

    // ── AI Assessment ────────────────────────────────────────────────────────
    if (c.ai_score_reason) {
      if (y > pageH - 35) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, 'AI Assessment', ml, y, pageW - mr)
      y += 5
      doc.setFillColor(239, 246, 255)
      const reasonLines = wrap(doc, `"${c.ai_score_reason}"`, cw - 6)
      const blockH = reasonLines.length * 4.5 + 6
      doc.roundedRect(ml, y - 3, cw, blockH, 2, 2, 'F')
      doc.setTextColor(30, 64, 175)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'italic')
      reasonLines.forEach((line: string) => { doc.text(line, ml + 3, y); y += 4.5 })
      doc.setFont('helvetica', 'normal')
      y += 5
    }

    // ── Recruiter Notes ──────────────────────────────────────────────────────
    if (c.recruiter_notes) {
      if (y > pageH - 30) { doc.addPage(); y = addContinuationHeader(doc, c.full_name, pageW, ml) }
      sectionHeading(doc, 'Recruiter Notes', ml, y, pageW - mr)
      y += 5
      doc.setFillColor(254, 243, 199)
      const noteLines = wrap(doc, c.recruiter_notes, cw - 6)
      const noteH = noteLines.length * 4.5 + 6
      doc.roundedRect(ml, y - 3, cw, noteH, 2, 2, 'F')
      doc.setTextColor(120, 53, 15)
      doc.setFontSize(8)
      noteLines.forEach((line: string) => { doc.text(line, ml + 3, y); y += 4.5 })
    }

    // ── Page footer ──────────────────────────────────────────────────────────
    doc.setDrawColor(226, 232, 240)
    doc.line(ml, pageH - 10, pageW - mr, pageH - 10)
    doc.setTextColor(148, 163, 184)
    doc.setFontSize(7)
    doc.text(
      `RecruitAI  ·  ${title}  ·  Exported ${exported}  ·  ${ci + 1} of ${candidates.length}`,
      pageW / 2,
      pageH - 5,
      { align: 'center' },
    )
  }

  const safeName = title.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  doc.save(`${safeName}-${Date.now()}.pdf`)
}
