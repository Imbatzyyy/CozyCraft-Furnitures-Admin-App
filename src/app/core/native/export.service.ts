import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type CsvCell = string | number | boolean | null | undefined;

@Injectable({ providedIn: 'root' })
export class ExportService {
  async csv(filename: string, rows: CsvCell[][]): Promise<string | null> {
    const safeName = this.safeFilename(filename);
    const csv = `\uFEFF${rows
      .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n')}`;

    try {
      if (Capacitor.isNativePlatform()) {
        const file = await Filesystem.writeFile({
          path: `exports/${safeName}`,
          data: csv,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        await Share.share({
          title: 'CozyCraft admin report',
          dialogTitle: 'Save or share report',
          url: file.uri,
        });
        return null;
      }

      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'The report could not be exported.';
    }
  }

  private safeFilename(filename: string) {
    const sanitized = filename.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    return (sanitized || 'cozycraft-report.csv').replace(/(?:\.csv)?$/i, '.csv');
  }
}
