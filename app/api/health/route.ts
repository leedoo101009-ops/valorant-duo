// GET /api/health
// 배포 후 동작 확인용 — 민감정보 없이 ok만 반환
export async function GET() {
  return Response.json({
    ok: true,
    service: "valorant-duo",
  });
}
