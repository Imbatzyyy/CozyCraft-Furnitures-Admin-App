import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const scratch = new URL('tmp/pdfs/', root);
await mkdir(scratch, { recursive: true });
const source = await readFile(new URL('src/app/core/native/order-receipt.ts', root), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
await writeFile(new URL('order-receipt.mjs', scratch), compiled);
const { prepareOrderReceipt, createOrderReceiptPdf } = await import(new URL('order-receipt.mjs', scratch).href + '?test=' + Date.now());

// Synthetic customer data only. No database connection or production writes.
const order = {
  id: 'receipt-test', order_number: 'CC-SAMPLE-001', user_id: 'sample-customer', status: 'delivered',
  payment_method: 'gcash', payment_status: 'paid', created_at: '2026-08-24T01:00:00Z',
  subtotal: 15998, delivery_fee: 650, reward_discount: 500, total: 16148,
  shipping_address: { name: 'Alex Reyes', mobile: '0900 000 0000', line: '12 Sample Street', barangay: 'Sample Village', city: 'Quezon City', province: 'Metro Manila', postal: '1100' },
  profiles: { full_name: 'Alex Reyes', email: 'alex@example.com', phone: '0900 000 0000' },
  order_items: [{ id: 1, product_name: 'HEMLINGBY two-seat sofa - warm beige', unit_price: 7999, quantity: 2, image_url: null, product_id: null }],
  order_status_history: [
    { status: 'delivered', changed_at: '2026-08-25T02:15:00Z' },
    { status: 'processing', changed_at: '2026-08-24T04:00:00Z' },
    { status: 'delivered', changed_at: '2026-08-25T01:00:00Z' },
  ],
  payment_transactions: [
    { status: 'paid', provider_payment_id: 'pay_older', paid_at: '2026-08-24T01:00:00Z', currency: 'PHP' },
    { status: 'paid', provider_payment_id: 'pay_sample_001', paid_at: '2026-08-24T02:00:00Z', currency: 'PHP' },
    { status: 'failed', provider_payment_id: 'pay_failed', updated_at: '2026-08-26T02:00:00Z', currency: 'PHP' },
  ],
};
const store = { store_name: 'CozyCraft Furnitures', contact_email: 'store@example.com', support_phone: '0900 000 0000', business_address: 'Metro Manila, Philippines', delivery_area: '', currency_code: 'PHP' };
const billing = { recipient_name: 'Alex Reyes', company_name: 'Sample Interiors', tax_id: 'SAMPLE-TAX-ID', invoice_email: 'billing@example.com', address_line: '85 Sample Avenue', barangay: 'Sample District', city: 'Makati', province: 'Metro Manila', postal_code: '1200', same_as_delivery: false };
const input = { order, store, billing, generatedAt: new Date('2026-08-28T02:00:00Z') };
let passed = 0;
const check = (name, action) => { action(); passed++; console.log('PASS ' + name); };
const model = prepareOrderReceipt(input);
check('Only delivered orders can be exported', () => {
  for (const status of ['pending', 'processing', 'packed', 'shipped', 'cancelled']) assert.throws(() => prepareOrderReceipt({ ...input, order: { ...order, status } }), /after.*delivered/);
});
check('Stored amounts, reward and cent-accurate reconciliation', () => {
  assert.equal(model.total, 1614800); assert.equal(model.discount, 50000); assert.equal(model.adjustment, 0);
  assert.equal(model.money(model.total), 'PHP 16,148.00');
  assert.equal(prepareOrderReceipt({ ...input, order: { ...order, subtotal: 10.1, delivery_fee: .2, reward_discount: .1, total: 10.2 } }).adjustment, 0);
});
check('Legacy discount and positive adjustment', () => {
  assert.equal(prepareOrderReceipt({ ...input, order: { ...order, reward_discount: undefined } }).discountLabel, 'Order discount');
  assert.equal(prepareOrderReceipt({ ...input, order: { ...order, reward_discount: 0, total: 17000 } }).adjustment, 35200);
});
check('Latest paid reference and actual delivered timestamp in PHT', () => {
  assert.equal(model.reference, 'pay_sample_001'); assert.match(model.delivered, /10:15 AM PHT/);
  assert.equal(prepareOrderReceipt({ ...input, order: { ...order, order_status_history: [] } }).delivered, 'Not recorded');
});
check('Billing profile, invoice email and delivery fallback', () => {
  assert(model.buyer.includes('billing@example.com')); assert(model.buyer.some((v) => v.includes('85 Sample Avenue')));
  assert(prepareOrderReceipt({ ...input, billing: null }).buyer.some((v) => v.includes('12 Sample Street')));
  assert(prepareOrderReceipt({ ...input, billing: { ...billing, same_as_delivery: true } }).buyer.some((v) => v.includes('12 Sample Street')));
});
check('Pending COD and refunded orders are never labeled paid', () => {
  for (const payment_status of ['pending', 'refunded']) {
    const receipt = prepareOrderReceipt({ ...input, order: { ...order, payment_method: 'cod', payment_status } });
    assert.equal(receipt.paymentStatus, payment_status); assert.equal(receipt.reference, 'COD-CC-SAMPLE-001');
  }
});
check('Singular/null embedded relations are safe', () => {
  const receipt = prepareOrderReceipt({ ...input, order: { ...order, order_items: order.order_items[0], order_status_history: order.order_status_history[0], payment_transactions: order.payment_transactions[0], profiles: [order.profiles] } });
  assert.equal(receipt.items.length, 1); assert.equal(receipt.reference, 'pay_older');
  assert.equal(prepareOrderReceipt({ ...input, order: { ...order, payment_transactions: null, order_status_history: null, profiles: null } }).reference, 'PAY-CC-SAMPLE-001');
});
check('Incomplete or invalid financial data blocks export', () => {
  for (const subtotal of [NaN, null, undefined, '', -1, Infinity]) assert.throws(() => prepareOrderReceipt({ ...input, order: { ...order, subtotal } }));
  assert.throws(() => prepareOrderReceipt({ ...input, order: { ...order, order_items: [] } }));
  assert.throws(() => prepareOrderReceipt({ ...input, order: { ...order, order_items: [{ ...order.order_items[0], quantity: 0 }] } }));
});
check('Safe, order-specific PDF filename', () => {
  assert.equal(model.filename, 'CozyCraft-Invoice-CC-SAMPLE-001.pdf');
  assert(!prepareOrderReceipt({ ...input, order: { ...order, order_number: '../bad/name' } }).filename.includes('/'));
});

const [body, strong, display] = await Promise.all(['dm-sans-400.ttf', 'dm-sans-700.ttf', 'dm-serif-display-400.ttf'].map((name) => readFile(new URL('src/assets/fonts/' + name, root))));
const fonts = { body, strong, display };
const logo = await readFile(new URL('src/assets/branding/cozycraft-receipt-logo.png', root));
const sample = await createOrderReceiptPdf(input, fonts, logo);
const sampleDoc = await PDFDocument.load(sample.bytes);
assert.equal(sampleDoc.getPageCount(), 1);
assert.match(sampleDoc.getTitle(), /INV-CC-SAMPLE-001/);
await writeFile(new URL('receipt-sample.pdf', scratch), sample.bytes);
console.log('PASS Single-page PDF with embedded fonts and invoice metadata');
const logoRef = (doc, page) => {
  const images = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  assert.equal(images.keys().length, 1);
  const ref = images.values()[0];
  const image = doc.context.lookup(ref, PDFRawStream);
  assert.equal(image.dict.get(PDFName.of('Subtype')).toString(), '/Image');
  assert.equal(image.dict.get(PDFName.of('Width')).asNumber(), 600);
  assert.equal(image.dict.get(PDFName.of('Height')).asNumber(), 200);
  return ref.toString();
};
check('Official logo is embedded as an image, not recreated text', () => {
  assert.equal(createHash('sha256').update(logo).digest('hex'), 'b9ef8a4666f62c6aa7a8b2f2551ee18b6799dc7d19380d1709106725204f04a5');
  logoRef(sampleDoc, sampleDoc.getPage(0));
});

const largeItems = Array.from({ length: 65 }, (_, index) => ({ ...order.order_items[0], id: index + 1, product_name: 'Line ' + (index + 1) + ' - Premium modular sofa, extended chaise with washable fabric and matching cushions', quantity: 1 }));
const many = await createOrderReceiptPdf({ ...input, order: { ...order, order_items: largeItems, subtotal: 519935, total: 520085 } }, fonts, logo);
const manyDoc = await PDFDocument.load(many.bytes);
assert(manyDoc.getPageCount() >= 3);
check('The same embedded logo is reused on every receipt page', () => {
  const refs = manyDoc.getPages().map((page) => logoRef(manyDoc, page));
  assert.equal(new Set(refs).size, 1);
});
await writeFile(new URL('receipt-many-items.pdf', scratch), many.bytes);
console.log('PASS Multi-page order with all 65 item rows');

const extreme = await createOrderReceiptPdf({
  ...input,
  billing: { ...billing, address_line: 'Long address '.repeat(250), invoice_email: 'reference'.repeat(50) + '@example.com' },
  order: { ...order, order_items: [{ ...order.order_items[0], product_name: 'Long product description '.repeat(300) }] },
}, fonts, logo);
assert((await PDFDocument.load(extreme.bytes)).getPageCount() >= 3);
await writeFile(new URL('receipt-long-fields.pdf', scratch), extreme.bytes);
await writeFile(new URL('fixture.json', scratch), JSON.stringify(input));
console.log('PASS Long names, addresses and unbroken fields paginate without truncation');
console.log(passed + 3 + ' receipt checks passed. Synthetic PDF previews: ' + fileURLToPath(scratch));
