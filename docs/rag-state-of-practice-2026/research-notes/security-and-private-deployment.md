# Access Control, Security and Private/Self-Hosted Deployment for Enterprise RAG (as of Oct 2026)

Research date: 2026-10-22. About 17 searches and fetches. Vendor documentation is labeled "vendor claim". Practitioner blogs are labeled as such. Older material (2023 to 2025) is marked with its date.

## 1. Permission-aware retrieval: how ACLs are enforced and how platforms do it

### Takeaway
The standard pattern is to copy source ACLs (users, groups, allow and deny) into the index at ingestion, filter on them inside the search query (pre-filter), and optionally re-check against the source system at query time. Post-filtering after the LLM has seen the chunks is widely considered unsafe. Every vendor puts the burden of authenticating the end user, and of managing permission drift between syncs, on the customer. Microsoft's own incidents show the main enterprise risk is **oversharing in the source system**, not the RAG layer: Copilot faithfully surfaces files that were already shared too broadly.

### Cited Findings

**General pattern: pre-filter vs post-filter**
- Practitioners agree that post-filtering (dropping unauthorized chunks after retrieval) is weak. If the LLM has already seen restricted content, the content can still shape its output. Post-filtering also hurts recall, because authorized results just outside top-k are lost. The suggested fixes are to pre-filter in the search, or to over-fetch a multiple of k and then filter. — [tianpan.co, "Vector Store Access Control" (Apr 2026, practitioner blog)](https://tianpan.co/blog/2026/04/17/vector-store-access-control-rag-rls); [dev.to, Permission-aware RAG](https://dev.to/venkathub/permission-aware-rag-enforcing-document-acls-at-retrieval-time-54a7)
- Pre-filtering, which limits the ANN search to the IDs a user may access, gives strong guarantees. It costs more compute when users have broad access, and it can under-use HNSW indexes. Filter-aware hybrid ANN strategies are an emerging research area. — [Policy-aware Vector Search (arXiv 2606.19803, 2026)](https://www.alphaxiv.org/abs/2606.19803.md); [unified.to blog](https://unified.to/blog/permissions_security_and_compliance_in_rag_pipelines)
- Syncing ACLs from SharePoint, Confluence and Google Drive into metadata creates a staleness window. Some practitioners argue for re-checking authorization against the source at retrieval time. Another documented pattern is a permission service (OpenFGA in front of Qdrant), so that revocation takes effect on the next query without re-indexing. — [wavect.io, RAG permissions for SharePoint/Confluence/Drive](https://wavect.io/blog/rag-permissions-sharepoint-confluence-drive/); [dev.to (lakhansamani)](https://dev.to/lakhansamani/your-ai-assistant-can-leak-files-people-arent-allowed-to-see-heres-how-to-fix-it-51en); [truto.one, document-level RBAC in RAG](https://www.truto.one/blog/how-to-maintain-document-level-rbac-in-enterprise-rag-pipelines/)
- AWS's own blog contrasts two approaches. The common "replicate-and-filter" approach syncs ACLs periodically. Real-time ACL checks against the source system avoid the gap between sync cycles. — [AWS ML blog, "Rethinking access control for RAG with Amazon Quick and Amazon Bedrock"](https://aws.amazon.com/blogs/machine-learning/rethinking-access-control-for-rag-with-amazon-quick-and-amazon-bedrock/)

**Postgres + pgvector + row-level security (RLS)**
- In the RLS pattern, you define a policy on the chunks or documents table and set a session variable (tenant or user, groups) per request. Every similarity search is then filtered "in the database kernel, not in application code". There are two documented risks:
  - **Connection pooling:** a session variable that is not reset can leak one tenant's context into another tenant's request.
  - **Performance:** the RLS policy can work against the approximate (HNSW/IVF) index. The mitigations are per-tenant partial indexes or partitioning.
  — [tianpan.co (practitioner, Apr 2026)](https://tianpan.co/blog/2026-04-17-vector-store-access-control-rag-rls)

**Microsoft Azure AI Search (security trimming, then native document-level ACLs)**
- Microsoft announced native Entra-based ACL and Azure RBAC enforcement "from ingestion to query" in public preview on 29 May 2025, with API 2025-05-01-preview. The initial scope was ADLS Gen2 POSIX ACLs and RBAC scopes on ADLS Gen2 and Blob. — [Microsoft Tech Community announcement](https://techcommunity.microsoft.com/blog/azure-ai-services-blog/-/4418584); [Learn: document-level access overview](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview)
- At query time, the Entra principal in the caller's token is compared with the permission metadata stored on each document, and non-matching documents are excluded. — [Learn: document-level access overview](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview)
- Later previews add the following (vendor docs):
  - SharePoint in Microsoft 365 ACL ingestion via indexer. Entra users and groups are supported; **SharePoint groups are not yet supported in preview**.
  - A Push API for ACL and RBAC fields.
  - Purview sensitivity-label support.
  - API versions cited across docs: 2025-11-01-preview and 2026-05-01-preview.
  - Push API limits: a maximum of 32 values per userIds/groupIds field, and a maximum of 5 unique rbacScope values per index.
  — [Learn: SharePoint ACL indexer](https://learn.microsoft.com/en-za/azure/search/search-indexer-sharepoint-access-control-lists); [Learn: ACL/RBAC push API](https://learn.microsoft.com/en-us/azure/search/search-index-access-control-lists-and-rbac-push-api)
- Permission changes in the source appear in search results only after the next indexer run, push update or Purview refresh. — [docs.azure.cn mirror of overview](https://docs.azure.cn/en-us/search/search-document-level-access-overview)
- Microsoft ISE team (Apr 2026) described how they did it before the native feature: materialize SharePoint permissions into index fields at ingestion, then filter on Entra object IDs at query time. This is the classic "security trimming" filter pattern. — [Microsoft ISE devblog, SharePoint doc-level access (30 Apr 2026)](https://devblogs.microsoft.com/ise/sharepoint-doc-level-access/)

**AWS Bedrock Knowledge Bases**
- Older and still valid: plain Bedrock KB lets you attach metadata files and filter at retrieve time. That is metadata filtering, not true ACLs.
- Newer: "Bedrock Managed Knowledge Base" ACL-aware retrieval (vendor docs; release date not shown on the page). It works in two stages:
  1. **Pre-retrieval filtering:** allowed and denied users and groups are crawled at ingestion and matched against the user context passed at query time.
  2. **Real-time ACL verification:** a live call to the source per returned document. This is supported for SharePoint, OneDrive, Google Drive, Confluence (Cloud and Data Center), Box, Zendesk and Salesforce. ServiceNow is partial. S3 and Custom connectors are not supported, and the Web Crawler is not ACL-capable.
  Deny overrides allow, and the system fails closed. — [AWS docs: kb-managed-acl](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-acl.html)
- AWS states explicitly that this "provides *ACL-aware filtering*, not a security boundary". Bedrock "does not authenticate end users". The app must pass verified identity, and the feature must not be relied on "as a sole access control mechanism without upstream authentication". — [AWS docs: kb-managed-acl](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-acl.html)
- The identity model uses email as the universal user key, with no alias or cross-IdP mapping. A mismatched email "fails silently" and the user gets no results. Email reassignment after an employee departs is the customer's problem. Group membership is only as fresh as the last sync, and propagation lags for very large groups. — [AWS docs: kb-managed-acl](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-acl.html)

**Glean**
- Vendor docs say Glean enforces permissions at query time. Connectors attach per-document ACLs (users and groups), and an ACL that names a group Glean doesn't know "matches nobody". The SDK test harness supports negative tests, which assert that identities who must not see a document are absent from its ACL. — [Glean Indexing SDK: permissions](https://developers.glean.com/libraries/indexing-sdk/permissions)
- Native connectors (Google Drive, OneDrive/SharePoint, Egnyte) mirror source permissions. Egnyte content shared only via link is excluded. Freshness is connector-dependent: some custom connectors (e.g., Lexion) have no real-time permission sync and only update on the next scheduled crawl. — [Glean: Egnyte connector](https://docs.glean.com/connectors/native/egnyte/home); [Glean: Lexion connector](https://docs.glean.com/connectors/custom/connector-guides/lexion); [Glean: connectors overview](https://docs.glean.com/connectors/connectors-power-glean)

**Elastic / OpenSearch document-level security**
- In OpenSearch DLS, the user is resolved against an ACL index or role at query time, so the application query does not need its own ACL filter. The tradeoff is that ACL changes require updating the ACL index or role definitions. — [Open Source Conference Luxembourg 2026 talk](https://pretalx.com/open-source-conference-luxembourg-2026/talk/3Q8XYD/)

**Oversharing incidents (Microsoft 365 Copilot)**
- **EchoLeak, CVE-2025-32711 (June 2025, CVSS 9.3):** a zero-click indirect prompt injection via a crafted email. It chained several bypasses: the XPIA classifier, link redaction (via reference-style Markdown), auto-fetched images, and a Microsoft Teams proxy allowed by CSP. The result was exfiltration of internal data with no user interaction. Microsoft patched it server-side in May 2025, and there is no evidence of exploitation in the wild. Researchers call this class "LLM Scope Violation". — [The Hacker News (Jun 2025)](https://thehackernews.com/2025/06/zero-click-ai-vulnerability-exposes.html); [arXiv 2509.10540, Reddy & Gujral](https://arxiv.org/html/2509.10540v1); [BleepingComputer](https://bleepingcomputer.com/news/security/zero-click-ai-data-leak-flaw-uncovered-in-microsoft-365-copilot)
- **Copilot Chat DLP/sensitivity-label bypass (CW1226324, Jan to Feb 2026):** starting 21 Jan 2026, labeled emails in Sent Items and Drafts were summarized by Copilot Chat despite DLP policies. A fix rolled out in early February 2026, and the number of affected customers was not disclosed. Microsoft's position is that users saw only content they already had permission to view. Some outlets frame the failure as more serious. — [Petri](https://petri.com/?p=774316); [eSecurity Planet](https://www.esecurityplanet.com/threats/microsoft-365-copilot-bug-circumvented-dlp-controls/); [VentureBeat](https://venturebeat.com/security/microsoft-copilot-ignoring-sensitivity-labels-dlp-cant-stop-ai-trust-failures)
- **Structural oversharing:** "Copilot didn't overshare your data. Your permissions did." Copilot respects existing permissions, so broadly shared SharePoint sites and "anyone with the link" files become discoverable through natural-language questions. — [Petri](https://petri.com/copilot-didnt-overshare-your-data-your-permissions-did/)
- **Microsoft's remediation toolkit** (vendor docs):
  - SharePoint Advanced Management (SAM) data access governance reports.
  - Restricted Content Discovery, which hides sites from Copilot and org search without changing permissions. One vendor blog says it can take up to 24 hours to apply.
  - Restricted Access Control, which limits a site to designated groups.
  - Purview DSPM for AI.
  - Purview DLP for Copilot, which excludes labeled content from grounding.
  Restricted SharePoint Search is being retired, and new enablement is blocked from 31 Jul 2026. A secondary source (Petri) says SAM is now included for tenants with at least one Copilot license; this is not verified against Microsoft licensing terms. — [Learn: Get ready for Copilot with SAM](https://learn.microsoft.com/sharepoint/get-ready-copilot-sharepoint-advanced-management); [Learn training summary](https://learn.microsoft.com/en-us/training/modules/govern-sharepoint-onedrive-copilot/12-summary); [Microsoft 365 Community Conf 2026 deck](https://adoption.microsoft.com/files/microsoft-365-community-conference/2026/pdf/MS88%20-%20Secure%20and%20Govern%20Microsoft%20365%20Copilot.pdf)

### Inferences
- The industry has converged on one model: **sync ACLs into the index, filter inside the query, optionally verify live, fail closed, and authenticate the user upstream.** A credible custom private build has to replicate this. Postgres RLS with a `chunks(doc_id, acl_principals[])` column plus a session-scoped principal set is a reasonable implementation. It must solve group expansion (nested AD/Entra groups), sync lag, pool hygiene and index performance.
- Group resolution and identity mapping are the hard part, not the filter itself. AWS keys on email, Azure on Entra object IDs, and Glean on its own group directory. A private stack needs a single identity source (an Entra/Okta/Keycloak OIDC token carrying group claims, or a periodic group sync).
- Pitch angle: "Private AI" does not solve oversharing. If the client's SharePoint is overshared, a self-hosted RAG with perfect ACL mirroring will still leak just as Copilot does. A permissions hygiene audit should be part of the engagement.

### Gaps
- Could not confirm whether Azure AI Search document-level ACLs (including SharePoint ACL ingestion) reached GA as of Oct 2026. The docs still showed preview API versions.
- Did not retrieve Elastic's own DLS documentation or Elastic's "Search Applications / Connectors" permission-sync docs. The DLS finding above is from OpenSearch.
- No independent measurement found of Glean's permission-sync latency.
- Release date and GA status of Bedrock "Managed Knowledge Base" ACL awareness are not shown on the doc page.

## 2. RAG-specific security risks, OWASP mapping and mitigations

### Takeaway
The risks specific to RAG are:
- **Indirect prompt injection** via retrieved documents and emails. EchoLeak is the canonical real-world case.
- **Data exfiltration** through rendered links and images.
- **Knowledge-base poisoning.** A handful of planted texts can steer answers.
- **Embedding inversion.** Vectors are not anonymized data.
- **Weak access control on vector stores.**

OWASP's 2025 list added "LLM08: Vector and Embedding Weaknesses" specifically for RAG. Mitigations in practice are layered. None is reliable alone; EchoLeak bypassed a production classifier.

### Cited Findings
- The OWASP Top 10 for LLM Applications 2025 added two new entries: LLM07 System Prompt Leakage and LLM08 Vector and Embedding Weaknesses. LLM08 covers embedding pipelines, vector storage, similarity search and RAG memory. Its risks are unauthorized access and data leakage, cross-context leaks between tenants, embedding inversion, data poisoning and behavior alteration. Its mitigations are permission-aware vector stores, fine-grained access control, data validation and source authentication, and retrieval logging. One source frames it as: an unprotected vector store is functionally an unprotected database. — [IronCore Labs: OWASP LLM Top 10 2025 update](https://ironcorelabs.com/blog/2025/owasp-llm-top10-2025-update/); [Cobalt: vector and embedding weaknesses](https://www.cobalt.io/blog/vector-and-embedding-weaknesses); [Indusface](https://www.indusface.com/learning/owasp-llm08-2025-vector-and-embedding-weaknesses/). The official page is genai.owasp.org/llm-top-10/ (fetch returned 403).
- The full 2025 list is LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM03 Supply Chain, LLM04 Data and Model Poisoning, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM07 System Prompt Leakage, LLM08 Vector and Embedding Weaknesses, LLM09 Misinformation and LLM10 Unbounded Consumption. — [HCL AppScan OWASP LLM 2025 report page](https://help.hcl-software.com/appscan/Enterprise/10.10.0/topics/r_owasp_top_10_for_llm.html); [dev.to overview](https://dev.to/foxgem/overview-owasp-top-10-for-llm-applications-2025-a-comprehensive-guide-8pk). This list was cross-checked against secondary sources only.
- **Indirect prompt injection and exfiltration in production:** EchoLeak needed no user interaction. A malicious email was retrieved into Copilot's context, and data left through Markdown image and link rendering via an allowed proxy domain. The XPIA classifier, link redaction and CSP were all bypassed. — [arXiv 2509.10540](https://arxiv.org/html/2509.10540v1); [The Hacker News](https://thehackernews.com/2025/06/zero-click-ai-vulnerability-exposes.html)
- **Knowledge poisoning (PoisonedRAG, 2024; USENIX Security 2025):** injecting 5 poisoned texts per target question into a corpus of millions achieved about 90% attack success. The defenses tested (paraphrasing, perplexity filtering) were insufficient. Follow-ups include CtrlRAG and CPA-RAG (covert poisoning). — [arXiv 2402.12784 PoisonedRAG](https://arxiv.org/html/2402.12784v1); [CtrlRAG arXiv 2503.06950](https://arxiv.org/html/2503.06950v2); [CPA-RAG arXiv 2505.19864](https://arxiv.org/html/2505.19864v1)
- **Embedding inversion (Vec2Text, Morris et al., EMNLP 2023):** recovers 92% of 32-token inputs exactly. The attacker needs only text–embedding pairs, not the model weights. A 2024 follow-up studies mitigations for dense retrieval. This is older but still the foundational reference. Note the 92% figure applies to short texts, not whole documents. — [Understanding and Mitigating the Threat of Vec2Text (2024)](https://astro.paperswithcode.com/paper/understanding-and-mitigating-the-threat-of)
- **Vulnerabilities in self-hosted RAG UIs (supply chain, LLM03):**
  - Open WebUI CVE-2025-64496 (CVSS about 8.0). A malicious "Direct Connections" model server can run JavaScript through SSE, steal tokens, and achieve backend RCE via the Functions API. It affects versions up to 0.6.34 and is fixed in 0.6.35. The feature is off by default.
  - RAGFlow CVE-2025-68700 (CVSS 8.6). A low-privilege user gets RCE through the Canvas CodeExec component via `eval()` on stdout. Fixed in 0.23.0.
  — [NVD CVE-2025-64496](https://nvd.nist.gov/vuln/detail/CVE-2025-64496); [InfoWorld](https://www.infoworld.com/article/4113142/open-webui-bug-turns-the-free-model-into-an-enterprise-backdoor.html); [OSV CVE-2025-68700](https://osv.dev/vulnerability/CVE-2025-68700)
- **Government framing:** the GC Guide recommends adversarial testing or red-teaming for public-facing tools, an incident plan aligned with the GC Cyber Security Event Management Plan, and the Cyber Centre's ITSAP.00.041 for security practice. — [Canada.ca Guide on the use of generative AI (page dated 2026-09-24)](https://www.canada.ca/en/government/system/digital-government/digital-government-innovations/responsible-use-ai/guide-use-generative-ai.html)

### Inferences
Mitigations used in practice, synthesized from the above (not a single cited source):
1. Enforce ACLs before retrieval (LLM08).
2. Treat all retrieved text as untrusted data. Use spotlighting or delimiting and injection classifiers, while accepting that classifiers are bypassable.
3. Kill the exfiltration channel. Don't render model-generated external URLs or images, enforce a strict CSP and an allowlist, and block egress from the inference host.
4. Least-privilege tools and human confirmation for actions (LLM06).
5. Source provenance and trust tiers for ingestion. Restrict who can write to indexed sources, because poisoning needs write access to something indexed.
6. Encrypt and access-control the vector DB like the source data. Embeddings are personal information if the source text is.
7. Log retrievals per user for audit.
8. Patch the open-source UI layer aggressively. These projects ship fast and have had RCE-class bugs.

On the pitch: "private" removes the third-party processor risk, but not prompt injection, poisoning or oversharing. A consultant should say this explicitly.

### Gaps
- Could not fetch the official OWASP page (403). It is unknown whether a 2026 revision of the LLM Top 10 exists. OWASP's separate Agentic AI Top 10 (reportedly published Dec 2025) was not verified.
- No vLLM CVE results came back in search. vLLM has had advisories historically, but none are verified here.
- No independent benchmark found comparing the effectiveness of prompt-injection defenses (e.g., spotlighting, Prompt Shields, Llama Prompt Guard) as of 2026.

## 3. Private/self-hosted stacks: which are production-credible

### Takeaway
The credible split is between **platforms that sync enterprise connectors and permissions** and **chat-over-uploaded-files UIs**.
- **Onyx** (formerly Danswer) is the open-source option closest to Glean: connectors with permission sync for major SaaS, hybrid index, MIT core with enterprise features under a separate license.
- **Open WebUI** is a polished chat front-end with SSO, RBAC and SCIM, but its RAG covers manually uploaded files only.
- **RAGFlow and Dify** are strong builder platforms, and RAGFlow has had a critical RCE.
- **Frameworks** (LlamaIndex, Haystack) are what you use to build a custom stack where you own the ACL logic.
- **Serving layer:** vLLM for the LLM, TEI or Infinity for embeddings and rerankers, Docling for local parsing. Docling is Linux Foundation-governed and can run air-gapped.

### Cited Findings
- **Onyx:** ingests content, metadata and permissions from connected apps into a hybrid (vector + keyword) index. The core is MIT and enterprise features are under the Onyx Enterprise License. A Sept 2026 guide references Onyx 4.8.0. Permission sync is reported for Confluence, Jira, Google Drive, Gmail, Slack, Salesforce, GitHub and SharePoint, with connector-specific conditions (agency write-up, not verified against Onyx docs). — [wz-it.com Onyx self-hosted guide](https://wz-it.com/en/blog/onyx-self-hosted-installation/); [agence-scroll.com](https://agence-scroll.com/en/blog/onyx-a-serious-solution-for-enterprise-rag-deployment); [onyx.app self-hosted RAG (vendor)](https://onyx.app/insights/self-hosted-rag)
- **Open WebUI:** a general-purpose AI platform (chat, knowledge bases, Python extensibility, any model provider). Its own docs say SSO, RBAC and SCIM are in the free community edition. Onyx's competitive page says Open WebUI's RAG is "limited to manually uploaded files" with no automated crawling of enterprise sources. Both sources are vendor-biased. — [Open WebUI docs: Onyx comparison](https://docs.openwebui.com/alternatives/onyx); [Onyx: Open WebUI alternative (vendor)](https://onyx.app/alternatives/open-webui)
- **RAGFlow:** listed among open-source RAG platforms with a UI and connectors. It had CVE-2025-68700, a privilege-to-RCE bug, fixed in 0.23.0. — [onyx.app self-hosted RAG](https://onyx.app/insights/self-hosted-rag); [OSV](https://osv.dev/vulnerability/CVE-2025-68700)
- **Docling:** created at IBM Research and donated to LF AI & Data in April 2025. It parses PDF, DOCX and PPTX while keeping layout, tables and reading order, and outputs Markdown, JSON or HTML. It runs locally by default and supports air-gapped "offline mode" after you pre-download its models. It can be deployed via containers, Kubernetes or OpenShift (docling-serve). One source says the Granite-Docling-258M VLM is Apache 2.0 and mentions a later move to the LF Agentic AI Foundation, which conflicts with other sources and is unverified. — [Red Hat: What is Docling](https://www.redhat.com/en/topics/ai/docling); [heidloff.net docling-serve](https://heidloff.net/article/docling-serve/); [idp-software.com](https://idp-software.com/vendors/docling/)

### Inferences
These are based on general knowledge and the findings above, and are not each verified in this session.

**Production-credibility tiers for a consultant pitch:**

| Tier | Options | Notes |
|---|---|---|
| Production-credible platform | Onyx | Permissioned enterprise search |
| Production-credible chat UI | Open WebUI | Uploaded or curated knowledge; needs patch discipline |
| Production-credible builder | Dify, RAGFlow | Workflow and app platforms; harden and patch |
| Credible frameworks (custom build) | LlamaIndex, Haystack | Paired with Postgres/pgvector or Qdrant/OpenSearch |
| Demo or SMB-grade | AnythingLLM, PrivateGPT, Kotaemon | Single-team or desktop use; weak or absent enterprise permission sync |
| Unclear | R2R | Has users and documents ACL primitives, but project momentum is uncertain |

**A credible private RAG stack** (on a client GPU server):
- **Identity:** Entra ID, Okta or Keycloak OIDC, with group claims.
- **Ingestion:** Docling for parsing. Connectors with ACL capture (Onyx's, or custom via Graph API, Drive API and Confluence REST).
- **Store:** Postgres + pgvector with RLS on `acl_principals`, or OpenSearch with DLS.
- **Serving:** TEI or Infinity for embeddings and reranker. vLLM serving an open-weights model (e.g., Qwen, Llama or Mistral family) behind an authenticated gateway.
- **UI:** Open WebUI or a custom app.
- **Controls:** audit logging of retrievals, egress-blocked inference host, no external image or URL rendering, and a patch cadence.

### Gaps
- Searches did not return details for TEI (Hugging Face text-embeddings-inference) or Infinity. Their status as of 2026 is not verified here.
- No independent, non-vendor comparison of Onyx, Dify, RAGFlow, AnythingLLM, Kotaemon, PrivateGPT and R2R production readiness was found. Current maintenance status and versions of AnythingLLM, PrivateGPT, Kotaemon and R2R are unverified.
- Dify's and Onyx's enterprise license terms (which features are paywalled, such as permission sync) are not verified against official repos.

## 4. Managed cloud alternatives with Canadian data residency, and how to position private vs managed

### Takeaway
Managed is viable in Canada, but residency depends on the deployment type.
- **Azure OpenAI:** Standard or Provisioned *Regional* deployments in Canada East (Québec City) or Canada Central (Toronto) keep inference in-region. *Global* and *Data Zone* deployments can process data elsewhere. The newest models often aren't offered as Regional in Canada; a July 2026 Q&A thread reports no GPT-5.1 Regional deployment in Canadian regions.
- **AWS Bedrock in ca-central-1:** frontier models are reached via cross-region inference to US or Global profiles. Data at rest stays in Canada, but inference processing can leave Canada.

This model-availability-vs-residency tension is the strongest argument for self-hosting.

### Cited Findings
- **Azure deployment types (official docs):**
  - Data Zone deployments keep data at rest in the geography, but inference "may be processed … in any Azure OpenAI location within the Microsoft specified data zone".
  - Global deployments may route anywhere.
  — [Learn: Azure OpenAI deployment types](https://learn.microsoft.com/en-us/AZURE/ai-services/openai/how-to/deployment-types)
- To keep storage and inference in Canada, select Standard (Regional) or Provisioned (Regional) in Canada East or Canada Central. This comes from Microsoft Q&A answers by community moderators, not official docs. — [MS Q&A: Azure OpenAI data residency in Canada East](https://learn.microsoft.com/en-us/answers/questions/5926885/azure-openai-data-residency-in-canada-east-quebec)
- July 2026 Q&A: with gpt-4.1-mini and gpt-4o deprecated, there is apparently no GPT-5.1 Regional deployment in Canada East or Central. Microsoft staff said no roadmap has been published and pointed to the Foundry portal for current availability. — [MS Q&A thread](https://learn.microsoft.com/en-us/answers/questions/5935539/need-help-understanding-the-options-and-road-map-f)
- **Bedrock Canada (Nov 2025 AWS blog):** from ca-central-1, Claude Sonnet 4.5 and Haiku 4.5 are reachable via cross-region inference using US or Global profiles. Data at rest stays in Canada, and only transient inference processing occurs in destination regions. Bedrock docs say geographic profiles keep prompts and outputs within the geography, while Global profiles have no geographic restriction. — [AWS ML blog: Accelerate gen AI innovation in Canada with Bedrock CRIS](https://aws.amazon.com/blogs/machine-learning/accelerate-generative-ai-innovation-in-canada-with-amazon-bedrock-cross-region-inference); [Bedrock model/region compatibility](https://docs.aws.amazon.com/bedrock/latest/userguide/models-region-compatibility.html)
- AgentCore Evaluations documents a "Canada" geography whose inference regions include ca-central-1 plus us-east-1, us-east-2 and us-west-2. So a "Canada" label at AWS does not necessarily mean in-Canada processing. — [AgentCore cross-region inference docs](https://docs.amazonaws.cn/bedrock-agentcore/latest/devguide/cross-region-inference.html)

### Inferences
Positioning for the pitch, as a synthesis:
- **Managed** (Azure OpenAI Regional + AI Search in Canada, or Bedrock) wins on time-to-value, built-in ACL connectors (Azure SharePoint ACL indexer, Bedrock managed ACL with real-time verification), and model quality. Its weaknesses are the US CLOUD Act exposure of US-headquartered providers, lagging frontier-model availability in Canadian regions, and cross-border inference for the newest models, which triggers Law 25 s.17 analysis.
- **Private** (vLLM on client GPUs) wins on sovereignty, no third-party processor, predictable cost at high volume, and air-gap capability. It costs open-weights quality (generally below frontier), MLOps and patching burden, and you must build ACL sync yourself.
- **Hybrid** is the common middle ground: private embeddings, index and ACL enforcement, with a managed Regional LLM endpoint. Its residency picture is easy to explain.

### Gaps
- Did not verify the current (Oct 2026) official list of Azure OpenAI models available as Regional in Canada East/Central, or whether a Canada data zone exists.
- Did not confirm whether a Canada-only Bedrock geographic inference profile exists as of Oct 2026.
- Azure AI Search Canada region availability for the preview ACL features was not checked.

## 5. Canadian and Quebec compliance angle

### Takeaway
For RAG over client documents, the main triggers are:
- **Quebec Law 25 s.17:** a privacy impact assessment (PIA) is required before personal information is communicated outside Quebec. Practitioners read this to include cloud services hosted outside Quebec, even Canadian ones. Penalties reach CAD 10M or 2% of worldwide turnover.
- **PIPEDA:** accountability for processors. Not researched in depth here.
- **Federal guidance:** the GC Guide on generative AI requires tools appropriate to the security classification and chief security officer approval for "protected" information. It does not name Protected B or RAG explicitly. It favours government-controlled systems and "grounding", which is effectively RAG.

### Cited Findings
- **Law 25 s.17:** communicating personal information outside Quebec requires a prior PIA. The PIA must consider the receiving jurisdiction's legal framework, and the transfer is allowed if protection is adequate, supported by a written agreement. Most provisions took effect 22 Sept 2023. Penalties reach the greater of CAD 10M or 2% of worldwide turnover. — [Greenberg Traurig (Sept 2023)](https://www.gtlaw.com/en/insights/2023/9/quebecs-law-25-many-provisions-take-effect-today); [IAPP survey (pre-enactment, older)](https://iapp.org/news/a/a-quick-comparative-survey-of-quebecs-proposed-privacy-legislation)
- A practitioner guide (Apr 2026) reads s.17 as applying "in principle" to any cloud service whose servers are not in Quebec, even a Canadian vendor's. It flags hyperscaler subprocessors as a common gap. This is an interpretation, not a CAI position. — [Hilo Intelligence Law 25 wiki](https://hilotech.ca/en/wiki/law-25/cross-border-transfers)
- **GC Guide on the use of generative AI** (canada.ca, page dated 2026-09-24):
  - Do not input personal information into publicly available tools.
  - Personal information may go into government-controlled systems with privacy and security controls.
  - "Don't enter sensitive or personal information into any tools not managed by the GC."
  - Use tools appropriate for the information's security classification, under the Directive on Security Management.
  - Get approval from the chief security officer before using protected information, with a risk assessment.
  - Consider the residency requirements of the Directive on Service and Digital.
  - Consult privacy officials on PIAs.
  - Use grounding so outputs rely on institution-controlled information.
  - Refer to Cyber Centre ITSAP.00.041.
  The page does not explicitly mention "Protected B" or "RAG". — [Canada.ca Guide](https://www.canada.ca/en/government/system/digital-government/digital-government-innovations/responsible-use-ai/guide-use-generative-ai.html)

### Inferences
- In Quebec, a RAG system on a GPU server physically in Quebec (client premises or a Quebec colo/DC) can avoid a s.17 cross-border PIA for the inference path. A PIA under Law 25 s.3.3 is still likely required for a new information system project involving personal information. That s.3.3 requirement is from general knowledge and not verified in this session.
- Azure Canada East (Québec City) Regional deployments are the managed option most aligned with a Quebec-residency narrative. Model availability limits it.
- For federal Protected B workloads, the guide's emphasis on "GC-managed" tools and classification-appropriate systems supports a private or self-hosted deployment, or a cloud service assessed for Protected B (GC cloud profile). This is inferred; not confirmed which AI services hold Protected B assessments.

### Gaps
- Did not retrieve CAI (Commission d'accès à l'information) guidance specific to AI, or the text of Law 25 s.12.1 (automated decision notification) and s.3.3 (PIA for systems projects).
- No PIPEDA or OPC-specific gen-AI guidance retrieved (OPC's Dec 2023 "Principles for responsible, trustworthy and privacy-protective generative AI" exists per general knowledge; not verified here). Bill C-27/AIDA died in Jan 2025 per general knowledge; current federal AI legislation status as of late 2026 is unverified.
- No source found that explicitly addresses Protected B and generative AI or RAG (Cyber Centre ITSAP.00.041 and the GC cloud Protected B profile were not fetched).
- Embeddings as personal information under Law 25 or PIPEDA: no regulator statement found.
