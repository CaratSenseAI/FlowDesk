# Making the WhatsApp bot reliable — improvement plan

**Why this exists.** On 5 Oct 2026 Ashish sent three ordinary messages and two went wrong: "Bipan ko bola 14015 bhejden" was read as a message to an outside vendor, and "Shaina ko bolo kal jaana hai" asked for a deadline that was already in the sentence. Voice notes are worse: on 11 Sept four real notes turned "Anshul" into "insurance", "Unchained Arrival" and "NSHU". The bot works on the phrasings it was written for and fails on normal speech. This plan changes the architecture so it works on normal speech.

**Status, 6 Oct 2026 (commit `c205012`).** Built and deployed: business context in the AI prompt (3.2), confidence gate and date fix (3.1), spoken-name aliases, Sarvam Saaras v4 as the speech model with Groq as fallback (3.4), the voice repair pass (3.3), and replies instead of silence (3.5). Not built: button-based clarification and learning aliases from corrections (3.6), the Settings page for the business profile (it lives in code, `backend/src/services/businessContext.ts`, with env overrides), and the labelled evaluation set (section 5).

Measured on the four real voice notes with the shipped pipeline: three end in the right task for the right person; the fourth is unreadable to every model tried and now gets "I could not work out what to do with that" instead of a wrong action. Ashish's three messages of 5 Oct now parse correctly. Sarvam's key-term list is limited to 50 terms with no duplicates (found by testing; the code enforces both).

---

## 1. What is wrong today

Verified on 6 Oct by running Ashish's three messages through the production parser code with the production AI key:

| Message | Regex rules | AI model returned | What the user saw |
|---|---|---|---|
| Bipan ko bola 14015 bhejden | no match | intent `assign_sample_dispatch`, person **Bipan**, confidence **0.3** | "There are no external contacts saved yet…" |
| Shaina ko bolo kal jaana hai | no match | intent `create_task`, person Shaina, title "kal jaana hai", **deadline empty**, confidence 0.9 | "When is 'kal jaana hai' due?" |
| Hello | no match | nothing | silence |

So the failures are **not** regex misfires. Since 11 Sept a manager's message that no rule matches already goes to the AI model, and it was the model that got these wrong. Three causes:

- **The model knows nothing about the business.** Its prompt has no team list, no idea that TDM trades fabric, no list of saved outside contacts. It found Bipan correctly, but guessed that "bhejden" plus a number meant a sample dispatch to an outside party, and that path then demanded an external contact.
- **Low confidence is not respected.** The model said 0.3 on the first message and the bot still went down that path instead of asking what was meant.
- **Dates are left inside the title.** "kal" stayed in the task title and the deadline came back empty, so the bot asked for something the sentence already said.

Two further problems, unchanged from before:

- **Voice is transcribed with almost no context.** Whisper gets only the team's names. A 5-second WhatsApp clip is ~11 KB of compressed audio, and on 11 Sept four real notes produced "insurance", "Unchained Arrival" and "NSHU" for Anshul.
- **Silence.** "Hello", or anything unparsed, gets no reply. Silence reads as broken.

---

## 2. Target architecture

```
                       ┌──────────────── Business context (per client) ───────────────┐
                       │ team roster + nicknames · locations · product vocabulary ·   │
                       │ task types · open tasks · saved external contacts            │
                       └───────────────┬──────────────────────────┬───────────────────┘
                                       │                          │
voice ─► speech-to-text (with names + vocabulary hint) ──► transcript
                                                              │
text ─────────────────────────────────────────────────────────┤
                                                              ▼
                                   ONE AI call: "what does this person want?"
                                   returns JSON: intent, person, title, deadline,
                                   confidence, and what it is unsure about
                                                              │
                          ┌───────────────────────────────────┼─────────────────────────┐
                          ▼                                   ▼                         ▼
                 confident + typed                    spoken, or unsure            not understood
                 → do it, confirm in one line         → "I heard … Confirm?"       → say so + 2 examples
                                                        with buttons
```

The new parts are the context block, the confidence gate and the reply for "not understood". The AI call itself exists today. The rules stay as (a) a fast path for exact forms like `TSK-12 done`, and (b) the fallback when the AI service is down.

