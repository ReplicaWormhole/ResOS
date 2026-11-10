# Browser prototype reference

The browser prototype is preserved in the original
[ResOS repository](https://github.com/ReplicaWormhole/ResOS), under
`research-ide/`. The tracked browser code baseline is `dbaeb27`. The original
local checkout at `../hackathon` also has the annotated tag
`legacy-browser-prototype` at `9f220ca`, which includes the planning baseline.

Use the prototype's `research-ide/MVP.md` and
`research-ide/ARCHITECTURE.md` for its behavior and data contracts. Its test
suite is a reference for revisions, source selection, context, and job
recovery. From the original checkout, run:

```sh
git show legacy-browser-prototype:research-ide/ARCHITECTURE.md
node --test research-ide/tests/*.test.mjs
```

The legacy checkout retains its existing local notebook data. The desktop app
uses a separate data directory. The M03 storage decision will record whether
prototype notebook import is required.
