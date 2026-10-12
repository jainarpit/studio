# Explain a failed run

1. Read the run with `get_run_log`. Without a run id it returns the latest run.
2. Find the first step that failed. Later failures often follow from it.
3. Say what was sent, what came back, and which check failed: the status, the schema check, or a value a later step needed.
4. Suggest one fix, and say whether it belongs in the request, the server or the spec.
