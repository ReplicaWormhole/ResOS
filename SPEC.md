# Personal document assistant — product and system specification

Status: **draft for product decisions**, 24 October 2026. This fixes a concrete
baseline for discussion; the decisions at the end need the owner's sign-off before
implementation. The product is a private, single-user web application hosted on
the user's computer. It accepts uploaded documents, retains the originals, builds
a searchable record of what they say, and surfaces time-sensitive next steps.

## 1. Promise and boundaries

The user's basic interaction is: **upload a document, review any uncertain
extraction, then ask questions or receive relevant reminders**. Examples:

- Upload an insurance policy. See its category, parties, coverage, premium,
  renewal date, cancellation notice period, and cited clauses. Receive a reminder
  before the latest safe date to review it.
- Upload a rental contract and later an amendment. See both originals, the
  amendment's effect on the active terms, and any affected reminders.
- Ask "Which contracts can I cancel in the next two months?" and receive a
  source-linked answer, including uncertainty and missing information.

The assistant can only know what is in the uploaded documents and any explicitly
connected, authorized sources. It cannot infer that a provider changed prices,
that a payment was made, or that a law changed merely by re-reading a contract.
It may suggest checking those things. The first release **does not send messages,
sign documents, make payments, change accounts, or cancel contracts**. It can
prepare a draft and a proposed action for approval. Legal and financial
interpretations are flagged for human review rather than presented as certain.

## 2. Default scope

| Area | First release | Later, separately scoped |
| --- | --- | --- |
| Users | One owner, one local installation | Multiple users and access roles |
| Input | PDF, PNG/JPEG/WebP, DOCX, TXT; batch upload | Email inbox, scanner, cloud drives |
| Organization | Configurable taxonomy with `personal/finance`, `personal/contracts`, `work` | User-trained rules and shared folders |
| Intelligence | Classification, extraction, cross-document Q&A, change comparison | External price/law monitoring |
| Follow-up | Daily checks, in-app inbox, optional local desktop notification | Email/calendar delivery with explicit setup |
| Actions | Drafts and reviewable proposals | Approved connector actions, one at a time |
| Access | Localhost web UI | Private device access after authentication and TLS |

An upload can be marked **private/excluded from model processing**. It remains
stored and manually searchable by filename but receives no AI extraction.
Supported language at launch: English and German. Other languages are retained
and queued for manual review if extraction is unreliable.

## 3. User experience

1. **Inbox/upload:** drag files or select them. Each receives a visible processing
   state: received, scanning, text extracted, analyzing, needs review, ready, or
   failed. A failure never silently loses the original.
2. **Triage:** show proposed folder, document type, title, date, people and
   organizations, confidence, and the source page. The user may change these.
   Low-confidence classification goes to `inbox/unclassified`.
3. **Document view:** original preview beside extracted facts, obligations,
   dates, linked versions, and an activity log. Clicking a citation opens the
   relevant page or text span. Corrections are saved as user assertions; later
   reprocessing must not silently overwrite them.
4. **Dashboard:** upcoming deadlines and review opportunities, each with a
   reason, source, latest safe date, confidence, and a clear action such as
   "review", "snooze", or "dismiss". The user can distinguish a contractual
   deadline from a suggested periodic review.
5. **Ask:** natural-language questions over only authorized documents. Answers
   identify the documents used, cite exact pages/clauses, distinguish direct
   quotes from inference, and say when evidence is missing. Search filters
   include category, date, organization, document type, and status.
6. **Action center:** an assistant-created draft includes its intended recipient,
   content, relevant source facts, assumptions, and consequences. Nothing is
   executed unless a later action-specific approval flow is implemented.
7. **Settings:** taxonomy, reminder lead times, timezone, data directory,
   model-processing permission, retention/backup status, and export/delete.

## 4. Storage and data model

The **original bytes are immutable** after intake. The application assigns a
random document ID and SHA-256 checksum, never uses a submitted filename as a
filesystem path, and stores the original under an ID-based path. A proposed
on-disk layout is:

