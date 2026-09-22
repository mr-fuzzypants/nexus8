# Generative Backend: ComfyUI vs. nodegraph — Decision Doc

**Status:** Draft for decision. No direction chosen yet.
**Question:** What should drive generation for nexus8 — ComfyUI, the in-house
`nodegraph` engine (`/Users/robertpringle/development/nodegraph/`), or some
composition of the two?

This doc is deliberately critical. It exists to *avoid* a premature commitment,
not to justify one. Where I previously leaned "nodegraph-first," see
[§6](#6-walking-back-the-easy-answer) for why that lean was probably wrong.

---

## 1. Frame the decision around the product goal, not the tech

The "right" backend is entirely contingent on what we actually want users to do.
Three distinct goals point at three different answers:

| If the goal is… | The backend that wins | Why |
|---|---|---|
| **A. Generate with current SOTA models** (Flux, SD3.x, video, new ControlNets) inside nexus8 | **ComfyUI** | Ecosystem + model currency. Nothing in-house keeps pace. |
| **B. Orchestrate multi-step pipelines** (gen + LLM steps + human approval + durability) with assets flowing through | **nodegraph** | It's a general durable workflow engine; diffusion is one node category. |
| **C. Make generation a first-class, reproducible, versioned nexus8 concept** | Integration *depth* matters most → favors nodegraph, or nodegraph-orchestrating-ComfyUI | Lineage maps natively to nexus8's batch/pin model. |

**We have not stated which of A/B/C is the priority.** That is the actual
decision. Everything below is in service of making it.

---

## 2. What each system actually is

**ComfyUI** — a mature, single-purpose *diffusion execution* engine with a vast
community. Its value is the ecosystem: thousands of custom nodes, day-one
support for new model architectures, hardened VRAM/offload/tiling plumbing.

**nodegraph** — from the recon, this is **not primarily a diffusion engine**.
It's a general node-based *workflow/agent orchestration* framework: math/logic/
control-flow nodes, LLM agent nodes (pydantic-ai, langchain), human-input pause,
**DBOS-backed durable execution**, async topological scheduling — that *also*
ships a set of imaging nodes (KSampler, CheckpointLoader, VAE…). The diffusion
nodes look incidental to its real thesis, which is durable, inspectable,
possibly-agentic pipelines.

> This reframe is the most important thing in this doc. We are not comparing two
> diffusion engines. We are comparing a **diffusion engine** (ComfyUI) with a
> **general orchestration engine that has some diffusion nodes** (nodegraph).
> Treating nodegraph as a ComfyUI replacement plays to its weakness; treating it
> as an orchestrator plays to its strength.

---

## 3. The case FOR nodegraph (integration quality)

These are real and were validated in the recon:

- **No wrapper nodes.** Its storage layer (`python/nodegraph/core/storage/`) has
  a pluggable URI-scheme + codec registry (`file://`, `s3://`, `gs://`,
  `modal://`). A `nexus8://code@symlink` scheme makes *every* URI-taking node
  (`LoadImageNode`, `CheckpointLoaderNode`) bind to nexus8 unchanged. The
  "arbitrary-node binding" problem that forced custom port-nodes in ComfyUI
  simply doesn't exist here.
- **Reproducibility maps 1:1.** The saved-graph format already has a
  `dependencies` block (`server/serializers/graph_serializer.py`). Freezing
  `@approved` → `@v5` pins there is structurally identical to nexus8's
  `ContainerReference` pinning. A run *is* a nexus8 batch
  (`create_container_version`), so `reproduction_manifest()` works on outputs
  with no new model.
- **Shared frontend stack.** nodegraph UI and nexus8 web are both React 19 +
  Vite + xyflow + Zustand + Mantine. The asset browser can be a shared component
  (native, not iframed), and xyflow's `onDrop` + `screenToFlowPosition` give
  clean drag-to-create.
- **It could BE the job queue nexus8 lacks.** DBOS durability + async scheduler +
  human-input pause is exactly the missing async-generation infrastructure.

## 4. The case AGAINST nodegraph (be honest)

- **Model currency is a treadmill you'd own forever.** New architectures land in
  ComfyUI within days because thousands of people maintain it. nodegraph's
  imaging nodes will *always* lag, and closing the gap is *your* recurring cost,
  not a community's. If goal A matters at all, this is close to disqualifying.
- **Diffusion in production is 80% memory/perf plumbing** — VRAM management,
  model offload, tiled VAE, attention kernels, quantization, multi-GPU. ComfyUI
  has hardened this over years. **The recon did not establish that nodegraph
  does any of it.** (See open questions, §7.) The elegant integration optimizes
  the *cheap* part of the problem (the canvas, the URI plumbing) while leaving
  the *expensive* part (actually running big models well) unproven.
- **"You own both ends" cuts both ways.** You own every bug, every torch/diffusers
  version conflict, every OOM. That's a lot of surface for a solo/early project.
- **Maturity unknown.** Is the executor battle-tested? Single-user only? How does
  it behave under a 90-second generation that OOMs halfway? These are unanswered.

## 5. The case FOR / AGAINST ComfyUI

**For:** unmatched ecosystem and model currency; battle-tested execution; the
community absorbs the maintenance treadmill; if the goal is "generate good images
now," it's the lowest-risk path to capability.

**Against (the integration is genuinely brittle):**
- You're a *guest*: a `custom_nodes` plugin, a separate process/origin/lifecycle
  you don't control.
- The frontend extension API **drifts fast** — we already had to flag "verify
  against frontend version." Upgrades can break your sidebar/nodes.
- CORS, the API-format vs UI-format split, node-id fragility for any
  address-based binding.
- Reproducibility/lineage is bolted on from outside rather than native.

None of these are fatal; they're ongoing friction and a standing
maintenance liability tied to an upstream you don't steer.

---

## 6. Walking back the easy answer

Last discussion I leaned **"nodegraph is the first-class engine, ComfyUI is
import/interop."** I now think that was driven by *integration aesthetics* (the
`nexus8://` scheme is genuinely elegant) rather than by *capability*. The clean
integration is real but it solves the easy half. If the product needs current
models — and most generative products do — then making nodegraph the primary
diffusion engine signs you up for an open-ended model-parity treadmill to win a
race ComfyUI already won.

