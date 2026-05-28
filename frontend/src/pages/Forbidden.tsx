export function Forbidden() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold text-red-600">403 — Acesso negado</h1>
      <p className="text-gray-500">Você não tem permissão para acessar esta página.</p>
    </div>
  );
}