```text
vault/
  originals/ab/<document-id>/<version-id>/original.pdf
  derived/ab/<document-id>/<version-id>/text.json
  derived/ab/<document-id>/<version-id>/pages/
  exports/
```

The requested folder structure is a **logical, editable taxonomy in the
database**, exposed in the UI and optional export. A document can have one
primary folder and multiple tags. Moving it changes metadata, never the source
bytes or document ID. The initial taxonomy is `inbox/unclassified`,
`personal/finance`, `personal/contracts`, `personal/health`, `personal/identity`,
`personal/home`, `work/contracts`, `work/finance`, and `work/other`; the owner can
rename or add categories. Exports materialize a human-readable folder tree with
safe filenames and a manifest mapping paths to IDs and hashes.

**SQLite is the system of record** for the single-user release, with migrations,
transactions, and full-text search. JSON is the versioned interchange format
for model output and export. A graph database is deferred: typed `entity` and
`relation` tables support links such as document → organization, contract →
renewal event, and amendment → prior version without another service. Semantic
embeddings can be added as a derived index; they are never the sole record.

Core records:

| Record | Required fields |
| --- | --- |
| `Document` | ID, original filename, media type, hash, intake time, folder, tags, owner, processing state |
| `Version` | ID, document ID, original path/hash, source date, supersedes link for a replacement file, parser/OCR versions |
| `Evidence` | version ID, page number, text span or bounding box, extracted text, checksum |
| `Fact` | typed key/value, effective dates, confidence, evidence IDs, extraction version, user correction state |
| `Entity`/`Relation` | typed parties and links, source evidence, valid-from/to |
| `Obligation` | actor, required/optional action, trigger, deadline rule, jurisdiction if stated, evidence, review state |
| `Event` | computed date, source rule, calculation inputs, timezone, next recalculation, confidence |
| `Task` | event or review trigger, due date, state, snooze/dismiss history |
| `ActionProposal` | draft, target, exact proposed effect, source facts, approval/execution state |
| `AuditEvent` | actor, time, operation, record IDs, before/after references, result |

An amendment is normally a separate `Document` linked to the original contract;
it does not automatically supersede the whole contract. `Version` represents a
replacement of one uploaded file. The current effective terms are a derived
view over the original and applicable amendments, with conflicts shown for
review. Every extracted field must have a source pointer or be labeled as
inference or a user assertion.
Unknown fields stay `null`, not guessed. Store both the text as written (for
example, "three months before the end of the term") and the interpreted date,
with the calculation rule and assumptions. Distinguish document issue date,
effective date, expiry date, renewal date, and notice deadline. Facts are
versioned; amendments do not erase earlier facts.

## 5. Processing pipeline

1. **Receive:** stream upload to a temporary quarantine area with size and
   count limits; authenticate request; validate detected type; reject active or
   unsupported content; compute hash; detect exact duplicates. Keep the original
   in a durable path before reporting success. Do not execute document macros.
2. **Read:** extract embedded text where possible; OCR scanned pages/images;
   preserve page order and coordinates; store parser errors. The original is
   untouched. A low-quality or empty text result goes to review.
3. **Classify:** propose document type and folder from an allowlisted taxonomy.
   User rules have priority. Model output is schema-validated and may only
   propose metadata, not paths or arbitrary commands.
4. **Extract:** run document-type schemas. Common fields: title, parties,
   addresses, dates, amounts/currency, reference IDs, obligations, options,
   notice periods, and key clauses. A contract schema adds term, renewal mode,
   termination conditions and latest notice date. An invoice schema adds issuer,
   amount, due date, and payment reference. Keep evidence per field.
5. **Validate:** deterministic type/date checks; reconcile conflicting dates;
   compare calculated deadline to quoted clause; mark ambiguity. For high-stakes
   fields such as cancellation deadlines, a human review state is mandatory
   before the system labels the date confirmed.
