# Next step: run the models on Kubernetes, one GPU, behind a login

```
you (browser / laptop) ──Tailscale──► Traefik (k3s ingress)
                                        │  ForwardAuth: "is this Supabase token valid?"
                                        ▼
                          ┌─────────────┴──────────────┐
                    chat model     model #2      model #3     ← one GPU, budgeted by
                    (vLLM)         (vLLM)        (vLLM)          time-slicing tokens +
                                                                 priorities
```

Goals: practise Kubernetes, and orchestrate several workloads on one GPU the way a production team with scarce GPUs would. Every service requires a Supabase login.

Background research: `gpu-node-bootstrap/reports/GPU model serving on k3s.md`.

## Decided

- GPU sharing through time-slicing (the device plugin advertises the one card as several units)

## Decisions still open

- Which three models share the GPU
- GPU memory budget per model (measure first)
- How the services authenticate (verifier service, rag-lab inside or outside the cluster)
- Swapping approach for models that don't fit together