---

## 3. The six changes

### 3.1 Respect confidence, and stop leaving dates in titles

The two cheapest fixes, both on the AI path that already exists:

- **Act only above the confidence threshold.** The model returns a confidence for every parse. Below 0.7, or whenever a required slot is missing, the bot must ask one clarifying question (3.6) instead of proceeding. Today a 0.3 parse went ahead. No path may start an outreach flow on a low-confidence parse.
- **Lift the date out of the title.** After the model answers, run the existing date extractor over the title when the deadline is empty: "kal jaana hai" → title "jaana hai", deadline "kal". The same extractor already does this for the regex rules; the AI path skips it.
- **Simplify the routing.** Keep the regex rules only for exact worker forms (`TSK-12 done`, button taps) and as the fallback when the AI service is down. Managers' free text goes straight to the model with context (3.2). This removes a class of rule/model disagreements, but it is a clean-up, not the main fix.

Model in use: `nvidia/nemotron-3-super-120b-a12b`. On 11 Sept it answered 19 of 20 test calls (one hit a 503 and fell back) with a median of about 1.1 s. That was a check that it responds with usable JSON, not a labelled accuracy test; section 5 adds the real one.

### 3.2 Business context in every AI call

A per-client **business profile**, stored in the database and editable from a Settings page, injected into the model's prompt:

| Block | Example for TDM | Why |
|---|---|---|
| What the business is | "Textile trader. Fabrics, godown, a store in Bandra. Staff do stock checks, shade matching, dispatch, sample sending, payment collection." | Tells the model what a plausible task looks like |
| Team roster | Every active member: name, role, **aliases** ("Bipan" = "papa", "dad", "Bipin"; "Dhamija" = "VK") | "Bipan" is staff → a task, never a vendor |
| Locations | godown, Bandra store, office | "bandra store me" is a place, not a person |
| Product vocabulary | cotton, satin, lot, shade, roll, than, bale, sample; lot numbers are 4–6 digits | "14015" is a lot number, not a task id or an amount |
| Task types | stock check, shade check, dispatch, delivery, collection, sample, visit | Title normalisation |
| Open tasks of the sender's team | id, title, holder, status | "uska kya hua", "wo wala kaam" resolve to a real task |
| Saved external contacts | name + type | Only these can be outreach targets |

Rule the prompt states explicitly: **a name on the team roster is always an internal task; outreach to an outside party requires a name from the saved contacts.** That rule is what fixes the first message: Bipan is on the roster, no outside party is named, so it is a plain task for Bipan with "14015 bhejna" as the work.

Size is not a problem: 26 people, a 60-word glossary and 30 open tasks is roughly 1,500 tokens.

### 3.3 Voice: context where it can help, and a second pass

Voice fails at the transcription step, so three things change:

1. **A context hint for the speech model.** Whisper-family models accept a `prompt` of at most **224 tokens**, which biases spelling towards the words in it. Put the team's names first, then the top product and location words. Measured on our four notes on 11 Sept: with no hint, none had a clean "Anshul"; with a names-only hint, two of four did. A longer vocabulary or sentence-style prompt made the model echo or invent text on those short clips, so the hint must stay a short comma-separated word list and its effect has to be measured, not assumed.
2. **Transcript repair by the AI with full context.** The raw transcript goes to the same model as 3.1 with the business profile and the instruction "this is speech-to-text output; names and product words may be mis-heard; map them to the closest roster entry or say you are unsure". "Task for insurance, deploy floor…" with a roster containing Anshul and a history of "deploy FlowDesk" has a real chance of being repaired; today it has none.
3. **Always confirm a spoken command**, quoting what was understood (already live since 11 Sept), now with quick-reply buttons: ✅ Confirm · ✏️ Change person · ❌ Cancel.

### 3.4 A better speech model — what "free" really offers

The bot does **not** run Whisper locally. It already calls Groq's hosted Whisper API (`whisper-large-v3-turbo`). There is no API that is both free and unlimited; these are the real options:

