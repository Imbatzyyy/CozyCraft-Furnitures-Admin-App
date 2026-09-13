import { Signal, computed, signal } from '@angular/core';

/** Bounded rendering; all matching records remain reachable without a growing DOM. */
export function createPagination<T>(rows: Signal<readonly T[]>, pageSize = 8) {
  const requestedPage = signal(1);
  const size = Math.max(1, Math.trunc(pageSize) || 8);
  const pageCount = computed(() => Math.max(1, Math.ceil(rows().length / size)));
  const page = computed(() => Math.max(1, Math.min(requestedPage(), pageCount())));
  const visible = computed(() => rows().slice((page() - 1) * size, page() * size));
  return { pageSize: size, page, pageCount, visible, select: (value: number) => requestedPage.set(Math.max(1, Math.min(Math.trunc(value) || 1, pageCount()))), reset: () => requestedPage.set(1) };
}
