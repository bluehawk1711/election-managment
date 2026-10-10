# Election Campaign — वीरनगर कैंपेन ऑपरेशन्स ऐप

A field-ready mobile app (Expo / React Native) that turns the official voter
roll into a working campaign tool: search every voter, record what the field
team learns, and see the campaign's state at a glance — **fully offline**.

वीरनगर के लिए बना फ़ील्ड-रेडी मोबाइल ऐप, जो आधिकारिक मतदाता सूची को चलते-फिरते
कैंपेन टूल में बदल देता है — हर मतदाता की खोज, फ़ील्ड टीम की जानकारी का रिकॉर्ड,
और कैंपेन की पूरी तस्वीर एक नज़र में, **बिना इंटरनेट के भी**।

---

## Why use this app? — ऐप क्यों इस्तेमाल करें?

### English — features & benefits

1. **The whole voter roll, in your pocket.** All 6,855 voters of 13 wards are
   bundled inside the APK — no internet, no server round-trip, results in
   milliseconds even on a cheap phone.
2. **Search that understands how people actually type.** Hindi (Devanagari)
   and English (Latin) both work: type `hariram` or `हरिराम` and real Harirams
   rank first — starting-word matches always beat mid-word ones, and typing
   just `ram` still finds everyone while keeping the best matches on top.
3. **Search only what you mean.** Scope badges narrow the query to name,
   father/husband name, locality, or everything else (EPIC, house, phone) —
   so "whose son is this" is one tap, not scrolling through wrong Mukeshes.
4. **Find the person, not just the record.** Every voter card shows photo
   slot, serial, EPIC ID, house number, age and locality together — you can
   confirm the human standing in front of you against the electoral roll.
5. **One-tap contact.** Call, SMS or WhatsApp a voter directly from their
   record — the number you captured in the field, no copy-pasting.
6. **Record what the field learns, instantly.** Photo, GPS fix, voted /
   not-voted, political leaning (5-point spectrum), supporter / opponent,
   caste, phone and notes — each commits the moment you tap it.
7. **Colour-coded intent at a glance.** Supporters wear green, opponents red,
   leaning runs warm-to-cool — the whole booth's mood is readable before you
   read a single label.
8. **Works with zero network, syncs later.** Every edit is written locally
   first and queued; the list stays usable offline and the queue pushes when
   connectivity returns. Nothing is ever lost in a basement or a village lane.
9. **Booth-wise accountability.** A karykarta sees exactly their assigned
   ward and nothing else; admins manage accounts and roles — the same rules
   are enforced in `firestore.rules`, not just hidden in the UI.
10. **Campaign dashboard, not spreadsheets.** Readiness index, booth
    coverage, 30-day task completion, open issues, spend, upcoming events and
    a live activity feed — all derived from live data.
11. **Tasks that reach the right worker.** Assign, due-date, and track work
    per ward and area; overdue items surface themselves in the attention list.
12. **Turnout reporting per ward.** Ward-by-ward tallies of marked voters,
    photos captured and pending edits, against the official census pulled
    straight from `wards-summary.csv` — tap a ward to jump into its list.
13. **Verified official data, corrections without overwriting.** The roll was
    OCR'd from the official PDF and machine-validated (per-ward gender
    tallies match the cover page exactly); field corrections are layered as an
    overlay, so the official record underneath is never mutated.
14. **Full Hindi + English UI.** Every label, empty state and date is
    translated — workers use the language they think in, including Hindi
    keyboard search.
15. **Secure by default.** Firebase auth (email + Google, verified emails),
    role-based Firestore rules, and a session-locked device store — voter data
    does not leak to whoever picks up the phone.

### हिन्दी — विशेषताएँ एवं लाभ

1. **पूरी मतदाता सूची आपकी जेब में।** 13 वार्ड के सभी 6,855 मतदाता ऐप के अंदर
   ही संग्रहित हैं — इंटरनेट की ज़रूरत नहीं, सस्ते फ़ोन पर भी परिणाम पलक झपकते।
2. **खोज वैसे ही जैसे लोग लिखते हैं।** हिन्दी (देवनागरी) और अंग्रेज़ी (रोमन)
   दोनों चलते हैं — `hariram` या `हरिराम` लिखिए, असली हरिराम सबसे ऊपर आएँगे;
   शुरुआत से मिलने वाले नाम हमेशा बीच से मिलने वाले नामों से पहले आते हैं।
3. **जो चाहिए वही खोजें।** स्कोप बैज से खोज को नाम, पिता/पति का नाम, मोहल्ला
   या सब कुछ (EPIC, मकान, फ़ोन) तक सीमित करें — "किसका बेटा है" एक टैप में
   मिलेगा, ग़लत मुकेशों को खोजते नहीं रहना पड़ेगा।