| Option | Hinglish quality | Free allowance | Paid price | Notes |
|---|---|---|---|---|
| **Groq `whisper-large-v3`** (non-turbo) | Mixed on our four notes: closer on some words, but it echoed the hint names on one clip. Not shown to be better | 2,000 requests/day, 28,800 audio-seconds/day, each request counted as ≥10 s | pay-as-you-go beyond | Same key, one env var. Up to 2,000 notes a day, far above TDM's volume |
| **Deepgram Nova-3 Multilingual** | Built for Hindi↔English code-switching | **$200 credit, no expiry** ≈ 575 hours | $0.0058/min | At 20 min of notes a day the credit lasts ~4.7 years |
| **Sarvam Saaras v3** | Trained on Indian audio; Hinglish is the default mode; among the two leaders on independent Hinglish benchmarks | ₹100 signup credit (official pricing page, read 6 Oct) | ₹30 per hour of audio (₹0.50/min) | ~₹255/month at 17 min/day; the ₹100 credit covers about 200 minutes |
| **ElevenLabs Scribe v2** | The other benchmark leader; Hindi WER < 5% claimed | 10,000 credits/month | $0.22/hour | Cheapest paid rate here |
| **Gemini Flash-Lite (audio in)** | Audio-native LLM: hears the clip *and* reads the business context in one call. Hinglish quality not tested by us | ~500 requests/day on Flash-Lite; ~20/day on Flash (limits change often) | per-token | The only option that puts full business context at the listening step. Check Google's data-use terms for the free tier before sending client audio |
| **Bhashini (Govt. of India)** | Hindi models from several institutes | Free for **non-commercial** use only | discounted commercial | Not appropriate for a paying client without a commercial agreement |

**Recommendation**

1. **Now, zero cost, same provider:** keep Groq and add the repair pass (3.3.2). That is where business context can actually be used, and it does not depend on which speech model wins.
2. **Then measure, do not guess:** run a bake-off (section 5) of Groq turbo, Groq large-v3, Deepgram Nova-3 and Sarvam Saaras on the same real notes. Our own small test did not show large-v3 beating turbo, so switching models is a result of the bake-off, not a step before it. Deepgram costs nothing to try for years; Sarvam costs roughly ₹250 a month at TDM's likely volume if it wins.
3. **Consider Gemini audio-in** only if names are still the failure after the repair pass, because it is the one design where the model *listening* already knows the roster.

"Marginally better and still free" is realistic. "Free and unlimited" does not exist; the nearest thing is Groq's daily allowance, which TDM does not come close to using.

### 3.5 Never silent

Anything from a known number that the bot cannot act on gets one short reply in the sender's language, with two examples relevant to their role. A greeting gets a one-line menu ("Send a task: 'Shaina ko kal godown jaana hai' · Check status: 'team status'"). Employees get their own open tasks instead.

### 3.6 Clarify with buttons, and remember the answer

- Missing person → up to three buttons with the most likely people (same first letter, recent assignees).
- Missing deadline → Today · Tomorrow · This week.
- Ambiguous name ("Lalit") → Lalit Dubey · Lalit Godown.
- When the sender corrects a mishearing ("not insurance, Anshul"), store the pair as an **alias** on that person in the business profile, so the same mistake is repaired automatically next time. The bot gets better from use.

---

## 4. What gets built

| # | Piece | Where | Size |
|---|---|---|---|
| 1 | `BusinessProfile` table (description, locations, vocabulary, task types) + `aliases` on `User` | `schema.prisma`, new `businessProfileService.ts` | S |
| 2 | Context builder: roster + aliases + open tasks + contacts → prompt block, cached 60 s | new `contextService.ts` | S |
| 3 | Confidence gate on every path, date lifted out of AI titles, rules reduced to fast path and fallback | `commandService.ts`, `commandExecutor.ts` | M |
| 4 | Prompt rewrite: roster rule, slots, `unsure_about`, Hinglish examples from the real command log | `commandService.ts` | M |
| 5 | Speech: provider interface (`groq` / `deepgram` / `sarvam`), context hint, repair pass | `transcriptionService.ts` | M |
| 6 | Reply layer: never-silent replies, button clarifications, alias learning | `webhookController.ts`, `replies.ts`, `commandExecutor.ts` | M |
| 7 | Settings page: edit business profile and aliases | `src/views/SettingsView.jsx` | S |
| 8 | Evaluation harness (section 5) | `backend/tests/eval/` | S |

