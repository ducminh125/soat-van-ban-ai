# Vercel Environment Diff v1.0.4.2 -> v1.0.4.3

## Keep
- OPENAI_API_KEY
- OPENAI_BASE_URL=https://api.shopaikey.com/v1
- SUPABASE variables
- UPSTASH variables

## Change
Replace:
OPENAI_QUALITY_MODEL=gpt-5.6-terra-ultra
OPENAI_LEGAL_MODEL=gpt-5.6-terra-ultra

With:
OPENAI_QUALITY_MODEL=gpt-5.6-terra
OPENAI_LEGAL_MODEL=gpt-5.6-terra

## Add
OPENAI_AUTO_FALLBACK=true
OPENAI_MODEL_HEALTH_CHECK=true
OPENAI_MAX_MODEL_FAILURE=1
OPENAI_MODEL_COOLDOWN_SECONDS=600

## Reason
Avoid ShopAIKey distributor 503 when an Ultra model has no available channel.
