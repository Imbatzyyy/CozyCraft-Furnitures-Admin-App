import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { BillingProfile, Order, StoreSettings } from '../models/admin.models';

export interface OrderReceiptInput {
  order: Order;
  billing: BillingProfile | null;
  store: Pick<StoreSettings, 'store_name' | 'contact_email' | 'support_phone' | 'business_address' | 'delivery_area' | 'currency_code'>;
  generatedAt?: Date;
}

export interface ReceiptFonts {
  body: ArrayBuffer | Uint8Array;
  strong: ArrayBuffer | Uint8Array;
  display: ArrayBuffer | Uint8Array;
}

const clean = (value: unknown): string => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const list = <T>(value: T | T[] | null | undefined): T[] => Array.isArray(value) ? value : value ? [value] : [];
const timestamp = (value: string | null | undefined) => value ? new Date(value).getTime() : NaN;
const date = (value: string | null | undefined): string => {
  const time = timestamp(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(time) + ' PHT'
    : 'Not recorded';
};
const cents = (value: unknown, field: string): number => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    throw new Error('The order ' + field + ' is unavailable. Refresh the order and try again.');
  }
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('The order ' + field + ' is invalid.');
  return amount;
};

/** Use stored order prices, never today's catalog prices or delivery settings. */
export function prepareOrderReceipt(input: OrderReceiptInput) {
  const { order, billing, store } = input;
  if (order.status !== 'delivered') throw new Error('Receipts are available after the order is delivered.');
  if (!clean(order.order_number)) throw new Error('The order number is unavailable. Refresh the order and try again.');
  const items = list(order.order_items).map((item) => {
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('An order quantity is invalid. Refresh the order and try again.');
    const unitPrice = cents(item.unit_price, 'item price');
    if (!Number.isSafeInteger(unitPrice * quantity)) throw new Error('An order item amount is invalid.');
    return { name: clean(item.product_name) || 'Ordered item', quantity, unitPrice, amount: unitPrice * quantity };
  });
  if (!items.length) throw new Error('Order items are unavailable. Refresh the order and try again.');

  const subtotal = cents(order.subtotal, 'subtotal');
  const delivery = cents(order.delivery_fee, 'delivery fee');
  const total = cents(order.total, 'total');
  const reward = cents(order.reward_discount ?? 0, 'reward discount');
  const discount = reward || Math.max(0, subtotal + delivery - total);
  const adjustment = total - (subtotal + delivery - discount);
  const shipping = order.shipping_address ?? {};
  const deliveryAddress = [shipping.line, shipping.barangay, shipping.city, shipping.province, shipping.postal].map(clean).filter(Boolean).join(', ');
  const billingAddress = !billing || billing.same_as_delivery || !clean(billing.address_line)
    ? deliveryAddress
    : [billing.address_line, billing.barangay, billing.city, billing.province, billing.postal_code].map(clean).filter(Boolean).join(', ');
  const payment = list(order.payment_transactions).filter((entry) => entry.status === 'paid')
    .sort((a, b) => (timestamp(b.paid_at || b.updated_at) || 0) - (timestamp(a.paid_at || a.updated_at) || 0))[0];
  const delivered = list(order.order_status_history).filter((entry) => entry.status === 'delivered' && Number.isFinite(timestamp(entry.changed_at)))
    .sort((a, b) => timestamp(b.changed_at) - timestamp(a.changed_at))[0];
  const profiles = list(order.profiles)[0];
  const invoiceNumber = 'INV-' + clean(order.order_number);
  const paymentMethod = ({ cod: 'Cash on delivery', gcash: 'GCash', card: 'Card' } as Record<string, string>)[order.payment_method] || clean(order.payment_method);
  // Delivery alone is not proof that COD was collected. Preserve pending/refunded states.
  const paymentStatus = clean(order.payment_status) || 'pending';
  const currency = clean(payment?.currency || store.currency_code) || 'PHP';
  const money = (amount: number) => currency + ' ' + (amount / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return {
    invoiceNumber,
    filename: 'CozyCraft-Invoice-' + clean(order.order_number).replace(/[^a-zA-Z0-9_-]/g, '-') + '.pdf',
    generatedAt: input.generatedAt ?? new Date(),
    items, subtotal, delivery, total, discount, adjustment, money,
    discountLabel: reward ? 'Home Circle reward' : 'Order discount',
    seller: [clean(store.store_name) || 'CozyCraft Furnitures', clean(store.business_address) || clean(store.delivery_area), clean(store.contact_email), clean(store.support_phone)].filter(Boolean),
    buyer: [
      clean(billing?.recipient_name) || clean(shipping.name) || clean(profiles?.full_name) || 'Customer',
      clean(billing?.company_name),
      billing?.tax_id ? 'Tax ID: ' + clean(billing.tax_id) : '',
      clean(billing?.invoice_email) || clean(profiles?.email) || clean(shipping.email),
      clean(shipping.mobile) || clean(profiles?.phone),
      billingAddress || 'Address not provided',
    ].filter(Boolean),
    paymentMethod, paymentStatus,
    reference: order.payment_method === 'cod' ? 'COD-' + clean(order.order_number) : clean(payment?.provider_payment_id) || clean(payment?.provider_session_id) || 'PAY-' + clean(order.order_number),
    placed: date(order.created_at),
    delivered: date(delivered?.changed_at),
    deliveryAddress: deliveryAddress || 'Address not provided',
    contact: clean(store.contact_email),
  };
}

/** A4 invoice with embedded local fonts and flowing, lossless multi-page tables. */
export async function createOrderReceiptPdf(input: OrderReceiptInput, fonts: ReceiptFonts, logoPng: ArrayBuffer | Uint8Array) {
  const receipt = prepareOrderReceipt(input);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [body, strong, display, logo] = await Promise.all([
    doc.embedFont(fonts.body, { subset: true }),
    doc.embedFont(fonts.strong, { subset: true }),
    doc.embedFont(fonts.display, { subset: true }),
    doc.embedPng(logoPng),
  ]);
  doc.setTitle(receipt.invoiceNumber + ' - Delivered order receipt');
  doc.setAuthor(receipt.seller[0]);
  doc.setCreator('CozyCraft Admin Mobile');
  doc.setSubject('Digital invoice / receipt for order ' + clean(input.order.order_number));
  doc.setCreationDate(receipt.generatedAt);
  const width = 595.28, height = 841.89, margin = 36, usable = width - margin * 2, bottom = 784;
  const color = {
    canvas: rgb(.973, .965, .949), paper: rgb(1, .997, .987), ink: rgb(.137, .125, .11),
    muted: rgb(.45, .425, .39), line: rgb(.85, .82, .77), accent: rgb(.72, .64, .53),
    sand: rgb(.9, .855, .78), green: rgb(.88, .925, .855), white: rgb(1, 1, 1),
  };
  let page: PDFPage;
  let y = 0;
  const text = (value: string, x: number, top: number, size = 9, font = body, ink = color.ink) => {
    page.drawText(value, { x, y: height - top - size, size, font, color: ink });
  };
  const rect = (x: number, top: number, w: number, h: number, fill = color.paper, border = false) => {
    page.drawRectangle({ x, y: height - top - h, width: w, height: h, color: fill, ...(border ? { borderColor: color.line, borderWidth: .6 } : {}) });
  };
  const rule = (top: number, x = margin, w = usable) => page.drawLine({ start: { x, y: height - top }, end: { x: x + w, y: height - top }, thickness: .6, color: color.line });
  const brandLogo = (x: number, top: number, w: number, h: number) => {
    // The unchanged website PNG is 600x200; its artwork occupies this alpha
    // bounding box. Fit the artwork, not the transparent outer padding.
    const artwork = { x: 153, y: 30, width: 297, height: 144 };
    const scale = Math.min((w - 16) / artwork.width, (h - 12) / artwork.height);
    const imageTop = top + (h - artwork.height * scale) / 2 - artwork.y * scale;
    page.pushOperators(pushGraphicsState(), rectangle(x, height - top - h, w, h), clip(), endPath());
    page.drawImage(logo, {
      x: x + (w - artwork.width * scale) / 2 - artwork.x * scale,
      y: height - imageTop - logo.height * scale,
      width: logo.width * scale,
      height: logo.height * scale,
    });
    page.pushOperators(popGraphicsState());
  };
  const wrap = (value: string, w: number, font = body, size = 9): string[] => {
    const lines: string[] = [];
    let line = '';
    // Split long unbroken references/addresses as well as ordinary words.
    for (const word of clean(value).split(' ')) {
      if (font.widthOfTextAtSize(line ? line + ' ' + word : word, size) <= w) {
        line = line ? line + ' ' + word : word;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > w) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const fitted = (value: string, x: number, top: number, w: number, size: number, font = body, ink = color.ink, right = false) => {
    const measured = font.widthOfTextAtSize(value, size);
    const actual = measured > w ? size * w / measured : size;
    text(value, right ? x + w - font.widthOfTextAtSize(value, actual) : x, top, actual, font, ink);
  };
  const addPage = (first = false) => {
    page = doc.addPage([width, height]);
    rect(0, 0, width, height, color.canvas);
    if (first) {
      rect(0, 0, width, 116, color.ink);
      rect(margin, 12, 210, 92, color.white);
      brandLogo(margin, 12, 210, 92);
      text('DIGITAL INVOICE / RECEIPT', width - margin - 190, 26, 8, strong, color.sand);
      fitted(receipt.invoiceNumber, width - margin - 190, 45, 190, 16, strong, color.white);
      fitted('Generated ' + date(receipt.generatedAt.toISOString()), width - margin - 190, 72, 190, 7, body, color.sand);
      rect(width - margin - 88, 91, 88, 17, color.green);
      text('DELIVERED', width - margin - 68, 94, 7, strong);
      y = 136;
    } else {
      brandLogo(margin, 7, 94, 40);
      fitted(receipt.invoiceNumber + ' / continued', width - margin - 240, 29, 240, 9, strong, color.muted, true);
      rule(51); y = 67;
    }
  };
  const ensure = (needed: number) => { if (y + needed > bottom) addPage(); };
  type Line = { value: string; bold: boolean };
  const panelLines = (label: string, values: string[], w: number): Line[] => [
    { value: label, bold: true },
    ...values.flatMap((value) => wrap(value, w - 28).map((part) => ({ value: part, bold: false }))),
  ];
  const panels = (left: Line[], right: Line[], leftWidth = (usable - 14) / 2) => {
    const rightWidth = usable - leftWidth - 14;
    const expected = Math.max(left.length, right.length) * 14 + 28;
    // Keep normal-sized panels together; exceptionally long details flow to more pages.
    if (expected <= bottom - 67) ensure(expected);
    let offset = 0;
    while (offset < Math.max(left.length, right.length)) {
      const capacity = Math.floor((bottom - y - 28) / 14);
      if (capacity < 2) { addPage(); continue; }
      const count = Math.min(capacity, Math.max(left.length, right.length) - offset);
      const h = count * 14 + 28;
      rect(margin, y, leftWidth, h, color.paper, true);
      rect(margin + leftWidth + 14, y, rightWidth, h, color.paper, true);
      [left, right].forEach((lines, column) => {
        lines.slice(offset, offset + count).forEach((line, index) => text(line.value, margin + 14 + (column ? leftWidth + 14 : 0), y + 13 + index * 14, 9, line.bold ? strong : body, line.bold ? color.ink : color.muted));
      });
      offset += count; y += h + 16;
      if (offset < Math.max(left.length, right.length)) addPage();
    }
  };

  addPage(true);
  const half = (usable - 14) / 2;
  panels(panelLines('ISSUED BY', receipt.seller, half), panelLines('BILL TO', receipt.buyer, half));
  const tableHeader = () => {
    rect(margin, y, usable, 26, color.ink);
    text('ITEM', margin + 10, y + 8, 8, strong, color.white);
    text('QTY', margin + 279, y + 8, 8, strong, color.white);
    text('UNIT PRICE', margin + 316, y + 8, 8, strong, color.white);
    text('AMOUNT', margin + 444, y + 8, 8, strong, color.white);
    y += 26;
  };
  const firstRowHeight = wrap(receipt.items[0].name, 257).length * 13 + 23;
  ensure(Math.min(firstRowHeight + 52, bottom - 67));
  text('Order summary', margin, y, 15, display); y += 26;
  tableHeader();
  receipt.items.forEach((item, index) => {
    const lines = wrap(item.name, 257);
    let offset = 0;
    // Keep ordinary rows intact, split extreme product names without truncating them.
    const rowHeight = lines.length * 13 + 23;
    if (rowHeight <= bottom - 93 && y + rowHeight > bottom) { addPage(); tableHeader(); }
    while (offset < lines.length) {
      const capacity = Math.floor((bottom - y - 23) / 13);
      if (capacity < 1) { addPage(); tableHeader(); continue; }
      const count = Math.min(lines.length - offset, capacity);
      const h = count * 13 + 23;
      if (index % 2 === 0) rect(margin, y, usable, h);
      lines.slice(offset, offset + count).forEach((line, i) => text(line, margin + 10, y + 10 + i * 13));
      if (offset === 0) {
        fitted(String(item.quantity), margin + 273, y + 10, 28, 9, body, color.ink, true);
        fitted(receipt.money(item.unitPrice), margin + 309, y + 10, 90, 9, body, color.ink, true);
        fitted(receipt.money(item.amount), margin + 408, y + 10, usable - 418, 9, strong, color.ink, true);
      }
      y += h; rule(y);
      offset += count;
    }
  });
  y += 20;
  const paymentWidth = 300, totalsWidth = usable - paymentWidth - 14;
  const totals = [
    'Subtotal: ' + receipt.money(receipt.subtotal),
    'Delivery: ' + receipt.money(receipt.delivery),
    ...(receipt.discount ? [receipt.discountLabel + ': -' + receipt.money(receipt.discount)] : []),
    ...(receipt.adjustment ? ['Adjustment: ' + (receipt.adjustment > 0 ? '+' : '-') + receipt.money(Math.abs(receipt.adjustment))] : []),
    'TOTAL: ' + receipt.money(receipt.total),
  ];
  const totalLines = panelLines('ORDER TOTALS', totals, totalsWidth);
  totalLines.slice(-wrap(totals[totals.length - 1], totalsWidth - 28).length).forEach((line) => line.bold = true);
  panels(panelLines('PAYMENT & DELIVERY', [
    receipt.paymentMethod + ' / ' + receipt.paymentStatus.toUpperCase(),
    'Reference: ' + receipt.reference,
    'Placed: ' + receipt.placed,
    'Delivered: ' + receipt.delivered,
    'Deliver to: ' + receipt.deliveryAddress,
  ], paymentWidth), totalLines, paymentWidth);

  const note = wrap('This digital receipt records the delivered order and its saved charges. For additional invoice documentation, contact ' + (receipt.contact || receipt.seller[0]) + '.', usable - 28, body, 8);
  ensure(note.length * 12 + 48);
  rect(margin, y, usable, note.length * 12 + 42, color.sand);
  text('PAYMENT STATUS: ' + receipt.paymentStatus.toUpperCase(), margin + 14, y + 12, 8, strong);
  note.forEach((line, i) => text(line, margin + 14, y + 30 + i * 12, 8));

  const pages = doc.getPages();
  pages.forEach((target, index) => {
    page = target;
    rule(806);
    fitted(receipt.seller[0] + (receipt.contact ? ' / ' + receipt.contact : ''), margin, 816, usable - 80, 7, body, color.muted);
    fitted('Page ' + (index + 1) + ' of ' + pages.length, width - margin - 75, 816, 75, 7, body, color.muted, true);
  });
  return { filename: receipt.filename, bytes: await doc.save() };
}
