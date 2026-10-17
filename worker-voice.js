// ============================================================================
// WORKER VOICE v6.1
//
// 1× klepnutí = začít diktovat.
//
// Ukončení:
// - krátká pauza,
// - "hotovo", "stop", "konec", "zastavit",
// - maximálně 15 sekund.
//
// Příklady:
// "oprava 12-63 3 gramy 600 korun hotovo"
// "výroba 16-35 5 hodin konec"
// "oprava 1625 6,5 gramů předávám Martině hotovo"
//
// Nic samo NEUKLÁDÁ.
// ============================================================================

(function(){
  'use strict';

  const btn=document.getElementById('workerVoiceBtn');
  const status=document.getElementById('workerVoiceStatus');

  if(!btn||!status)return;

  const SpeechRecognition=
    window.SpeechRecognition||
    window.webkitSpeechRecognition;

  if(!SpeechRecognition){
    btn.classList.add('unsupported');

    showCompactStatus(
      'Hlasové zadávání tento prohlížeč nepodporuje.',
      3000
    );

    return;
  }

  const recognition=new SpeechRecognition();

  recognition.lang='cs-CZ';
  recognition.continuous=false;
  recognition.interimResults=true;
  recognition.maxAlternatives=3;


  let sessionActive=false;
  let recognitionRunning=false;

  let segments=[];
  let currentSegment='';

  let restartTimer=null;
  let finishTimer=null;
  let hideTimer=null;
  let maxRecordingTimer=null;


  const AUTO_FINISH_MS=1800;
  const MAX_RECORDING_MS=15000;

  const STOP_WORDS=[
    'hotovo',
    'stop',
    'konec',
    'zastavit'
  ];


  // ==========================================================================
  // TLAČÍTKO MIKROFONU
  // ==========================================================================

  btn.addEventListener('click',function(){

    if(sessionActive){
      return;
    }

    startVoiceSession();
  });


  function startVoiceSession(){

    clearTimers();

    segments=[];
    currentSegment='';

    sessionActive=true;
    recognitionRunning=false;

    btn.classList.add('listening');

    showCompactStatus(
      '🎙 Poslouchám… řekni „hotovo“',
      0
    );


    // Maximálně 15 sekund.
    maxRecordingTimer=setTimeout(
      function(){

        maxRecordingTimer=null;

        if(sessionActive){
          finishVoiceSession();
        }

      },
      MAX_RECORDING_MS
    );


    // DŮLEŽITÉ:
    // První start mikrofonu probíhá přímo uvnitř
    // kliknutí uživatele.
    try{

      recognition.start();

    }catch(e){

      failVoiceSession(
        'Mikrofon se nepodařilo spustit.'
      );

      console.warn(
        'Worker Voice start:',
        e
      );
    }
  }


  // ==========================================================================
  // OPAKOVANÉ SPUŠTĚNÍ PO PAUZE
  // ==========================================================================

  function restartRecognition(){

    if(
      !sessionActive||
      recognitionRunning
    ){
      return;
    }

    try{

      recognition.start();

    }catch(e){

      // Chrome může krátce po onend ještě hlásit,
      // že předchozí rozpoznávání není úplně zavřené.
      restartTimer=setTimeout(
        function(){

          restartTimer=null;

          if(
            !sessionActive||
            recognitionRunning
          ){
            return;
          }

          try{

            recognition.start();

          }catch(err){

            failVoiceSession(
              'Mikrofon se nepodařilo znovu spustit.'
            );

            console.warn(
              'Worker Voice restart:',
              err
            );
          }

        },
        250
      );
    }
  }


  recognition.onstart=function(){

    recognitionRunning=true;
  };


  recognition.onspeechstart=function(){

    // Když člověk znovu začne mluvit,
    // zrušíme automatické dokončení po pauze.
    if(finishTimer){

      clearTimeout(finishTimer);
      finishTimer=null;
    }
  };


  // ==========================================================================
  // ROZPOZNANÁ ŘEČ
  // ==========================================================================

  recognition.onresult=function(event){

    let bestText='';


    for(
      let r=0;
      r<event.results.length;
      r++
    ){

      const result=
        event.results[r];

      if(
        !result||
        !result[0]
      ){
        continue;
      }


      const part=
        String(
          result[0].transcript||
          ''
        ).trim();


      if(part){

        bestText+=
          (bestText?' ':'')+
          part;
      }
    }


    bestText=
      bestText.trim();


    if(!bestText){
      return;
    }


    // ------------------------------------------------------------------------
    // HOTOVO / STOP / KONEC / ZASTAVIT
    // ------------------------------------------------------------------------

    if(
      containsStopWord(
        bestText
      )
    ){

      const cleanText=
        removeStopWord(
          bestText
        );


      if(cleanText){

        currentSegment=
          cleanText;
      }


      finishVoiceSession();

      return;
    }


    currentSegment=
      bestText;
  };


  // ==========================================================================
  // CHYBY MIKROFONU
  // ==========================================================================

  recognition.onerror=function(event){

    recognitionRunning=false;


    if(
      event.error==='no-speech'||
      event.error==='aborted'
    ){
      return;
    }


    if(
      event.error==='not-allowed'||
      event.error==='service-not-allowed'
    ){

      failVoiceSession(
        'Mikrofon není povolený.'
      );

      return;
    }


    if(
      event.error==='audio-capture'
    ){

      failVoiceSession(
        'Mikrofon není dostupný.'
      );

      return;
    }


    if(
      event.error==='network'
    ){

      failVoiceSession(
        'Hlasové rozpoznávání nemá spojení.'
      );

      return;
    }


    failVoiceSession(
      'Hlasové zadání se nepodařilo.'
    );


    console.warn(
      'Worker Voice error:',
      event.error
    );
  };


  // ==========================================================================
  // KONEC JEDNOHO ÚSEKU ŘEČI
  // ==========================================================================

  recognition.onend=function(){

    recognitionRunning=false;


    if(
      currentSegment.trim()
    ){

      addSegment(
        currentSegment.trim()
      );

      currentSegment='';
    }


    if(!sessionActive){
      return;
    }


    // Znovu spustit mikrofon,
    // aby krátká pauza nebyla problém.
    restartTimer=setTimeout(
      function(){

        restartTimer=null;

        restartRecognition();

      },
      120
    );


    // Pokud už dál nikdo nezačne mluvit,
    // po 1,8 s dokončíme formulář.
    if(finishTimer){

      clearTimeout(
        finishTimer
      );
    }


    finishTimer=setTimeout(
      function(){

        finishTimer=null;

        finishVoiceSession();

      },
      AUTO_FINISH_MS
    );
  };


  // ==========================================================================
  // ULOŽENÍ JEDNOTLIVÝCH ÚSEKŮ
  // ==========================================================================

  function addSegment(text){

    text=
      String(
        text||
        ''
      ).trim();


    if(!text){
      return;
    }


    const last=
      segments.length
        ? segments[
            segments.length-1
          ]
        : '';


    // Chrome někdy stejný text vrátí dvakrát.
    if(
      fold(last)===
      fold(text)
    ){
      return;
    }


    segments.push(
      text
    );
  }


  // ==========================================================================
  // DOKONČENÍ DIKTOVÁNÍ
  // ==========================================================================

  function finishVoiceSession(){

    if(!sessionActive){
      return;
    }


    sessionActive=false;


    stopSessionTimers();


    if(
      currentSegment.trim()
    ){

      addSegment(
        currentSegment.trim()
      );

      currentSegment='';
    }


    if(recognitionRunning){

      try{

        recognition.stop();

      }catch(e){}
    }


    btn.classList.remove(
      'listening'
    );


    if(!segments.length){

      showCompactStatus(
        'Nerozpoznal jsem zadání.',
        1500
      );

      return;
    }


    const data=
      parseWorkerVoice(
        segments
      );


    fillWorkerForm(
      data
    );


    if(
      scoreParsed(data)>0
    ){

      showCompactStatus(
        '✓ Vyplněno',
        1200
      );

    }else{

      showCompactStatus(
        'Nerozpoznal jsem údaje.',
        1800
      );
    }
  }


  // ==========================================================================
  // UKONČENÍ PŘI CHYBĚ
  // ==========================================================================

  function failVoiceSession(
    message
  ){

    sessionActive=false;
    recognitionRunning=false;


    stopSessionTimers();


    btn.classList.remove(
      'listening'
    );


    showCompactStatus(
      message,
      3000
    );
  }


  function stopSessionTimers(){

    if(restartTimer){

      clearTimeout(
        restartTimer
      );

      restartTimer=null;
    }


    if(finishTimer){

      clearTimeout(
        finishTimer
      );

      finishTimer=null;
    }


    if(maxRecordingTimer){

      clearTimeout(
        maxRecordingTimer
      );

      maxRecordingTimer=null;
    }
  }


  // ==========================================================================
  // STOP SLOVA
  // ==========================================================================

  function containsStopWord(
    text
  ){

    const t=
      fold(text);


    return STOP_WORDS.some(
      function(word){

        return new RegExp(
          '\\b'+
          word+
          '\\b',
          'i'
        ).test(t);
      }
    );
  }


  function removeStopWord(
    text
  ){

    const original=
      String(
        text||
        ''
      );


    const folded=
      fold(
        original
      );


    let earliest=-1;


    for(
      const word
      of STOP_WORDS
    ){

      const match=
        new RegExp(
          '\\b'+
          word+
          '\\b',
          'i'
        ).exec(
          folded
        );


      if(
        match&&
        (
          earliest===-1||
          match.index<earliest
        )
      ){

        earliest=
          match.index;
      }
    }


    if(
      earliest<0
    ){

      return original.trim();
    }


    return original
      .slice(
        0,
        earliest
      )
      .trim()
      .replace(
        /[,.;:\s]+$/,
        ''
      )
      .trim();
  }


  // ==========================================================================
  // KOLIK ÚDAJŮ JSME ROZPOZNALI
  // ==========================================================================

  function scoreParsed(
    data
  ){

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
      (n,k)=>
        n+
        (
          data[k]!==null
            ? 1
            : 0
        ),
      0
    );
  }


  // ==========================================================================
  // PARSER
  // ==========================================================================

  function parseWorkerVoice(
    inputSegments
  ){

    const originals=
      Array.isArray(
        inputSegments
      )
        ? inputSegments
        : [
            String(
              inputSegments||
              ''
            )
          ];


    const foldedSegments=
      originals.map(
        fold
      );


    const original=
      originals.join(
        ' '
      );


    const text=
      foldedSegments.join(
        ' '
      );


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


    // ------------------------------------------------------------------------
    // OPRAVA / VÝROBA
    // ------------------------------------------------------------------------

    if(
      /\bvyroba\b/.test(
        text
      )
    ){

      data.jobType=
        'VÝROBA';

    }else if(
      /\boprava\b/.test(
        text
      )
    ){

      data.jobType=
        'OPRAVA';
    }


    // ------------------------------------------------------------------------
    // ČÍSLO ZAKÁZKY
    // ------------------------------------------------------------------------

    data.jobNumber=
      extractJobNumber(
        foldedSegments
      );


    // ------------------------------------------------------------------------
    // GRAMY
    // ------------------------------------------------------------------------

    data.grams=
      findUnitQuantity(
        text,
        [
          'g',
          'gram',
          'gramu',
          'gramy'
        ]
      );


    // ------------------------------------------------------------------------
    // HODINY
    // ------------------------------------------------------------------------

    data.hours=
      findUnitQuantity(
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


    // ------------------------------------------------------------------------
    // KORUNY
    // ------------------------------------------------------------------------

    data.price=
      findUnitQuantity(
        text,
        [
          'kc',
          'korun',
          'koruna',
          'koruny'
        ]
      );


    // "cena 600"
    if(
      data.price===null
    ){

      const m=
        text.match(
          /\bcena(?:\s+prace)?\s*[:,-]?\s*(\d+(?:[.,]\d+)?)/i
        );


      if(m){

        data.price=
          parseCzechNumber(
            m[1]
          );
      }
    }


    // ------------------------------------------------------------------------
    // PŘEDÁVÁM MARTINĚ
    // ------------------------------------------------------------------------

    let m=
      text.match(
        /\b(?:predavam|predam|predat)\s+(?:zakazku\s+)?(?:to\s+)?([a-z]+)/i
      );


    if(m){

      data.handoffName=
        m[1];
    }


    // ------------------------------------------------------------------------
    // POZNÁMKA
    // ------------------------------------------------------------------------

    m=
      original.match(
        /(?:poznámka|poznamka|poznámky|poznamky)\s*[:,-]?\s*(.+)$/i
      );


    if(m){

      data.note=
        m[1].trim();
    }


    // ------------------------------------------------------------------------
    // RYZOST
    // ------------------------------------------------------------------------

    m=
      text.match(
        /\bryzost\s*(585|750|925)\b/i
      );


    if(m){

      data.fineness=
        Number(
          m[1]
        );
    }


    return data;
  }


  // ==========================================================================
  // ČÍSLO ZAKÁZKY
  // ==========================================================================

  function extractJobNumber(
    foldedSegments
  ){

    for(
      const segment
      of foldedSegments
    ){

      const typeMatch=
        segment.match(
          /\b(?:oprava|vyroba)\b(.*)$/i
        );


      if(!typeMatch){
        continue;
      }


      let rest=
        String(
          typeMatch[1]||
          ''
        ).trim();


      rest=
        rest.replace(
          /^\s*(?:cislo|zakazka|cislo\s+zakazky)\s*/i,
          ''
        );


      // Zastavíme číslo zakázky před:
      // gramy / korunami / hodinami / předáním / poznámkou...
      const stop=
        rest.search(
          /\b(?:\d+(?:[.,]\d+)?\s*(?:g|gram|gramu|gramy|kc|korun|koruna|koruny|h|hod|hodina|hodiny|hodin|hodinu)|ryzost|predavam|predam|predat|poznamka)\b/i
        );


      if(
        stop>=0
      ){

        rest=
          rest.slice(
            0,
            stop
          );
      }


      // 12-63 -> 1263
      // 12 63 -> 1263
      // 1263  -> 1263

      const digits=
        rest.replace(
          /\D/g,
          ''
        );


      if(digits){

        return digits;
      }


      const spoken=
        spokenDigits(
          rest
        );


      if(spoken){

        return spoken;
      }
    }


    return null;
  }


  // ==========================================================================
  // VYPLNĚNÍ FORMULÁŘE
  // ==========================================================================

  function fillWorkerForm(
    data
  ){


    // Typ zakázky
    if(
      data.jobType&&
      typeof window.setJobType===
      'function'
    ){

      window.setJobType(
        data.jobType
      );
    }


    // Číslo zakázky
    if(
      data.jobNumber!==null
    ){

      setValue(
        'jobNumber',
        data.jobNumber
      );
    }


    // Ryzost
    if(
      data.fineness!==null
    ){

      selectGoldByFineness(
        data.fineness
      );
    }


    // Gramy
    if(
      data.grams!==null
    ){

      setValue(
        'jobGrams',
        formatInputNumber(
          data.grams
        )
      );
    }


    // ------------------------------------------------------------------------
    // HODINOVÁ PRÁCE
    // ------------------------------------------------------------------------

    if(
      data.hours!==null
    ){

      setChecked(
        'jobHourly',
        true
      );


      setValue(
        'jobHours',
        formatInputNumber(
          data.hours
        )
      );


      const price=
        document.getElementById(
          'jobPrice'
        );


      if(price){

        price.value='';
        price.disabled=true;
      }


      const panel=
        document.getElementById(
          'jobHourlyPanel'
        );


      if(panel){

        panel.classList.remove(
          'hidden'
        );
      }


      if(
        typeof window.loadWorkSettings===
        'function'
      ){

        window.loadWorkSettings();
      }


      if(
        typeof window.updateJobHourlyPreview===
        'function'
      ){

        setTimeout(
          function(){

            window.updateJobHourlyPreview();

          },
          50
        );
      }


    }else if(
      data.price!==null
    ){

      // Pevná cena
      setChecked(
        'jobHourly',
        false
      );


      const panel=
        document.getElementById(
          'jobHourlyPanel'
        );


      if(panel){

        panel.classList.add(
          'hidden'
        );
      }


      const price=
        document.getElementById(
          'jobPrice'
        );


      if(price){

        price.disabled=false;
      }


      setValue(
        'jobPrice',
        formatInputNumber(
          data.price
        )
      );
    }


    // Poznámka
    if(
      data.note!==null
    ){

      setValue(
        'jobNote',
        data.note
      );
    }


    // Předání
    if(
      data.handoffName!==null
    ){

      data.handoffResolved=
        enableHandoff(
          data.handoffName
        );
    }


    // Gramy při předání
    if(
      data.grams!==null&&
      typeof window.syncHandoffWeightFromGrams===
      'function'
    ){

      window.syncHandoffWeightFromGrams();
    }
  }


  function setChecked(
    id,
    checked
  ){

    const el=
      document.getElementById(
        id
      );


    if(!el){
      return;
    }


    const changed=
      el.checked!==
      Boolean(
        checked
      );


    el.checked=
      Boolean(
        checked
      );


    if(changed){

      el.dispatchEvent(
        new Event(
          'change',
          {
            bubbles:true
          }
        )
      );
    }
  }


  // ==========================================================================
  // PŘEDÁNÍ PRACOVNÍKOVI
  // ==========================================================================

  function enableHandoff(
    spokenName
  ){

    setChecked(
      'shareJobWorker',
      true
    );


    const panel=
      document.getElementById(
        'jobSharePanel'
      );


    if(panel){

      panel.classList.remove(
        'hidden'
      );
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
        select.options||
        []
      ).filter(
        o=>
          String(
            o.value||
            ''
          ).trim()
      );


    const target=
      fold(
        spokenName
      ).split(
        ' '
      )[0];


    const stem=
      personStem(
        target
      );


    const matches=
      options.filter(
        o=>{

          const words=
            fold(
              o.textContent||
              ''
            )
            .split(
              /\s+/
            )
            .filter(
              Boolean
            );


          return words.some(
            word=>
              personStem(
                word
              )===stem
          );
        }
      );


    if(
      matches.length!==1
    ){

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
      spokenName
    ).trim();
  }


  // ==========================================================================
  // ČÍSLO + JEDNOTKA
  // ==========================================================================

  function findUnitQuantity(
    text,
    unitWords
  ){

    const units=
      new Set(
        unitWords.map(
          fold
        )
      );


    const tokens=
      fold(
        text
      )
      .split(
        /\s+/
      )
      .filter(
        Boolean
      );


    for(
      let i=0;
      i<tokens.length;
      i++
    ){

      const unit=
        cleanToken(
          tokens[i]
        );


      if(
        !units.has(
          unit
        )
      ){
        continue;
      }


      // 5 gramů
      // 5,6 gramů
      if(i>0){

        const previous=
          cleanToken(
            tokens[i-1]
          );


        if(
          /^\d+(?:[.,]\d+)?$/.test(
            previous
          )
        ){

          const n=
            parseCzechNumber(
              previous
            );


          if(
            n!==null
          ){

            return n;
          }
        }
      }


      // pět gramů
      // pět celých šest gramů
      // šest set korun
      const first=
        Math.max(
          0,
          i-7
        );


      for(
        let start=i-1;
        start>=first;
        start--
      ){

        const phrase=
          tokens
          .slice(
            start,
            i
          )
          .map(
            cleanToken
          )
          .filter(
            Boolean
          )
          .join(
            ' '
          );


        const n=
          spokenCzechDecimal(
            phrase
          );


        if(
          n!==null
        ){

          return n;
        }
      }
    }


    return null;
  }


  // ==========================================================================
  // POMOCNÉ FUNKCE
  // ==========================================================================

  function setValue(
    id,
    value
  ){

    const el=
      document.getElementById(
        id
      );


    if(!el){
      return;
    }


    el.value=
      value;


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


    if(!select){
      return;
    }


    const option=
      Array.from(
        select.options
      ).find(
        o=>
          Number(
            o.dataset&&
            o.dataset.fineness
          )===
          Number(
            fineness
          )
      );


    if(!option){
      return;
    }


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


  function personStem(v){

    let s=
      fold(
        v
      ).replace(
        /[^a-z]/g,
        ''
      );


    if(!s){
      return '';
    }


    s=
      s.replace(
        /(ovi|ove|emu|eho)$/,
        ''
      );


    s=
      s.replace(
        /[aeiouy]$/,
        ''
      );


    return s;
  }


  function normalize(v){

    return String(
      v||
      ''
    )
      .toLowerCase()
      .replace(
        /\s+/g,
        ' '
      )
      .trim();
  }


  function fold(v){

    return normalize(
      v
    )
      .normalize(
        'NFD'
      )
      .replace(
        /[\u0300-\u036f]/g,
        ''
      );
  }


  function cleanToken(v){

    return fold(
      v
    ).replace(
      /^[^a-z0-9]+|[^a-z0-9.,]+$/g,
      ''
    );
  }


  function parseCzechNumber(v){

    const n=
      Number(
        String(
          v
        )
        .replace(
          /\s/g,
          ''
        )
        .replace(
          ',',
          '.'
        )
      );


    return Number.isFinite(
      n
    )
      ? n
      : null;
  }


  function formatInputNumber(v){

    return String(
      v
    ).replace(
      '.',
      ','
    );
  }


  // ==========================================================================
  // ČÍSLICE SLOVY
  // ==========================================================================

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
      fold(
        v
      )
      .split(
        /\s+/
      )
      .filter(
        Boolean
      );


    const found=[];


    for(
      const word
      of words
    ){

      if(
        Object.prototype.hasOwnProperty.call(
          map,
          word
        )
      ){

        found.push(
          map[word]
        );
      }
    }


    return found.length
      ? found.join('')
      : null;
  }


  // ==========================================================================
  // ČESKÉ DESETINNÉ ČÍSLO
  // ==========================================================================

  function spokenCzechDecimal(v){

    const phrase=
      fold(
        v
      )
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


    if(
      /^\d+(?:[.,]\d+)?$/.test(
        phrase
      )
    ){

      return parseCzechNumber(
        phrase
      );
    }


    const parts=
      phrase.split(
        /\s+(?:celych|cela|cele|cely|carka|tecka)\s+/
      );


    if(
      parts.length===2
    ){

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


      return(
        whole+
        fraction
      );
    }


    if(
      parts.length>2
    ){

      return null;
    }


    return spokenCzechInteger(
      phrase
    );
  }


  function spokenFraction(v){

    const words=
      fold(
        v
      )
      .split(
        /\s+/
      )
      .filter(
        Boolean
      );


    if(
      !words.length
    ){

      return null;
    }


    const digits={

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


    if(
      words.every(
        w=>
          Object.prototype.hasOwnProperty.call(
            digits,
            w
          )
      )
    ){

      const value=
        words.map(
          w=>
            String(
              digits[w]
            )
        ).join(
          ''
        );


      return(
        Number(value)/
        Math.pow(
          10,
          value.length
        )
      );
    }


    const n=
      spokenCzechInteger(
        words.join(
          ' '
        )
      );


    if(
      n===null||
      n<0
    ){

      return null;
    }


    const length=
      String(
        Math.trunc(
          n
        )
      ).length;


    return(
      n/
      Math.pow(
        10,
        length
      )
    );
  }


  // ==========================================================================
  // ČESKÁ CELÁ ČÍSLA
  // ==========================================================================

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
      fold(
        v
      )
      .replace(
        /[.,]/g,
        ''
      )
      .split(
        ' '
      )
      .filter(
        Boolean
      );


    if(
      !words.length
    ){

      return null;
    }


    let total=0;
    let current=0;
    let used=false;


    for(
      const w
      of words
    ){

      if(
        Object.prototype.hasOwnProperty.call(
          small,
          w
        )
      ){

        current+=
          small[w];

        used=true;

        continue;
      }


      if(
        w==='sto'||
        w==='ste'||
        w==='set'
      ){

        current=
          (current||1)*
          100;

        used=true;

        continue;
      }


      if(
        w==='tisic'
      ){

        total+=
          (current||1)*
          1000;

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


  // ==========================================================================
  // MALÁ STAVOVÁ HLÁŠKA
  // ==========================================================================

  function showCompactStatus(
    text,
    timeout
  ){

    if(hideTimer){

      clearTimeout(
        hideTimer
      );

      hideTimer=null;
    }


    status.textContent=
      text;


    status.classList.add(
      'show'
    );


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


  // ==========================================================================
  // RESET ČASOVAČŮ
  // ==========================================================================

  function clearTimers(){

    stopSessionTimers();


    if(hideTimer){

      clearTimeout(
        hideTimer
      );

      hideTimer=null;
    }
  }

})();