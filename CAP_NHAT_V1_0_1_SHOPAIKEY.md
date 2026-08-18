# Cập nhật v1.0.1 — ShopAIKey

- Sửa lỗi 401 do v1.0 hard-code `https://api.openai.com/v1`.
- `OPENAI_BASE_URL` được sử dụng lại; mặc định là `https://api.shopaikey.com/v1`.
- `OPENAI_API_KEY` tiếp tục chứa API key ShopAIKey.
- Giữ cả Chat Completions và Responses API.
- Mặc định model ShopAIKey: `gpt-5.6-sol-ultra` cho lượt chất lượng/pháp lý và `gpt-5.6-terra-ultra` cho lượt cân bằng. Có thể ghi đè bằng biến môi trường trên Vercel.
- Lượt LEGAL vẫn sử dụng Responses API + tool web search. ShopAIKey công bố Responses API hỗ trợ `tools`/`tool_choice`; tuy nhiên khả năng built-in `web_search` cụ thể còn phụ thuộc tuyến model/key. Nếu provider trả lỗi tool, xem log Vercel để đổi cấu hình hoặc cơ chế fallback.
