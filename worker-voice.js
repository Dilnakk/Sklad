// ============================================================================
// WORKER VOICE v4
// Hlasové PŘEDVYPLNĚNÍ existujícího formuláře Worker.
//
// Co umí:
// - 1. klepnutí na mikrofon = začít diktovat,
// - po běžné pauze se rozpoznávání samo znovu spustí,
// - další klepnutí na mikrofon = diktování definitivně ukončit,
// - jednotka určuje pole: Kč -> cena, g -> gramy, hodiny -> hodinová práce,
// - „oprava číslo 1625“ / „výroba číslo 1625“,
// - „předávám Martině“ otevře předání a při jednoznačné shodě vybere pracovníka,
// - gramy se přes existující Worker funkci propíšou i do hmotnosti při předání.
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

  // Chrome/Android často ukončí jednu rozpoznávací dávku po pauze.
  // Proto continuous necháváme false a po onend ji během aktivní relace znovu spouštíme.
  recognition.continuous=false;
  recognition.interimResults=false;
  recognition.maxAlternatives=3;

  let recognitionRunning=false;
  let sessionActive=false;
  let stopRequested=false;
  let accumulatedTranscript='';
  let hideTimer=null;
  let restartTimer=null;

  btn.addEventListener('click',function(){
    if(sessionActive){
      stopVoiceSession();
      return;
    }
    startVoiceSession();
  });

  function startVoiceSession(){
    if(restartTimer){
      clearTimeout(restartTimer);
      restartTimer=null;
    }

    accumulatedTranscript='';
    stopRequested=false;
    sessionActive=true;

    btn.classList.add('listening');
    showListeningStatus();
    safeStartRecognition();
  }

  function stopVoiceSession(){
    sessionActive=false;
    stopRequested=true;

    if(restartTimer){
      clearTimeout(restartTimer);
      restartTimer=null;
    }

    btn.classList.remove('listening');

    if(accumulatedTranscript){
      const parsed=parseWorkerVoice(accumulatedTranscript);
      fillWorkerForm(parsed);
      showResult(accumulatedTranscript,parsed,false);
    }else{
      showStatus('Diktování ukončeno.',2500);
    }

    if(recognitionRunning){
      try{
        recognition.stop();
      }catch(e){
        console.warn('Worker Voice stop:',e);
      }
    }
  }

  function safeStartRecognition(){
    if(!sessionActive||stopRequested||recognitionRunning)return;

    try{
      recognition.start();
    }catch(e){
      // InvalidStateError se může objevit při rychlém restartu.
      // Krátce počkáme a zkusíme znovu.
      restartTimer=setTimeout(function(){
        restartTimer=null;

        if(sessionActive&&!stopRequested&&!recognitionRunning){
          safeStartRecognition();
        }
      },220);
    }
  }

  recognition.onstart=function(){
    recognitionRunning=true;
    btn.classList.add('listening');

    if(accumulatedTranscript){
      showResult(
        accumulatedTranscript,
        parseWorkerVoice(accumulatedTranscript),
        true
      );
    }else{
      showListeningStatus();
    }
  };

  recognition.onend=function(){
    recognitionRunning=false;

    if(sessionActive&&!stopRequested){
      restartTimer=setTimeout(function(){
        restartTimer=null;
        safeStartRecognition();
      },180);

      return;
    }

    btn.classList.remove('listening');
  };

  recognition.onerror=function(event){
    recognitionRunning=false;

    // Pauza bez řeči je během aktivního diktování normální.
    // onend relaci znovu spustí.
    if(event.error==='no-speech'||event.error==='aborted'){
      return;
    }

    if(
      event.error==='not-allowed'||
      event.error==='service-not-allowed'
    ){
      sessionActive=false;
      stopRequested=true;
      btn.classList.remove('listening');

      return showStatus(
        'Mikrofon není povolený.',
        5000
      );
    }

    if(event.error==='audio-capture'){
      sessionActive=false;
      stopRequested=true;
      btn.classList.remove('listening');

      return showStatus(
        'Mikrofon není dostupný.',
        5000
      );
    }

    // U ostatních chyb relaci raději ukončíme,
    // aby nevznikla nekonečná smyčka restartů.
    sessionActive=false;
    stopRequested=true;
    btn.classList.remove('listening');

    showStatus(
      'Hlasové zadání se nepodařilo.',
      4000
    );
  };

  recognition.onresult=function(event){
    const start=Number.isInteger(event.resultIndex)
      ? event.resultIndex
      : 0;

    let received=false;

    for(
      let r=start;
      r<(event.results?event.results.length:0);
      r++
    ){
      const alternatives=event.results[r];

      if(!alternatives||!alternatives[0])continue;

      // Z alternativ vybereme tu, která po připojení
      // k dosavadnímu diktátu dává nejvíc rozpoznaných polí.
      let best=null;

      const count=Math.min(
        alternatives.length||1,
        3
      );

      for(let i=0;i<count;i++){
        const segment=String(
          alternatives[i].transcript||''
        ).trim();

        if(!segment)continue;

        const combined=(
          accumulatedTranscript+
          ' '+
          segment
        ).trim();

        const parsed=parseWorkerVoice(combined);
        const score=scoreParsed(parsed);

        if(!best||score>best.score){
          best={
            segment,
            combined,
            parsed,
            score
          };
        }
      }

      if(!best)continue;

      accumulatedTranscript=best.combined;
      received=true;
    }

    if(!received)return;

    const parsed=parseWorkerVoice(
      accumulatedTranscript
    );

    fillWorkerForm(parsed);

    showResult(
      accumulatedTranscript,
      parsed,
      sessionActive&&!stopRequested
    );
  };

  function showListeningStatus(){
    showStatus(
      '<strong>🎙 Poslouchám…</strong><br>'+
      '<span class="worker-voice-muted">'+
      'Mluv klidně po částech a dělej pauzy. '+
      'Dalším klepnutím na mikrofon diktování ukončíš.'+
      '</span>',
      0
    );
  }

  function scoreParsed(data){
    return [
      'jobType',
      'jobNumber',
      'grams',
      'price',
      'hours',
      'note',
      'fineness',
      'handoffName'
    ].reduce(
      (n,k)=>n+(data[k]!==null?1:0),
      0
    );
  }

  function parseWorkerVoice(original){
    const text=fold(original);

    const data={
      jobNumber:null,
      grams:null,
      price:null,
      hours:null,
      note:null,
      jobType:null,
      fineness:null,
      handoffName:null,
      handoffResolved:null
    };

    // ----------------------------------------------------------------------
    // TYP ZAKÁZKY
    // ----------------------------------------------------------------------

    if(/\bvyroba\b/i.test(text)){
      data.jobType='VÝROBA';
    }else if(/\boprava\b/i.test(text)){
      data.jobType='OPRAVA';
    }

    // ----------------------------------------------------------------------
    // ČÍSLO ZAKÁZKY
    //
    // Umí mimo jiné:
    // „oprava číslo 1625“
    // „výroba číslo 1625“
    // „zakázka číslo 1625“
    // ----------------------------------------------------------------------

    let m=text.match(
      /(?:cislo\s+zakazky|zakazka\s+cislo|zakazka|oprava\s+cislo|vyroba\s+cislo)\s*[:,-]?\s*([0-9][0-9\s-]{0,14})/i
    );

    if(m){
      const digits=m[1].replace(/\D/g,'');

      if(digits){
        data.jobNumber=digits;
      }
    }

    // „oprava 1625“ / „výroba 1625“
    if(!data.jobNumber){
      m=text.match(
        /\b(?:oprava|vyroba)\s+([0-9][0-9\s-]{1,14})/i
      );

      if(m){
        const digits=m[1].replace(/\D/g,'');

        if(digits){
          data.jobNumber=digits;
        }
      }
    }

    // Číslice vyslovené po slovech:
    // „dva pět šest osm“
    if(!data.jobNumber){
      m=text.match(
        /(?:cislo\s+zakazky|zakazka\s+cislo|zakazka|oprava\s+cislo|vyroba\s+cislo)\s*[:,-]?\s*((?:(?:nula|jedna|jeden|dva|dve|tri|ctyri|pet|sest|sedm|osm|devet)\s*){2,})/i
      );

      if(m){
        data.jobNumber=spokenDigits(m[1]);
      }
    }

    // ----------------------------------------------------------------------
    // JEDNOTKY URČUJÍ CÍLOVÉ POLE
    // ----------------------------------------------------------------------

    // HMOTNOST
    //
    // 5 g
    // 5 gramů
    // 5,6 gramů
    // pět celých šest gramů

    data.grams=findUnitQuantity(
      text,
      [
        'g',
        'gram',
        'gramu',
        'gramy'
      ]
    );

    // Zachování staršího způsobu:
    // „hmotnost 5“
    // „vydané zlato 5“
    if(data.grams===null){
      m=text.match(
        /(?:pridana\s+hmotnost|vydane\s+zlato|hmotnost|pridano|gramaz)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i
      );

      if(m){
        data.grams=parseCzechNumber(m[1]);
      }
    }

    // ----------------------------------------------------------------------
    // HODINY
    //
    // „5 hodin“
    // „2,5 hodiny“
    // Automaticky zapnou hodinovou práci.
    // ----------------------------------------------------------------------

    data.hours=findUnitQuantity(
      text,
      [
        'h',
        'hod',
        'hodina',
        'hodiny',
        'hodin',
        'hodinu'
      ]
    );

    // ----------------------------------------------------------------------
    // CENA
    //
    // „600 Kč“
    // „600 korun“
    // „šest set korun“
    // ----------------------------------------------------------------------

    data.price=findUnitQuantity(
      text,
      [
        'kc',
        'korun',
        'koruna',
        'koruny'
      ]
    );

    // Zachování staršího:
    // „cena 600“
    // „za 600“
    if(data.price===null){
      m=text.match(
        /(?:cena(?:\s+prace)?|za)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i
      );

      if(m){
        data.price=parseCzechNumber(m[1]);
      }
    }

    // ----------------------------------------------------------------------
    // PŘEDÁNÍ DALŠÍMU PRACOVNÍKOVI
    //
    // „předávám Martině“
    // „předám Martině“
    // „předat Martině“
    //
    // Jméno se následně porovná s aktuálními možnostmi
    // v jobShareWorker.
    // ----------------------------------------------------------------------

    m=text.match(
      /\b(?:predavam|predam|predat|predani)\s+(?:zakazku\s+)?(?:to\s+)?([a-z]+)/i
    );

    if(m){
      data.handoffName=m[1];
    }

    // ----------------------------------------------------------------------
    // POZNÁMKA
    //
    // Vše za slovem poznámka / poznámky ponecháme
    // tak, jak bylo rozpoznáno.
    // ----------------------------------------------------------------------

    m=String(original||'').match(
      /(?:poznámka|poznamka|poznámky|poznamky)\s*[:,-]?\s*(.+)$/i
    );

    if(m){
      data.note=m[1].trim();
    }

    // ----------------------------------------------------------------------
    // RYZOST
    //
    // Pouze pokud ji uživatel výslovně řekne.
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

    // Typ zakázky
    if(
      data.jobType&&
      typeof window.setJobType==='function'
    ){
      window.setJobType(data.jobType);
    }

    // Číslo zakázky
    if(data.jobNumber!==null){
      setValue(
        'jobNumber',
        data.jobNumber
      );
    }

    // Ryzost
    if(data.fineness!==null){
      selectGoldByFineness(
        data.fineness
      );
    }

    // Gramy
    if(data.grams!==null){
      setValue(
        'jobGrams',
        formatInputNumber(data.grams)
      );
    }

    // ----------------------------------------------------------------------
    // HODINY
    //
    // Jednotka „hodin“ přepne formulář
    // automaticky do hodinového režimu.
    // ----------------------------------------------------------------------

    if(data.hours!==null){

      setHourlyMode(true);

      setValue(
        'jobHours',
        formatInputNumber(data.hours)
      );

      if(
        typeof window.updateJobHourlyPreview==='function'
      ){
        window.updateJobHourlyPreview();
      }

    }else if(data.price!==null){

      // Pokud zazní Kč / korun
      // a nezazní hodiny,
      // jde o pevnou cenu.

      setHourlyMode(false);

      setValue(
        'jobPrice',
        formatInputNumber(data.price)
      );
    }

    // Poznámka
    if(data.note!==null){
      setValue(
        'jobNote',
        data.note
      );
    }

    // Předání pracovníkovi
    if(data.handoffName!==null){
      data.handoffResolved=
        enableHandoff(
          data.handoffName
        );
    }

    // ----------------------------------------------------------------------
    // GRAMY PŘI PŘEDÁNÍ
    //
    // Po zapnutí předání znovu synchronizujeme gramy,
    // takže například:
    //
    // „6,5 gramů, předávám Martině“
    //
    // vyplní:
    // jobGrams = 6,5
    // jobHandoffWeight = 6,5
    //
    // pokud hmotnost při předání nebyla ručně změněna.
    // ----------------------------------------------------------------------

    if(
      data.grams!==null&&
      typeof window.syncHandoffWeightFromGrams==='function'
    ){
      window.syncHandoffWeightFromGrams();
    }
  }

  function setHourlyMode(on){
    const cb=document.getElementById(
      'jobHourly'
    );

    if(!cb)return;

    const changed=
      cb.checked!==Boolean(on);

    cb.checked=Boolean(on);

    if(
      changed&&
      typeof window.toggleJobHourly==='function'
    ){
      window.toggleJobHourly();

    }else{

      const panel=
        document.getElementById(
          'jobHourlyPanel'
        );

      const price=
        document.getElementById(
          'jobPrice'
        );

      if(panel){
        panel.classList.toggle(
          'hidden',
          !on
        );
      }

      if(price){
        price.disabled=Boolean(on);
      }
    }
  }

  function enableHandoff(spokenName){

    const cb=
      document.getElementById(
        'shareJobWorker'
      );

    if(cb){

      const changed=!cb.checked;

      cb.checked=true;

      if(
        changed&&
        typeof window.toggleJobShare==='function'
      ){
        window.toggleJobShare();

      }else{

        const panel=
          document.getElementById(
            'jobSharePanel'
          );

        if(panel){
          panel.classList.remove(
            'hidden'
          );
        }
      }
    }

    const select=
      document.getElementById(
        'jobShareWorker'
      );

    if(!select){
      return null;
    }

    const options=
      Array.from(
        select.options||[]
      ).filter(
        o=>String(o.value||'').trim()
      );

    const target=
      fold(spokenName).split(' ')[0];

    const targetStem=
      personStem(target);

    if(!targetStem){
      return null;
    }

    // Nejprve přesná shoda.
    let matches=
      options.filter(o=>{

        const label=
          fold(
            o.textContent||
            o.innerText||
            ''
          );

        return(
          label===target||
          label.startsWith(
            target+' '
          )
        );
      });

    // Pokud není přesná shoda,
    // zkusíme český pád jména.
    if(matches.length!==1){

      matches=
        options.filter(o=>{

          const words=
            fold(
              o.textContent||
              o.innerText||
              ''
            )
            .split(/\s+/)
            .filter(Boolean);

          return words.some(
            w=>
              personStem(w)===
              targetStem
          );
        });
    }

    if(matches.length!==1){
      return null;
    }

    select.value=
      matches[0].value;

    select.dispatchEvent(
      new Event(
        'change',
        {
          bubbles:true
        }
      )
    );

    return String(
      matches[0].textContent||
      matches[0].innerText||
      spokenName
    ).trim();
  }

  // --------------------------------------------------------------------------
  // ZJEDNODUŠENÍ ČESKÝCH PÁDŮ JMEN
  //
  // Martina -> Martin
  // Martině -> Martin
  // Martinovi -> Martin
  //
  // Ondra -> Ondr
  // Ondrovi -> Ondr
  // --------------------------------------------------------------------------

  function personStem(v){

    let s=
      fold(v)
      .replace(
        /[^a-z]/g,
        ''
      );

    if(!s){
      return '';
    }

    s=s.replace(
      /(ovi|ove|emu|eho)$/,
      ''
    );

    s=s.replace(
      /[aeiouy]$/,
      ''
    );

    return s;
  }

  function setValue(id,value){

    const el=
      document.getElementById(id);

    if(!el)return;

    el.value=value;

    el.dispatchEvent(
      new Event(
        'input',
        {
          bubbles:true
        }
      )
    );

    el.dispatchEvent(
      new Event(
        'change',
        {
          bubbles:true
        }
      )
    );
  }

  function selectGoldByFineness(
    fineness
  ){

    const select=
      document.getElementById(
        'jobGoldCode'
      );

    if(!select)return;

    const option=
      Array.from(
        select.options
      ).find(
        o=>
          Number(
            o.dataset&&
            o.dataset.fineness
          )===
          Number(fineness)
      );

    if(!option)return;

    select.value=
      option.value;

    select.dispatchEvent(
      new Event(
        'change',
        {
          bubbles:true
        }
      )
    );
  }

  function showResult(
    transcript,
    data,
    stillListening
  ){

    const found=[];

    if(data.jobType){
      found.push(
        'Typ: <strong>'+
        esc(data.jobType)+
        '</strong>'
      );
    }

    if(data.jobNumber!==null){
      found.push(
        'Zakázka: <strong>'+
        esc(data.jobNumber)+
        '</strong>'
      );
    }

    if(data.grams!==null){
      found.push(
        'Hmotnost: <strong>'+
        esc(
          formatInputNumber(
            data.grams
          )
        )+
        ' g</strong>'
      );
    }

    if(data.hours!==null){
      found.push(
        'Hodinová práce: <strong>'+
        esc(
          formatInputNumber(
            data.hours
          )
        )+
        ' h</strong>'
      );
    }

    if(
      data.price!==null&&
      data.hours===null
    ){
      found.push(
        'Cena: <strong>'+
        esc(
          formatInputNumber(
            data.price
          )
        )+
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

    if(data.handoffName!==null){

      found.push(
        'Předání: <strong>'+
        esc(
          data.handoffResolved||
          data.handoffName
        )+
        '</strong>'+
        (
          data.handoffResolved
          ? ''
          : ' <span class="worker-voice-muted">(zkontroluj výběr)</span>'
        )
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
      '<span class="worker-voice-muted">'+
      'Slyšel jsem:'+
      '</span><br>'+
      esc(transcript);

    if(found.length){

      html+=
        '<br><br>'+
        found.join('<br>');

      if(stillListening){

        html+=
          '<br><br>'+
          '<span class="worker-voice-ok">'+
          '🎙 Poslouchám dál. '+
          'Dalším klepnutím diktování ukončíš.'+
          '</span>';

      }else{

        html+=
          '<br><br>'+
          '<span class="worker-voice-ok">'+
          'Diktování ukončeno. '+
          'Zkontroluj formulář a teprve potom potvrď výdej.'+
          '</span>';
      }

    }else if(stillListening){

      html+=
        '<br><br>'+
        '<strong>'+
        'Zatím jsem nenašel údaj k předvyplnění.'+
        '</strong>'+
        '<br>'+
        '<span class="worker-voice-muted">'+
        'Pokračuj v diktování.'+
        '</span>';

    }else{

      html+=
        '<br><br>'+
        '<strong>'+
        'Nenašel jsem žádný údaj k předvyplnění.'+
        '</strong>';
    }

    showStatus(
      html,
      stillListening
        ? 0
        : 9000
    );
  }

  function showStatus(
    html,
    timeout
  ){

    if(hideTimer){
      clearTimeout(hideTimer);
      hideTimer=null;
    }

    status.innerHTML=html;
    status.classList.add('show');

    if(timeout){

      hideTimer=
        setTimeout(
          function(){
            status.classList.remove(
              'show'
            );
          },
          timeout
        );
    }
  }

  function normalize(v){

    return String(v||'')
      .toLowerCase()
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  }

  function fold(v){

    return normalize(v)
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .replace(
        /[“”„]/g,
        '"'
      )
      .replace(
        /[’]/g,
        "'"
      );
  }

  function parseCzechNumber(v){

    const n=
      Number(
        String(v)
        .replace(
          /\s/g,
          ''
        )
        .replace(
          ',',
          '.'
        )
      );

    return Number.isFinite(n)
      ? n
      : null;
  }

  function formatInputNumber(v){

    return String(v)
      .replace(
        '.',
        ','
      );
  }

  function cleanToken(v){

    return fold(v)
      .replace(
        /^[^a-z0-9]+|[^a-z0-9.,]+$/g,
        ''
      );
  }

  // --------------------------------------------------------------------------
  // NAJDE ČÍSLO PŘED KONKRÉTNÍ JEDNOTKOU
  //
  // Díky tomu se:
  //
  // 600 korun -> cena
  // 5 gramů -> gramy
  // 5 hodin -> hodiny
  //
  // navzájem nepletou.
  // --------------------------------------------------------------------------

  function findUnitQuantity(
    text,
    unitWords
  ){

    const units=
      new Set(
        unitWords.map(fold)
      );

    const tokens=
      fold(text)
      .split(/\s+/)
      .filter(Boolean);

    for(
      let i=0;
      i<tokens.length;
      i++
    ){

      const unit=
        cleanToken(
          tokens[i]
        );

      if(!units.has(unit)){
        continue;
      }

      // --------------------------------------------------------------
      // 1. Klasické číslo
      //
      // 5
      // 5,6
      // 5.6
      // --------------------------------------------------------------

      if(i>0){

        const numeric=
          cleanToken(
            tokens[i-1]
          );

        if(
          /^\d+(?:[.,]\d+)?$/.test(
            numeric
          )
        ){

          const n=
            parseCzechNumber(
              numeric
            );

          if(n!==null){
            return n;
          }
        }
      }

      // --------------------------------------------------------------
      // 2. Slovní číslo
      //
      // pět gramů
      // pět celých šest gramů
      // šest set korun
      // --------------------------------------------------------------

      const first=
        Math.max(
          0,
          i-8
        );

      for(
        let start=first;
        start<i;
        start++
      ){

        const phrase=
          tokens
          .slice(
            start,
            i
          )
          .map(cleanToken)
          .filter(Boolean)
          .join(' ');

        const n=
          spokenCzechDecimal(
            phrase
          );

        if(n!==null){
          return n;
        }
      }
    }

    return null;
  }

  function spokenDigits(v){

    const map={
      nula:'0',
      jedna:'1',
      jeden:'1',
      dva:'2',
      dve:'2',
      tri:'3',
      ctyri:'4',
      pet:'5',
      sest:'6',
      sedm:'7',
      osm:'8',
      devet:'9'
    };

    const words=
      fold(v)
      .split(' ')
      .filter(Boolean);

    if(
      !words.length||
      words.some(
        x=>
          !Object.prototype.hasOwnProperty.call(
            map,
            x
          )
      )
    ){
      return null;
    }

    return words
      .map(
        x=>map[x]
      )
      .join('')||
      null;
  }

  function spokenCzechDecimal(v){

    const phrase=
      fold(v)
      .replace(
        /[;:]/g,
        ' '
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();

    if(!phrase){
      return null;
    }

    // Pokud SpeechRecognition vrátí rovnou číslo.
    if(
      /^\d+(?:[.,]\d+)?$/.test(
        phrase
      )
    ){
      return parseCzechNumber(
        phrase
      );
    }

    // Například:
    //
    // pět celých šest
    // pět čárka šest
    // pět tečka šest

    const parts=
      phrase.split(
        /\s+(?:celych|cela|cele|cely|carka|tecka)\s+/
      );

    if(parts.length===2){

      const whole=
        spokenCzechInteger(
          parts[0]
        );

      const fraction=
        spokenFraction(
          parts[1]
        );

      if(
        whole===null||
        fraction===null
      ){
        return null;
      }

      return whole+fraction;
    }

    if(parts.length>2){
      return null;
    }

    return spokenCzechInteger(
      phrase
    );
  }

  function spokenFraction(v){

    const words=
      fold(v)
      .split(/\s+/)
      .filter(Boolean);

    if(!words.length){
      return null;
    }

    const digitMap={
      nula:0,
      jedna:1,
      jeden:1,
      dva:2,
      dve:2,
      tri:3,
      ctyri:4,
      pet:5,
      sest:6,
      sedm:7,
      osm:8,
      devet:9
    };

    // „nula šest“ -> 0,06
    // „šest“ -> 0,6

    if(
      words.every(
        w=>
          Object.prototype.hasOwnProperty.call(
            digitMap,
            w
          )
      )
    ){

      const digits=
        words
        .map(
          w=>
            String(
              digitMap[w]
            )
        )
        .join('');

      return(
        Number(digits)/
        Math.pow(
          10,
          digits.length
        )
      );
    }

    // „padesát šest“ -> 0,56

    const n=
      spokenCzechInteger(
        words.join(' ')
      );

    if(
      n===null||
      n<0
    ){
      return null;
    }

    const digits=
      String(
        Math.trunc(n)
      ).length;

    return(
      n/
      Math.pow(
        10,
        digits
      )
    );
  }

  // --------------------------------------------------------------------------
  // PŘEVOD ČESKÝCH SLOVNÍCH ČÍSEL
  //
  // Přísný převod:
  // pokud se v úseku objeví cizí slovo,
  // vrátí null.
  //
  // Tím se zamezí tomu,
  // aby parser sebral číslo
  // z jiné kolonky.
  // --------------------------------------------------------------------------

  function spokenCzechInteger(v){

    const small={

      nula:0,

      jeden:1,
      jedna:1,

      dva:2,
      dve:2,

      tri:3,

      ctyri:4,

      pet:5,

      sest:6,

      sedm:7,

      osm:8,

      devet:9,

      deset:10,

      jedenact:11,
      dvanact:12,
      trinact:13,
      ctrnact:14,
      patnact:15,
      sestnact:16,
      sedmnact:17,
      osmnact:18,
      devatenact:19,

      dvacet:20,
      tricet:30,
      ctyricet:40,
      padesat:50,
      sedesat:60,
      sedmdesat:70,
      osmdesat:80,
      devadesat:90
    };

    const words=
      fold(v)
      .replace(
        /[.,]/g,
        ''
      )
      .split(' ')
      .filter(Boolean);

    if(!words.length){
      return null;
    }

    let total=0;
    let current=0;
    let used=false;

    for(const w of words){

      if(
        Object.prototype.hasOwnProperty.call(
          small,
          w
        )
      ){

        current+=small[w];
        used=true;

        continue;
      }

      if(
        w==='sto'||
        w==='ste'||
        w==='set'
      ){

        current=
          (current||1)*100;

        used=true;

        continue;
      }

      if(w==='tisic'){

        total+=
          (current||1)*1000;

        current=0;
        used=true;

        continue;
      }

      return null;
    }

    return used
      ? total+current
      : null;
  }

  function esc(v){

    return String(v)

      .replace(
        /&/g,
        '&amp;'
      )

      .replace(
        /</g,
        '&lt;'
      )

      .replace(
        />/g,
        '&gt;'
      )

      .replace(
        /"/g,
        '&quot;'
      )

      .replace(
        /'/g,
        '&#039;'
      );
  }

})();