# Enterprise RAG in production: lessons, failure modes, build vs buy, and engagement structure (as of Oct 2026)

Research date: 2026-10-22. Evidence labels used below: **[FIRST-HAND]** = engineering write-up or practitioner describing own deployments; **[SURVEY]** = survey/analyst data; **[VENDOR]** = vendor/consultancy marketing or SEO content with commercial interest; **[SECONDARY]** = press coverage of someone else's data. Dates given where known; anything from 2024 or early 2025 is marked as older.

Note on recency: the most recent large surveys I could reach are from mid/late 2025 (a16z June 2025, MIT NANDA Aug 2025, Menlo Dec 2025, Gartner June 2025). I did not find a 2026 edition of these surveys; many "2026" pages in search results are SEO content from vendors.

## First-hand production lessons (engineering write-ups, practitioners, surveys)

### Takeaway
The first-hand evidence is remarkably consistent: quality is won in document parsing, metadata enrichment, hybrid retrieval and an expert-built eval set, not in model or prompt choice; automated evaluation (LLM-as-judge calibrated against SMEs) is what makes iteration possible. At the market level, 2025 surveys show enterprises shifting decisively toward buying, with "true agents" still a minority of deployments.

### Cited Findings

**Uber (Genie, internal on-call copilot) — [FIRST-HAND], May 2025**
- Genie answers Slack questions citing internal docs; when tested on 40+ security/privacy policy PDFs with a golden set of 100+ SME-written queries, many answers were incomplete or inaccurate and SMEs judged quality insufficient for wider rollout — [Uber blog](https://www.uber.com/blog/enhanced-agentic-rag/)
- Fixes: no off-the-shelf PDF loader worked, so they moved docs to Google Docs and wrote a custom loader extracting paragraphs, tables, TOC; used an LLM to convert tables/lists to markdown; kept table chunks intact via metadata; added LLM-generated doc summaries plus per-chunk FAQs and keywords used in retrieval; added a Query Optimizer (rewrite/decompose), Source Identifier (narrow to likely docs), BM25 alongside vector search, and a post-processor that dedupes and orders chunks by source position — [Uber blog](https://www.uber.com/blog/enhanced-agentic-rag/)
- Results: relative +27% acceptable answers, relative -60% incorrect advice; LLM-as-judge cut experiment review from weeks to minutes — [Uber blog](https://www.uber.com/blog/enhanced-agentic-rag/)
- Stated lessons: parsing quality is a major bottleneck; better source documentation directly improves the bot; prompt/retrieval-parameter tuning plateaued quickly; automated eval essential when SME review is slow — [Uber blog](https://www.uber.com/blog/enhanced-agentic-rag/)

**LinkedIn (customer-service QA with RAG + knowledge graph) — [FIRST-HAND, peer-reviewed paper], April 2024 (older)**
- Built a knowledge graph from historical support tickets, preserving intra-issue structure and inter-issue links, instead of plain-text chunk retrieval; reported +77.6% MRR, +0.32 BLEU, and a 28.6% reduction in median per-issue resolution time over ~6 months in production — [arXiv 2404.17723](https://arxiv.com/abs/2404.17723); summary at [ZenML LLMOps DB](https://www.zenml.io/llmops-database/knowledge-graph-enhanced-rag-for-customer-service-question-answering). (Some secondary write-ups round this to 30%.)

**DoorDash (Dasher support automation) — [SECONDARY summary of FIRST-HAND blog], 2024 (older)**
- Pipeline: condense conversation to core issue, retrieve KB articles plus past resolved cases; an online guardrail checks each response for accuracy/compliance; an LLM judge scores retrieval correctness, response accuracy, grammar, coherence and relevance — [Evidently AI summary](https://www.evidentlyai.com/blog/rag-examples). Primary post ("Path to high-quality LLM-based Dasher support automation") not fetched.

**Harvey (legal) — [FIRST-HAND conference talk], AI Engineer World's Fair 2025**
- Legal retrieval combines semantic questions, exact identifiers (citations, docket numbers), implicit filters (jurisdiction, date) and confidential client data; speakers argue scale depends on expert evaluation and infra supporting rapid repeated experimentation — [AI Engineer talk page](https://www.ai.engineer/talks/W1MiZChnkfA-scaling-enterprise-grade-rag-systems-lessons)
- Third-party interview guide (not Harvey's own material) frames the core constraints as per-client data isolation and citation faithfulness (Mata v. Avianca as cautionary case), evaluated via pairwise comparison and rubric scoring — [techinterview.org](https://www.techinterview.org/companies/harvey-ai-interview-guide/) [SECONDARY]
- Thomson Reuters CoCounsel: public materials describe grounding in legal authorities and advise verifying output; I found no published engineering write-up on their retrieval eval — [Thomson Reuters](https://www.thomsonreuters.com.au/en-au/products/cocounsel.html) [VENDOR]

**Klarna (customer service AI) — [SECONDARY reporting of CEO statements], May 2025**
- After claiming in 2024 the assistant did the work of ~700 agents with on-par CSAT, the CEO said cost had been "a too-predominant evaluation factor" and the result was lower quality; Klarna resumed hiring human agents in an "Uber-type" flexible model while saying it is "not reversing on AI" — [Maginative](https://www.maginative.com/article/klarna-dials-back-its-ai-customer-service-strategy-now-its-hiring-humans-again/); [CX Today](https://www.cxtoday.com/?p=70468). Lesson: optimizing for the wrong success metric (cost/deflection) over quality.

**Practitioners**
- Hamel Husain & Shreya Shankar (Evals FAQ, PDF dated 2025-07-31, reportedly expanded 2026): error analysis is "the most important activity in evals"; in their projects 60-80% of development time went to error analysis and evaluation; review 30+ real traces before automating; prefer binary pass/fail judges over 1-5 scales; let observed failures decide which evals to write — [hamel.dev error analysis](https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html); [FAQ PDF](https://hamel.dev/blog/posts/evals-faq/evals-faq.pdf) [FIRST-HAND]
- Husain on "Is RAG dead?": the viral claim is specifically against naive vector-DB retrieval for autonomous coding agents, not retrieval generally — [hamel.dev](https://hamel.dev/blog/posts/evals-faq/is-rag-dead.html) [FIRST-HAND opinion, July 2025]
- Jason Liu (jxnl): independent consultant on RAG; his "Systematically Improving RAG" material and course, and a context-engineering series (Aug 2025) — [jxnl.co](https://jxnl.co); [course](https://567-labs.github.io/systematically-improving-rag/). (I did not fetch the full post text; the core thesis widely associated with it is synthetic-question retrieval evals plus segmenting query types, but treat that as unverified here.)
- Looming Tech, "Lessons from 10 enterprise deployments" — [VENDOR but first-hand-ish, no verifiable numbers]: fix retrieval before generation (teams "waste months" on prompts when retrieval is the problem); chunking is corpus-dependent (page-level + preserved tables for regulatory pharma docs; ~512 tokens for product reviews); hybrid search claimed 15-25% better recall than pure vector; extract tables separately and embed raw + summary; carry doc/page/passage citation metadata end-to-end; model choice mattered less than retrieval; start with 20-30 hand-curated eval queries; one overnight sweep of 24 configs hit 82% Recall@5 — [Looming Tech](https://www.looming.tech/post/rag-in-production-lessons-enterprise-deployments)

**Surveys / analysts**
- Menlo Ventures, State of GenAI in the Enterprise (Dec 9, 2025; ~500 US enterprise decision-makers): enterprise GenAI spend $37B in 2025 vs $11.5B in 2024; apps $19B, infra $18B; only $1.5B on "AI infrastructure (storage, retrieval, orchestration)"; **build vs buy shifted from 47/53 (2024) to 24/76 (2025)**, buying because "ready-made AI solutions are reaching production more quickly"; 47% of AI deals reach production vs 25% for traditional SaaS; prompt design is the most common customization, RAG second, fine-tuning/tool calling/RL niche; only 16% of enterprise deployments qualify as "true agents" (most are fixed-sequence or routing workflows); horizontal copilots (ChatGPT Enterprise, Claude for Work, Microsoft Copilot) = 86% ($7.2B) of horizontal spend, agent platforms 10% ($750M); legal vertical AI $650M — [Menlo Ventures](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/) [SURVEY, VC with portfolio interest]
- a16z CIO survey (June 10, 2025; 100 CIOs, 15 industries): off-the-shelf apps "eclipsing custom builds"; AI moved from innovation budgets to recurring IT/BU line items; multi-model use rising — [a16z](https://a16z.com/ai-enterprise-2025/). Secondary: spend growing ~75% YoY, innovation-budget share fell from 25% to 7%, 37% use 5+ models — [SaaStr](https://www.saastr.com/a16z-enterprise-ai-spending-is-growing-75-a-year/) [SURVEY/SECONDARY]
- MIT NANDA "The GenAI Divide" (Aug 2025; 150 interviews, 350-employee survey, 300 public deployments): ~95% of GenAI pilots show little/no measurable P&L impact; cause framed as a "learning gap" and poor workflow integration, not model quality; reportedly, purchased/vendor-partnered deployments succeeded about twice as often as internal builds — [Fortune](https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo/) [SURVEY via SECONDARY; small qualitative base, "fail" = no rapid revenue impact, widely criticized as headline-inflated]
- Gartner (June 25, 2025): >40% of agentic AI projects will be canceled by end-2027 due to escalating costs, unclear business value or inadequate risk controls; most current projects are hype-driven PoCs; only ~130 of thousands of "agentic" vendors are real ("agent-washing") — [Gartner press release](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027) [ANALYST PREDICTION, not measurement]

### Inferences
- The recurring technical recipe across Uber, Harvey, LinkedIn and practitioners: custom parsing for tables/structure, metadata enrichment, hybrid (BM25 + dense) retrieval, query rewriting/routing, and an SME-built golden set with an LLM judge calibrated against it. This is where a consultant's work actually goes.
- The Menlo "16% true agents" figure suggests most "agent" projects in mid-market will in practice be workflows with retrieval steps; selling "agents" while delivering well-scoped workflows is the honest framing.
- Klarna and MIT NANDA both point at metric choice and workflow integration, not retrieval quality, as the reason value fails to materialize.

### Gaps
- I did not find/fetch first-hand write-ups from Notion, Ramp, Vimeo, Glean engineering or Eugene Yan within budget; the report writer should not attribute specific lessons to them from these notes.
- DoorDash primary blog not fetched (only a secondary summary).
- No 2026 editions of Menlo/a16z/MIT surveys located; late-2026 state is inferred from 2025 data plus 2026 commentary.

## Common failure modes and pilot-to-production rates

### Takeaway
Failure rates are real but headline numbers are soft: Gartner's 40% agentic-cancellation forecast and MIT's 95% "no P&L impact" are the most-cited; RAG-specific "70% fail" numbers are mostly unsourced vendor blog claims. The concrete, well-evidenced failure causes are permissions/oversharing, bad and stale source data (especially tables/PDFs), no eval set, wrong success metric, and cost/latency of agentic loops.

### Cited Findings
- **Permissions/oversharing (strongest evidence):** Gartner survey of 132 IT leaders (June 2025) found oversharing concerns led 40% to delay Microsoft 365 Copilot rollouts by 3+ months — [Computerworld](https://www.computerworld.com/article/3542000/microsoft-365-copilot-rollouts-slowed-by-data-security-roi-concerns.html); [Infosecurity Magazine](https://infosecurity-magazine.com/news/microsoft-copilot-delayed-over) [SURVEY via SECONDARY]
- CoreView survey (279 respondents): 66% delayed or cancelled Copilot over concerns it could expose confidential SharePoint data; 73% worried AI already surfaces sensitive info internally — [CoreView](https://www.coreview.com/news/66-percent-of-enterprises-delay-microsoft-copilot) [VENDOR SURVEY]
- Mechanism: assistants see everything the user can access, so years of "Everyone except external users" links and inherited permissions become searchable; Concentric AI claims 16% of business-critical data is overshared (~802K files/org) — [MyWorkDrive blog](https://www.myworkdrive.com/blog/microsoft-365-copilot-oversharing) [VENDOR]
- Permissions should be enforced at query time in the index, not as a post-filter; semantically similar content in accessible docs can leak restricted material — [Atolio](https://www.atolio.com/blog/enterprise-rag-guide); [dev.to](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml) [VENDOR/BLOG]
- **Bad source data / parsing:** Uber: no off-the-shelf PDF loader worked; better source docs directly improved answers — [Uber](https://www.uber.com/blog/enhanced-agentic-rag/) [FIRST-HAND]. Scanned PDFs/slides produce empty retrievals; outdated and current policy versions coexist without timestamp logic — [dev.to](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml) [BLOG]
- **No eval set:** "Teams without an eval set have a chatbot with a search bar"; eval ground-truth needs domain experts — [Looming Tech](https://www.looming.tech/post/rag-in-production-lessons-enterprise-deployments) [VENDOR]. Hamel/Shankar: 60-80% of dev time on error analysis/eval — [hamel.dev](https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html) [FIRST-HAND]. One blog claims ~70% of production RAG teams have no systematic retrieval eval — [dev.to](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml) [UNVERIFIED]
- **Wrong success metric:** Klarna CEO: cost was "too predominant" an evaluation factor, yielding lower quality — [Maginative](https://www.maginative.com/article/klarna-dials-back-its-ai-customer-service-strategy-now-its-hiring-humans-again/)
- **Cost/latency/value:** Gartner cites escalating costs, unclear business value, inadequate risk controls as reasons for agentic project cancellation — [Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027). Agentic loops add latency and per-query cost; teams gate them behind cheap routing — [Atolio](https://www.atolio.com/blog/assembling-and-evolving-an-enterprise-rag-platform) [VENDOR]
- **Adoption/integration:** MIT NANDA attributes the 95% to a "learning gap" and failure to adapt to workflows — [Fortune](https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo/)
- **Pilot-to-production rates:** Menlo: 47% of AI *deals* reach production (vs 25% SaaS) — a vendor-purchase metric, not internal pilots — [Menlo](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/). Gartner earlier (July 2024, older) predicted 30% of GenAI projects would be abandoned after PoC by end-2025 (from my prior knowledge; press release not re-verified in this session). RAG-specific "40-70% fail" and "73% of 143 deployments" (attributed to MLOps Community) and "67% data layer" (attributed to Deloitte) appear only in secondary blogs and could not be verified — [dev.to](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml); [ragaboutit](https://ragaboutit.com/7-rag-failure-modes-crippling-enterprise-deployments-in-2026/)
- **Silent degradation:** corpora drift and systems degrade without monitoring; re-indexing and "no relevant result" query tracking are ongoing costs — [Looming Tech](https://www.looming.tech/post/rag-in-production-lessons-enterprise-deployments)

### Inferences
- For a mid-size client, a permissions/oversharing audit is both a risk and a sellable discovery deliverable, whether they build or buy (Copilot rollouts stall on it too).
- The defensible statement to clients: "Most pilots fail for organizational reasons (metric, data ownership, workflow fit), not model reasons." Avoid quoting the 95% figure without its caveat.

### Gaps
- No primary, methodologically sound survey specifically on RAG pilot-to-production rates was found.
- No good public data on latency/cost overruns as a cause of RAG (vs agentic) abandonment.

## Build vs buy, and where custom work still wins

### Takeaway
The market moved hard toward buying in 2025 (Menlo: 76% bought), with horizontal copilots (ChatGPT Enterprise, Microsoft Copilot, Claude, Gemini Enterprise, Glean) absorbing generic "chat over our docs." Custom work still wins on domain-specific corpora with structure (tables, policies, legal/regulatory), exact-identifier retrieval, workflow-embedded use cases with measurable outcomes, strict data residency/self-hosting, and as integration/eval/governance work around bought platforms. Retrieval itself is being absorbed into platforms and rebranded as "context engineering."

### Cited Findings
- Build share fell from 47% (2024) to 24% (2025); buyers say purchased tools reach production faster — [Menlo](https://menlovc.com/perspective/2025-the-state-of-generative-ai-in-the-enterprise/) [SURVEY]
- a16z: off-the-shelf eclipsing custom builds; procurement now resembles traditional software buying — [a16z](https://a16z.com/ai-enterprise-2025/) [SURVEY]. Counterpoint (different population): survey of 350+ Indian CIOs reports 85% prefer internal development for control — [CXOToday](https://cxotoday.com/media-coverage/state-of-enterprise-technology-survey-2025-indian-enterprises-go-all-in-on-ai-but-only-15-8-achieve-strategic-maturity/)
- MIT NANDA reportedly found vendor-partnered deployments succeed ~2x as often as internal builds — referenced in [dev.to](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml) [SECONDARY]
- **Platform price signals (vendor/consultancy sources, verify before use):** Microsoft 365 Copilot ~$30/user/mo add-on (Business tier ~$18 for <300 users); Gemini Enterprise launched Oct 2025, tiers ~$21-60+/user/mo with connectors to Workspace, M365, Salesforce, ServiceNow, Jira, agent usage billed on top; ChatGPT Enterprise reportedly ~$45-75/user/mo with ~150-seat minimum; Glean custom-quoted, deployment ~6-12 weeks; Onyx (open-source, self-hostable) ~$16-20/user/mo enterprise tier — [Redress Compliance](https://redresscompliance.com/google-gemini-vs-copilot-vs-openai-enterprise-cost.html); [The Decoder](https://the-decoder.com/google-launches-gemini-enterprise-as-a-response-to-microsoft-copilot-and-chatgpt-enterprise); [Kestra](https://kestra.io/resources/ai/glean-alternatives); [nexos.ai](https://nexos.ai/blog/glean-alternatives/). A claimed post-July-2026 M365 E3+Copilot bundle at $69/user/mo is unverified.
- **Retrieval absorbed into platforms / renamed:** OpenAI File Search, Anthropic Contextual Retrieval, Google Vertex RAG Engine — [MindStudio](https://www.mindstudio.ai/blog/is-rag-dead-what-ai-agents-use-instead); Douwe Kiela (RAG paper co-author), Jan 2026: RAG "is still happening, but it's not called that anymore" — now "context engineering" — [The New Stack](https://thenewstack.io/tns-daily/january-27-2026/). Coding agents use grep/file tools rather than vector DBs; 2026 practice described as "hybrid + context engineering" rather than either/or — [SmartScope](https://smartscope.blog/en/ai-development/practices/rag-debate-agentic-search-code-exploration/) [BLOG]
- **Where custom wins (first-hand evidence):** Uber needed custom parsing, enrichment and agentic query steps for policy docs — [Uber](https://www.uber.com/blog/enhanced-agentic-rag/); Harvey's legal retrieval mixes exact identifiers, implicit filters and confidential data — [AI Engineer](https://www.ai.engineer/talks/W1MiZChnkfA-scaling-enterprise-grade-rag-systems-lessons); LinkedIn's KG over historical tickets exploited domain structure for measurable resolution-time gains — [arXiv](https://arxiv.com/abs/2404.17723)
- Agentic RAG should be selective, gated by routing, because of cost/latency — [Atolio](https://www.atolio.com/blog/assembling-and-evolving-an-enterprise-rag-platform) [VENDOR]

### Inferences
- Positioning for a new consultant: don't compete with Copilot/Glean on "search all our docs." Sell (a) platform-selection and readiness (permissions cleanup, content hygiene, connector coverage, eval of the bought tool on the client's own questions), and (b) narrow, high-value custom builds embedded in a workflow with a measurable outcome (support deflection with quality gate, policy/contract Q&A, proposal drafting, ticket triage).
- "Private AI" (self-hosted/sovereign) remains a real niche for regulated mid-size orgs (and Canadian data-residency concerns), but I found no quantified demand data.

### Gaps
- No independent, first-hand comparison of Glean vs Copilot vs Gemini Enterprise answer quality on the same corpus.
- No verified official 2026 list prices; figures above come from third parties.
- No quantified data on demand for self-hosted/open-weight RAG in Canada.

## Typical engagement structure, timelines, team sizes, pricing

### Takeaway
Independent/boutique RAG engagements typically run as a 2-week discovery/assessment, a 4-12 week pilot or build, then a monthly retainer; large-enterprise programs run ~6 months. Price signals: hourly US$150-300 (CAD 150-350 for senior boutique), fixed projects US$25K-100K, retainers US$3K-25K/month. Most pricing data is from sellers of these services, so it should be presented as a range, not a benchmark.

### Cited Findings
- **Jason Liu / 567 Labs consulting guide [FIRST-HAND practitioner advice]:**
  - Engagement models: advisory retainer (access, not deliverables; 1-4 hrs/month leadership meetings + async Slack; example $60K); self-contained 6-week project = Discovery wks 1-2 (interviews, requirements, architecture recommendation), Development wks 3-5 (prototype, internal testing, docs), Handoff wk 6 (client repo, knowledge transfer) with deployment explicitly excluded; "rollover pilot" = 6-month contract with 6-week cancellable period; maintenance retainer ~$3-5K light, $7-12K active, $15-25K strategic per month; typical conversion ~$10K/month after a $40K implementation — [567 Labs engagement models](https://567-labs.github.io/consulting/guide/16-engagement-models/)
  - Pricing: hourly starts ~$150-170 rising to ~$250; minimums ~$20K even for hourly; new consultants start at $7-10K minimums and raise $1-2K after each yes; >=80% acceptance means price too low; market ranges: advisory retainer $8-25K/mo, implementation project $25-100K, strategic engagement $50-200K, enterprise program $100K+; terms 50% upfront / 50% at day 45 of 90-day project; value-based example: $40K fee ≈10% of $400K value created — [567 Labs pricing](https://567-labs.github.io/consulting/guide/07-hourly-to-value/)
  - Structural safeguards: single Slack Connect channel, deliverables in client's private repo, single designated client contact, explicit scope list — [567 Labs](https://567-labs.github.io/consulting/guide/16-engagement-models/)
- **Canada rate signals [VENDOR, CAD]:** AI consultants CAD 150-400/hr — [GetClear](https://getclear.ca/guides/ai-consultant-cost-canada); mid-level CAD 140-220/hr, senior boutique 200-350/hr, Big Four partners 600-1,200/hr; knowledge-base chatbot CAD 4K-18K over 2-4 weeks (low-end, small-business oriented); support retainers CAD 2K-10K/mo — [ChatGPT.ca rate card](https://chatgpt.ca/blog/ai-consulting-rate-card-canada-2026); general GenAI app builds CAD 60K-160K+ over 4-8 months — [Apptunix](https://www.apptunix.com/blog/ai-software-development-cost-canada/)
- **Other US/UK signals [VENDOR/MARKETPLACE]:** freelance RAG experts ~$80 low / $140 typical / $250+ senior per hour — [MentorCruise](https://mentorcruise.com/experts/rag/); custom RAG assistant for a consulting firm ~USD 30-70K (Boston), EUR 25-60K (London) — [Kolonell](https://kolonell.com/en/blog/internal-rag-ai-assistant-cost-boston-2026)
- **Timelines:** one practitioner-vendor describes a ~24-week enterprise production rollout including eval harness, PII redaction and observability — [CodeGully](https://www.codegully.com/blog/enterprise-rag-hard-truths-2026/) [VENDOR]; Glean deployment ~6-12 weeks — [Kestra](https://kestra.io/resources/ai/glean-alternatives) [VENDOR]; Gartner says 40% of Copilot rollouts delayed 3+ months by oversharing remediation — [Computerworld](https://www.computerworld.com/article/3542000/microsoft-365-copilot-rollouts-slowed-by-data-security-roi-concerns.html)
- **Eval set phase:** start with 20-30 hand-curated queries then expand semi-automatically — [Looming Tech](https://www.looming.tech/post/rag-in-production-lessons-enterprise-deployments); Uber's golden set was 100+ SME-written queries — [Uber](https://www.uber.com/blog/enhanced-agentic-rag/); review 30+ traces before automating judges — [hamel.dev](https://hamel.dev/blog/posts/evals-faq/evals-faq.pdf)

### Inferences
- A synthesized phase model consistent with the sources: (1) Discovery & data audit, 1-2 wks (use case, success metric, sources, permissions, document formats, SME availability); (2) Eval set + baseline, 1-2 wks (20-100 SME questions; measure an off-the-shelf tool and a naive pipeline); (3) Pilot build, 3-6 wks (parsing, hybrid retrieval, citations, access control); (4) Evaluation & user pilot with a small group, 2-4 wks; (5) Production hardening, 4-12 wks (SSO/ACL sync, monitoring, re-indexing, cost controls, red-teaming); (6) Retainer. Total 3-6 months for a mid-size org; this phasing is my synthesis, not a single cited source.
- Team size: no source gives numbers; inferred typical boutique delivery is 1-3 people (lead/architect + engineer, part-time PM/data person), plus client-side SMEs and an IT/security owner. Flag as inference.
- For mid-size Canadian clients, a plausible ladder: paid discovery CAD 10-25K → pilot CAD 30-80K → retainer CAD 3-10K/mo. Inference combining the ranges above.

### Gaps
- No credible survey of team sizes on RAG engagements.
- No source specific to mid-size organizations' RAG budgets; Canadian figures are from firms selling services and span an order of magnitude.
- No first-hand Canadian boutique case study found.

## Discovery questions and what clients underestimate

### Takeaway
The highest-leverage discovery questions are about the business metric, the questions users actually ask, the state and ownership of source documents, permissions, and SME time for evaluation. Clients consistently underestimate eval-set labor, document extraction (tables, scans, versions), permissions hygiene, and ongoing operations.

### Cited Findings
- Underestimated items named in practitioner/vendor write-ups: SME labor for eval ground truth; document extraction and grounding being "much of the real work"; ongoing monitoring, re-embedding/re-indexing, tracking no-answer queries; cost at scale — [Looming Tech](https://www.looming.tech/post/rag-in-production-lessons-enterprise-deployments)
- SME review is slow enough that Uber built LLM-as-judge to make iteration feasible — [Uber](https://www.uber.com/blog/enhanced-agentic-rag/)
- Error analysis/eval consumes 60-80% of dev time in Hamel/Shankar's projects — [hamel.dev](https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html)
- Permissions remediation delays rollouts by months — [Computerworld](https://www.computerworld.com/article/3542000/microsoft-365-copilot-rollouts-slowed-by-data-security-roi-concerns.html)
- Content staleness: outdated and current versions coexisting; corpora drifting after pilot snapshot — [dev.to](https://dev.to/gabrielanhaia/70-of-enterprise-rag-deployments-fail-before-production-heres-what-kills-them-26ml) [BLOG]
- Liu's guide has a chapter on structuring discovery calls/qualifying buyers and a "situational assessment" proposal structure, but I did not retrieve its content — [567 Labs](https://567-labs.github.io/consulting/)

### Inferences (suggested discovery question list, synthesized from the failure modes above)
- What decision or task gets faster/better, who does it today, and what number would prove success (time-to-answer, deflection with quality floor, error rate)?
- Can you give 30-50 real questions users asked last month, with the correct answer and where it lives?
- Where do the sources live (SharePoint, Confluence, Drive, ticketing, DB), in what formats (scanned PDFs, tables, slides), who owns them, and how are versions/superseded docs marked?
- How are permissions modeled, and do they reflect reality? Any "everyone" shares? Must answers respect per-user ACLs?
- What M365/Google/ChatGPT/Glean licences do you already own, and have you tested them on these questions?
- Data residency/privacy constraints (PIPEDA, Quebec Law 25, sector rules), and is a hosted LLM API acceptable?
- Which SMEs can commit hours per week to eval and feedback?
- What happens when the system is wrong, and who is accountable? What's the escalation path?
- Who will own it after handoff (re-indexing, monitoring, eval regression)?

### Gaps
- No published, first-hand consultant discovery checklist was retrieved verbatim; the list above is synthesized and should be labeled as such.
- Canadian regulatory specifics (Law 25, PIPEDA, AIDA status) were not researched here.
