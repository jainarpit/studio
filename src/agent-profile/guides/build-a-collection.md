# Build a collection from a description

1. Map each step the developer described to an operation, with `search_operations` or `get_operation`.
2. Ask about anything the description leaves open, such as which server to use or what a step should send.
3. Create the collection with `create_collection` and add each step with `add_step`.
4. Link values between steps with `link_value` instead of hard-coding them.
5. Set `set_expected_status` on steps that are meant to fail.
6. Run it once with `run_collection` and show the result.
