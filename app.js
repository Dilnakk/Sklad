let deviceId = localStorage.getItem(DEVICE_ID_KEY);
let deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
let scannerStream = null;
let scannerLoop = null;

function makeId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
}
if(!deviceId){deviceId='device-'+makeId();localStorage.setItem(DEVICE_ID_KEY,deviceId)}

function esc(v){return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function num(v,d=3){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:d}).format(n):'—'}
function setLocalToken(t){deviceToken=t||'';if(deviceToken)localStorage.setItem(DEVICE_TOKEN_KEY,deviceToken);else localStorage.removeItem(DEVICE_TOKEN_KEY)}
function getToken(){return deviceToken}
function clearAuth(){setLocalToken('')}
function go(path){window.location.href=APP_BASE_PATH+path}

function api(action, extra={}){
  if(!API_URL || API_URL.indexOf('SEM_VLOZ')>=0)return Promise.reject(new Error('NENASTAVENA_API_URL'));
  const request={action,deviceId,...extra};
  if(action!=='register')request.deviceToken=deviceToken;
  return new Promise((resolve,reject)=>{
    const requestId=makeId();
    const frame=document.createElement('iframe');frame.name='inventory_v1_'+Date.now()+'_'+Math.random().toString(36).slice(2);frame.style.display='none';document.body.appendChild(frame);
    const form=document.createElement('form');form.method='POST';form.action=API_URL;form.target=frame.name;form.style.display='none';
    const input=document.createElement('input');input.type='hidden';input.name='payload';input.value=JSON.stringify({...request,requestId});form.appendChild(input);document.body.appendChild(form);
    let done=false;
    const cleanup=()=>{if(done)return;done=true;window.removeEventListener('message',onMessage);clearTimeout(timer);frame.remove();form.remove()}
    const origins=new Set(['https://script.google.com','https://script.googleusercontent.com']);
    const trusted=o=>origins.has(o)||/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/i.test(o);
    const onMessage=e=>{if(!trusted(e.origin))return;const d=e.data;if(!d||d.type!=='inventory-api'||d.requestId!==requestId)return;cleanup();if(d.status==='OK')resolve(d.data);else{if(d.error==='UNAUTHORIZED'||d.error==='DEVICE_BLOCKED'||d.error==='USER_INACTIVE')clearAuth();reject(new Error(d.error||'SERVER_ERROR'))}};
    window.addEventListener('message',onMessage);
    const timer=setTimeout(()=>{cleanup();reject(new Error('TIMEOUT'))},60000);
    try{form.submit()}catch(err){cleanup();reject(err)}
  });
}

async function requireAuth(requiredRole){
  if(!deviceToken){go('index.html');return null}
  try{const a=await api('auth');if(!a||!a.user){clearAuth();go('index.html');return null}if(requiredRole&&a.user.role!==requiredRole){go(a.user.role==='ADMIN'?'admin.html':a.user.role==='MANAGER'?'manager.html':'worker.html');return null}return a.user}catch(e){clearAuth();go('index.html');return null}
}

function showStatus(id,msg,type='info'){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.className='status '+type}

async function openScanner(onCode){
  const existing=document.getElementById('scannerOverlay');if(existing)existing.remove();
  const overlay=document.createElement('div');overlay.id='scannerOverlay';overlay.className='scanner-overlay';overlay.innerHTML=`<div class="scanner-box"><div class="scanner-head"><strong>📷 Skenování QR</strong><button class="small secondary" id="scannerClose">Zavřít</button></div><div class="scanner-body"><video id="scannerVideo" autoplay muted playsinline></video><div class="scanner-target"></div></div><div class="scanner-foot" id="scannerInfo">Spouštím kameru…</div></div>`;document.body.appendChild(overlay);
  overlay.querySelector('#scannerClose').onclick=stopScanner;
  if(!('mediaDevices' in navigator)||!navigator.mediaDevices.getUserMedia){overlay.querySelector('#scannerInfo').textContent='Tento prohlížeč neumí přístup ke kameře. Použij ruční zadání kódu.';return}
  if(!('BarcodeDetector' in window)){overlay.querySelector('#scannerInfo').textContent='Tento prohlížeč nepodporuje QR skenování bez knihovny. Použij ruční zadání kódu.';return}
  try{
    const detector=new BarcodeDetector({formats:['qr_code']});
    scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
    const video=overlay.querySelector('#scannerVideo');video.srcObject=scannerStream;await video.play();
    overlay.querySelector('#scannerInfo').textContent='Namiř kameru na QR kód položky.';
    const loop=async()=>{if(!scannerStream)return;try{const codes=await detector.detect(video);if(codes.length){const value=(codes[0].rawValue||'').trim();if(value){onCode(value);stopScanner();return}}}catch(_){}scannerLoop=requestAnimationFrame(loop)};
    scannerLoop=requestAnimationFrame(loop);
  }catch(err){overlay.querySelector('#scannerInfo').textContent='Kameru se nepodařilo otevřít. Povol přístup ke kameře nebo zadej kód ručně.'}
}
function stopScanner(){if(scannerLoop)cancelAnimationFrame(scannerLoop);scannerLoop=null;if(scannerStream){scannerStream.getTracks().forEach(t=>t.stop());scannerStream=null}const o=document.getElementById('scannerOverlay');if(o)o.remove()}

async function checkRoute(){
  if(!deviceToken)return {ok:false};
  try{return {ok:true,user:(await api('auth')).user}}catch(e){clearAuth();return {ok:false}}
}
