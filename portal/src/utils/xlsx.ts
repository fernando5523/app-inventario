import { strToU8, zipSync } from 'fflate'

export type XlsxCell = string | number | boolean | null | undefined

export interface XlsxColumn {
  header: string
  /** Width in Excel characters. */
  width?: number
  /** 'money' writes numbers with 2 decimals. */
  format?: 'text' | 'number' | 'money'
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

/** A1-style column letters: 0 -> A, 25 -> Z, 26 -> AA. */
const columnLetter = (index: number) => {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// Style ids in styles.xml: 0 default, 1 bold header, 2 money (#,##0.00)
const STYLE_HEADER = 1
const STYLE_MONEY = 2

function cellXml(ref: string, value: XlsxCell, column: XlsxColumn, isHeader: boolean): string {
  if (value === null || value === undefined || value === '') return ''
  const style = isHeader ? STYLE_HEADER : column.format === 'money' && typeof value === 'number' ? STYLE_MONEY : 0
  const s = style ? ` s="${style}"` : ''
  if (typeof value === 'number' && Number.isFinite(value) && !isHeader) return `<c r="${ref}"${s}><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="inlineStr"><is><t>${value ? 'Sí' : 'No'}</t></is></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
}

/**
 * Minimal Office Open XML workbook (one sheet): bold, frozen header row with an autofilter,
 * numbers kept numeric. Enough for Excel and LibreOffice; no dependency beyond the zipper.
 */
export function buildXlsx(sheetName: string, columns: XlsxColumn[], rows: XlsxCell[][]): Uint8Array {
  const lastCol = columnLetter(Math.max(0, columns.length - 1))
  const lastRow = rows.length + 1
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`).join('')
  const header = `<row r="1">${columns.map((c, i) => cellXml(`${columnLetter(i)}1`, c.header, c, true)).join('')}</row>`
  const body = rows
    .map((row, r) => `<row r="${r + 2}">${columns.map((c, i) => cellXml(`${columnLetter(i)}${r + 2}`, row[i], c, false)).join('')}</row>`)
    .join('')
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${header}${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/></worksheet>`
  const safeName = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja1')

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets>` +
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${safeName}'!$A$1:$${lastCol}$${lastRow}</definedName></definedNames>` +
        `</workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
        `</styleSheet>`
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  }
  return zipSync(files, { level: 6 })
}

/** Saves the workbook through a temporary link (no new window, no server round trip). */
export function downloadXlsx(fileName: string, bytes: Uint8Array) {
  // Copy into a plain ArrayBuffer: Blob does not take a view over a SharedArrayBuffer-capable buffer.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
