# CDK Python

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure auth

1. Edit `config.json`.
2. Set `jwt_secret` to a long random secret.
3. For the simplest setup, set `password` to the exact login password you want.
4. If you prefer a hash instead, generate one with:

```bash
python generate_password_hash.py your-password
```

5. Paste the resulting Argon2 hash into `password_hash` and remove `password`.
6. Adjust `access_token_expire_minutes` as needed.
7. Set `llm.api_key` if you want queued vLLM/OpenAI-compatible calls.

The included `config.json` uses `changeme` as the default password.

## Run

```bash
python run.py
```

## Pipelines

Authenticated telemetry is available at `/api/pipelines`.

Routine task Python code receives a global `PIPELINES` helper:

```python
await PIPELINES.submit("gpu_heavy", "label", some_async_callable)
PIPELINES.telemetry()
```