6. **Link/index:** match likely entities and earlier versions, with explicit
   merge review when uncertain; update SQLite full-text and derived indexes.
7. **Schedule:** generate tasks from confirmed or clearly labeled tentative
   events. Recompute affected tasks after corrections, new versions, policy
   changes, or timezone changes. Never leave a stale reminder active silently.

Processing is asynchronous and idempotent. Each stage records its input hash,
schema/parser/model version, outcome, and retry count. Reprocessing can rebuild
derived data from originals; failed jobs enter a visible retry queue. The
application never treats instructions inside uploaded files as instructions to
the agent.

## 6. Reminder and action semantics

The scheduler runs daily in the owner's configured timezone (default
`Europe/Berlin`), catches up after the computer has been off, and rechecks on
relevant data changes. It computes an event's **latest
safe action date** from source clauses and calendar rules; it must handle
month-end, leap years, business-day wording, missing term start dates, and
ambiguous notice delivery rules. Ambiguity creates a review task, not a
confident deadline. Default reminders are 90, 30, and 7 days before a confirmed
contract notice deadline, plus the deadline day; users can change the policy.
Past-due items remain visible until resolved. Deduplicate notifications and
record delivery state.

A suggested "review this contract" is distinct from "you must cancel by this
date". For each item, show the source clause, calculation, status, and the next
safe user step. When a newer document changes an event, mark the previous task
superseded and explain the change. The system can draft a cancellation letter,
but drafting is not sending. Future connector actions require an explicit,
scoped user approval showing the exact payload and destination immediately
before execution, plus a result receipt and recovery path.

## 7. Question answering

Retrieval is hybrid: metadata filters and full-text search first, optional
semantic search to broaden candidates, then evidence-grounded synthesis. The
assistant answers from the selected source spans and their effective-term
status. It must account for amendments and replacements, show conflicts,
and cite each material claim. Questions such as "what should I do?" produce
options and a proposed next step, with explicit assumptions. If no document
supports an answer, it says so. Chat history is not the source of record;
document facts and user corrections are.

## 8. Local Codex integration

The web app owns upload, storage, authorization, schemas, scheduling, audit,
and approvals. A local **Codex app-server** process handles agent conversations
and bounded extraction tasks through a narrow application tool interface. The
web server, not the model, resolves document IDs into permitted text spans.
For each job, pass only the relevant extracted text/pages and a strict output
schema. The Codex process has no general write access to the vault, no access
to unrelated home directories or secrets, and no unrestricted network/tool
permissions. Separate threads/jobs prevent an uploaded document from becoming
standing instructions. Timeouts, cancellation, retry limits, and usage logging
are required.

"Runs Codex locally" means the **agent process** runs on the user's machine;
it does **not** mean inference is offline. Depending on account/configuration,
document content may be sent to the model service. The UI must disclose this
before the first AI processing and offer the storage-only mode. No document
content is sent to any other service without a separately approved integration.
Actual account, data-control, and model choices are deployment decisions to
verify during implementation.

