interface ComingSoonProps {
  module: string;
}

export function ComingSoon({ module }: ComingSoonProps) {
  return (
    <div className="ds-state">
      <span className="ds-state-code neutral">Em breve</span>
      <h1>Módulo {module}</h1>
      <p>Em breve</p>
    </div>
  );
}
