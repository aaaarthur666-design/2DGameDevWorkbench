export function GET() {
  return Response.json({
    ok: true,
    service: '2d-game-workbench-web',
    version: 1,
  });
}
