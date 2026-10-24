# Personal document assistant — product and system specification

Status: **draft for product decisions**, 24 October 2026. This fixes a concrete
baseline for discussion; the decisions at the end need the owner's sign-off before
implementation. The product is a private, single-user **chat assistant** whose
backend runs on the user's computer. A Telegram bot is the everyday client; a
web app demonstrates the same chat experience and provides document previews
and settings. Both accept documents, retain the originals, build a searchable
record of what they say, and surface time-sensitive next steps.

## 1. Promise and boundaries

The user's basic interaction is: **send a document in chat, review any uncertain
extraction in chat, then ask questions or receive relevant reminders**. Examples:

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
It may suggest checking those things. The first release sends replies and
reminders **only to the paired owner's chat**; it does not contact third parties,
sign documents, make payments, change accounts, or cancel contracts. It can
prepare a draft and a proposed action for approval. Legal and financial
interpretations are flagged for human review rather than presented as certain.

## 2. Default scope

| Area | First release | Later, separately scoped |
| --- | --- | --- |
| Users | One owner, one local installation | Multiple users and access roles |
| Clients | Telegram private chat and chat-first web demo using one backend | Other messaging channels |
| Input | PDF, PNG/JPEG/WebP, DOCX, TXT; single or multiple chat attachments | Email inbox, scanner, cloud drives |
| Organization | Configurable taxonomy with `personal/finance`, `personal/contracts`, `work` | User-trained rules and shared folders |
| Intelligence | Classification, extraction, cross-document Q&A, change comparison | External price/law monitoring |
| Follow-up | Daily checks, Telegram direct messages and mirrored web chat/inbox | Email/calendar delivery with explicit setup |
| Actions | Drafts and reviewable proposals | Approved connector actions, one at a time |
| Access | Paired Telegram owner; localhost web demo | Private web access after authentication and TLS |

An upload can be marked **private/excluded from model processing**. It remains
stored and manually searchable by filename but receives no AI extraction.
Supported language at launch: English and German. Other languages are retained
and queued for manual review if extraction is unreliable.

## 3. Chat-first user experience

The main screen is a conversation, not a dashboard. The Telegram bot and web
demo share the same conversation, document, task, and audit records. Channel
adapters normalize messages and attachments into one backend command/event
model; replies are rendered for each channel. A user can start a task in one
channel and continue it in the other. New replies return to the channel where
the request arrived; both clients show the shared history. Reminders target the
paired Telegram chat and appear in the web history. Each outbound message has
a delivery record so a retry cannot create duplicate reminders or replies.

1. **Send:** attach one or more files with an optional note such as "This is my
   new insurance contract." The assistant immediately acknowledges receipt
   with a short document ID and reports progress asynchronously. A processing
   failure is explained in chat; the original remains recoverable.
2. **Confirm:** the assistant returns a compact summary: proposed folder,
   document type, parties, key dates, and any review question. The user can
   answer naturally ("Put this under work/contracts"), use quick buttons, or
   say "show details". Low-confidence classification goes to
   `inbox/unclassified` until confirmed.
3. **Ask:** free-form questions and requests such as "What is due next month?",
   "Compare these two policies", "Why did you remind me?", and "Draft a
   cancellation letter." Answers include source document names, page/section
   references, uncertainty, and next steps. Telegram offers an on-demand
   source excerpt or original; the web demo can open the cited page directly.
4. **Remind:** send a short, privacy-conscious Telegram direct message with the
   reason, date, and actions such as review, snooze, or dismiss. The mirrored web
   chat shows the same item. A contractual deadline is visibly distinct from
   a suggested review. Detailed contract text is sent only on request.
5. **Correct:** in either channel, the user can correct a fact or folder. The
   assistant echoes the old and new values, updates affected reminders, and
   keeps the correction as a user assertion across reprocessing.
6. **Inspect:** the web demo has a secondary document panel for original
   preview, extracted fields, versions/amendments, and activity log. A compact
   task list and settings page support browsing and administration, but every
   core workflow remains reachable from chat.
7. **Propose:** a draft action appears in chat with intended recipient,
   content, source facts, assumptions, and consequences. The first release has
   no tool to execute it against an external account or recipient.

The chat must handle multi-turn ambiguity without guessing: if "cancel it"
could refer to two contracts, ask which one; if a document has no reliable
date, ask for the missing fact. Optional slash commands such as `/help`,
`/status`, `/upcoming`, and `/privacy` improve discoverability, but ordinary
language and attachments are the primary interface.

**Availability requirement:** dependable Telegram intake and timely reminders
require the local backend to stay running and online. The Telegram Bot API
retains undelivered updates for at most 24 hours. After longer downtime, the
app warns that messages may have been missed and asks the owner to resend
uploads sent during the outage. The web demo can still accept local uploads.
For a dependable deployed assistant, use an always-on local host and monitor
worker health; a laptop-only deployment is a demo with this limitation.

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
| `ConversationMessage` | ID, actor, channel, text/attachment references, related document/task IDs, timestamp |
| `Delivery` | message ID, target channel/chat, idempotency key, attempt count, status, provider ID |
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
record delivery state. The scheduler creates a task first; the channel adapter
delivers a Telegram reminder if the owner has enabled it. If Telegram is
unavailable, the task remains pending in the web chat and delivery is retried
without changing its due date.

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
document facts and user corrections are. A Telegram answer uses compact
citations such as `Policy ABC, p. 3`; a follow-up request returns the excerpt
or original. The web answer links directly to the cited page/span.

## 8. Local Codex integration

