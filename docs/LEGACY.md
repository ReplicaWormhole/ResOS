# Browser prototype reference

The browser prototype is preserved in this repository's history at
[`dbaeb27`](https://github.com/ReplicaWormhole/ResOS/tree/dbaeb27f4a37c2702c9b013424a16944ea48fc78/research-ide).
The current repository layout contains the desktop project. The original
local checkout at `../hackathon` also has the annotated tag
`legacy-browser-prototype` at `9f220ca`, which includes the planning baseline.

Use the prototype's `research-ide/MVP.md` and
`research-ide/ARCHITECTURE.md` for its behavior and data contracts. Its test
suite is a reference for revisions, source selection, context, and job
recovery. From the desktop checkout, read the saved source with:

```sh
git show dbaeb27:research-ide/ARCHITECTURE.md
```

From the original checkout, run:

```sh
git show legacy-browser-prototype:research-ide/ARCHITECTURE.md
node --test research-ide/tests/*.test.mjs
```

The legacy checkout retains its existing local notebook data. The desktop app
uses a separate data directory. The [M03 storage decision](decisions/0002-notebook-storage.md) records
the current prototype import scope.
