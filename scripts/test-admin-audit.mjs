import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'tmp/admin-audit/regressions.mjs');
await mkdir(resolve(root, 'tmp/admin-audit'), { recursive: true });
await build({ stdin: { contents: `
  export * from './src/app/core/utils/format';
  export * from './src/app/core/utils/admin-permissions';
  export * from './src/app/core/utils/pagination';
  export * from './src/app/core/utils/order-filters';
  export * from './src/app/core/utils/csv';
  export * from './src/app/core/utils/reporting-period';
  export * from './src/app/core/utils/notification-destination';
  export * from './src/app/core/data/admin-data.service';
  export * from './src/app/core/data/admin-actions.service';
  export * from './src/app/core/native/connectivity.service';
  export * from './src/app/features/catalog/catalog-actions.service';
  export * from './src/app/features/loyalty/member-tiers.service';
  export * from './src/app/features/merchandising/merchandising.service';
`, resolveDir: root, loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });

const timers = new Set();
const localStore = new Map();
globalThis.localStorage = { getItem: key => localStore.get(key) ?? null, setItem: (key, value) => localStore.set(key, value), removeItem: key => localStore.delete(key) };
globalThis.window = Object.assign(new EventTarget(), {
  matchMedia: () => ({ matches: false }), screen: { width: 390, height: 844 }, devicePixelRatio: 3,
  setTimeout: (fn, delay) => { const id = setTimeout(fn, delay); timers.add(id); return id; }, clearTimeout,
});
globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true, hardwareConcurrency: 4 } });
await import('@angular/compiler');
const { signal } = await import('@angular/core');
const api = await import(pathToFileURL(output));
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log('PASS ' + name); };
const tick = delay => new Promise(resolve => setTimeout(resolve, delay));
const deferred = () => { let resolve; let reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const order = (id = 'one', changes = {}) => ({ id, user_id: 'customer', order_number: 'CC-' + id, status: 'pending', payment_status: 'pending', payment_method: 'cod', created_at: '2026-09-12T10:00:00Z', subtotal: 1, delivery_fee: 0, total: 1, shipping_address: { name: 'Alex', mobile: '09001234567' }, order_items: [{ id: 1, product_name: 'Oak Cabinet', unit_price: 1, quantity: 1 }], order_status_history: [], payment_transactions: [], ...changes });
const auth = () => ({ signedIn: signal(true), role: signal('superadmin'), userId: signal('admin') });
const workspace = (client = {}) => new api.AdminDataService({ client }, auth(), {});
const chain = result => { const q = new Proxy({}, { get: (_, key) => key === 'then' ? Promise.resolve(result).then.bind(Promise.resolve(result)) : () => q }); return q; };

await test('Role guard rejects missing roles and protects financial/settings pages', () => {
  assert.equal(api.canAccessRoute(null, '/app/orders'), false);
  assert.equal(api.canAccessRoute('staff', '/app/system-health'), false);
  assert.equal(api.canAccessRoute('admin', '/app/system-health'), true);
  assert.equal(api.canAccessRoute('admin', '/app/settings'), false);
  assert.equal(api.canAccessRoute('superadmin', '/app/settings'), true);
});
await test('Return destinations reject external and malformed URLs', () => {
  for (const path of ['https://example.com', '//example.com', '/app/\\evil', '/app/payments']) assert.equal(api.safeAdminReturnUrl('staff', path), '/app/dashboard');
  assert.equal(api.safeAdminReturnUrl('staff', '/app/orders/one'), '/app/orders/one');
});
await test('Pagination stays bounded, reaches last row, resets and clamps after deletion', () => {
  const records = signal(Array.from({ length: 51 }, (_, i) => i)); const pager = api.createPagination(records, 6);
  assert.equal(pager.visible().length, 6); pager.select(9); assert.deepEqual(pager.visible(), [48,49,50]);
  records.set([0,1]); assert.equal(pager.page(), 1); assert.deepEqual(pager.visible(), [0,1]);
  records.set([]); assert.equal(pager.pageCount(), 1); assert.deepEqual(pager.visible(), []); pager.select(NaN); assert.equal(pager.page(), 1);
});
await test('PHT date ranges match midnight boundaries independently of device timezone', () => {
  const now = Date.parse('2026-09-13T01:00:00Z');
  assert(api.orderMatchesRange('2026-09-12T16:00:00Z','today',now));
  assert(!api.orderMatchesRange('2026-09-12T15:59:59Z','today',now));
  assert(api.orderMatchesRange('2026-09-06T16:00:00Z','last_7_days',now));
  assert(!api.orderMatchesRange('2026-09-06T15:59:59Z','last_7_days',now));
  assert(!api.orderMatchesRange('bad','today',now));
});
await test('Fulfillment, refund, returns and overdue saved views preserve website rules', () => {
  assert(api.orderMatchesView(order(), 'needs_fulfillment', new Set()));
  assert(!api.orderMatchesView(order('one',{cancellation_status:'pending'}),'needs_fulfillment',new Set()));
  assert(!api.orderMatchesView(order('one',{payment_method:'gcash'}),'needs_fulfillment',new Set()));
  assert(api.orderMatchesView(order('one',{payment_method:'gcash'}),'awaiting_payment',new Set()));
  assert(api.orderMatchesView(order(),'returns',new Set(['one'])));
  assert(api.orderMatchesView(order('one',{refund_status:'failed'}),'refund_attention',new Set()));
  assert(!api.orderMatchesView(order('one',{status:'delivered'}),'overdue',new Set(),Date.parse('2026-09-20')));
});
await test('Order search includes product names, phone and exact record IDs', () => {
  const text = api.orderSearchText(order('exact-id')); for (const term of ['oak cabinet','09001234567','exact-id']) assert(text.includes(term));
});
await test('Current payment falls back to paid_at and created_at without mutating data', () => {
  const payments = [{ id:1,status:'paid',paid_at:'2026-09-01T00:00Z' },{id:2,status:'paid',paid_at:'2026-09-02T00:00Z'},{id:3,status:'failed',updated_at:'2026-09-03T00:00Z'}];
  assert.equal(api.currentPayment(order('one',{payment_transactions:payments})).id,2); assert.equal(payments[0].id,1);
});
await test('Timestamp formatting accepts database precision and invalid dates safely', () => {
  assert(api.parseTimestamp('2026-08-24 11:00:00.123456+08'));
  assert.equal(api.dateTime('bad'), 'Not recorded'); assert.equal(api.money(10.25,2), '₱10.25');
});
await test('CSV cells neutralize formulas, retain numeric negatives and escape quotes', () => {
  for (const text of ['=HYPERLINK("bad")',' +SUM(1,2)','\t@SUM(1,2)','-10+20']) assert(api.csvCell(text).startsWith('"\''));
  assert.equal(api.csvCell(-10),'"-10"'); assert.equal(api.csvCell('a"b'),'"a""b"'); assert.equal(api.csvCell(null),'""');
});
await test('Successful retry ignores old probe failure and clears offline state', async () => {
  const old = deferred(); const latest = deferred(); let count = 0; globalThis.fetch = () => (++count === 1 ? old.promise : latest.promise);
  const monitor = new api.ConnectivityService(); monitor.statusState.set('offline');
  const first = monitor.checkNow(true); const retry = monitor.retry(); latest.resolve({status:200}); await retry;
  old.reject(new Error('old network')); await first; assert.equal(monitor.status(),'online'); assert.equal(monitor.checking(),false);
  monitor.hideRestoredState(); monitor.cancelFollowUpProbe();
});
await test('Repeated background probes share a request', async () => {
  const response = deferred(); let count=0; globalThis.fetch = () => { count++; return response.promise; };
  const monitor = new api.ConnectivityService(); const first=monitor.checkNow(true); const second=monitor.checkNow();
  assert.equal(count,1); response.resolve({status:200}); await Promise.all([first,second]); monitor.hideRestoredState();
});
await test('Offline event invalidates a pending successful response', async () => {
  const response=deferred(); globalThis.fetch=() => response.promise; const monitor=new api.ConnectivityService();
  const first=monitor.checkNow(true); monitor.handleOffline(); response.resolve({status:200}); await first;
  assert.equal(monitor.status(),'offline'); monitor.cancelFollowUpProbe();
});
await test('Singular graph relations normalize instead of throwing .map errors', () => {
  const data=workspace(); const raw=order(); const normalized=data.normalizeOrder({...raw, order_items:raw.order_items[0], payment_transactions:{amount:'12'}, profiles:[{full_name:'Alex'}]});
  assert.equal(normalized.order_items.length,1); assert.equal(normalized.payment_transactions[0].amount,12); assert.equal(normalized.profiles.full_name,'Alex');
});
await test('A disappeared order is removed from retained detail state', async () => {
  const data=workspace({from:()=>chain({data:null,error:null})}); data.ordersState.set([order()]);
  assert.equal(await data.loadOrderDetail('one'),null); assert.deepEqual(data.orders(),[]);
});
await test('Simultaneous full refreshes share one snapshot', async () => {
  const data=workspace(); const pending=deferred(); let count=0; data.refreshWorkspace=()=>{count++;return pending.promise;};
  const first=data.refreshAll(); const second=data.refreshAll(); assert.equal(count,1); pending.resolve(); await Promise.all([first,second]);
});
await test('Logout stops history pagination before the next database request', async () => {
  const data=workspace(); let count=0; const rows=await data.pagedRows(async()=> {count++; data.auth.signedIn.set(false); return {data:Array(500).fill({id:1}),error:null};});
  assert.equal(count,1); assert.deepEqual(rows,[]);
});
await test('Order events coalesce into one bounded graph query', async () => {
  let calls=0, queried=[];
  const data=workspace({from:()=>({select:()=>({in:async(_,ids)=>{calls++;queried=ids;return {data:[order()],error:null};}})})});
  for (let i=0;i<8;i++) data.scheduleOrderChange({eventType:'UPDATE',new:{order_id:'one'},old:{}},'order_id',0);
  await tick(450); assert.equal(calls,1); assert.deepEqual(queried,['one']); assert.equal(data.orders().length,1); await data.stop();
});
await test('RLS delete payload without parent schedules reconciliation', () => {
  const data=workspace(); let target=''; data.scheduleRefresh=(value)=>{target=value;};
  data.scheduleOrderChange({eventType:'DELETE',new:{},old:{id:7}},'order_id',0); assert.equal(target,'orders');
});
await test('Parent delete removes the row without downloading history', () => {
  const data=workspace(); data.ordersState.set([order()]); data.scheduleOrderChange({eventType:'DELETE',new:{},old:{id:'one'}},'id',0); assert.equal(data.orders().length,0);
});
await test('Committed actions survive refresh failure with a truthful retry notice', async () => {
  const data=workspace(); await data.reconcileAfterWrite([async()=>{throw new Error('offline');}]); assert.match(data.error(),/change was saved/);
  const actions=new api.AdminActionsService({client:{from:()=>chain({data:{id:'one'},error:null})}},auth(),{reconcileAfterWrite:async()=>{},loadOrderDetail:async()=>{throw new Error('offline');}});
  assert.equal((await actions.updateOrderStatus(order(),'processing')).error,null);
});
await test('Support reply does not query the administrator-only customer directory', async () => {
  let customers=0,tickets=0; const data={reconcileAfterWrite:async(reads)=>Promise.all(reads.map(read=>read())),loadTickets:async()=>{tickets++;},loadCustomers:async()=>{customers++;}};
  const actions=new api.AdminActionsService({client:{from:()=>chain({data:{id:'one'},error:null})}},auth(),data);
  assert.equal((await actions.replyToTicket({id:'one'},'Your order is ready','open')).error,null); assert.equal(tickets,1); assert.equal(customers,0);
});
await test('Protected workflows use the native-compatible authenticated transport', async () => {
  let invoked=''; const actions=new api.AdminActionsService({client:{},invokeAuthenticatedFunction:async(name)=>{invoked=name;return {success:true};}},auth(),{reconcileAfterWrite:async()=>{}});
  assert.equal((await actions.sendRefundEmail('one')).error,null); assert.equal(invoked,'send-refund-email');
});
await test('Editing a product never sends stale stock; creation still sets opening stock', async () => {
  let updated,inserted; const client={from:()=>({update:(payload)=>{updated=payload;return chain({data:product,error:null});},insert:(payload)=>{inserted=payload;return chain({data:product,error:null});}})};
  const data={loadProducts:async()=>{},loadInventory:async()=>{},reconcileAfterWrite:async()=>{}};
  const actions=new api.CatalogActionsService({client},auth(),data);
  const product={id:'one',name:'Cabinet',category:'Room',subcategory:'Cabinets',price:100,stock_quantity:8,status:'active',color:'oak',material:'',dimensions:'',description:'A sample cabinet',images:['1','2','3','4'],main_image_index:0};
  assert.equal((await actions.saveProduct(product,false)).error,null); assert(!('stock_quantity' in updated));
  assert.equal((await actions.saveProduct(product,true)).error,null); assert.equal(inserted.stock_quantity,8);
});
await test('Month and quarter reports use Philippine midnight across year boundaries', () => {
  const now = new Date('2026-12-31T17:00:00Z');
  assert.equal(api.phtMonthStart(now).toISOString(), '2026-12-31T16:00:00.000Z');
  assert.equal(api.reportingBounds('quarter', now).start.toISOString(), '2026-12-31T16:00:00.000Z');
  const range = api.reportingBounds('week', now);
  assert.equal(range.start.toISOString(), '2026-12-25T16:00:00.000Z');
  assert.equal(api.reportingSlices('week', range.start, now).length, 7);
  const quarter = api.reportingSlices('quarter', api.phtMonthStart(now), now);
  assert.deepEqual(quarter.map(item => item.label), ['Jan', 'Feb', 'Mar']);
  assert(quarter.every(item => item.end >= item.start));
});
await test('New tools and exact order notifications preserve safe mobile destinations', () => {
  for (const page of ['system-health','content','experience','member-tiers']) assert.equal(api.adminNotificationDestination({route:'/admin/'+page}), '/app/'+page);
  assert.equal(api.adminNotificationDestination({kind:'order',entity_type:'orders',entity_id:'order-1',route:'/admin/orders'}), '/app/orders/order-1');
  assert.equal(api.adminNotificationDestination({route:'https://example.com/app/orders'}), '/app/notifications');
});
await test('Returning to a cached loyalty page cancels a stale request without a stuck spinner', async () => {
  const pending = deferred();
  const service = new api.MemberTiersService({client:{from:()=>chain(pending.promise)}});
  const original = {page:0,pageSize:8,tier:'all',sort:'points',query:''};
  service.lastRequestKey = JSON.stringify(original); service.lastLoadedAt = Date.now();
  const stale = service.loadPage({...original,page:1});
  assert(service.loading());
  await service.loadPage(original);
  assert.equal(service.loading(),false);
  pending.resolve({data:[],error:null,count:0}); await stale;
  assert.equal(service.loading(),false);
});
await test('Delivery settings reject non-finite amounts and fractional delivery days before writing', async () => {
  const service = new api.MerchandisingService({client:{from:()=>{throw new Error('Must not write invalid data');}}});
  const area = {name:'Metro',delivery_fee:NaN,free_delivery_minimum:null,lead_time_min_days:1,lead_time_max_days:2};
  assert.match(await service.saveArea(area), /valid delivery amounts/);
  assert.match(await service.saveArea({...area,delivery_fee:100,lead_time_max_days:1.5}), /whole numbers/);
});
for (const timer of timers) clearTimeout(timer);
await test('Legacy return notifications never confuse return IDs with order IDs', () => {
  assert.equal(api.adminNotificationDestination({entity_type:'return_requests',entity_id:'return-1',kind:'order'}),'/app/orders?view=returns');
  assert.equal(api.adminNotificationDestination({entity_type:'return_requests',entity_id:'return-1',route:'/admin/orders/order-1'}),'/app/orders/order-1');
});
await test('Every statically referenced outline icon is bundled for offline native use', async () => {
  const walk=async path=>(await Promise.all((await readdir(path,{withFileTypes:true})).map(entry=>entry.isDirectory()?walk(resolve(path,entry.name)):resolve(path,entry.name)))).flat();
  const registered=await readFile(resolve(root,'src/app/core/icons/app-icons.ts'),'utf8');
  for(const path of await walk(resolve(root,'src/app'))){
    if(!/\.(ts|html)$/.test(path)) continue;
    for(const match of (await readFile(path,'utf8')).matchAll(/["']([a-z]+(?:-[a-z]+)*-outline)["']/g)) {
      const camel=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
      assert(registered.includes(camel),'Missing icon '+match[1]);
    }
  }
});
await test('Mobile release does not expose the unverified customer access mutation', async () => {
  const source = await readFile(resolve(root, 'src/app/features/customers/customer-management.component.ts'), 'utf8');
  assert(!source.includes('set-status'));
  assert(!source.includes('confirmAccessChange'));
  assert(source.includes("action: 'update'"), 'Profile editing remains available');
});
console.log(`${passed} admin audit regression checks passed. No production requests or writes.`);
