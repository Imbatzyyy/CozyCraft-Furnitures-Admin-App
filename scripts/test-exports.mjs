import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';
import '@angular/compiler';

const root = resolve(import.meta.dirname, '..');
const scratch = resolve(root, 'tmp/pdfs');
await mkdir(scratch, {recursive:true});
const output = resolve(scratch, 'exports-test.mjs');
await build({stdin:{contents:"export * from './src/app/core/native/export.service'; export * from './src/app/core/native/packing-list';",resolveDir:root,loader:'ts'},outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const { ExportService, packingListReport } = await import(pathToFileURL(output));
const order = {
  id:'packing-test',order_number:'CC-SAMPLE-001',status:'processing',cancellation_status:null,
  payment_method:'cod',payment_status:'pending',created_at:'2026-09-12T08:00:00Z',
  shipping_address:{name:'Alex Reyes',mobile:'0900 000 0000',email:'alex@example.test',line:'12 Sample Street',city:'Quezon City',province:'Metro Manila',postal:'1100',note:'Call before arrival; use the side entrance.'},
  order_items:[{product_id:'SKU-001',product_name:'Oak cabinet with adjustable shelves',quantity:2}],
};
const model = packingListReport(order, new Date('2026-09-13T01:00:00Z'));
assert.equal(model.kpis[3].value,'2');
assert.equal(model.kpis[1].detail,'Collect on delivery');
assert(model.rows.some(row=>String(row[0]).includes('side entrance')));
assert(model.rows.some(row=>row[1]==='SKU-001'&&row[2]===2));
assert.throws(()=>packingListReport({...order,status:'cancelled'}),/cancelled/i);
assert.throws(()=>packingListReport({...order,cancellation_status:'pending'}),/cancellation/);
console.log('PASS Packing fields, COD state, quantities and cancelled-order guards');
const service = new ExportService();
service.fontAsset = async path => new Uint8Array(await readFile(resolve(root,'src',path))).buffer;
let captured;
service.shareBytes = async (filename, bytes) => {captured={filename,bytes};return null;};
assert.equal(await service.premiumPdf(model),null);
assert.equal((await PDFDocument.load(captured.bytes)).getPageCount(),1);
await writeFile(resolve(scratch,'packing-list-sample.pdf'),captured.bytes);
console.log('PASS Packing list exports a single-page PDF');
const longName='Long item '+ 'with adjustable shelves and premium fabric '.repeat(10)+'COMPLETE-END-MARKER';
const report={...model,title:'Export stress test',rows:Array.from({length:82},(_,i)=>['Line '+(i+1)+' '+longName,'SKU-'+i,1,'[  ]'])};
assert.equal(await service.premiumPdf(report),null);
assert((await PDFDocument.load(captured.bytes)).getPageCount()>5);
await writeFile(resolve(scratch,'report-wrapping-sample.pdf'),captured.bytes);
console.log('PASS Multi-page report exports 82 long rows');
assert.equal(await service.premiumPdf({...model,rows:[['UNBROKEN-'+ 'x'.repeat(6000)+'-END','','','']]}),null);
assert((await PDFDocument.load(captured.bytes)).getPageCount()>1);
console.log('PASS Extremely long cells split across pages');
captured=null;
assert.equal(await service.premiumPdf(model,()=>false),null); assert.equal(captured,null);
console.log('PASS Leaving the order prevents a late export or share sheet');
assert.equal(await service.premiumPdf({...model,rows:[]}),null);
assert.equal((await PDFDocument.load(captured.bytes)).getPageCount(),1);
console.log('PASS Empty report retains a readable one-page result');
console.log('6 export regression checks passed. Synthetic data only.');
