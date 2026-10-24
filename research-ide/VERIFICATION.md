# Manual verification, 24 October 2026

The live Wi-Fi URL was exercised in a browser, rather than only on localhost.
This reproduced a send failure: `crypto.randomUUID()` is unavailable on the
insecure LAN origin. The old handler cleared the input before throwing. Browser
message IDs now use an internal local sequence; server IDs and access keys still
use Node's cryptographic generators.

After the fix, verified through the live interface:

- Sent a prompt, received `Hello.`, and confirmed the composer stayed enabled
  during generation.
- Drafted in one chat, switched to another and drafted there, then switched back
  and recovered the first draft.
- Opened a linked chat, asked about the parent conversation, and received the
  correct answer from its inherited context.
- Created another branch and immediately entered a follow-up. The composer
  waited for branch creation, and the prompt went into the new linked chat.
- At 1024 by 450 pixels, representing the space remaining above a tablet
  keyboard, the full composer remained within the visible viewport.
- At 390 by 600 pixels, the conversation filled the screen. Opened the navigation
  drawer, inspected a file without editing it, and closed the editor to return
  to the same conversation.
- Stopped a running agent turn. The response showed `Response stopped.`, and
  the ordinary send control returned.

Adversarial review fixed a branch-creation race that could otherwise send a
fast follow-up into the parent, and prevented background file refreshes from
reopening the editor over chat. No unresolved blocking finding remains in the
reviewed interaction; the platform limits below still apply.

`node --check public/app.js` and `node --check server.mjs` passed.

These are manual Chromium browser checks at representative sizes. A physical
iPad Safari keyboard was not controlled from this machine. The user service is
transient: it survives this chat session but does not start automatically after
a computer reboot. Synthetic verification chats remain in ignored local state.
`VERIFY.txt` is the retained fixture from the original file-save check.
