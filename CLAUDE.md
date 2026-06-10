# Task: stage:scan — Stage dispatch: scan
# Change: Spec workspace bootstrap

## Allowed Paths
- /data/spec-workspaces/992cedec-8d7e-47ec-85c7-1d778cca41eb
- /host-projects/WorkNew/SillyHub

## Denied Paths
- /host-projects/WorkNew/SillyHub/.sillyspec
- /host-projects/WorkNew/SillyHub/docs

## Profile
- **Strategy**: platform-managed
- **Profile version**: 0.1.0

## Available Tools
- **sillyspec**: Use `sillyspec init --dir <source_root>` to initialize spec space, then `sillyspec run scan --dir <source_root> --spec-root <spec_root>` to scan. Do NOT write .sillyspec files directly — always use the CLI.
