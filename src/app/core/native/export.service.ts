import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { PDFFont, PDFPage } from 'pdf-lib';

export type CsvCell = string | number | boolean | null | undefined;

export interface ReportColumn {
  label: string;
  weight: number;
  align?: 'left' | 'right';
}

export interface ReportKpi {
  label: string;
  value: string;
  detail: string;
}

export interface PremiumReport {
  filename: string;
  title: string;
  subtitle: string;
  period: string;
  generatedAt: string;
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: CsvCell[][];
  note?: string;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  async csv(filename: string, rows: CsvCell[][]): Promise<string | null> {
    const safeName = this.safeFilename(filename, 'csv');
    const csv = `\uFEFF${rows
      .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n')}`;

    return this.shareText(safeName, csv, 'text/csv;charset=utf-8');
  }

  async premiumPdf(report: PremiumReport): Promise<string | null> {
    try {
      const [{ PDFDocument, rgb }, fontkitModule] = await Promise.all([
        import('pdf-lib'),
        import('@pdf-lib/fontkit'),
      ]);
      const [bodyBytes, strongBytes, displayBytes] = await Promise.all([
        this.fontAsset('assets/fonts/dm-sans-400.ttf'),
        this.fontAsset('assets/fonts/dm-sans-700.ttf'),
        this.fontAsset('assets/fonts/dm-serif-display-400.ttf'),
      ]);
      const document = await PDFDocument.create();
      document.registerFontkit(fontkitModule.default);
      const [body, strong, display] = await Promise.all([
        document.embedFont(bodyBytes, { subset: true }),
        document.embedFont(strongBytes, { subset: true }),
        document.embedFont(displayBytes, { subset: true }),
      ]);

      document.setTitle(report.title);
      document.setSubject(report.subtitle);
      document.setAuthor('CozyCraft Furnitures');
      document.setCreator('CozyCraft Admin Mobile');
      document.setProducer('CozyCraft Operations');
      document.setCreationDate(new Date());

      const pageSize: [number, number] = [841.89, 595.28];
      const palette = {
        canvas: rgb(0.969, 0.961, 0.941),
        surface: rgb(0.996, 0.992, 0.976),
        ink: rgb(0.125, 0.114, 0.102),
        soft: rgb(0.455, 0.435, 0.408),
        border: rgb(0.871, 0.847, 0.808),
        accent: rgb(0.722, 0.647, 0.553),
        accentSoft: rgb(0.898, 0.851, 0.784),
        white: rgb(0.985, 0.976, 0.949),
      };
      const margin = 38;
      const tableWidth = pageSize[0] - margin * 2;
      const totalWeight = report.columns.reduce((sum, column) => sum + column.weight, 0);
      const columnWidths = report.columns.map((column) => tableWidth * column.weight / totalWeight);
      const rowHeight = 24;
      const tableHeaderHeight = 27;
      const bottomLimit = 39;
      const pages: PDFPage[] = [];
      let page = document.addPage(pageSize);
      pages.push(page);

      const drawBrandHeader = (target: PDFPage, first: boolean) => {
        const { height, width } = target.getSize();
        target.drawRectangle({ x: 0, y: 0, width, height, color: palette.canvas });
        if (first) {
          target.drawRectangle({ x: margin, y: height - 128, width: tableWidth, height: 91, color: palette.ink });
          target.drawRectangle({ x: margin, y: height - 128, width: 5, height: 91, color: palette.accent });
          target.drawText('C O Z Y C R A F T   /   A D M I N', { x: margin + 22, y: height - 62, size: 9.5, font: strong, color: palette.accentSoft });
          target.drawText(this.fitText(report.title, display, 27, tableWidth - 238), { x: margin + 22, y: height - 98, size: 27, font: display, color: palette.white });
          target.drawText(this.fitText(report.subtitle, body, 9.5, tableWidth - 260), { x: margin + 23, y: height - 116, size: 9.5, font: body, color: palette.accentSoft });
          const periodWidth = Math.min(205, Math.max(116, strong.widthOfTextAtSize(report.period, 9) + 28));
          target.drawRectangle({ x: width - margin - periodWidth - 20, y: height - 92, width: periodWidth, height: 31, color: palette.surface });
          target.drawText(this.fitText(report.period, strong, 9, periodWidth - 22), { x: width - margin - periodWidth - 9, y: height - 81, size: 9, font: strong, color: palette.ink });
          return;
        }

        target.drawText('C O Z Y C R A F T   /   A D M I N', { x: margin, y: height - 35, size: 8.5, font: strong, color: palette.accent });
        target.drawText(this.fitText(report.title, display, 17, 360), { x: margin, y: height - 57, size: 17, font: display, color: palette.ink });
        target.drawText(report.period, { x: width - margin - strong.widthOfTextAtSize(report.period, 8.5), y: height - 48, size: 8.5, font: strong, color: palette.soft });
        target.drawLine({ start: { x: margin, y: height - 69 }, end: { x: width - margin, y: height - 69 }, thickness: 0.7, color: palette.border });
      };

      const drawKpis = (target: PDFPage) => {
        const top = pageSize[1] - 145;
        const gap = 9;
        const count = Math.max(1, Math.min(4, report.kpis.length));
        const width = (tableWidth - gap * (count - 1)) / count;
        report.kpis.slice(0, 4).forEach((kpi, index) => {
          const x = margin + index * (width + gap);
          target.drawRectangle({ x, y: top - 68, width, height: 68, color: palette.surface, borderColor: palette.border, borderWidth: 0.7 });
          target.drawText(kpi.label.toLocaleUpperCase(), { x: x + 13, y: top - 19, size: 7.5, font: strong, color: palette.soft });
          target.drawText(this.fitText(kpi.value, display, 18, width - 26), { x: x + 13, y: top - 43, size: 18, font: display, color: palette.ink });
          target.drawText(this.fitText(kpi.detail, body, 7.7, width - 26), { x: x + 13, y: top - 58, size: 7.7, font: body, color: palette.soft });
        });
      };

      const drawTableHeader = (target: PDFPage, y: number) => {
        target.drawRectangle({ x: margin, y: y - tableHeaderHeight, width: tableWidth, height: tableHeaderHeight, color: palette.ink });
        let x = margin;
        report.columns.forEach((column, index) => {
          const width = columnWidths[index];
          const label = this.fitText(column.label.toLocaleUpperCase(), strong, 7.6, width - 16);
          const labelWidth = strong.widthOfTextAtSize(label, 7.6);
          target.drawText(label, {
            x: column.align === 'right' ? x + width - labelWidth - 8 : x + 8,
            y: y - 17.5,
            size: 7.6,
            font: strong,
            color: palette.white,
          });
          x += width;
        });
        return y - tableHeaderHeight;
      };

      drawBrandHeader(page, true);
      drawKpis(page);
      let cursor = drawTableHeader(page, pageSize[1] - 232);
      const firstPageCapacity = Math.max(1, Math.floor((cursor - bottomLimit) / rowHeight));
      const continuationCursor = pageSize[1] - 83 - tableHeaderHeight;
      const continuationCapacity = Math.max(1, Math.floor((continuationCursor - bottomLimit) / rowHeight));
      let rowsOnPage = 0;
      let currentPageCapacity = firstPageCapacity;

      if (!report.rows.length) {
        page.drawRectangle({ x: margin, y: cursor - 54, width: tableWidth, height: 54, color: palette.surface });
        page.drawText('No records are available for the selected report.', { x: margin + 14, y: cursor - 32, size: 9, font: body, color: palette.soft });
      }

      report.rows.forEach((row, rowIndex) => {
        if (rowsOnPage >= currentPageCapacity) {
          page = document.addPage(pageSize);
          pages.push(page);
          drawBrandHeader(page, false);
          cursor = drawTableHeader(page, pageSize[1] - 83);
          rowsOnPage = 0;
          const remainingRows = report.rows.length - rowIndex;
          const remainingPages = Math.max(1, Math.ceil(remainingRows / continuationCapacity));
          currentPageCapacity = Math.ceil(remainingRows / remainingPages);
        }

        page.drawRectangle({ x: margin, y: cursor - rowHeight, width: tableWidth, height: rowHeight, color: rowIndex % 2 ? palette.surface : palette.canvas });
        page.drawLine({ start: { x: margin, y: cursor - rowHeight }, end: { x: margin + tableWidth, y: cursor - rowHeight }, thickness: 0.4, color: palette.border });
        let x = margin;
        report.columns.forEach((column, columnIndex) => {
          const width = columnWidths[columnIndex];
          const value = this.fitText(String(row[columnIndex] ?? '—'), body, 8.2, width - 16);
          const valueWidth = body.widthOfTextAtSize(value, 8.2);
          page.drawText(value, {
            x: column.align === 'right' ? x + width - valueWidth - 8 : x + 8,
            y: cursor - 15.5,
            size: 8.2,
            font: body,
            color: palette.ink,
          });
          x += width;
        });
        cursor -= rowHeight;
        rowsOnPage += 1;
      });

      pages.forEach((target, index) => {
        const { width } = target.getSize();
        target.drawText(`Generated ${report.generatedAt}  ·  Confidential administrator report`, { x: margin, y: 18, size: 7.2, font: body, color: palette.soft });
        const pageNumber = `${index + 1} / ${pages.length}`;
        target.drawText(pageNumber, { x: width - margin - body.widthOfTextAtSize(pageNumber, 7.2), y: 18, size: 7.2, font: body, color: palette.soft });
        if (report.note && index === pages.length - 1) {
          target.drawText(this.fitText(report.note, body, 7.2, tableWidth - 190), { x: margin + 275, y: 18, size: 7.2, font: body, color: palette.soft });
        }
      });

      const bytes = await document.save();
      return this.shareBytes(this.safeFilename(report.filename, 'pdf'), bytes, 'application/pdf');
    } catch (error) {
      return error instanceof Error ? error.message : 'The PDF report could not be exported.';
    }
  }