The local application backend owns Telegram and web adapters, upload, storage,
authorization, schemas, scheduling, audit, and approvals. A local **Codex
app-server** process handles agent conversations and bounded extraction tasks
through a narrow application tool interface. The backend, not the model,
resolves document IDs into permitted text spans.
For each job, pass only the relevant extracted text/pages and a strict output
schema. The Codex process has no general write access to the vault, no access
to unrelated home directories or secrets, and no unrestricted network/tool
permissions. Separate threads/jobs prevent an uploaded document from becoming
standing instructions. Timeouts, cancellation, retry limits, and usage logging
are required.

"Runs Codex locally" means the **agent process** runs on the user's machine;
it does **not** mean inference is offline. Depending on account/configuration,
document content may be sent to the model service. Both clients must disclose
this before the first AI processing and offer the storage-only mode. Sending a
file through Telegram also transmits it through Telegram's service; this is a
separate privacy boundary from model inference and must be disclosed during bot
pairing. A file uploaded only to the web demo is not sent to Telegram unless
the owner explicitly requests delivery through the bot. No document content
is sent to any further service without a separately approved integration.
Actual account, data-control, and model choices are deployment decisions to
verify during implementation. Telegram bot conversations are cloud chats, not
end-to-end encrypted secret chats; see [Telegram's privacy policy](https://telegram.org/privacy).

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
- Pair one Telegram private chat through a one-time code shown in the local web
  UI. Allowlist its chat and user IDs; reject group chats, forwarded commands
  from other users, and unpaired updates. Store the bot token outside code and
  logs. Use outbound polling for the local deployment so no public inbound
  endpoint is needed. Deduplicate incoming updates and cap attachment sizes.
  The [Telegram Bot API](https://core.telegram.org/bots/api) documents polling
  and its update retention limit.
- Telegram messages and uploaded files pass through Telegram's infrastructure.
  Keep bot replies concise and avoid putting sensitive details in reminders by
  default. Provide a clear way to disconnect the bot and stop delivery.
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

1. Send PDFs, scans, images, DOCX and TXT through Telegram and web chat;
   originals remain byte-identical and downloadable; both channels show the
   same processing state and failures are retryable.
2. Correct or move a classified document; the correction persists across
   reprocessing and does not alter the original.
3. For a sample contract with an unambiguous term and notice period, show the
   cited clause, calculated latest notice date, and expected reminders.
4. For an ambiguous clause or missing date, create a review task and avoid a
   definitive deadline claim.
5. Upload an amendment; show both originals, changed facts, and recomputed
   tasks; superseded reminders no longer fire.
6. Ask a cross-document question in either channel; each material answer claim
   identifies its document and page, the web citation opens the page/span, and
   an unsupported question receives an explicit gap.
7. Restart the service mid-job; intake and jobs recover without duplicate
   records or lost originals. Restore a backup on a fresh installation.
8. Demonstrate that malicious instructions embedded in a document cannot
   trigger shell, vault writes, network calls, or an external action.
9. Verify that no third-party action is possible in the first release and that
   model processing can be disabled for a selected document.
10. Pair the Telegram bot, reject a message from an unpaired user or group,
    upload a document, then continue the same conversation in the web demo.
    Disconnect the bot and verify that no further Telegram delivery occurs.
11. Simulate Telegram downtime and duplicate updates; one task and one
    successful reminder delivery are recorded, with failed delivery visible.
12. Simulate an outage longer than Telegram's update retention window; show a
    missed-message warning and request resubmission rather than claiming full
    recovery.

These are functional gates, not a claim of legal or factual correctness. Build
an evaluation set of real-looking, consented or synthetic documents with known
answers, including German/English scans, missing pages, amendments, duplicate
uploads, and difficult date wording. Report field-level accuracy, citation
correctness, deadline false negatives, and human review rate. Deadline false
negatives deserve particular attention; no target percentage is assumed until
the evaluation set is agreed.

## 11. Implementation sequence

1. **Foundation:** shared conversation API, local web chat, vault, immutable
   upload, preview, deterministic text extraction, database, backup/restore.
2. **Telegram:** private-chat pairing, attachment intake, reply/delivery
   adapter, idempotent updates, and privacy controls.
3. **Understanding:** Codex integration spike; typed extraction, citations,
   chat review/correction, linking and amendment comparison.
4. **Assistant:** retrieval/Q&A, deterministic reminder engine, scheduler,
   chat notifications, audit and delivery state.
5. **Expansion:** approved external connectors, monitoring of explicitly
   authorized external sources, richer actions and multi-user controls.

Suggested implementation for the first release: Python backend (FastAPI),
SQLite with FTS5, a durable local job queue, isolated parser/OCR workers, a
Telegram adapter, and a TypeScript chat-first web UI. This is a replaceable
engineering choice, not a product requirement. A graph database, vector
database, and cloud deployment are not required for the first release.

## 12. Decisions to ratify before implementation

1. **Telegram privacy:** is sending documents through Telegram acceptable for
   the documents in scope, with web-only upload for exceptions?
2. **Inference:** is sending selected document text to the configured Codex
   model service acceptable, with storage-only mode for exceptions? If not,
   the model architecture must change to an offline alternative.
3. **Autonomy:** should the first release only remind and draft (recommended),
   or should a particular external action be included from day one?
4. **Web access:** should the web demo stay localhost-only, since Telegram
   covers phone use, or also open through an authenticated private tunnel?
5. **Documents:** which three document types matter most for the initial
   evaluation set, and are both German and English required from day one?
6. **Data home and backup:** where should the vault live, and what backup
   destination and retention policy does the owner want?
7. **Uptime:** will the backend run on an always-on local computer, or is
   laptop-only availability acceptable for the hackathon demo?
