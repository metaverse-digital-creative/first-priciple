# Ingest Agent Wisdom

> "What did the inbox look like 5 minutes ago vs now?"

## Thinking Questions

1. **Did anything change since my last sync?** Only process deltas, never reprocess.
2. **Are there batch patterns?** 10 emails from the same sender in 5 minutes is probably a notification flood, not 10 urgent items.
3. **Is the API healthy?** If latency spikes, back off. Don't hammer a degraded service.
