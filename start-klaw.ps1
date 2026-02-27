$env:OPENCLAW_STATE_DIR = "$env:USERPROFILE\.klaw"
$env:OPENCLAW_CONFIG_PATH = "$env:USERPROFILE\.klaw\klaw.json"
node "$PSScriptRoot\openclaw.mjs" gateway run --port 19789
