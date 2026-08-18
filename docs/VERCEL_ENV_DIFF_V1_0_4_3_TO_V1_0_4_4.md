# Vercel Environment Diff v1.0.4.3 -> v1.0.4.4

## Giữ nguyên

- OPENAI_API_KEY
- OPENAI_BASE_URL=https://api.shopaikey.com/v1
- SUPABASE_*
- UPSTASH_*
- APP_ACCESS_CODE

## Khuyến nghị sửa

Tránh model không ổn định:
```
OPENAI_QUALITY_MODEL=gpt-5.6-terra
OPENAI_LEGAL_MODEL=gpt-5.6-terra
```

Không dùng mặc định:
```
gpt-5.6-terra-ultra
```

## Thêm mới

```
OPENAI_MODEL_SANITIZER=true
OPENAI_PROVIDER_GUARD=true
OPENAI_MODEL_AUTO_FALLBACK=true
OPENAI_MODEL_COOLDOWN_SECONDS=600
OPENAI_ALLOWED_MODELS=gpt-5.4-nano,gpt-5.6-terra
```
