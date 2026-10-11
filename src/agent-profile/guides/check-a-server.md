# Check a running server against its spec

1. Confirm the server's base URL with the developer, for example `http://localhost:8080`.
2. Run `check_contract` for the API against that URL. It skips operations that change data unless the developer asks for them.
3. Group the mismatches by operation.
4. For each one, say what came back, what the spec says, and whether the server or the spec looks wrong, and why.
5. If the spec file was changed while you worked, run `reload_spec` and check again.
