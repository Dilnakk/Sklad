// ============================================================================
// WORKER VOICE v6
//
// 1× klepnutí = začít diktovat.
// Žádné druhé klepnutí pro ukončení.
//
// Diktování se ukončí:
// - po krátké pauze,
// - slovem: HOTOVO / STOP / KONEC / ZASTAVIT,
// - nejpozději automaticky po 15 sekundách.
//
// Příklady:
//   "oprava 12-63 3 gramy 600 korun hotovo"
//   "výroba 16-35 5 hodin konec"
//   "oprava 1625 6,5 gramů předávám Martině hotovo"
//
// Pravidla:
// - číslo po OPRAVA / VÝROBA bez jednotky = číslo zakázky
// - číslo + gramy = jobGrams
// - číslo + korun/Kč = jobPrice
// - číslo + hodin = hodinová práce + jobHours
// - "předávám Martině" = zapnutí předání + výběr pracovníka
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
    console.warn(
      'Worker Voice: SpeechRecognition není dostupné.'
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

  // Po kolika ms bez další nové řeči
  // se celá zakázka automaticky dokončí.
  const AUTO_FINISH_MS=1800;

  // Maximální délka jedné hlasové relace.
  // Pojistka proti nekonečnému poslouchání v hlučné dílně.
  const MAX_RECORDING_MS=15000;

  // Slova, která diktování okamžitě ukončí.
  const STOP_WORDS=[
    'hotovo',
    'stop',
    'konec',
    'zastavit'
  ];


  // --------------------------------------------------------------------------
  // MIKROFON
  // --------------------------------------------------------------------------

  btn.addEventListener('click',function(){

    // Během aktivního diktování druhé klepnutí nic nedělá.
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

    btn.classList.add('listening');
    btn.disabled=true;

    showCompactStatus(
      '🎙 Poslouchám… řekni „hotovo“ pro ukončení',
      0
    );

    // Tvrdá pojistka.
    maxRecordingTimer=setTimeout(
      function(){

        maxRecordingTimer=null;

        if(sessionActive){
          finishVoiceSession();
        }

      },
      MAX_RECORDING_MS
    );

    safeStartRecognition();
  }


  function safeStartRecognition(){

    if(
      !sessionActive||
      recognitionRunning
    ){
      return;
    }

    try{

      recognition.start();

    }catch(e){

      restartTimer=setTimeout(
        function(){

          restartTimer=null;

          if(
            sessionActive&&
            !recognitionRunning
          ){
            safeStartRecognition();
          }

        },
        180
      );
    }
  }


  recognition.onstart=function(){

    recognitionRunning=true;
  };


  recognition.onspeechstart=function(){

    // Pokud pracovník po krátké pauze znovu začne mluvit,
    // zrušíme plánované dokončení.
    if(finishTimer){

      clearTimeout(finishTimer);
      finishTimer=null;
    }
  };


  recognition.onresult=function(event){

    let bestText='';

    for(
      let r=0;
      r<event.results.length;
      r++
    ){

      const result=event.results[r];

      if(
        !result||
        !result[0]
      ){
        continue;
      }

      bestText+=
        (bestText?' ':'')+
        String(
          result[0].transcript||''
        ).trim();
    }

    bestText=bestText.trim();

    if(!bestText){
      return;
    }


    // ----------------------------------------------------------------------
    // HLASOVÉ UKONČENÍ
    //
    // "hotovo"
    // "stop"
    // "konec"
    // "zastavit"
    //
    // Jakmile některé slovo zazní,
    // poslední část před tímto slovem se uloží
    // a mikrofon se okamžitě vypne.
    // ----------------------------------------------------------------------

    if(containsStopWord(bestText)){

      const cleanText=
        removeStopWord(bestText);

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

      sessionActive=false;

      clearTimers();

      btn.classList.remove('listening');
      btn.disabled=false;

      showCompactStatus(
        'Mikrofon není povolený.',
        2500
      );

      return;
    }

    if(event.error==='audio-capture'){

      sessionActive=false;

      clearTimers();

      btn.classList.remove('listening');
      btn.disabled=false;

      showCompactStatus(
        'Mikrofon není dostupný.',
        2500
      );

      return;
    }
  };


  recognition.onend=function(){

    recognitionRunning=false;

    // Uložíme právě nadiktovaný úsek.
    if(currentSegment.trim()){

      addSegment(
        currentSegment.trim()
      );

      currentSegment='';
    }

    if(!sessionActive){
      return;
    }

    // Po každé pauze znovu zapneme mikrofon.
    restartTimer=setTimeout(
      function(){

        restartTimer=null;

        if(sessionActive){
          safeStartRecognition();
        }

      },
      120
    );

    // Pokud už dál pracovník nezačne mluvit,
    // po krátké době zakázku dokončíme.
    if(finishTimer){
      clearTimeout(finishTimer);
    }

    finishTimer=setTimeout(
      function(){

        finishTimer=null;

        finishVoiceSession();

      },
      AUTO_FINISH_MS
    );
  };


  function addSegment(text){

    text=String(text||'').trim();

    if(!text)return;

    // Ochrana proti tomu,
    // aby Chrome stejnou větu přidal dvakrát.
    const last=
      segments.length
        ? segments[segments.length-1]
        : '';

    if(
      fold(last)===
      fold(text)
    ){
      return;
    }

    segments.push(text);
  }


  function finishVoiceSession(){

    if(!sessionActive)return;

    sessionActive=false;

    if(restartTimer){

      clearTimeout(restartTimer);
      restartTimer=null;
    }

    if(finishTimer){

      clearTimeout(finishTimer);
      finishTimer=null;
    }

    if(maxRecordingTimer){

      clearTimeout(maxRecordingTimer);
      maxRecordingTimer=null;
    }

    if(currentSegment.trim()){

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

    btn.classList.remove('listening');
    btn.disabled=false;

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

    fillWorkerForm(data);

    if(scoreParsed(data)>0){

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


  // --------------------------------------------------------------------------
  // HLASOVÉ STOP SLOVO
  // --------------------------------------------------------------------------

  function containsStopWord(text){

    const t=fold(text);

    return STOP_WORDS.some(
      function(word){

        return new RegExp(
          '\\b'+word+'\\b',
          'i'
        ).test(t);
      }
    );
  }


  function removeStopWord(text){

    const original=
      String(text||'');

    const folded=
      fold(original);

    let earliest=-1;

    for(const word of STOP_WORDS){

      const regex=
        new RegExp(
          '\\b'+word+'\\b',
          'i'
        );

      const match=
        regex.exec(folded);

      if(
        match&&
        (
          earliest===-1||
          match.index<earliest
        )
      ){
        earliest=match.index;
      }
    }

    if(earliest<0){
      return original.trim();
    }

    // fold() u běžné češtiny pouze odstraňuje diakritiku,
    // délka textu proto zůstává pro tento účel použitelná.
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


  // --------------------------------------------------------------------------
  // PARSER
  // --------------------------------------------------------------------------

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


  function parseWorkerVoice(inputSegments){

    const originals=
      Array.isArray(inputSegments)
        ? inputSegments
        : [String(inputSegments||'')];

    const foldedSegments=
      originals.map(fold);

    const original=
      originals.join(' ');

    const text=
      foldedSegments.join(' ');

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

    if(/\bvyroba\b/.test(text)){

      data.jobType='VÝROBA';

    }else if(/\boprava\b/.test(text)){

      data.jobType='OPRAVA';
    }


    // ----------------------------------------------------------------------
    // ČÍSLO ZAKÁZKY
    // ----------------------------------------------------------------------

    data.jobNumber=
      extractJobNumber(
        foldedSegments
      );


    // ----------------------------------------------------------------------
    // GRAMY
    // ----------------------------------------------------------------------

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


    // ----------------------------------------------------------------------
    // HODINY
    // ----------------------------------------------------------------------

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


    // ----------------------------------------------------------------------
    // CENA
    // ----------------------------------------------------------------------

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


    // Starší možnost:
    // "cena 600"
    if(data.price===null){

      const m=text.match(
        /\bcena(?:\s+prace)?\s*[:,-]?\s*(\d+(?:[.,]\d+)?)/i
      );

      if(m){

        data.price=
          parseCzechNumber(
            m[1]
          );
      }
    }


    // ----------------------------------------------------------------------
    // PŘEDÁNÍ
    // ----------------------------------------------------------------------

    let m=text.match(
      /\b(?:predavam|predam|predat)\s+(?:zakazku\s+)?(?:to\s+)?([a-z]+)/i
    );

    if(m){

      data.handoffName=
        m[1];
    }


    // ----------------------------------------------------------------------
    // POZNÁMKA
    // ----------------------------------------------------------------------

    m=original.match(
      /(?:poznámka|poznamka|poznámky|poznamky)\s*[:,-]?\s*(.+)$/i
    );

    if(m){

      data.note=
        m[1].trim();
    }


    // ----------------------------------------------------------------------
    // RYZOST
    // ----------------------------------------------------------------------

    m=text.match(
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


  // --------------------------------------------------------------------------
  // ČÍSLO ZAKÁZKY
  // --------------------------------------------------------------------------

  function extractJobNumber(foldedSegments){

    for(
      const segment of foldedSegments
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
          typeMatch[1]||''
        ).trim();

      rest=
        rest.replace(
          /^\s*(?:cislo|zakazka|cislo\s+zakazky)\s*/i,
          ''
        );


      const stop=
        rest.search(
          /\b(?:\d+(?:[.,]\d+)?\s*(?:g|gram|gramu|gramy|kc|korun|koruna|koruny|h|hod|hodina|hodiny|hodin|hodinu)|ryzost|predavam|predam|predat|poznamka)\b/i
        );

      if(stop>=0){

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
        spokenDigits(rest);

      if(spoken){

        return spoken;
      }
    }

    return null;
  }


  // --------------------------------------------------------------------------
  // VYPLNĚNÍ FORMULÁŘE
  // --------------------------------------------------------------------------

  function fillWorkerForm(data){


    // TYP
    if(
      data.jobType&&
      typeof window.setJobType==='function'
    ){

      window.setJobType(
        data.jobType
      );
    }


    // ČÍSLO ZAKÁZKY
    if(data.jobNumber!==null){

      setValue(
        'jobNumber',
        data.jobNumber
      );
    }


    // RYZOST
    if(data.fineness!==null){

      selectGoldByFineness(
        data.fineness
      );
    }


    // GRAMY
    if(data.grams!==null){

      setValue(
        'jobGrams',
        formatInputNumber(
          data.grams
        )
      );
    }


    // ----------------------------------------------------------------------
    // HODINOVÁ PRÁCE
    // ----------------------------------------------------------------------

    if(data.hours!==null){

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


    }else if(data.price!==null){

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


    // POZNÁMKA
    if(data.note!==null){

      setValue(
        'jobNote',
        data.note
      );
    }


    // ----------------------------------------------------------------------
    // PŘEDÁVÁM MARTINĚ
    // ----------------------------------------------------------------------

    if(data.handoffName!==null){

      data.handoffResolved=
        enableHandoff(
          data.handoffName
        );
    }


    // Pokud jsou současně gramy + předání,
    // zkopíruje se gramáž i do hmotnosti předání.
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
      document.getElementById(id);

    if(!el)return;

    const changed=
      el.checked!==Boolean(
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


  function enableHandoff(spokenName){

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
        select.options||[]
      ).filter(
        o=>
          String(
            o.value||''
          ).trim()
      );

    const target=
      fold(spokenName)
      .split(' ')[0];

    const stem=
      personStem(
        target
      );

    let matches=
      options.filter(
        o=>{

          const words=
            fold(
              o.textContent||
              ''
            )
            .split(/\s+/)
            .filter(Boolean);

          return words.some(
            word=>
              personStem(
                word
              )===stem
          );
        }
      );

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
      spokenName
    ).trim();
  }


  // --------------------------------------------------------------------------
  // JEDNOTKY
  // --------------------------------------------------------------------------

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

          if(n!==null){

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


  // --------------------------------------------------------------------------
  // POMOCNÉ FUNKCE
  // --------------------------------------------------------------------------

  function setValue(
    id,
    value
  ){

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
          Number(
            fineness
          )
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


  function personStem(v){

    let s=
      fold(v)
      .replace(
        /[^a-z]/g,
        ''
      );

    if(!s)return '';

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
      );
  }


  function cleanToken(v){

    return fold(v)
      .replace(
        /^[^a-z0-9]+|[^a-z0-9.,]+$/g,
        ''
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
      .split(/\s+/)
      .filter(Boolean);

    const found=[];

    for(const word of words){

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
        ).join('');

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
        words.join(' ')
      );

    if(
      n===null||
      n<0
    ){

      return null;
    }

    const length=
      String(
        Math.trunc(n)
      ).length;

    return(
      n/
      Math.pow(
        10,
        length
      )
    );
  }


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


  function showCompactStatus(
    text,
    timeout
  ){

    if(hideTimer){

      clearTimeout(hideTimer);
      hideTimer=null;
    }

    status.textContent=text;
    status.classList.add('show');

    if(timeout){

      hideTimer=setTimeout(
        function(){

          status.classList.remove(
            'show'
          );

        },
        timeout
      );
    }
  }


  function clearTimers(){

    if(restartTimer){
      clearTimeout(restartTimer);
      restartTimer=null;
    }

    if(finishTimer){
      clearTimeout(finishTimer);
      finishTimer=null;
    }

    if(hideTimer){
      clearTimeout(hideTimer);
      hideTimer=null;
    }

    if(maxRecordingTimer){
      clearTimeout(maxRecordingTimer);
      maxRecordingTimer=null;
    }
  }

})();