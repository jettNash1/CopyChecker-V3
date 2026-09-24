import { toClientRows } from './issue-rows.js';

const PINE = 'FF1A281F';
const LILAC = 'FFCDB7FF';
const CORAL = 'FFFA9A66';
const SAND = 'FFD2CFC5';
const PAPER = 'FFFFFFFF';
const BAND = 'FFF7F6F3';
const MAX_LINK = 2000;
const MAX_ROW_HEIGHT = 409;

const COLUMNS = [
  { header: 'Section', key: 'section', width: 34 },
  { header: 'Page', key: 'url', width: 42 },
  { header: 'Element', key: 'element', width: 28 },
  { header: 'Full path', key: 'path', width: 42 },
  { header: 'Word at issue', key: 'word', width: 22 },
  { header: 'Description', key: 'description', width: 42 },
  { header: 'Paragraph', key: 'paragraph', width: 56 },
];

function paint(cell, fill) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.border = {
    top: { style: 'thin', color: { argb: SAND } },
    left: { style: 'thin', color: { argb: SAND } },
    bottom: { style: 'thin', color: { argb: SAND } },
    right: { style: 'thin', color: { argb: SAND } },
  };
  cell.alignment = { vertical: 'top', wrapText: true };
}

function reportDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function rowHeight(row) {
  const lines = COLUMNS.reduce((tallest, column) => {
    const text = String(row[column.key] || '');
    const wrapped = Math.ceil(text.length / Math.max(column.width - 2, 8)) || 1;
    return Math.max(tallest, wrapped);
  }, 1);
  return Math.min(Math.max(lines * 16, 22), MAX_ROW_HEIGHT);
}

function pageLink(row) {
  const target = row.link || row.url;
  if (!target || target.length > MAX_LINK) return row.url;
  return target;
}

async function loadWorkbook() {
  const loaded = typeof window === 'undefined'
    ? await import('exceljs')
    : await import('exceljs/dist/exceljs.min.js');
  const ExcelJS = loaded.default?.Workbook ? loaded.default : loaded;
  return new ExcelJS.Workbook();
}

export async function buildExcelReport({ sections, languageLabel = '', date = new Date() }) {
  const workbook = await loadWorkbook();
  workbook.creator = 'CopyChecker';
  workbook.title = 'Copy review';
  const sheet = workbook.addWorksheet('Copy review', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    properties: { tabColor: { argb: LILAC } },
  });

  sheet.pageSetup.orientation = 'landscape';
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 0;
  sheet.pageSetup.paperSize = 9;
  sheet.pageSetup.printTitlesRow = '1:4';
  sheet.headerFooter.oddFooter = '&LCopyChecker&CCopy review&RPage &P of &N';
  sheet.headerFooter.evenFooter = '&LCopyChecker&CCopy review&RPage &P of &N';
  sheet.columns = COLUMNS.map((column) => ({ key: column.key, width: column.width }));

  const title = sheet.getCell('A1');
  title.value = 'Copy review';
  title.font = { name: 'Segoe UI', size: 20, bold: true, color: { argb: PINE } };
  sheet.getRow(1).height = 28;

  const rows = toClientRows(sections);
  const issueLabel = rows.length === 1 ? '1 issue' : `${rows.length} issues`;
  const intro = sheet.getCell('A2');
  intro.value = ['CopyChecker', languageLabel, issueLabel, reportDate(date)].filter(Boolean).join('  ·  ');
  intro.font = { name: 'Segoe UI', size: 11, color: { argb: PINE } };

  const note = sheet.getCell('A3');
  note.value = 'Each row is one place the wording appears. The page name opens that sentence in the browser.';
  note.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: PINE } };
  sheet.mergeCells('A1:G1');
  sheet.mergeCells('A2:G2');
  sheet.mergeCells('A3:G3');

  const header = sheet.getRow(4);
  COLUMNS.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.header;
    cell.font = { name: 'Segoe UI', bold: true, color: { argb: PINE } };
    paint(cell, LILAC);
  });
  header.height = 22;

  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 5);
    const fill = index % 2 === 0 ? PAPER : BAND;
    COLUMNS.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = row[column.key] || '';
      cell.font = {
        name: 'Segoe UI',
        size: 11,
        bold: column.key === 'word' && Boolean(row.word),
        color: { argb: column.key === 'word' && row.word ? PINE : 'FF000000' },
      };
      paint(cell, column.key === 'word' && row.word ? CORAL : fill);
    });
    if (row.url) {
      const page = excelRow.getCell(2);
      page.value = { text: row.url, hyperlink: pageLink(row) };
      page.font = { name: 'Segoe UI', size: 11, color: { argb: PINE }, underline: true };
    }
    excelRow.height = rowHeight(row);
  });

  if (rows.length > 0) sheet.autoFilter = { from: 'A4', to: 'G4' };
  return workbook.xlsx.writeBuffer();
}
