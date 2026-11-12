# Source drawings

| File | What it is | How the app uses it |
| --- | --- | --- |
| `lot-98-site-plan-2026-11-10.pdf` | Site plan for approval of **lot 98, Kibbutz Afikim** (house model E7), scale 1:100, dated 10.11.26. The owner's actual house. | Authoritative for wall positions, lot boundary, building line, parking bays, entry path and the furniture layout. |
| `E7-dimension-sheet-2026-11-08-mirror-twin.pdf` | E7 dimension drawing + site plan dated 8.11.26, drawn for the mirror-twin lot. | Source of every written dimension (wall chains, opening width / height / sill, room sizes). Lot 98 is its exact **north–south mirror**. |

Both are vector PDFs; the geometry in `src/core/plan.js` was measured from the vector data and is checked by `tests/plan.test.mjs`.
