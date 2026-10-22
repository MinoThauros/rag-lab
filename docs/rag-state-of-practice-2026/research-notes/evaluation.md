# RAG Evaluation and Monitoring: State of Practice (late 2026)

Research date: 2026-10-22. About 17 tool calls. Items before 2025 are marked **[older]**. Vendor-authored sources are marked **[vendor]**.

## Metrics: which retrieval and generation metrics are used and trusted?

### Takeaway
Practitioners split RAG evaluation into two parts. Retrieval is scored as an IR problem, using recall@k, precision@k, and MRR against labeled query-to-document pairs. Generation is scored with "triad" relationships: context relevance (C|Q), faithfulness or groundedness (A|C), and answer relevance (A|Q). Generic off-the-shelf generation scores are trusted much less than application-specific, human-validated judges. Independent studies show that library metrics (Ragas, DeepEval, etc.) correlate unevenly with human judgment. Reference-free faithfulness and hallucination metrics correlate weakly with human quality scores.

### Cited Findings
- Hamel Husain's FAQ (updated Sept 2026) says to evaluate retrieval "as a search problem" using Recall@k, Precision@k, and MRR. It then says to "debug retrieval first using IR metrics, then tackle generation quality using properly validated LLM judges". It cites Jason Liu's tiered framework: Tier 1 is IR metrics; Tiers 2–3 are context relevance (C|Q), faithfulness (A|C), and answer relevance (A|Q). nDCG is not discussed there. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- The same FAQ says generic metrics such as "hallucination score" or "helpfulness rating" rarely capture what matters and "can create false confidence". It recommends using them only to surface traces worth reviewing. Similarity metrics (BERTScore, ROUGE) are "generally not useful" for LLM outputs, though cosine similarity remains useful for retrieval. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- **[older]** The original Ragas paper (2023) reports that faithfulness predictions were "in general highly accurate" against humans. Answer relevance agreement was lower, and context relevance was hardest, especially for long contexts. These results are self-reported by the authors. — [Ragas paper, arXiv 2309.15217](https://arxiv.org/pdf/2309.15217)
- An independent study (Brabant, arXiv July 2026) compared Ragas, DeepEval, RAGChecker, and Opik metrics, plus BLEU, ROUGE-L, METEOR, and BERTScore, against two human raters. The raters agreed with each other at Pearson r=0.85. The data was 96 French questions over 479 telecom business documents. Findings:
  - Generation-only metrics (hallucination, faithfulness) correlated weakly with human scores because they lack the reference answer.
  - RAGChecker's recall-type metrics correlated best, and METEOR did surprisingly well.
  - Opik's moderation metric showed no correlation.
  - Ragas's non-LLM context metrics were very weak, which the author attributes to Levenshtein matching across very different span sizes.
  - DeepEval contextual precision correlated above 0.5 with reference recall.
  - Word-level recall@5 correlated r=0.35 with human scores, versus 0.05 for document-level recall.
  - The study used one RAG system and has wide confidence intervals, and the author says it should not be used to rank tools. — [Brabant 2026, arXiv 2607.07302](https://arxiv.org/html/2607.07302)
- A knowledge-graph RAG evaluation paper found low correlation between Ragas context relevancy and human annotation, and moderate to high correlation for its other metrics. — [arXiv 2510.02549](https://arxiv.org/pdf/2510.02549)
- Faithfulness measures grounding in the retrieved context, not truth. Practitioners note that an answer can score 1.0 on faithfulness, answer relevance, and context precision while being wrong, for example when the retriever surfaces a repealed or stale policy. — [Atlan, RAG evaluation 2026](https://atlan.com/know/how-to-evaluate-rag-systems-explained/) (vendor-ish blog); [Ragas/levelup article](https://levelup.gitconnected.com/rag-evaluation-in-practice-faithfulness-answer-relevance-and-context-precision-in-ragas-ce13b0363cda)
- Academic RAG benchmarking (TREC 2024 RAG Track) uses **nugget-based recall**: the share of key facts a response covers. LLM-automated nugget scoring (AutoNuggetizer) showed strong *run-level* agreement with human (NIST) variants across 301 topics. Agreement was best when only nugget *assignment* was automated. Per-topic correlation was weaker, so the method is less suited to debugging individual answers. LLM assessors were stricter than NIST assessors. — [Pradeep et al., "The Great Nugget Recall", arXiv 2504.15068](https://arxiv.org/html/2504.15068v1); [initial report, arXiv 2411.09607](https://arxiv.org/pdf/2411.09607)
- For retrieval relevance labels, UMBRELA (Waterloo and Microsoft) reproduces Bing's LLM relevance assessor (Thomas et al.). LLM-derived judgments on TREC DL 2019–2023 correlate highly with *system rankings*. Whether this holds across other LLMs is an open question. — [UMBRELA, arXiv 2406.06519](https://arxiv.org/pdf/2406.06519); [Does UMBRELA work on other LLMs?, arXiv 2507.09483](https://arxiv.org/html/2507.09483v1)
- A production monitoring guide treats falling citation coverage as an early hallucination signal. — [Sphere, RAG pipeline monitoring](https://www.sphereinc.com/blogs/rag-pipeline-monitoring) **[vendor/consultancy]**

### Inferences
- The defensible "standard" stack has three parts:
  1. Recall@k (plus MRR or nDCG when ranking order matters) on a labeled retrieval set.
  2. Faithfulness or groundedness, and answer relevance, via LLM judges.
  3. Some answer-correctness check against references, such as nuggets or key facts.

  Reference-free metrics alone are not trustworthy for measuring quality.
- Studies agree that LLM-based metrics are good for *comparing systems in aggregate* (run-level) and weaker for *per-answer* verdicts. That is how a consultant should position them to clients.
- nDCG and hit rate appear mostly in IR and academic settings. Practitioner guidance centers on recall@k and MRR.

### Gaps
- I found no rigorous independent study of **citation accuracy** metrics (whether each cited source actually supports the claim) in production. ALCE-style citation precision and recall exist academically, but I did not verify them in this pass.
- I found no survey data on *how many* teams use which metric. Adoption claims are anecdotal.

## Tools: what each does, open source vs SaaS, self-hostability

### Takeaway
The market has split into two groups. One is **metric libraries** (Ragas, DeepEval, TruLens, promptfoo, OpenAI Evals) that you run in code or CI. The other is **tracing, observability, and eval platforms** (Langfuse, Arize Phoenix/AX, LangSmith, Braintrust, Galileo, Patronus, MLflow 3), which add datasets, experiments, annotation queues, and online scoring. 2026 brought major consolidation:
- ClickHouse acquired Langfuse (Jan 2026).
- OpenAI announced its acquisition of Promptfoo (Mar 2026).
- Cisco acquired Galileo (announced Apr, closed May 2026).

Practitioners treat the platforms as roughly interchangeable feature-wise and say the evaluation *process* matters more than the tool.

### Cited Findings
- **Langfuse.** Open source (MIT) and fully self-hostable. The self-host stack is web and worker containers plus Postgres, ClickHouse, Redis/Valkey, and S3. Priced by usage, not seats. — [Langfuse compare](https://langfuse.com/compare); [Langfuse alternatives guide](https://www.morphllm.com/comparisons/langfuse-alternatives)
  - ClickHouse acquired it on Jan 16, 2026, alongside ClickHouse's $400M Series D at a $15B valuation. Langfuse says the roadmap, open source, and self-hosting are unchanged. — [Langfuse blog](https://langfuse.com/blog/joining-clickhouse); [ClickHouse blog](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability); [SiliconANGLE](https://siliconangle.com/2026/01/16/database-maker-clickhouse-raises-400m-acquires-ai-observability-startup-langfuse/)
  - Usage figures conflict: 23.1M+ vs 26M+ monthly SDK installs, and 2,000+ paying customers per Orrick. — [Orrick](https://www.orrick.com/en/news/2026/01/open-source-llm-observability-langfuse-acquired-by-clickhouse-inc)
- **Arize Phoenix.** Source-available under the Elastic License 2.0 (not OSI open source). OpenTelemetry-native, runs as a single process, and is described as the lightest self-host option. Arize AX, the enterprise product, is closed SaaS. — [Langfuse compare](https://langfuse.com/compare) **[competitor vendor]**; [FutureAGI Arize alternatives](https://futureagi.com/blog/arize-alternatives-2026) **[vendor]**
- **LangSmith (LangChain).** Closed platform with MIT-licensed SDKs. Self-hosting is Enterprise-only. The natural fit for LangChain/LangGraph users. — [Langfuse compare](https://langfuse.com/compare) **[competitor vendor]**; [FutureAGI LangSmith alternatives](https://futureagi.com/blog/langsmith-alternatives-2026) **[vendor]**
- **Braintrust.** Closed and hosted-first, with enterprise-only self-host (hybrid). Strongest on the experiment and eval workflow, including CI/CD gating. — [FutureAGI Braintrust alternatives](https://futureagi.com/blog/braintrust-alternatives-2026) **[vendor]**; [Braintrust's own comparison](https://www.braintrust.dev/articles/langfuse-alternatives-2026) **[vendor]**
- Hamel Husain says LangSmith, Arize, and Braintrust are broadly similar in features. Vendor choice often depends more on support quality, client size, and use case, and he often builds custom tooling on top. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- **Ragas.** Open-source library of LLM-judged RAG metrics: faithfulness, answer relevancy, context precision and recall, factual correctness. It also does synthetic test-set generation and judge alignment with human feedback. Its docs say mining explicit and implicit user signals for monitoring is still "on the roadmap". — [Ragas monitoring docs](https://docs.ragas.io/en/latest/getstarted/monitoring.html); [Ragas paper](https://arxiv.org/pdf/2309.15217)
- **DeepEval (Confident AI).** Open-source, local-first, pytest-style framework with 50+ metrics covering RAG (contextual precision, recall, and relevancy; faithfulness; hallucination), agents, and safety. Confident AI is the paid hosted layer. — [Atlan framework comparison 2026](https://atlan.com/know/llm-evaluation-frameworks-compared/); [Brabant 2026](https://arxiv.org/html/2607.07302)
- **TruLens.** Open source and self-hostable (Snowflake-backed). Its "RAG triad" feedback functions are Groundedness, ContextRelevance, and AnswerRelevance. Available as first-class MLflow scorers from MLflow 3.10.0. — [TruLens MLflow guide](https://www.trulens.org/component_guides/evaluation/mlflow/); [Atlan comparison](https://atlan.com/know/llm-evaluation-frameworks-compared/)
- **MLflow 3 (GenAI eval, Databricks).** Open-source tracing and evaluation with built-in and third-party scorers. DeepEval, Ragas, and TruLens all plug in as scorers. — [Databricks third-party scorers](https://docs.databricks.com/aws/en/mlflow3/genai/eval-monitor/third-party-scorers)
- **Promptfoo.** Open-source CLI for prompt and eval testing and red-teaming, popular in CI. OpenAI announced its acquisition on Mar 9, 2026, to fold it into the OpenAI Frontier enterprise agent platform. The founders say it stays open source and multi-model. The company claims use by more than 25% of the Fortune 500 (company claim). I found no confirmation that the deal had closed. — [Security Boulevard](https://securityboulevard.com/2026/03/openai-acquires-security-startup-promptfoo-to-fortify-ai-agents); [Yahoo Finance/TechCrunch syndication](https://finance.yahoo.com/news/openai-acquires-promptfoo-secure-ai-174904138.html)
- **Galileo.** Commercial eval and observability platform whose Luna-2 small models score 20+ metrics and can act as real-time guardrails (vendor claim). Cisco announced the acquisition on Apr 9, 2026 and closed it on May 22, 2026, folding it into Splunk Observability. — [AgentMarketCap analysis](https://agentmarketcap.ai/blog/2026/04/13/cisco-acquires-galileo-ai-agent-observability-enterprise-monitoring-consolidation-2026); [usagepricing](https://usagepricing.com/blueprint/activity/galileo-ai-2026-04-09-cisco-acquisition) (secondary sources)
- **Patronus AI.** Proprietary SaaS eval platform. Its Lynx hallucination-detection model weights are reportedly Apache-2.0 on Hugging Face, but that comes from a weak aggregator source and needs verification. — [aggregator](https://learn.engineering.vips.edu/frameworks/patronus-ai) (low confidence)
- **RAGChecker and Opik.** Also used in independent comparisons. RAGChecker does claim-level precision and recall. Opik (Comet) is an open-source tracing and eval platform. — [Brabant 2026](https://arxiv.org/html/2607.07302)
- Openlayer markets itself as named in a "2026 Gartner Market Guide for AI Evaluation and Observability Platforms", which suggests the category is now an analyst-tracked market. — [Openlayer](https://www.openlayer.com/blog/llm-as-judge-evaluation-guide) **[vendor]**

### Inferences
- For a consultant, the practical decision tree runs on hosting constraints:
  - Must self-host with a permissive license: Langfuse (MIT), or Phoenix (ELv2, lightest).
  - Already on LangChain: LangSmith.
  - Experiment- and CI-centric hosted team: Braintrust.
  - Databricks shop: MLflow 3.
  - Any of these: pair with a metric library (Ragas or DeepEval) only as a starting point, then replace generic metrics with custom validated judges.
- The 2026 acquisitions mean vendor-independence risk should be a client consideration. OpenTelemetry-based tracing (Phoenix, Langfuse) reduces lock-in. That point is my inference.

### Gaps
- I did not verify the current status of **OpenAI Evals** (the open-source repo and the hosted Evals API) in 2026.
- I did not verify Braintrust funding or pricing in 2026, current Ragas and DeepEval versions or GitHub stars, or Patronus's 2026 status.
- Most head-to-head tool comparisons are written by competing vendors. I found no neutral benchmark of platforms.

## Building eval sets: synthetic vs real questions, golden sets, size, bootstrapping

### Takeaway
The 2026 consensus is to start from real traces and error analysis. Use structured synthetic data only to bootstrap or to probe rare cases, and never to estimate production failure rates. Independent 2025–2026 studies show that synthetic questions are systematically longer and "easier" than real user queries, and that this inflates scores.

### Cited Findings
- Hamel's sizing guidance:
  - About 100 diverse traces for error discovery, with at least 30 reviewed manually first.
  - 100–200 labeled examples per failure mode for each LLM judge, split roughly into train 10–20%, dev 40–45%, and test 40–45%, with 30–50 Pass and 30–50 Fail examples in dev and test.
  - Repeatable eval and CI sets are "often 100+".

  — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Synthetic data guidance: don't prompt for generic "test queries". Define dimensions (for example issue type and persona), write tuples by hand, then generate in two steps: structured tuples first, then natural language. Synthetic data is unreliable for specialized documents, high-stakes domains, low-resource languages, and underrepresented users. It cannot tell you how often a failure occurs in production. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- For retrieval sets, Hamel suggests generating query-to-document pairs synthetically by extracting facts from the corpus and writing questions those facts answer. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Kucia and Gawlik (2026 preprint) compared 1,851 synthetic questions with 322 authentic student queries on a university information system. Real queries averaged 6.8 words versus 15.7 for synthetic ones and touched far fewer sources. Configurations that looked strong on synthetic data dropped noticeably on real queries. The authors recommend treating the two sets as complements. — [arXiv 2609.14579](https://arxiv.org/pdf/2609.14579)
- "The Coverage Illusion" (2026) studied the Danish National Encyclopedia's production RAG system. Real queries were brief and sparse in vocabulary. Benchmarks suggested about 90% of queries needed LLM query augmentation, but only about 28% of live traffic benefited. Those figures come from a secondary summary and need verification. — [arXiv 2605.27220](https://arxiv.org/pdf/2605.27220); [Modelwire summary](https://themodelwire.com/article/the-coverage-illusion-from-pre-retrieval-routing-failure-to-post-retrieval-casca-01KSKMH2RGSQVSZXZ3YPNHY1YB)
- "Can we Evaluate RAGs with Synthetic Data?" (2025) found that synthetic benchmarks gave uniformly high Context Precision, while human benchmarks separated retrieval settings more clearly. Synthetic data may underestimate retrieval difficulty. — [arXiv 2508.11758](https://arxiv.org/pdf/2508.11758)
- Eugene Yan's bootstrap loop:
  1. Label a small dataset with binary pass/fail.
  2. Align LLM evaluators on dev and test splits.
  3. Run the harness on every config change.

  He suggests using a working evaluator to surface likely failures for human review, so the labeled set ends up balanced. — [Eugene Yan, Product Evals in Three Simple Steps](https://eugeneyan.com/writing/product-evals/)
- Production thumbs-down reports and escalations should feed the golden and regression set. — [Sphere](https://www.sphereinc.com/blogs/rag-pipeline-monitoring) **[consultancy]**; consistent with [Hamel FAQ](https://hamel.dev/blog/posts/evals-faq/) on adding production failures to CI.

### Inferences
- Recommended client pattern:
  - Pre-launch: seed with about 50–100 structured synthetic and SME-written questions to get going.
  - Post-launch: replace or augment them with sampled real queries as soon as traffic exists.
  - Continuously: grow the golden set from labeled production failures.
  - Report synthetic-set scores as an upper bound.

### Gaps
- I found no good industry data on the cost or time of SME labeling, or on inter-annotator agreement in enterprise RAG golden sets.

## LLM-as-judge reliability: calibration, biases, practitioner guidance

### Takeaway
LLM judges are accepted as necessary but untrusted until validated. Practitioners converge on these rules:
- Binary pass/fail judgments.
- One judge per failure mode.
- Measure TPR and TNR against held-out human labels.
- Expect criteria to drift as humans look at outputs.

Known biases (position, verbosity, self-preference) are well documented. Agreement is strong at the aggregate or system level and weaker per item.

### Cited Findings
- Hamel (Sept 2026):
  - Use binary Pass/Fail rather than 1–5 scales, which produce inconsistent, middle-heavy labels.
  - Build one judge per failure mode.
  - Give each judge only the needed context; extra context can hurt, so ablate it.
  - Using the same model as the app is usually fine.
  - Measure TPR and TNR on a held-out test set, and use those rates to *correct* estimated failure rates.
  - Inspect disagreements before any automated prompt tuning.
  - Prefer code assertions where possible.

  — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Eugene Yan: treat evaluator alignment as a conventional ML problem with dev and test splits. Use one evaluator per dimension and avoid a "God Evaluator". — [Product Evals](https://eugeneyan.com/writing/product-evals/). Also: "An LLM-as-Judge won't save the product—fixing your process will." Evals are practices (scientific method, eval-driven development, monitoring), not artifacts. — [Eugene Yan, eval-process](https://eugeneyan.com/writing/eval-process/)
- **[older, foundational]** Shankar et al., "Who Validates the Validators?" (UIST 2024), introduced **criteria drift**. Users need criteria to grade outputs, but grading outputs changes their criteria, and some criteria cannot be defined before seeing outputs. EvalGen has users grade a subset of outputs to select which candidate assertions or LLM-grader prompts align with them. — [arXiv 2404.12272](https://arxiv.org/pdf/2404.12272)
- Hamel operationalizes criteria drift: "don't write a rubric first". Reviewers anchored to a rubric miss problems, and criteria evolve while reading traces. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Biases:
  - Position and verbosity are classified as presentation biases; there are also authority and bandwagon effects. — [LLMs-as-Judges survey, arXiv 2412.05579](https://arxiv.org/pdf/2412.05579)
  - A large position-bias study (9 judges, about 80k instances) argues that verbosity and self-enhancement effects are partly downstream of position bias. — [Shi et al., arXiv 2406.07791](https://arxiv.org/pdf/2406.07791v3)
  - GPT-4 shows significant self-preference. — [arXiv 2410.21819](https://arxiv.org/pdf/2410.21819)
  - 2026 work finds self- and other-labels induce bidirectional bias. — [arXiv 2608.18091](https://arxiv.org/pdf/2608.18091)
  - Length-controlled methods only partly fix verbosity. — [arXiv 2602.18029](https://arxiv.org/pdf/2602.18029)
- **[older]** Databricks found that LLM judges matched human scores exactly in over 80% of cases on a 0–3 scale, and that few-shot examples per score helped cheaper judges. — [Databricks blog](https://databricks.com/blog/LLM-auto-eval-best-practices-RAG)
- Vendor guidance: mitigate bias by swapping answer positions and decomposing rubrics, and validate until judge-human correlation exceeds 0.85. The threshold is a vendor rule of thumb, not an empirical standard. — [Openlayer guide, Mar 2026](https://www.openlayer.com/blog/llm-as-judge-evaluation-guide) **[vendor]**
- RAG-specific judges should see the retrieved evidence and the conversation history, not just the final answer, and should score retrieval, grounding, and usefulness separately. — [DIO article 2026](https://www.dio.me/en/articles/rag-evaluation-em-2026-llm-as-a-judge-mais-estruturado-ad4d8154db3f) (secondary, citing a case-aware enterprise RAG judge paper)
- TREC evidence: LLM judges are stricter than NIST assessors and need calibration. Run-level agreement is strong; per-topic agreement is weaker. — [arXiv 2504.15068](https://arxiv.org/html/2504.15068v1)

### Inferences
- The defensible claim to a client is: "We validated the judge on N held-out human labels; TPR=x, TNR=y; the corrected failure rate is z±CI." Reporting a raw judge score without this is the anti-pattern.

### Gaps
- I did not find an authoritative 2026 meta-analysis giving a single number for human-judge agreement on RAG faithfulness specifically.

## Error analysis workflows and separating retrieval from generation failures

### Takeaway
Error analysis (reading traces, open coding, clustering into a failure taxonomy) is called the single most important eval activity. Retrieval is debugged first with IR metrics. A wrong answer is attributed by asking two questions: was the needed information in the retrieved context (context recall), and did the model stay faithful to it (faithfulness)?

### Cited Findings
- Hamel's workflow:
  1. Review about 100 diverse traces, annotating at least 30 yourself before letting an agent suggest failures.
  2. Write open-ended notes and cluster them into a taxonomy.
  3. Iterate to saturation, until new traces stop revealing new failure modes.
  4. Log failures that aren't the model's fault, such as missing features.
  5. Repeat every 2–4 weeks or after major changes, with 100+ fresh traces.

  — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Hamel says to debug retrieval first with IR metrics, then generation with validated judges. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Context recall asks whether the context contained the needed information. Faithfulness asks whether the model stayed true to the context. The pair localizes a failure: low context recall means a retrieval failure; high context recall with low faithfulness means a generation failure. — [Ragas paper](https://arxiv.org/pdf/2309.15217); [Codex and Compass](https://thecodexandthecompass.substack.com/p/making-sense-of-rag-evaluation-metrics)
- A third failure class sits outside both: stale, unowned, or non-canonical content in the index. Faithfulness can be 0.95 while business answers are wrong. — [Atlan](https://atlan.com/know/how-to-evaluate-rag-systems-explained/)
- Production research (Coverage Illusion, 2026) identifies *pre-retrieval routing failures* that cascade into post-retrieval errors. This argues for tracing every stage: routing, query rewrite, retrieval, rerank, generation. — [arXiv 2605.27220](https://arxiv.org/pdf/2605.27220)
- Eugene Yan says the starting point is "looking at the data" to find failure modes before building judges. — [Eugene Yan, eval-process](https://eugeneyan.com/writing/eval-process/)

### Inferences
- A practical attribution table for client work has four buckets:
  - Retrieval miss: the gold doc is not in the top-k.
  - Ranking miss: the gold doc is present but low or truncated.
  - Generation unfaithful: the answer is unsupported by the context.
  - Corpus problem: the doc is wrong or stale.

  Each bucket needs a different fix (chunking and embeddings, reranker, prompt or model, or content governance).

### Gaps
- I found no published quantitative breakdown from a production team of what share of RAG failures are retrieval vs generation.

## Production monitoring: tracing, feedback, drift, CI regression

### Takeaway
Standard production practice has four parts:
- OpenTelemetry-style tracing of every pipeline step.
- Asynchronous, reference-free LLM judges on sampled live traffic, tracked with confidence intervals.
- Explicit feedback (thumbs, escalations) routed into the golden set.
- A small, curated CI regression suite dominated by deterministic assertions.

Implicit signals such as citation clicks are discussed often, but mature reference implementations are scarce.

### Cited Findings
- Production: sample live traces and run evaluators asynchronously. Use reference-free judges because references are absent. Track confidence intervals and investigate when the lower bound crosses a threshold. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- CI: keep datasets small (often 100+), curated around core features, past bugs, and edge cases. Prefer deterministic assertions over LLM judges for cost. Add production failures to guard against regressions. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- Implicit signals proposed: dwell time, click-through on provided links or citations, follow-up and reformulated queries, and which corpus sections are never referenced. — [Shelf.io](https://shelf.io/blog/continuously-monitor-your-rag-system-to-neutralize-data-decay/) **[vendor]**
- Ragas docs list mining explicit and implicit user signals as still on the roadmap, so there is no mature open reference implementation. — [Ragas monitoring docs](https://docs.ragas.io/en/latest/getstarted/monitoring.html)
- Drift types: data drift (corpus changes, shifting query mix) and concept drift (the query-to-relevance relationship changes). — [ApX course](https://apxml.com/courses/optimizing-rag-for-production/chapter-6-advanced-rag-evaluation-monitoring/monitoring-retrieval-drift-rag)
- A reranker update can improve median quality while hurting long-tail queries, so cohort-level monitoring helps isolate regressions. — [Braintrust, RAG observability tools 2026](https://braintrust.dev/articles/best-rag-observability-tools-2026) **[vendor]**
- Phoenix and Langfuse are OpenTelemetry-based tracing backends. Braintrust markets CI/CD eval gating. — [Langfuse compare](https://langfuse.com/compare); [FutureAGI](https://futureagi.com/blog/braintrust-alternatives-2026) **[vendors]**
- Galileo positions small evaluator models (Luna-2) as real-time guardrails, which points toward online scoring at low latency and cost. — [AgentMarketCap](https://agentmarketcap.ai/blog/2026/04/13/cisco-acquires-galileo-ai-agent-observability-enterprise-monitoring-consolidation-2026) (vendor claim relayed)
- Hamel notes outcome signals such as A/B acceptance rates and human-handoff rate and quality as business-level feedback. — [Hamel Husain, Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)

### Inferences
- Thumbs feedback is sparse and biased toward negative experiences. Treat it as a *triage signal* that routes traces to error analysis, not as a quality metric. This is my inference; it is consistent with the sources treating thumbs-down as "high-value" for the golden set.
- Monitoring and evaluation have converged into one loop: traces → sampled judges → human review queue → golden set → CI. Every major platform now sells this loop.

### Gaps
- I found no primary engineering blog with numbers on citation click-through as a quality proxy, or on correcting position bias in click data.
- I found no hard data on what sampling rates or judge costs teams use in production online evaluation.
