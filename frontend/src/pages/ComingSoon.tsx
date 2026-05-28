interface ComingSoonProps {
  module: string;
}

export function ComingSoon({ module }: ComingSoonProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold text-gray-800">Módulo {module}</h1>
      <p className="text-gray-500">Em breve</p>
    </div>
  );
}
