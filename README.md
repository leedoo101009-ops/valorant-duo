# Duorant

실시간 발로란트 듀오 매칭 사이트.

- **Production:** https://duorant.com
- **Health check:** https://duorant.com/api/health
- **Stack:** Next.js, Supabase, Vercel, Riot / Discord 연동

## Getting Started

```bash
npm install
cp .env.example .env.local
# .env.local 에 키 채운 뒤
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

환경변수·Supabase Redirect URL 예시는 `.env.example` 하단 주석을 참고하세요.

## Deploy

Vercel에 연결해 배포합니다. 커스텀 도메인은 `duorant.com` 입니다.

배포 후 확인:

- https://duorant.com/api/health → `{"ok":true}`
- https://duorant.com/riot.txt → Riot 도메인 검증용 UUID