The official integration guidance distinguishes `codex exec` for bounded jobs,
the SDK for programmatic workflows, and app-server for persistent product
conversations and approvals. See [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
and [Codex app-server](https://learn.chatgpt.com/docs/app-server). The app-server
choice here is an architectural recommendation, subject to a small integration
spike before the implementation is fixed.

## 9. Security, privacy, and reliability

- Bind to localhost by default. Require an authenticated session, CSRF
  protection, secure cookies, idle timeout, and rate limits. For phone access,
  use a private tunnel with TLS and authentication; never expose the raw local
  service to the public Internet.
- Treat PDF/DOCX/image contents, OCR output, and filenames as untrusted data.
  Scan or restrict risky formats; sandbox parsers/OCR; cap file/page/decompression
  sizes; block path traversal and archive bombs; render previews safely.
- Keep originals and database under a user-owned directory with restrictive
  permissions. Keep versioned backups at a separate destination, outside the
  vault being backed up. Recommend full-disk encryption; encrypt backups and
  document how to restore them. An export must be explicit and auditable.
- Apply collection-level access and model-processing policies. `work` documents
  may have employer confidentiality requirements; do not send them to a model
  service or mix them into personal answers unless that collection permits it.
- Minimize model context to the requested task. Never include credentials in
  prompts. Give the model read-only, ID-scoped tools; implement any future write
  as a validated application endpoint with a separate approval token.
- Provide local deletion of originals and derived data after explicit user
  confirmation, including index and backup policy. Record what was deleted and
  what remains in retained backups. Support a complete portable export.
- Use transaction boundaries and backups so a power loss cannot produce a
  "successful" upload with missing bytes. On startup, reconcile database
  records and files, surface inconsistencies, and allow repair from backup.

Prompt-injection and tool-access controls follow the threat model in
[OpenAI's agent guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety)
and [sandbox security guidance](https://developers.openai.com/api/docs/guides/agents-api/environments/security).

## 10. Acceptance criteria for the first release

1. Upload a mixed batch of PDFs, scans, images, DOCX and TXT; originals remain
   byte-identical and downloadable; processing failures are visible and retryable.
2. Correct or move a classified document; the correction persists across
   reprocessing and does not alter the original.
3. For a sample contract with an unambiguous term and notice period, show the
   cited clause, calculated latest notice date, and expected reminders.
4. For an ambiguous clause or missing date, create a review task and avoid a
   definitive deadline claim.
5. Upload an amendment; show both originals, changed facts, and recomputed
   tasks; superseded reminders no longer fire.
6. Ask a cross-document question; each material answer claim opens the
   relevant page/span, and an unsupported question receives an explicit gap.
7. Restart the service mid-job; intake and jobs recover without duplicate
   records or lost originals. Restore a backup on a fresh installation.
8. Demonstrate that malicious instructions embedded in a document cannot
   trigger shell, vault writes, network calls, or an external action.
9. Verify that no external action is possible in the first release and that
   model processing can be disabled for a selected document.

These are functional gates, not a claim of legal or factual correctness. Build
an evaluation set of real-looking, consented or synthetic documents with known
answers, including German/English scans, missing pages, amendments, duplicate
uploads, and difficult date wording. Report field-level accuracy, citation
correctness, deadline false negatives, and human review rate. Deadline false
negatives deserve particular attention; no target percentage is assumed until
the evaluation set is agreed.

## 11. Implementation sequence

1. **Foundation:** local authenticated UI, vault, immutable upload, preview,
   deterministic text extraction, database, backup/restore.
2. **Understanding:** Codex integration spike; typed extraction, citations,
   review UI, correction persistence, linking/version comparison.
3. **Assistant:** retrieval/Q&A, dashboard, deterministic reminder engine,
   scheduler, audit and notification state.
4. **Expansion:** approved external connectors, monitoring of explicitly
   authorized external sources, richer actions and multi-user controls.

Suggested implementation for the first release: Python backend (FastAPI),
SQLite with FTS5, a durable local job queue, isolated parser/OCR workers, and
a TypeScript web UI. This is a replaceable engineering choice, not a product
requirement. A graph database, vector database, and cloud deployment are not
required for the first release.

## 12. Decisions to ratify before implementation

1. **Access:** only the host computer at launch, or authenticated access from
   phone/tablet over a private tunnel?
2. **Inference:** is sending selected document text to the configured Codex
   model service acceptable, with storage-only mode for exceptions? If not,
   the model architecture must change to an offline alternative.
3. **Autonomy:** should the first release only remind and draft (recommended),
   or should a particular external action be included from day one?
4. **Notifications:** in-app only at launch, or also desktop/email/calendar?
5. **Documents:** which three document types matter most for the initial
   evaluation set, and are both German and English required from day one?
6. **Data home and backup:** where should the vault live, and what backup
   destination and retention policy does the owner want?
