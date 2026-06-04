---
'mermaid': minor
'@mermaid-js/layout-elk': minor
---

feat: expose `elk.nodePlacementAlignment` to configure Brandes-Koepf fixed alignment in ELK layout

ELK defaults Brandes-Koepf fixed alignment to `NONE`, preserving ELK's built-in alignment
selection. Set `elk.nodePlacementAlignment` to another supported value, such as `BALANCED`
or `RIGHTDOWN`, to opt into a fixed ELK alignment strategy.