Estimate: **4–5 working days** including tests and the bake-off. Items 1–4 (text reliability) are two days and deliver most of the improvement; 5–6 (voice + replies) are two more. The confidence gate and the date fix in item 3 are a few hours on their own and can ship first.

No Meta template changes: every reply here is a session message inside the 24-hour window the sender just opened.

---

## 5. Measure before and after

A bot is only "better" if a fixed set of real messages says so.

- **Text golden set:** every command in the production command log (the Tracker's Commands tab) plus Ashish's failures, each labelled with the correct intent, person, title and deadline. Target: ≥ 95% fully correct, 0 wrong-person actions.
- **Voice golden set:** the four stored notes from 11 Sept plus 30 new ones recorded by Ashish's team reading typical instructions. Score: is the person right, is the task right.
- **Bake-off:** run the voice set through each speech option in 3.4, then through the repair pass. Pick by name accuracy, not by published benchmarks.
- Run both sets in CI as an offline eval so a prompt change that breaks Hinglish is caught before deploy.

---

## 6. Rollout

1. Build behind a flag `WA_CONTEXT_AI=false`; deploy dark.
2. Turn it on for Aditya's number only; replay the golden sets live.
3. Turn it on for Ashish and Bipan; watch the command log for a week.
4. Remove the flag; keep the rules as fallback.

Rollback is the flag.

---

## 7. What is needed from Aditya

- A go-ahead on the plan and on the order (text first, then voice).
- 30 short voice notes from Ashish's team for the voice golden set.
- From Ashish: nicknames people actually use for each other, the names of locations, and the 20 most common words for products and tasks. Ten minutes on a call.
- If the bake-off is wanted: a free Deepgram account ($200 credit, no card) and a Sarvam account. I can create both under the `tdm@` alias once it reaches your mailbox.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| The AI service is slow or down | 1 retry, then rules fallback; the reply says "taking the simple route" only in logs, the user sees a normal answer |
| The model acts on a wrong person | Roster-only names, confidence threshold, confirmation on every spoken or low-confidence command |
| Prompt grows with the team | Context is bounded (roster + 30 open tasks); cached per sender for 60 s |
| Free tiers change | Speech provider is one env var; Groq remains the default |
| Client data in third-party APIs | NVIDIA and Groq are already in use; adding a provider is a decision for CaratSense to state to the client |

---

## Sources

- Groq speech-to-text limits and prompt cap: https://console.groq.com/docs/speech-to-text , https://spokenly.app/blog/free-speech-to-text-apis , https://toolfreebie.com/free-whisper-api-compared/
- Whisper prompt is limited to 224 tokens: https://theneuralbase.com/whisper-api/learn/beginner/prompt-length-224-tokens-limit/
- Deepgram Nova-3 Multilingual, Hindi code-switching, $200 credit, $0.0058/min: https://deepgram.com/learn/nova-3-multilingual-major-wer-improvements-across-languages , https://diyai.io/ai-tools/speech-to-text/deepgram-pricing-2026/
- Sarvam Saaras v3, Hinglish default, ₹30/hour, ₹100 signup credit: https://www.sarvam.ai/apis/speech-to-text , https://docs.sarvam.ai/api/getting-started/pricing
- ElevenLabs Scribe, Hindi accuracy tier, pricing, free credits: https://elevenlabs.io/speech-to-text/hindi , https://elevenlabs.io/speech-to-text
- Hinglish benchmark comparing Sarvam Saaras v3, Scribe v2 and fine-tuned Whisper: https://trelis.substack.com/p/whisper-hinglish
- Gemini API free-tier limits and audio input: https://tokenmix.ai/blog/gemini-api-free-tier-limits , https://pecollective.com/tools/gemini-free-tier-guide/
- Bhashini access terms: https://bhashini.gitbook.io/bhashini-apis , https://caller.digital/blog/open-source-voice-ai-india-sarvam-ai4bharat-bhasini-2026
- Our own measurements: four production voice notes replayed on 11 Sept 2026 (five Whisper configurations); a 20-call response check of the AI model on 11 Sept 2026; Ashish's three messages replayed through the parser on 6 Oct 2026.
