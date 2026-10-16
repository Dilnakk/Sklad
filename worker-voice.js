// ============================================================================
// WORKER VOICE v3
// Hlasové PŘEDVYPLNĚNÍ existujícího formuláře Worker.
//
// Bezpečnost:
// - nic samo NEUKLÁDÁ,
// - nevolá api(), fetch() ani Apps Script,
// - pouze ovládá a vyplňuje existující Worker formulář,
// - pracovník vždy údaje zkontroluje a použije původní POTVRDIT VÝDEJ.
//
// Navíc v3:
// - hodinová práce + hodiny,
// - "odevzdávám také kameny",
// - "předávám Martině / Ondrovi..." podle AKTUÁLNÍHO seznamu Workerů,
// - žádná jména nejsou natvrdo uložená v tomto souboru.
// ============================================================================

(function () {
  'use strict';

  const btn = document.getElementById('workerVoiceBtn');
  const status = document.getElementById('workerVoiceStatus');

  if (!btn || !status) return;

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    btn.classList.add('unsupported');

    console.warn(
      'Worker Voice: SpeechRecognition není v tomto prohlížeči dostupné.'
    );

    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = 'cs-CZ';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  let listening = false;
  let hideTimer = null;


  // ==========================================================================
  // MIKROFON
  // ==========================================================================

  btn.addEventListener('click', function () {

    if (listening) {
      recognition.stop();
      return;
    }

    try {
      recognition.start();
    } catch (e) {
      console.warn('Worker Voice:', e);
    }

  });


  recognition.onstart = function () {

    listening = true;

    btn.classList.add('listening');

    showStatus(
      '<strong>🎙 Poslouchám…</strong><br>' +
      '<span class="worker-voice-muted">' +
      'Můžeš nadiktovat zakázku, cenu, gramy, hodiny nebo předání.' +
      '</span>'
    );

  };


  recognition.onend = function () {

    listening = false;

    btn.classList.remove('listening');

  };


  recognition.onerror = function (event) {

    listening = false;

    btn.classList.remove('listening');

    if (event.error === 'not-allowed') {
      showStatus('Mikrofon není povolený.', 5000);
      return;
    }

    if (event.error === 'no-speech') {
      showStatus('Nerozpoznal jsem žádnou řeč.', 3500);
      return;
    }

    showStatus(
      'Hlasové zadání se nepodařilo.',
      4000
    );

  };


  recognition.onresult = async function (event) {

    const alternatives =
      event.results &&
      event.results[0];

    if (!alternatives || !alternatives[0]) {

      showStatus(
        'Nerozpoznal jsem zadání.',
        3500
      );

      return;
    }


    let best = null;

    const count =
      Math.min(
        alternatives.length || 1,
        3
      );


    for (let i = 0; i < count; i++) {

      const transcript =
        String(
          alternatives[i].transcript || ''
        ).trim();

      const parsed =
        parseWorkerVoice(transcript);

      const score =
        scoreParsed(parsed);


      if (!best || score > best.score) {

        best = {
          transcript,
          parsed,
          score
        };

      }

    }


    if (!best) {

      showStatus(
        'Nerozpoznal jsem zadání.',
        3500
      );

      return;
    }


    await fillWorkerForm(best.parsed);

    showResult(
      best.transcript,
      best.parsed
    );

  };


  // ==========================================================================
  // HODNOCENÍ ROZPOZNANÉ VARIANTY
  // ==========================================================================

  function scoreParsed(data) {

    let score = 0;

    if (data.jobType !== null) score++;
    if (data.jobNumber !== null) score++;
    if (data.grams !== null) score++;
    if (data.price !== null) score++;
    if (data.note !== null) score++;
    if (data.fineness !== null) score++;

    if (data.hours !== null) {
      score += 2;
    }

    if (data.hourlyRequested) {
      score++;
    }

    if (data.stonesRequested) {
      score++;
    }

    if (data.shareRequested) {
      score++;
    }

    if (data.transferName) {
      score += 2;
    }

    return score;

  }


  // ==========================================================================
  // PARSER
  // ==========================================================================

  function parseWorkerVoice(original) {

    const text =
      normalize(original);

    const matchText =
      normalizeForMatch(original);


    const data = {

      jobNumber: null,

      grams: null,

      price: null,

      note: null,

      jobType: null,

      fineness: null,

      hours: null,

      hourlyRequested: false,

      stonesRequested: false,

      shareRequested: false,

      transferName: null,

      selectedWorkerName: null,

      workerMatch: null

    };


    // ------------------------------------------------------------------------
    // TYP ZAKÁZKY
    // ------------------------------------------------------------------------

    if (
      /\bvyroba\b/i.test(matchText)
    ) {

      data.jobType = 'VÝROBA';

    } else if (
      /\boprava\b/i.test(matchText)
    ) {

      data.jobType = 'OPRAVA';

    }


    // ------------------------------------------------------------------------
    // ČÍSLO ZAKÁZKY
    // ------------------------------------------------------------------------

    let m = text.match(
      /(?:číslo\s+zakázky|cislo\s+zakazky|zakázka\s+číslo|zakazka\s+cislo|zakázka|zakazka)\s*[:,-]?\s*([0-9][0-9\s-]{1,14})/i
    );


    if (m) {

      const digits =
        m[1].replace(/\D/g, '');

      if (digits) {

        data.jobNumber =
          digits;

      }

    }


    if (!data.jobNumber) {

      m = text.match(
        /(?:číslo\s+zakázky|cislo\s+zakazky|zakázka\s+číslo|zakazka\s+cislo|zakázka|zakazka)\s*[:,-]?\s*((?:(?:nula|jedna|jeden|dva|dvě|tri|tři|čtyři|ctyri|pět|pet|šest|sest|sedm|osm|devět|devet)\s*){2,})/i
      );


      if (m) {

        data.jobNumber =
          spokenDigits(m[1]);

      }

    }


    // ------------------------------------------------------------------------
    // HMOTNOST
    // ------------------------------------------------------------------------

    m = text.match(
      /(?:přidaná\s+hmotnost|pridana\s+hmotnost|vydané\s+zlato|vydane\s+zlato|hmotnost|přidáno|pridano|gramáž|gramaz)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i
    );


    if (m) {

      data.grams =
        parseCzechNumber(m[1]);

    }


    // "2,5 gramu"
    if (data.grams === null) {

      m = text.match(
        /\b([0-9]+(?:[.,][0-9]+)?)\s*(?:g|gram|gramu|gramy|gramů)\b/i
      );


      if (m) {

        data.grams =
          parseCzechNumber(m[1]);

      }

    }


    // ------------------------------------------------------------------------
    // CENA
    // ------------------------------------------------------------------------

    m = text.match(
      /(?:cena(?:\s+práce)?|cena\s+prace|za)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i
    );


    if (m) {

      data.price =
        parseCzechNumber(m[1]);

    }


    // "600 korun"
    if (data.price === null) {

      m = text.match(
        /\b([0-9]+(?:[.,][0-9]+)?)\s*(?:kč|kc|korun|koruna|koruny)\b/i
      );


      if (m) {

        data.price =
          parseCzechNumber(m[1]);

      }

    }


    // Slovně: "šest set korun"
    if (data.price === null) {

      m = matchText.match(
        /\b((?:nula|jeden|jedna|dva|dve|tri|ctyri|pet|sest|sedm|osm|devet|deset|jedenact|dvanact|trinact|ctrnact|patnact|sestnact|sedmnact|osmnact|devatenact|dvacet|tricet|ctyricet|padesat|sedesat|sedmdesat|osmdesat|devadesat|sto|ste|set|tisic)(?:\s+|$)){1,8}(?=korun|koruna|koruny)/i
      );


      if (m) {

        const spoken =
          spokenCzechNumber(m[1]);


        if (spoken !== null) {

          data.price =
            spoken;

        }

      }

    }


    // ------------------------------------------------------------------------
    // RYZOST
    // ------------------------------------------------------------------------

    m = text.match(
      /(?:ryzost\s*)?\b(585|750|925)\b/i
    );


    if (m) {

      data.fineness =
        Number(m[1]);

    }


    // ------------------------------------------------------------------------
    // HODINOVÁ PRÁCE
    // ------------------------------------------------------------------------

    data.hours =
      parseHours(original);


    if (
      data.hours !== null ||
      /\bhodinove\b/i.test(matchText) ||
      /\buctovat\s+hodinove\b/i.test(matchText) ||
      /\bodpracovano\b/i.test(matchText)
    ) {

      data.hourlyRequested =
        true;

    }


    // ------------------------------------------------------------------------
    // KAMENY
    // ------------------------------------------------------------------------

    if (
      /\bodevzdavam\b.{0,30}\bkamen/i.test(matchText) ||
      /\bodevzdavam\s+take\s+kamen/i.test(matchText) ||
      /\btake\s+kameny\b/i.test(matchText)
    ) {

      data.stonesRequested =
        true;

    }


    // ------------------------------------------------------------------------
    // PŘEDÁNÍ DALŠÍMU PRACOVNÍKOVI
    // ------------------------------------------------------------------------

    if (
      /\bpredavam\b/i.test(matchText)
    ) {

      data.shareRequested =
        true;

      data.transferName =
        extractTransferName(original);

    }


    // ------------------------------------------------------------------------
    // POZNÁMKA
    // ------------------------------------------------------------------------

    m = original.match(
      /(?:poznámka|poznamka|poznámky|poznamky)\s*[:,-]?\s*(.+)$/i
    );


    if (m) {

      data.note =
        m[1].trim();

    }


    return data;

  }


  // ==========================================================================
  // HODINY
  // ==========================================================================

  function parseHours(original) {

    const text =
      normalizeForMatch(original);


    // ------------------------------------------------------------------------
    // ČÍSELNĚ
    //
    // "5 hodin"
    // "2,5 hodiny"
    // ------------------------------------------------------------------------

    let m = text.match(
      /\b([0-9]+(?:[.,][0-9]+)?)\s*(?:h|hodina|hodiny|hodin)\b/i
    );


    if (m) {

      return parseCzechNumber(
        m[1]
      );

    }


    // "hodiny 3,5"
    m = text.match(
      /\b(?:hodina|hodiny|hodin)\s*[:,-]?\s*([0-9]+(?:[.,][0-9]+)?)/i
    );


    if (m) {

      return parseCzechNumber(
        m[1]
      );

    }


    // ------------------------------------------------------------------------
    // SLOVNĚ
    // ------------------------------------------------------------------------

    const words =
      text
        .replace(/[.,;:!?]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);


    for (
      let i = 0;
      i < words.length;
      i++
    ) {

      if (
        words[i] !== 'hodina' &&
        words[i] !== 'hodiny' &&
        words[i] !== 'hodin'
      ) {
        continue;
      }


      // Zkusíme slova PŘED "hodiny"
      for (
        let len = 4;
        len >= 1;
        len--
      ) {

        const start =
          i - len;

        if (start < 0) {
          continue;
        }

        const phrase =
          words
            .slice(start, i)
            .join(' ');

        const n =
          parseSpokenHoursPhrase(
            phrase
          );


        if (n !== null) {

          return n;

        }

      }


      // Zkusíme slova ZA "hodiny"
      for (
        let len = 4;
        len >= 1;
        len--
      ) {

        const end =
          i + 1 + len;

        if (end > words.length) {
          continue;
        }

        const phrase =
          words
            .slice(i + 1, end)
            .join(' ');

        const n =
          parseSpokenHoursPhrase(
            phrase
          );


        if (n !== null) {

          return n;

        }

      }

    }


    return null;

  }


  function parseSpokenHoursPhrase(phrase) {

    let p =
      normalizeForMatch(phrase)
        .trim();


    // "dvě a půl"
    let m = p.match(
      /^(.+?)\s+a\s+pul$/
    );


    if (m) {

      const whole =
        spokenCzechNumber(
          m[1]
        );


      if (
        whole !== null &&
        whole >= 0
      ) {

        return whole + 0.5;

      }

    }


    // "půl"
    if (p === 'pul') {

      return 0.5;

    }


    const n =
      spokenCzechNumber(p);


    if (
      n !== null &&
      n >= 0 &&
      n <= 24
    ) {

      return n;

    }


    return null;

  }


  // ==========================================================================
  // PŘEDÁNÍ PRACOVNÍKOVI
  // ==========================================================================

  function extractTransferName(original) {

    const words =
      normalizeForMatch(original)
        .replace(/[.,;:!?]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);


    const index =
      words.indexOf('predavam');


    if (index === -1) {
      return null;
    }


    const skip = new Set([
      'to',
      'zakazku',
      'zakazku',
      'dal',
      'dale',
      'dalsimu',
      'pracovnikovi',
      'pracovnik',
      'kolegovI'.toLowerCase(),
      'kolega',
      'take',
      'taky'
    ]);


    const stop = new Set([
      'cena',
      'poznamka',
      'hodiny',
      'hodin',
      'hodinove',
      'hmotnost',
      'gramu',
      'gramy',
      'gram',
      'ryzost',
      'oprava',
      'vyroba'
    ]);


    for (
      let i = index + 1;
      i < words.length;
      i++
    ) {

      const word =
        words[i];


      if (stop.has(word)) {
        break;
      }


      if (skip.has(word)) {
        continue;
      }


      // "předávám kameny" není jméno pracovníka
      if (
        word.startsWith('kamen')
      ) {
        return null;
      }


      return word;

    }


    return null;

  }


  function selectWorkerBySpokenName(spokenName) {

    if (!spokenName) {

      return {
        status: 'none',
        name: null
      };

    }


    const select =
      document.getElementById(
        'jobShareWorker'
      );


    if (!select) {

      return {
        status: 'notfound',
        name: null
      };

    }


    const candidate =
      normalizeName(
        spokenName
      );


    if (!candidate) {

      return {
        status: 'notfound',
        name: null
      };

    }


    const matches = [];


    Array
      .from(select.options)
      .forEach(function (option) {

        if (!option.value) {
          return;
        }


        const label =
          String(
            option.textContent || ''
          ).trim();


        if (!label) {
          return;
        }


        // Nejprve zkoušíme jednotlivá slova názvu.
        const labelWords =
          label
            .split(/\s+/)
            .map(normalizeName)
            .filter(Boolean);


        let bestScore = 0;


        labelWords.forEach(
          function (base) {

            const score =
              nameMatchScore(
                base,
                candidate
              );


            if (score > bestScore) {

              bestScore =
                score;

            }

          }
        );


        if (bestScore > 0) {

          matches.push({
            option,
            label,
            score: bestScore
          });

        }

      });


    if (!matches.length) {

      return {
        status: 'notfound',
        name: null
      };

    }


    matches.sort(
      function (a, b) {
        return b.score - a.score;
      }
    );


    const bestScore =
      matches[0].score;


    const best =
      matches.filter(
        x => x.score === bestScore
      );


    // Pokud máme více stejně dobrých výsledků,
    // raději nikoho nevybíráme.
    if (best.length !== 1) {

      return {
        status: 'ambiguous',
        name: null
      };

    }


    select.value =
      best[0].option.value;


    select.dispatchEvent(
      new Event(
        'change',
        {
          bubbles: true
        }
      )
    );


    return {
      status: 'selected',
      name: best[0].label
    };

  }


  function nameMatchScore(base, candidate) {

    if (!base || !candidate) {
      return 0;
    }


    // Úplná shoda.
    if (base === candidate) {
      return 100;
    }


    // Ondřej -> Ondřejovi
    if (
      candidate.startsWith(base)
    ) {
      return 95;
    }


    // Pokud je přepsaná zkrácená varianta.
    if (
      base.startsWith(candidate) &&
      candidate.length >= 3
    ) {
      return 90;
    }


    const prefix =
      commonPrefixLength(
        base,
        candidate
      );


    const minLength =
      Math.min(
        base.length,
        candidate.length
      );


    // Martina / Martině
    // Ondra / Ondrovi
    // Jana / Janě
    //
    // Připustíme rozdíl přibližně v posledním znaku základního jména.
    const needed =
      Math.max(
        3,
        minLength - 1
      );


    if (prefix >= needed) {

      return 70 + prefix;

    }


    // Žádná bezpečná shoda.
    return 0;

  }


  function commonPrefixLength(a, b) {

    const n =
      Math.min(
        a.length,
        b.length
      );


    let i = 0;


    while (
      i < n &&
      a[i] === b[i]
    ) {

      i++;

    }


    return i;

  }


  // ==========================================================================
  // VYPLNĚNÍ WORKER FORMULÁŘE
  // ==========================================================================

  async function fillWorkerForm(data) {

    // ------------------------------------------------------------------------
    // OPRAVA / VÝROBA
    // ------------------------------------------------------------------------

    if (
      data.jobType &&
      typeof window.setJobType ===
        'function'
    ) {

      window.setJobType(
        data.jobType
      );

    }


    // ------------------------------------------------------------------------
    // ČÍSLO
    // ------------------------------------------------------------------------

    if (
      data.jobNumber !== null
    ) {

      setValue(
        'jobNumber',
        data.jobNumber
      );

    }


    // ------------------------------------------------------------------------
    // GRAMY
    // ------------------------------------------------------------------------

    if (
      data.grams !== null
    ) {

      setValue(
        'jobGrams',
        formatInputNumber(
          data.grams
        )
      );

    }


    // ------------------------------------------------------------------------
    // RYZOST
    // ------------------------------------------------------------------------

    if (
      data.fineness !== null
    ) {

      selectGoldByFineness(
        data.fineness
      );

    }


    // ------------------------------------------------------------------------
    // HODINOVÁ PRÁCE
    // ------------------------------------------------------------------------

    if (
      data.hourlyRequested
    ) {

      const hourly =
        document.getElementById(
          'jobHourly'
        );


      if (hourly) {

        if (!hourly.checked) {

          hourly.checked =
            true;


          if (
            typeof window.toggleJobHourly ===
              'function'
          ) {

            try {

              await window.toggleJobHourly();

            } catch (e) {

              console.warn(
                'Worker Voice – hodinová práce:',
                e
              );

            }

          } else {

            const panel =
              document.getElementById(
                'jobHourlyPanel'
              );


            if (panel) {

              panel.classList.remove(
                'hidden'
              );

            }

          }

        }


        if (
          data.hours !== null
        ) {

          setValue(
            'jobHours',
            formatInputNumber(
              data.hours
            )
          );


          if (
            typeof window.updateJobHourlyPreview ===
              'function'
          ) {

            window.updateJobHourlyPreview();

          }

        }

      }

    }


    // ------------------------------------------------------------------------
    // CENA
    // ------------------------------------------------------------------------

    if (
      data.price !== null
    ) {

      const hourly =
        document.getElementById(
          'jobHourly'
        );


      // Při hodinové práci se cena počítá systémem.
      if (
        !hourly ||
        !hourly.checked
      ) {

        setValue(
          'jobPrice',
          formatInputNumber(
            data.price
          )
        );

      }

    }


    // ------------------------------------------------------------------------
    // POZNÁMKA
    // ------------------------------------------------------------------------

    if (
      data.note !== null
    ) {

      setValue(
        'jobNote',
        data.note
      );

    }


    // ------------------------------------------------------------------------
    // KAMENY
    // ------------------------------------------------------------------------

    if (
      data.stonesRequested
    ) {

      const stones =
        document.getElementById(
          'includeJobStones'
        );


      if (
        stones &&
        !stones.checked
      ) {

        stones.checked =
          true;


        if (
          typeof window.toggleJobStones ===
            'function'
        ) {

          window.toggleJobStones();

        }

      }

    }


    // ------------------------------------------------------------------------
    // PŘEDÁNÍ PRACOVNÍKOVI
    // ------------------------------------------------------------------------

    if (
      data.shareRequested
    ) {

      const share =
        document.getElementById(
          'shareJobWorker'
        );


      if (share) {

        if (!share.checked) {

          share.checked =
            true;


          if (
            typeof window.toggleJobShare ===
              'function'
          ) {

            window.toggleJobShare();

          } else {

            const panel =
              document.getElementById(
                'jobSharePanel'
              );


            if (panel) {

              panel.classList.remove(
                'hidden'
              );

            }

          }

        }


        if (
          data.transferName
        ) {

          // Krátká prodleva je užitečná,
          // pokud se seznam pracovníků právě načítá.
          await wait(150);


          const result =
            selectWorkerBySpokenName(
              data.transferName
            );


          data.workerMatch =
            result.status;

          data.selectedWorkerName =
            result.name;

        }

      }

    }


    // ------------------------------------------------------------------------
    // SYNCHRONIZACE HMOTNOSTI PŘI PŘEDÁNÍ
    // ------------------------------------------------------------------------

    if (
      data.grams !== null &&
      typeof window.syncHandoffWeightFromGrams ===
        'function'
    ) {

      window.syncHandoffWeightFromGrams();

    }

  }


  // ==========================================================================
  // POMOCNÉ OVLÁDÁNÍ FORMULÁŘE
  // ==========================================================================

  function setValue(id, value) {

    const el =
      document.getElementById(id);


    if (!el) return;


    el.value =
      value;


    el.dispatchEvent(
      new Event(
        'input',
        {
          bubbles: true
        }
      )
    );


    el.dispatchEvent(
      new Event(
        'change',
        {
          bubbles: true
        }
      )
    );

  }


  function selectGoldByFineness(
    fineness
  ) {

    const select =
      document.getElementById(
        'jobGoldCode'
      );


    if (!select) return;


    const option =
      Array
        .from(select.options)
        .find(
          o =>
            Number(
              o.dataset &&
              o.dataset.fineness
            ) === Number(fineness)
        );


    if (!option) return;


    select.value =
      option.value;


    select.dispatchEvent(
      new Event(
        'change',
        {
          bubbles: true
        }
      )
    );

  }


  // ==========================================================================
  // VÝSLEDEK
  // ==========================================================================

  function showResult(
    transcript,
    data
  ) {

    const found = [];


    if (data.jobType) {

      found.push(
        'Typ: <strong>' +
        esc(data.jobType) +
        '</strong>'
      );

    }


    if (
      data.jobNumber !== null
    ) {

      found.push(
        'Zakázka: <strong>' +
        esc(data.jobNumber) +
        '</strong>'
      );

    }


    if (
      data.grams !== null
    ) {

      found.push(
        'Hmotnost: <strong>' +
        esc(
          formatInputNumber(
            data.grams
          )
        ) +
        ' g</strong>'
      );

    }


    if (
      data.price !== null
    ) {

      const hourly =
        document.getElementById(
          'jobHourly'
        );


      if (
        !hourly ||
        !hourly.checked
      ) {

        found.push(
          'Cena: <strong>' +
          esc(
            formatInputNumber(
              data.price
            )
          ) +
          ' Kč</strong>'
        );

      }

    }


    if (
      data.fineness !== null
    ) {

      found.push(
        'Ryzost: <strong>' +
        esc(data.fineness) +
        '/1000</strong>'
      );

    }


    if (
      data.hourlyRequested
    ) {

      if (
        data.hours !== null
      ) {

        found.push(
          'Hodinová práce: <strong>' +
          esc(
            formatInputNumber(
              data.hours
            )
          ) +
          ' hod.</strong>'
        );

      } else {

        found.push(
          'Hodinová práce: <strong>zapnuta</strong>'
        );

      }

    }


    if (
      data.stonesRequested
    ) {

      found.push(
        'Kameny: <strong>panel otevřen</strong>'
      );

    }


    if (
      data.shareRequested
    ) {

      if (
        data.workerMatch ===
          'selected' &&
        data.selectedWorkerName
      ) {

        found.push(
          'Předání: <strong>' +
          esc(
            data.selectedWorkerName
          ) +
          '</strong>'
        );

      } else if (
        data.workerMatch ===
          'ambiguous'
      ) {

        found.push(
          'Předání: <strong>vyber pracovníka – našel jsem více možností</strong>'
        );

      } else if (
        data.transferName &&
        data.workerMatch ===
          'notfound'
      ) {

        found.push(
          'Předání: <strong>pracovníka jsem bezpečně nerozpoznal – vyber ho ručně</strong>'
        );

      } else {

        found.push(
          'Předání: <strong>panel otevřen</strong>'
        );

      }

    }


    if (
      data.note !== null
    ) {

      found.push(
        'Poznámka: <strong>' +
        esc(data.note) +
        '</strong>'
      );

    }


    let html =
      '<span class="worker-voice-muted">' +
      'Slyšel jsem:' +
      '</span><br>' +
      esc(transcript);


    if (found.length) {

      html +=
        '<br><br>' +
        found.join('<br>');


      html +=
        '<br><br>' +
        '<span class="worker-voice-ok">' +
        'Zkontroluj formulář a teprve potom potvrď výdej.' +
        '</span>';

    } else {

      html +=
        '<br><br>' +
        '<strong>' +
        'Nenašel jsem žádný údaj k předvyplnění.' +
        '</strong>';

    }


    showStatus(
      html,
      10000
    );

  }


  // ==========================================================================
  // STATUS
  // ==========================================================================

  function showStatus(
    html,
    timeout
  ) {

    if (hideTimer) {

      clearTimeout(
        hideTimer
      );

      hideTimer =
        null;

    }


    status.innerHTML =
      html;


    status.classList.add(
      'show'
    );


    if (timeout) {

      hideTimer =
        setTimeout(
          function () {

            status.classList.remove(
              'show'
            );

          },
          timeout
        );

    }

  }


  // ==========================================================================
  // ČÍSLA
  // ==========================================================================

  function parseCzechNumber(v) {

    const n =
      Number(
        String(v)
          .replace(/\s/g, '')
          .replace(',', '.')
      );


    return Number.isFinite(n)
      ? n
      : null;

  }


  function spokenDigits(v) {

    const map = {

      nula: '0',

      jedna: '1',

      jeden: '1',

      dva: '2',

      dvě: '2',

      tri: '3',

      tři: '3',

      čtyři: '4',

      ctyri: '4',

      pět: '5',

      pet: '5',

      šest: '6',

      sest: '6',

      sedm: '7',

      osm: '8',

      devět: '9',

      devet: '9'

    };


    return normalize(v)
      .split(' ')
      .map(
        x => map[x] || ''
      )
      .join('') || null;

  }


  function spokenCzechNumber(v) {

    const small = {

      nula: 0,

      jeden: 1,

      jedna: 1,

      dva: 2,

      dve: 2,

      tri: 3,

      ctyri: 4,

      pet: 5,

      sest: 6,

      sedm: 7,

      osm: 8,

      devet: 9,

      deset: 10,

      jedenact: 11,

      dvanact: 12,

      trinact: 13,

      ctrnact: 14,

      patnact: 15,

      sestnact: 16,

      sedmnact: 17,

      osmnact: 18,

      devatenact: 19,

      dvacet: 20,

      tricet: 30,

      ctyricet: 40,

      padesat: 50,

      sedesat: 60,

      sedmdesat: 70,

      osmdesat: 80,

      devadesat: 90

    };


    const words =
      normalizeForMatch(v)
        .replace(/[.,]/g, '')
        .split(' ')
        .filter(Boolean);


    let total = 0;
    let current = 0;
    let used = false;


    for (const w of words) {

      if (
        Object.prototype.hasOwnProperty.call(
          small,
          w
        )
      ) {

        current +=
          small[w];

        used =
          true;

        continue;

      }


      if (
        w === 'sto' ||
        w === 'ste' ||
        w === 'set'
      ) {

        current =
          (current || 1) * 100;

        used =
          true;

        continue;

      }


      if (
        w === 'tisic'
      ) {

        total +=
          (current || 1) * 1000;

        current =
          0;

        used =
          true;

        continue;

      }

    }


    return used
      ? total + current
      : null;

  }


  // ==========================================================================
  // TEXT
  // ==========================================================================

  function normalize(v) {

    return String(v || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  }


  function normalizeForMatch(v) {

    return String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .replace(/\s+/g, ' ')
      .trim();

  }


  function normalizeName(v) {

    return normalizeForMatch(v)
      .replace(
        /[^a-z]/g,
        ''
      );

  }


  function formatInputNumber(v) {

    return String(v)
      .replace('.', ',');

  }


  function wait(ms) {

    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );

  }


  function esc(v) {

    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  }

})();