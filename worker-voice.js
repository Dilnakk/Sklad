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
    if(data.fineness