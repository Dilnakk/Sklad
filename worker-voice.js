// ============================================================================
// WORKER VOICE v2
// Hlasové PŘEDVYPLNĚNÍ existujícího formuláře Worker.
//
// Bezpečnostní princip:
// - nic samo NEUKLÁDÁ,
// - nevolá api(), fetch() ani Apps Script,
// - pouze vyplní existující pole formuláře,
// - pracovník musí údaje zkontrolovat a použít původní tlačítko POTVRDIT VÝDEJ.
// ============================================================================

(function(){
  'use strict';

  const btn=document.getElementById('workerVoiceBtn');
  const status=document.getElementById('workerVoiceStatus');
  if(!btn||!status)return;

  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    btn.classList.add('unsupported');
    console.warn('Worker Voice: SpeechRecognition není v tomto prohlížeči dostupné.');
    return;
  }

  const recognition=new SpeechRecognition();
  recognition.lang='cs-CZ';
  recognition.continuous=false;
  recognition.interimResults=false;
  recognition.maxAlternatives=3;

  let listening=false;
  let hideTimer=null;

  btn.addEventListener('click',function(){
    if(listening){
      recognition.stop();
      return;
    }
    try{recognition.start()}catch(e){console.warn('Worker Voice:',e)}
  });

  recognition.onstart=function(){
    listening=true;
    btn.classList.add('listening');
    showStatus('<strong>🎙 Poslouchám…</strong><br><span class="worker-voice-muted">Např. „Oprava, zakázka číslo 2568, 2,5 gramu, 600 korun, poznámka leštění.“</span>');
  };

  recognition.onend=function(){
    listening=false;
    btn.classList.remove('listening');
  };

  recognition.onerror=function(event){
    listening=false;
    btn.classList.remove('listening');
    if(event.error==='not-allowed')return showStatus('Mikrofon není povolený.',5000);
    if(event.error==='no-speech')return showStatus('Nerozpoznal jsem žádnou řeč.',3500);
    showStatus('Hlasové zadání se nepodařilo.',4000);
  };

  recognition.onresult=function(event){
    const alternatives=event.results&&event.results[0];
    if(!alternatives||!alternatives[0])return showStatus('Nerozpoznal jsem zadání.',3500);

    let best=null;
    const count=Math.min(alternatives.length||1,3);

    for(let i=0;i<count;i++){
      const transcript=String(alternatives[i].transcript||'').trim();
      const parsed=parseWorkerVoice(transcript);
      const score=scoreParsed(parsed);

      if(!best||score>best.score){
        best={transcript,parsed,score};
      }
    }

    if(!best)return showStatus('Nerozpoznal jsem zadání.',3500);

    fillWorkerForm(best.parsed);
    showResult(best.transcript,best.parsed);
  };

  function scoreParsed(data){
    return ['jobType','jobNumber','grams','price','note','fineness']
      .reduce((n,k)=>n+(data[k]!==null?1:0),0);
  }

  function parseWorkerVoice(original){
    const text=normalize(original);

    const data={
      jobNumber:null,
      grams:null,
      price:null,
      note:null,
      jobType:null,
      fineness:null
    };

    // Typ zakázky
    if(/\bvýroba\b|\bvyroba\b/i.test(text)){
      data.jobType='VÝROBA';
    }else if(/\boprava\b/i.test(text)){
      data.jobType='OPRAVA';
    }

    // ----------------------------------------------------------------------
    // ČÍSLO ZAKÁZKY
    // ----------------------------------------------------------------------

    let m=text.match(
      /(?:číslo\s+zakázky|cislo\s+zakazky|zakázka\s+číslo|zakazka\s+cislo|zakázka|zakazka)\s*[:,-]?\s*([0-9][0-9\s-]{1,14})/i
    );

    if(m){
      const digits=m[1].replace(/\D/g,'');
      if(digits)data.jobNumber=digits;
    }

    // Např. "dva pět šest osm"
    if(!data.jobNumber){
      m=text.match(
        /(?:číslo\s+zakázky|cislo\s+zakazky|zakázka\s+číslo|zakazka\s+cislo|zakázka|zakazka)\s*[:,-]?\s*((?:(?:nula|jedna|jeden|dva|dvě|tri|tři|čtyři|ctyri|pět|pet|šest|sest|sedm|osm|devět|devet)\s*){2,})/i
      );

      if(m){
        data.jobNumber=spokenDigits(m[1]);
      }
    }

    // ----------------------------------------------------------------------
    // HMOTNOST
    // ----------------------------------------------------------------------

    m=text.match(
      /(?:přidaná\s+hmotnost|pridana\s+hmotnost|vydané\s+zlato|vydane\s+zlato|hmotnost|přidáno|pridano|gramáž|gramaz)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i
    );

    if(m){
      data.grams=parseCzechNumber(m[1]);
    }

    // Stačí i "2,5 gramu"
    if(data.grams===null){
      m=text.match(
        /\b([0-9]+(?:[.,][0-9]+)?)\s*(?:g|gram|gramu|gramy|gramů)\b/i
      );

      if(m){
        data.grams=parseCzechNumber(m[1]);
      }
    }

    // ----------------------------------------------------------------------
    // CENA
    // ----------------------------------------------------------------------

    m=text.match(
      /(?:cena(?:\s+práce)?|cena\s+prace|za)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i
    );

    if(m){
      data.price=parseCzechNumber(m[1]);
    }

    // Stačí i "600 korun"
    if(data.price===null){
      m=text.match(
        /\b([0-9]+(?:[.,][0-9]+)?)\s*(?:kč|kc|korun|koruna|koruny)\b/i
      );

      if(m){
        data.price=parseCzechNumber(m[1]);
      }
    }

    // Umí i "šest set korun", "tisíc dvě stě korun"
    if(data.price===null){
      m=text.match(
        /\b((?:nula|jeden|jedna|dva|dvě|tři|tri|čtyři|ctyri|pět|pet|šest|sest|sedm|osm|devět|devet|deset|jedenáct|jedenact|dvanáct|dvanact|třináct|trinact|čtrnáct|ctrnact|patnáct|patnact|šestnáct|sestnact|sedmnáct|sedmnact|osmnáct|osmnact|devatenáct|devatenact|dvacet|třicet|tricet|čtyřicet|ctyricet|padesát|padesat|šedesát|sedesat|sedmdesát|sedmdesat|osmdesát|osmdesat|devadesát|devadesat|sto|stě|ste|set|tisíc|tisic)(?:\s+|$)){1,8}(?=korun|koruna|koruny)/i
      );

      if(m){
        const spoken=spokenCzechNumber(m[1]);

        if(spoken!==null){
          data.price=spoken;
        }
      }
    }

    // ----------------------------------------------------------------------
    // POZNÁMKA
    // ----------------------------------------------------------------------

    m=original.match(
      /(?:poznámka|poznamka|poznámky|poznamky)\s*[:,-]?\s*(.+)$/i
    );

    if(m){
      data.note=m[1].trim();
    }

    // ----------------------------------------------------------------------
    // RYZOST
    // ----------------------------------------------------------------------

    m=text.match(
      /(?:ryzost\s*)?\b(585|750|925)\b/i
    );

    if(m){
      data.fineness=Number(m[1]);
    }

    return data;
  }

  function fillWorkerForm(data){
    if(data.jobType&&typeof window.setJobType==='function'){
      window.setJobType(data.jobType);
    }

    if(data.jobNumber!==null){
      setValue('jobNumber',data.jobNumber);
    }

    if(data.grams!==null){
      setValue('jobGrams',formatInputNumber(data.grams));
    }

    if(data.price!==null){
      const hourly=document.getElementById('jobHourly');

      if(!hourly||!hourly.checked){
        setValue('jobPrice',formatInputNumber(data.price));
      }
    }

    if(data.note!==null){
      setValue('jobNote',data.note);
    }

    if(data.fineness!==null){
      selectGoldByFineness(data.fineness);
    }

    if(
      data.grams!==null &&
      typeof window.syncHandoffWeightFromGrams==='function'
    ){
      window.syncHandoffWeightFromGrams();
    }
  }

  function setValue(id,value){
    const el=document.getElementById(id);
    if(!el)return;

    el.value=value;

    el.dispatchEvent(
      new Event('input',{bubbles:true})
    );

    el.dispatchEvent(
      new Event('change',{bubbles:true})
    );
  }

  function selectGoldByFineness(fineness){
    const select=document.getElementById('jobGoldCode');
    if(!select)return;

    const option=Array.from(select.options).find(
      o=>Number(o.dataset&&o.dataset.fineness)===Number(fineness)
    );

    if(!option)return;

    select.value=option.value;

    select.dispatchEvent(
      new Event('change',{bubbles:true})
    );
  }

  function showResult(transcript,data){
    const found=[];

    if(data.jobType){
      found.push(
        'Typ: <strong>'+esc(data.jobType)+'</strong>'
      );
    }

    if(data.jobNumber!==null){
      found.push(
        'Zakázka: <strong>'+esc(data.jobNumber)+'</strong>'
      );
    }

    if(data.grams!==null){
      found.push(
        'Hmotnost: <strong>'+
        esc(formatInputNumber(data.grams))+
        ' g</strong>'
      );
    }

    if(data.price!==null){
      found.push(
        'Cena: <strong>'+
        esc(formatInputNumber(data.price))+
        ' Kč</strong>'
      );
    }

    if(data.fineness!==null){
      found.push(
        'Ryzost: <strong>'+
        esc(data.fineness)+
        '/1000</strong>'
      );
    }

    if(data.note!==null){
      found.push(
        'Poznámka: <strong>'+
        esc(data.note)+
        '</strong>'
      );
    }

    let html=
      '<span class="worker-voice-muted">Slyšel jsem:</span><br>'+
      esc(transcript);

    if(found.length){
      html+='<br><br>'+found.join('<br>');

      html+=
        '<br><br>'+
        '<span class="worker-voice-ok">'+
        'Zkontroluj formulář a teprve potom potvrď výdej.'+
        '</span>';
    }else{
      html+=
        '<br><br>'+
        '<strong>Nenašel jsem žádný údaj k předvyplnění.</strong>';
    }

    showStatus(html,9000);
  }

  function showStatus(html,timeout){
    if(hideTimer){
      clearTimeout(hideTimer);
      hideTimer=null;
    }

    status.innerHTML=html;
    status.classList.add('show');

    if(timeout){
      hideTimer=setTimeout(
        function(){
          status.classList.remove('show');
        },
        timeout
      );
    }
  }

  function normalize(v){
    return String(v||'')
      .toLowerCase()
      .replace(/\s+/g,' ')
      .trim();
  }

  function parseCzechNumber(v){
    const n=Number(
      String(v)
        .replace(/\s/g,'')
        .replace(',','.')
    );

    return Number.isFinite(n)?n:null;
  }

  function formatInputNumber(v){
    return String(v).replace('.',',');
  }

  function spokenDigits(v){
    const map={
      nula:'0',
      jedna:'1',
      jeden:'1',
      dva:'2',
      'dvě':'2',
      tri:'3',
      'tři':'3',
      'čtyři':'4',
      ctyri:'4',
      'pět':'5',
      pet:'5',
      'šest':'6',
      sest:'6',
      sedm:'7',
      osm:'8',
      'devět':'9',
      devet:'9'
    };

    return normalize(v)
      .split(' ')
      .map(x=>map[x]||'')
      .join('')||null;
  }

  function spokenCzechNumber(v){
    const small={
      nula:0,
      jeden:1,
      jedna:1,
      dva:2,
      'dvě':2,
      'tři':3,
      tri:3,
      'čtyři':4,
      ctyri:4,
      'pět':5,
      pet:5,
      'šest':6,
      sest:6,
      sedm:7,
      osm:8,
      'devět':9,
      devet:9,

      deset:10,
      'jedenáct':11,
      jedenact:11,
      'dvanáct':12,
      dvanact:12,
      'třináct':13,
      trinact:13,
      'čtrnáct':14,
      ctrnact:14,
      'patnáct':15,
      patnact:15,
      'šestnáct':16,
      sestnact:16,
      'sedmnáct':17,
      sedmnact:17,
      'osmnáct':18,
      osmnact:18,
      'devatenáct':19,
      devatenact:19,

      dvacet:20,
      'třicet':30,
      tricet:30,
      'čtyřicet':40,
      ctyricet:40,
      'padesát':50,
      padesat:50,
      'šedesát':60,
      sedesat:60,
      'sedmdesát':70,
      sedmdesat:70,
      'osmdesát':80,
      osmdesat:80,
      'devadesát':90,
      devadesat:90
    };

    const words=normalize(v)
      .replace(/[.,]/g,'')
      .split(' ')
      .filter(Boolean);

    let total=0;
    let current=0;
    let used=false;

    for(const w of words){
      if(
        Object.prototype.hasOwnProperty.call(small,w)
      ){
        current+=small[w];
        used=true;
        continue;
      }

      if(
        w==='sto' ||
        w==='stě' ||
        w==='ste' ||
        w==='set'
      ){
        current=(current||1)*100;
        used=true;
        continue;
      }

      if(
        w==='tisíc' ||
        w==='tisic'
      ){
        total+=(current||1)*1000;
        current=0;
        used=true;
        continue;
      }
    }

    return used?total+current:null;
  }

  function esc(v){
    return String(v)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

})();
