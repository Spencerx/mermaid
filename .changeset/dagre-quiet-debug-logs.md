---
'mermaid': patch
---

fix(flowchart): stop dagre layout from spamming `warn`-level logs on every node/edge/cluster

The dagre cluster/graph helpers (`mermaid-graphlib.js`) emitted ~20 `log.warn`
tracing lines per node/edge/cluster (e.g. "Now next level", "Adjusted Graph",
several serializing the whole graph), and `edgeMarker` logged "Unknown arrow
type: none" once per edge without an arrowhead. On large diagrams that is
thousands of `warn` lines per render — enough to dominate render time when
anything (a dev tool, an app logger, DevTools) is capturing `console.warn`.

These are internal debug traces, not user-facing warnings: they are downgraded
to `log.debug` so they no longer fire at the default `warn` level, and `none`
(the valid "no arrowhead" value) no longer warns. No behavior change beyond log
volume.
