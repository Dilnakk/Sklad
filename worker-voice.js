// ============================================================================
// WORKER VOICE – volitelná hlasová nadstavba
// Pouze předvyplňuje existující formulář. Nic neukládá a nevolá API.
// ============================================================================
(function(){
  'use strict';

  const btn=document.getElementById('workerVoiceBtn');
  const box=document.getElementById('workerVoiceStatus');
  if(!btn)return;

  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    btn.style.display='none';
    return;
  }

  const rec=new SpeechRecognition();
  rec.lang='cs-CZ';
  rec.continuous=false;
  rec.interimResults=false;
  rec.maxAlternatives=3;
  let listening=false;

  btn.addEventListener('click',()=>{
    if(listening){rec.stop();return;}
    try{rec.start()}catch(e){console.warn('Worker Voice:',e)}
  });

  rec.onstart=()=>{
    listening=true;
    btn.classList.add('listening');
    show('🎙 Poslouchám…<br><small>Např. „Zakázka 25 68, hmotnost 2,5 gramu, cena 600, poznámka leštění.“</small>');
  };

  rec.onend=()=>{listening=false;btn.classList.remove('listening')};
  rec.onerror=e=>{
    listening=false;btn.classList.remove('listening');
    if(e.error==='not-allowed')show('Mikrofon není povolen.');
    else if(e.error==='no-speech')show('Nerozpoznal jsem žádnou řeč.');
    else show('Hlasové zadání se nepodařilo.');
  };

  rec.onresult=e=>{
    const r=e.results&&e.results[0]&&e.results[0][0];
    if(!r){show('Nerozpoznal jsem zadání.');return;}
    const spoken=String(r.transcript||'').trim();
    const data=parse(spoken);
    fill(data);
    showResult(spoken,data);
  };

  function parse(original){
    const text=normalize(original);
    const out={jobNumber:null,grams:null,price:null,note:null,type:null,fineness:null};
    let m;

    m=text.match(/(?:číslo\s+zakázky|cislo\s+zakazky|zakázka|zakazka)\s*[:,-]?\s*([0-9][0-9\s-]{1,14})/i);
    if(m){const n=m[1].replace(/\D/g,'');if(n)out.jobNumber=n;}

    m=text.match(/(?:přidaná\s+hmotnost|pridana\s+hmotnost|hmotnost|přidáno|pridano|váha|vaha)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i);
    if(m)out.grams=number(m[1]);

    m=text.match(/(?:cena|za)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:kč|kc|korun|koruny)?/i);
    if(m)out.price=number(m[1]);

    if(/\boprava\b/i.test(text))out.type='OPRAVA';
    else if(/\bvýroba\b|\bvyroba\b/i.test(text))out.type='VÝROBA';

    m=text.match(/(?:ryzost\s*)?\b(585|750|925)\b/i);
    if(m)out.fineness=Number(m[1]);

    m=original.match(/(?:poznámka|poznamka)\s*[:,-]?\s*(.+)$/i);
    if(m)out.note=m[1].trim();

    return out;
  }

  function fill(d){
    if(d.type&&typeof window.setJobType==='function')window.setJobType(d.type);
    set('jobNumber',d.jobNumber);
    set('jobGrams',format(d.grams));
    set('jobPrice',format(d.price));
    set('jobNote',d.note);

    if(d.fineness!==null){
      const select=document.getElementById('jobGoldCode');
      if(select){
        const option=Array.from(select.options).find(o=>Number(o.dataset.fineness)===d.fineness);
        if(option){select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
      }
    }

    if(d.grams!==null&&typeof window.syncHandoffWeightFromGrams==='function')window.syncHandoffWeightFromGrams();
  }

  function set(id,value){
    if(value===null||value===undefined||value==='')return;
    const el=document.getElementById(id);if(!el)return;
    el.value=value;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function showResult(spoken,d){
    const rows=[];
    if(d.jobNumber)rows.push('Zakázka: <strong>'+esc(d.jobNumber)+'</strong>');
    if(d.type)rows.push('Typ: <strong>'+esc(d.type)+'</strong>');
    if(d.fineness)rows.push('Ryzost: <strong>'+d.fineness+'/1000</strong>');
    if(d.grams!==null)rows.push('Hmotnost: <strong>'+esc(format(d.grams))+' g</strong>');
    if(d.price!==null)rows.push('Cena: <strong>'+esc(format(d.price))+' Kč</strong>');
    if(d.note)rows.push('Poznámka: <strong>'+esc(d.note)+'</strong>');
    const none=rows.length?'':'<br><strong>Nenašel jsem žádný známý údaj.</strong>';
    show('<strong>Slyšel jsem:</strong><br>'+esc(spoken)+'<br><br>'+rows.join('<br>')+none+'<br><br><strong>Zkontroluj formulář a teprve potom zakázku ulož.</strong>',9000);
  }

  function show(html,ms=0){
    if(!box)return;
    box.innerHTML=html;box.classList.add('show');
    if(ms)setTimeout(()=>box.classList.remove('show'),ms);
  }
  function normalize(s){return String(s).toLowerCase().replace(/\s+/g,' ').trim()}
  function number(s){const n=Number(String(s).replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null}
  function format(n){return n===null||n===undefined?'':String(n).replace('.',',')}
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
})();