4. **रिकॉर्ड नहीं, इंसान मिले।** हर वोटर कार्ड पर फ़ोटो, क्रम संख्या, EPIC ID,
   मकान नंबर, आयु और मोहल्ला एक साथ — सामने खड़े व्यक्ति को आधिकारिक सूची से
   तुरंत मिलाइए।
5. **एक टैप में संपर्क।** वोटर के रिकॉर्ड से सीधा कॉल, SMS या WhatsApp —
   फ़ील्ड में दर्ज नंबर, कॉपी-पेस्ट करने की झंझट नहीं।
6. **फ़ील्ड की जानकारी तुरंत दर्ज हो।** फ़ोटो, GPS लोकेशन, मतदान/न मतदान,
   राजनीतिक झुकाव (5-बिंदु पैमाना), समर्थक/विरोधी, जाति, फ़ोन और नोट — हर
   टैप के साथ ही सेव।
7. **इरादे रंगों में दिखें।** समर्थक हरे, विरोधी लाल, झुकाव गर्म से ठंडे रंग
   में — पूरे बूथ का मिज़ाज लेबल पढ़ने से पहले ही समझ आ जाता है।
8. **बिना नेटवर्क काम करे, बाद में सिंक हो।** हर बदलाव पहले फ़ोन में सेव होता
   है और कतार में रहता है — ऑफ़लाइन में भी सूची चलती रहती है, नेटवर्क आते ही
   सिंक हो जाता है। बस में या गली में कोई डेटा नहीं खोता।
9. **बूथ-स्तर पर जवाबदेही।** कार्यकर्ता को ठीक अपना वार्ड दिखता है, बाकी
   कुछ नहीं; ऐडमिन खाते और भूमिकाएँ संभालता है — यही नियम `firestore.rules`
   में भी लागू हैं, सिर्फ़ दिखावे में नहीं।
10. **डैशबोर्ड, एक्सेल शीट नहीं।** तैयारी सूचकांक, बूथ कवरेज, 30-दिन का काम
    पूरा होना, खुली समस्याएँ, खर्च, आगामी कार्यक्रम और लाइव एक्टिविटी फ़ीड —
    सब लाइव डेटा से, एक ही जगह।
11. **काम सही कार्यकर्ता तक।** वार्ड और क्षेत्र के हिसाब से काम सौंपिए,
    समय-सीमा दीजिए, प्रगति देखिए — लेट काम ध्यान सूची में अपने आप सामने आ
    जाते हैं।
12. **वार्ड-वार मतदान रिपोर्ट।** मतदान दर्ज, फ़ोटो और बाकी संशोधन — वार्ड
    दर वार्ड, आधिकारिक जनगणना (वार्ड-सारांश CSV) के साथ; किसी वार्ड पर
    टैप करते ही उसकी सूची खुल जाती है।
13. **आधिकारिक डेटा, जाँचा हुआ।** सूची आधिकारिक PDF से OCR से निकाली और
    मशीन से जाँची गई (हर वार्ड के पुरुष/महिला गिनती कवर पेज से बिल्कुल
    मेल खाती है); फ़ील्ड के सुधार अलग परत में जुड़ते हैं, आधिकारिक रिकॉर्ड
    कभी बदलता नहीं।
14. **पूरा ऐप हिन्दी और अंग्रेज़ी में।** हर लेबल, खाली स्क्रीन और तारीख़
    अनूदित है — कार्यकर्ता अपनी भाषा में काम करे, हिन्दी कीबोर्ड से खोज भी
    चलती है।
15. **सुरक्षा डिफ़ॉल्ट रूप से।** Firebase लॉगिन (ईमेल + Google, सत्यापित
    ईमेल), भूमिका-आधारित Firestore नियम और लॉक किया हुआ डिवाइस स्टोर —
    फ़ोन कोई और उठाए तो मतदाता डेटा उसके हाथ नहीं लगता।

---

## Repository map

| Path | What it is |
|---|---|
| `mobile/` | The Expo app (all screens, components, i18n, tests) |
| `tools/extract_roll/` | OCR + validation pipeline that produced the roll CSVs |
| `data/rajasthan/jodhpur/jhanwar/veernagar/` | Generated ward CSVs + summary |
| `data/130-eroll/` | Official ECI e-roll PDFs (assembly segment 130, scans) |
| `EXTRACTION.md` | How the roll was extracted from the official PDF |
| `verification.md` | Per-row verification list (what to spot-check, what's pending) |
| `DESIGN.md` | Design tokens & visual language |
| `plan-voters.md` | Product plan for the voter-roll module |

## Quick start

```bash
cd mobile
pnpm install
pnpm start          # Expo dev server
pnpm test           # jest suite
pnpm lint && pnpm exec tsc --noEmit
```

Roll data regenerates with:

```bash
python tools/extract_roll/fix_final.py
python tools/extract_roll/write_csv.py
python tools/extract_roll/validate.py
cd mobile && pnpm roll:bundle
```