  private async fontAsset(path: string): Promise<ArrayBuffer> {
    const response = await fetch(new URL(path, document.baseURI));
    if (!response.ok) throw new Error('The report font could not be loaded.');
    return response.arrayBuffer();
  }

  private fitText(value: string, font: PDFFont, size: number, maxWidth: number): string {
    const normalized = value.replace(/₱/g, 'PHP ');
    if (font.widthOfTextAtSize(normalized, size) <= maxWidth) return normalized;
    const suffix = '…';
    let result = normalized;
    while (result.length && font.widthOfTextAtSize(`${result}${suffix}`, size) > maxWidth) result = result.slice(0, -1);
    return `${result}${suffix}`;
  }

  private async shareText(filename: string, data: string, mimeType: string): Promise<string | null> {
    try {
      if (Capacitor.isNativePlatform()) {
        const file = await Filesystem.writeFile({ path: `exports/${filename}`, data, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
        await this.openShareSheet(file.uri);
        return null;
      }

      this.download(filename, new Blob([data], { type: mimeType }));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'The report could not be exported.';
    }
  }

  private async shareBytes(filename: string, data: Uint8Array, mimeType: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const file = await Filesystem.writeFile({ path: `exports/${filename}`, data: this.toBase64(data), directory: Directory.Cache, recursive: true });
      await this.openShareSheet(file.uri);
      return null;
    }

    this.download(filename, new Blob([data as BlobPart], { type: mimeType }));
    return null;
  }

  private async openShareSheet(uri: string): Promise<void> {
    await Share.share({ title: 'CozyCraft admin report', dialogTitle: 'Save or share report', url: uri });
  }

  private download(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    return btoa(binary);
  }

  private safeFilename(filename: string, extension: 'csv' | 'pdf'): string {
    const sanitized = filename.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    const base = (sanitized || 'cozycraft-report').replace(/\.(csv|pdf)$/i, '');
    return `${base}.${extension}`;
  }
}
