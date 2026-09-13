// Local-only visual regression fixture. It has no credentials or database access.
import '@angular/compiler';
import { Component, ErrorHandler, signal, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { appRoutes } from '../out-tsc/app/app/app.routes.js';
import { registerAppIcons } from '../out-tsc/app/app/core/icons/app-icons.js';
import { AdminDataService } from '../out-tsc/app/app/core/data/admin-data.service.js';
import { AdminAuthService } from '../out-tsc/app/app/core/auth/admin-auth.service.js';
import { SupabaseAdminService } from '../out-tsc/app/app/core/auth/supabase-admin.service.js';
import { NativePlatformService } from '../out-tsc/app/app/core/native/native-platform.service.js';
import { AppLockService } from '../out-tsc/app/app/core/auth/app-lock.service.js';
import { ConnectivityService } from '../out-tsc/app/app/core/native/connectivity.service.js';
import { CozyToastService } from '../out-tsc/app/app/shared/components/toast.service.js';
import { defaultStoreSettings, defaultAdminSecuritySettings } from '../out-tsc/app/app/core/models/defaults.js';

registerAppIcons();
const deviceOnly = new URLSearchParams(location.search).has('device');
const initialPath = location.pathname;
if (deviceOnly) {
  document.querySelectorAll('#tools,#notice,#errors').forEach(el => el.style.display='none');
  Object.assign(document.querySelector('#device').style,{width:'100%',height:'100dvh',margin:'0',border:'0'});
}
const logs = [];
const notice = document.querySelector('#notice');
const report = (text) => { notice.textContent = text; };
const record = (text) => { logs.push(text); document.querySelector('#errors').textContent = logs.join('\n') || 'No runtime errors'; };
window.addEventListener('error', (event) => record(event.message));
window.addEventListener('unhandledrejection', (event) => record(String(event.reason)));
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
  const resolved = new URL(typeof url === 'string' ? url : url.url, location.href);
  if (resolved.origin !== location.origin) return Promise.reject(new Error('External request blocked by audit fixture'));
  return originalFetch(url, options);
};
const now = new Date().toISOString();
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="25" fill="#b8a58d"/><text x="50" y="62" text-anchor="middle" fill="#fff" font-size="30">CC</text></svg>');
const customer = { id:'customer-1',full_name:'Alex Reyes',email:'alex@example.test',phone:'0900 000 0000',username:'alexreyes',gender:'male',avatar_url:image,role:'customer',staff_active:true,customer_active:true,created_at:now,addresses:[{id:'address',user_id:'customer-1',label:'Home',recipient_name:'Alex Reyes',mobile:'0900 000 0000',email:'alex@example.test',address_line:'12 Sample Street',barangay:'Sample Village',city:'Quezon City',province:'Metro Manila',postal_code:'1100',is_primary:true}] };
const products = Array.from({length:51},(_,i)=>({id:'product-'+i,name:'Oak Cabinet '+i,category:'Living Room',subcategory:'Cabinets',price:7999.5,stock_quantity:i%12,status:i%4===0?'draft':'active',color:'Natural oak',material:'Oak wood',dimensions:'Width: 80 cm',description:'A compact cabinet with generous storage for a welcoming home.',images:[image,image,image,image],main_image_index:0,rating:4.5,review_count:4,created_at:now,updated_at:now}));
const orders = Array.from({length:51},(_,i)=>({id:'order-'+i,order_number:'CC-'+String(1100+i),user_id:'customer-1',status:['pending','processing','packed','shipped','delivered','cancelled'][i%6],payment_method:i%2?'gcash':'cod',payment_status:i%2?'paid':'pending',refund_status:i===50?'failed':null,cancellation_status:i===49?'pending':null,subtotal:7999.5,delivery_fee:650,reward_discount:0,total:8649.5,created_at:new Date(Date.now()-i*86400000).toISOString(),shipping_address:{name:'Alex Reyes',email:customer.email,mobile:customer.phone,line:'12 Sample Street',barangay:'Sample Village',city:'Quezon City',province:'Metro Manila',postal:'1100'},profiles:customer,order_items:[{id:i,product_id:'product-0',product_name:'Oak Cabinet',quantity:1,unit_price:7999.5,image_url:image}],order_status_history:[{id:i,status:'pending',changed_at:now}],payment_transactions:[]}));
const tickets = Array.from({length:24},(_,i)=>({id:'ticket-'+i,ticket_number:'SUP-'+i,user_id:'customer-1',order_id:'order-0',subject:'Delivery inquiry '+i,message:'Please confirm the delivery window for my order.',status:i%2?'in_progress':'open',category:'delivery',priority:i%2?'normal':'high',assigned_to:null,attachment_paths:[],admin_reply:null,profiles:customer,created_at:now,updated_at:now}));
const reviews = Array.from({length:19},(_,i)=>({id:'review-'+i,rating:4,title:'A comfortable addition '+i,body:'The product arrived safely. It looks great in our living room.',approved:i%2===0,image_urls:[image],profiles:customer,products:{name:'Oak Cabinet'},created_at:now}));
const customers = Array.from({length:25},(_,i)=>({...customer,id:i===0?'customer-1':'customer-'+(i+1),full_name:'Alex Reyes '+(i+1)}));
const tables = {
  products, orders, support_tickets:tickets, reviews, profiles:customers, categories:[{id:1,name:'Living Room',slug:'living-room',sort_order:1,active:true,created_at:now}],
  client_error_events:[{id:1,message:'Synthetic network interruption',path:'/checkout',created_at:now}],
  mobile_loyalty_accounts:[{user_id:'customer-1',points_balance:2500,lifetime_eligible_spend:40000,tier:'plus',tier_valid_until:now,updated_at:now,last_activity_at:now}],
  mobile_loyalty_transactions:Array.from({length:16},(_,i)=>({id:String(i),user_id:'customer-1',kind:'earned',points:100,description:'Delivered order reward',created_at:now,expires_at:now})),
  mobile_loyalty_redemptions:[{id:'reward',user_id:'customer-1',points_cost:500,discount_amount:100,status:'available',code:'SAMPLE',created_at:now,expires_at:now,used_at:null}],
  delivery_service_areas:[{id:1,area_code:'metro',name:'Metro Manila',description:'City delivery',delivery_fee:650,free_delivery_minimum:50000,lead_time_min_days:3,lead_time_max_days:7,assembly_available:true,active:true,sort_order:1}],
  search_synonyms:[{id:1,term:'sofa',synonyms:['couch'],active:true}], search_events:[],product_alerts:[],
  content_pages:[{slug:'about',eyebrow:'Our story',title:'About CozyCraft',summary:'Furniture for your home',body:'A sample content page for visual review.',published:true,updated_at:now}],
  homepage_banners:[{id:'banner',eyebrow:'New collection',title:'Space to slow down',subtitle:'Considered pieces for everyday living',image_url:image,cta_label:'Explore',cta_path:'/new-arrivals',active:true,starts_at:null,ends_at:null,sort_order:1,updated_at:now}],
  email_templates:[{event_type:'order_confirmation',subject_template:'Order received',heading:'Thank you',body_template:'Your order {{order_number}} is confirmed.',enabled:true,updated_at:now}], email_delivery_logs:[],
};
let offline=false;
const query = (table) => {
  let rows=[...(tables[table]??[])],first=0,last=999,singular=false,mutation=false;
  const q = new Proxy({}, {get:(_,key)=>{
    if(key==='then') { const result=offline?{data:null,error:{message:'Offline simulation'},count:0}:{data:singular?rows[0]??null:rows.slice(first,last+1),count:rows.length,error:null}; return Promise.resolve(result).then.bind(Promise.resolve(result)); }
    return (...args)=>{
      if(key==='eq') rows=rows.filter(row=>row[args[0]]===args[1]);
      if(key==='in') rows=rows.filter(row=>args[1].includes(row[args[0]]));
      if(key==='range') [first,last]=args;
      if(key==='limit') last=args[0]-1;
      if(key==='single'||key==='maybeSingle') singular=true;
      if(['update','upsert','insert','delete'].includes(key)){mutation=true;report('Simulated '+key+' on '+table+' — no production write');}
      return q;
    };
  }});
  return q;
};
const connection = {client:{from:query,rpc:()=>query('profiles'),storage:{from:()=>({createSignedUrls:async()=>({data:[],error:null})})}},invokeAuthenticatedFunction:async(name,body)=>{
  report('Simulated '+name+' / '+body.action);
  if(offline) throw new Error('Offline simulation');
  if(name==='manage-newsletter'&&body.action==='overview') return {counts:{active:24,pending:2,unsubscribed:1,bounced:0},campaigns:[],products:products.slice(0,4),adminEmail:'admin@example.test'};
  return {success:true,message:'Simulated success',campaign:{...body.campaign,id:'draft'}};
}};
const auth = {signedIn:signal(true),ready:signal(true),busy:signal(false),error:signal(''),configured:signal(true),userId:signal('admin'),role:signal('superadmin'),displayName:signal('Test Administrator'),profile:signal({...customer,id:'admin',role:'superadmin'}),user:signal({id:'admin',email:'admin@example.test'}),security:signal(defaultAdminSecuritySettings),hasVerifiedMfa:signal(true),mfaRequired:signal(true),mfaSatisfied:signal(true),ensureInitialized:async()=>{},revalidateAccess:async()=>true,recordActivity:()=>{},registerSessionEndHook:()=>()=>{},signOut:async()=>report('Sign out simulated'),resetPassword:async()=>null};
const native = new Proxy({native:signal(false),platform:signal('web'),pushEnabled:signal(false),pushRegistration:signal({title:'Optional alerts',detail:'Native delivery is tested on a phone.',canRegister:false,action:'Register'}),foreground:signal(true)}, {get:(obj,key)=>key in obj?obj[key]:async()=>null});
const data = new AdminDataService(connection,auth,native);
for(const [key,value] of Object.entries({productsState:products,categoriesState:tables.categories,ordersState:orders,customersState:customers,ticketsState:tickets,reviewsState:reviews,teamState:[{...customer,id:'admin',role:'superadmin'}],settingsState:defaultStoreSettings,securityState:defaultAdminSecuritySettings,initializedState:true,realtimeState:'live',lastSyncState:new Date()})) data[key].set(value);
data.start=async()=>{}; data.stop=async()=>{}; data.refreshAll=async()=>{};
data.loadOrderDetail=async(id)=>data.orders().find(order=>order.id===id)??null;
data.loadReceiptBillingProfile=async()=>null;
data.loadProducts=async()=>{}; data.loadTickets=async()=>{};
data.notificationsState.set(Array.from({length:18},(_,i)=>({id:i,kind:'order',title:'New order received',message:'An order is ready for your review.',entity_type:'orders',entity_id:'order-'+i,route:'/app/orders/order-'+i,read_at:null,dismissed_at:null,created_at:now})));
data.notificationUnreadState.set(18);data.notificationTotalState.set(18);
const lock = new Proxy({biometricEnabled:signal(false),biometricAvailable:signal(false),biometricBusy:signal(false),biometricLabel:signal('Biometrics'),unlocked:signal(true),needsSetup:signal(false),error:signal(''),loading:signal(false)}, {get:(obj,key)=>key in obj?obj[key]:async()=>({ok:true})});
const routes = appRoutes.find(route=>route.path==='app').children.filter(route=>route.loadComponent).map(route=>({...route,data:{},canActivate:[],canDeactivate:[]}));
const mobileRoutes = [...routes];
routes.push(...appRoutes.filter(route=>route.path?.startsWith('auth/')).map(route=>({...route,canActivate:[]})));
routes.push({path:'app',component:appRoutes.find(route=>route.path==='app').component,children:mobileRoutes});
routes.push({path:'',pathMatch:'full',redirectTo:'app/orders'});
class AuditApp {}
Component({selector:'audit-app',standalone:true,imports:[RouterOutlet],template:'<router-outlet />'})(AuditApp);
const fixtureConnectivity={offline:signal(false),unstable:signal(false),checking:signal(false),banner:signal(null),retry:async()=>{offline=false;fixtureConnectivity.offline.set(false);}};
const app=await bootstrapApplication(AuditApp,{providers:[provideZonelessChangeDetection(),provideIonicAngular(),provideRouter(routes),{provide:AdminDataService,useValue:data},{provide:AdminAuthService,useValue:auth},{provide:SupabaseAdminService,useValue:connection},{provide:NativePlatformService,useValue:native},{provide:AppLockService,useValue:lock},{provide:ConnectivityService,useValue:fixtureConnectivity},{provide:CozyToastService,useValue:{show:async(message)=>report(message)}},{provide:ErrorHandler,useValue:{handleError:error=>record(String(error))}}]});
const router=app.injector.get(Router);
const paths=routes.filter(route=>route.loadComponent).map(route=>route.path.replace('orders/:id','orders/order-0').replace('products/:id','products/product-0').replace('customers/:id','customers/customer-1').replace('support/:id','support/ticket-0'));
const fullPath = path => '/' + (path.startsWith('auth/') ? path : 'app/' + path);
const select=document.querySelector('#route');
for(const path of paths){const option=document.createElement('option');option.textContent=path;option.value=path;select.append(option);}
select.onchange=()=>router.navigateByUrl(fullPath(select.value));
document.querySelector('#size').onchange=event=>document.querySelector('#device').style.width=event.target.value+'px';
document.querySelector('#offline').onclick=()=>{offline=!offline;fixtureConnectivity.offline.set(offline);report(offline?'Offline fixture enabled':'Online fixture enabled');};
document.querySelector('#diagnose').onclick=()=>{
  const device=document.querySelector('#device');const boundary=device.getBoundingClientRect();
  const overflow=[...device.querySelectorAll('main,section,article,form,input,select,textarea,button,cc-pagination')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>boundary.right+2||r.left<boundary.left-2)&&!el.closest('.filter-rail,.order-filter-scroll,.catalog-filter-scroll');});
  report('Width '+Math.round(boundary.width)+'px; '+overflow.length+' overflow candidates; '+logs.length+' runtime errors. '+overflow.slice(0,5).map(el=>el.tagName+'.'+el.className).join(', '));
};
document.querySelector('#sweep').onclick=async()=>{
  const issues=[];
  for(const path of paths){
    await router.navigateByUrl(fullPath(path));
    await new Promise(resolve=>setTimeout(resolve,150));
    const offenders=[...document.querySelectorAll('#device main,#device article,#device form,#device input,#device textarea,#device select,#device button')].filter(el=>{
      const r=el.getBoundingClientRect();
      if(!r.width || (r.left>=-1 && r.right<=innerWidth+1)) return false;
      for(let parent=el.parentElement;parent&&parent.id!=='device';parent=parent.parentElement){if(['auto','scroll','hidden'].includes(getComputedStyle(parent).overflowX)) return false;}
      return true;
    });
    if(offenders.length) issues.push(path+': '+offenders.slice(0,3).map(el=>el.tagName+'.'+el.className).join(', '));
  }
  report('Rendered '+paths.length+' route variants at '+innerWidth+'px. '+logs.length+' runtime errors. '+issues.length+' routes with overflow candidates. Synthetic data only.\n'+issues.join('\n'));
};
select.value='orders';
await router.navigateByUrl(deviceOnly && /^\/(app|auth)\//.test(initialPath) ? initialPath : '/app/orders');
report('Mobile audit fixture ready. Synthetic data only; remote requests are blocked.');
