# Online Mimari

Tarayıcı (`index.html`) aynı Render servisi üzerindeki Node sunucusuna bağlanır.

API:
- GET /api/health
- POST /api/register
- POST /api/login
- GET /api/profile
- PUT /api/profile
- GET /api/goals
- POST /api/goals
- DELETE /api/goals/:id
- POST /api/goals/:id/board

Sunucu tarafında parola `scrypt` ile hashlenir. Oturum belirteci bellekte tutulur. Hedef kilidi sunucuda doğrulanır; kilitli hedef değiştirilemez veya silinemez.