So discount the elegance. It should influence *how* we integrate the chosen
engine, not *which* engine generates.

---

## 7. Open questions that should gate the decision

These are unknowns the recon could not settle. **Answer these before committing**
— do not decide on architecture aesthetics alone:

1. **Does nodegraph actually run real diffusion well *today*?** Which model
   families? Flux/SD3/video? Or only SD1.5/SDXL toy paths?
2. **VRAM/offload/perf:** does it manage memory, or will a real workflow OOM?
3. **Is nodegraph's executor production-grade** — concurrency, failure recovery,
   multi-user? Or a single-user dev tool?
4. **Goal A/B/C:** which is the actual near-term product priority? (The whole
   decision pivots on this.)
5. **Maintenance appetite:** are we willing to chase model support indefinitely?

---

## 8. The synthesis option (probably the strongest)

It is **not** strictly either/or. The composition that plays each system to its
strength:

```
  nexus8  ──(assets, lineage, versioning)──►  nodegraph (orchestrator)
                                                   │
                                   ┌───────────────┼───────────────┐
                                   ▼               ▼               ▼
                            ComfyUINode      LLM/agent nodes   human-input
                         (submits to ComfyUI   (pydantic-ai)     (approval)
                          /prompt API)
```

- **nodegraph orchestrates** (durable, async, human-in-the-loop) and integrates
  cleanly with nexus8 via `nexus8://` + `dependencies` pinning.
- **ComfyUI is wrapped as a single `ComfyUINode`** inside nodegraph — you get its
  *entire* model ecosystem without owning the diffusion treadmill.
- **nexus8** stays the neutral asset/lineage hub feeding the whole chain.

**Cost / criticism of the synthesis:** three moving parts in the chain instead of
one. More failure modes, more to operate, and you still maintain a `ComfyUINode`
adapter (the same brittle ComfyUI API surface, just relocated). It's the most
*capable* option and the most *complex* one. Justified only if goal B or C is
real; overkill if goal A alone is the point.

---

## 9. Recommendation (conditional, not a decree)

- **If goal A dominates (generate with current models, soon):** ComfyUI as the
  engine. Integrate via the port-node + sidebar approach from prior discussion.
  Do *not* deep-integrate nodegraph's diffusion side. Cheapest path to real
  capability.
- **If goal B/C dominates (orchestration / first-class reproducible generation):**
  pursue the **synthesis** — nodegraph as orchestrator, ComfyUI wrapped as a
  node, nexus8 as hub. Accept the operational complexity as the price of not
  owning the model treadmill.
- **If undecided:** do the cheapest disambiguating experiment first — answer
  §7.1–7.3 by actually running a real (Flux/SDXL) workflow in nodegraph and
  watching VRAM + failure behavior. That single test likely settles A-vs-rest.

**Do not** make nodegraph the primary *diffusion* engine. Its value to nexus8 is
as an orchestrator/job layer, not as a from-scratch competitor to ComfyUI's model
support.

---

## 10. Scorecard

Rough, opinionated; 1–5 (5 best). Weights depend on goal (§1).

| Criterion | ComfyUI | nodegraph (as diffusion engine) | Synthesis |
|---|---|---|---|
| Model currency / ecosystem | 5 | 2 | 5 |
| Execution maturity (VRAM/perf) | 5 | ? (assume 2) | 5 |
| Integration cleanliness w/ nexus8 | 2 | 5 | 4 |
| Reproducibility / lineage fit | 2 | 5 | 5 |
| Orchestration (durable/agentic/human-in-loop) | 1 | 5 | 5 |
| Control / stability of the dependency | 2 | 5 | 3 |
| Maintenance burden (lower=better → higher score) | 4 | 2 | 2 |
| Time-to-first-demo | 4 | 3 | 2 |

The shape to notice: ComfyUI and nodegraph are nearly **inverse** profiles. That
inversion is precisely why the synthesis scores well on capability — and why it
pays for it in complexity and maintenance.
