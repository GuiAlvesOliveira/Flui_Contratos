// DEV ONLY — remover antes da produção
// Para remover: deletar este arquivo e a linha <DevApiMenu /> em AppRouter.tsx
import { useState } from 'react';
import { api } from '../api/axiosInstance';

type Output = Record<string, unknown> | unknown[] | null;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-700 pt-3 mt-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</p>
      {children}
    </div>
  );
}

function Btn({
  onClick,
  color = 'blue',
  children,
}: {
  onClick: () => void;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
  children: React.ReactNode;
}) {
  const colors = {
    blue: 'bg-blue-600 hover:bg-blue-500',
    green: 'bg-green-700 hover:bg-green-600',
    red: 'bg-red-700 hover:bg-red-600',
    yellow: 'bg-yellow-600 hover:bg-yellow-500',
    purple: 'bg-purple-700 hover:bg-purple-600',
  };
  return (
    <button
      onClick={onClick}
      className={`${colors[color]} text-white text-xs font-medium px-3 py-1.5 rounded cursor-pointer`}
    >
      {children}
    </button>
  );
}

function Input({
  placeholder,
  value,
  onChange,
  type = 'text',
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type}
      className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-400"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function DevApiMenu() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<Output>(null);

  // POST /users form
  const [createForm, setCreateForm] = useState({
    email: '',
    cpf: '',
    name: '',
    surname: '',
    role: 'analista' as 'dono' | 'analista' | 'cliente',
  });

  // User ID actions
  const [userId, setUserId] = useState('');

  // PATCH /me/change-password
  const [newPassword, setNewPassword] = useState('');

  // PATCH /me/onboarding
  const [onboardingForm, setOnboardingForm] = useState({ name: '', surname: '', telefone: '' });

  // POST /users/bulk (raw JSON)
  const [bulkJson, setBulkJson] = useState(
    JSON.stringify(
      [
        { email: 'ana.silva@assessoria.com', name: 'Ana Silva', cpf: '11122233344', role: 'analista' },
        { email: 'carlos.lima@assessoria.com', name: 'Carlos Lima', cpf: '55566677788', role: 'analista' },
      ],
      null,
      2,
    ),
  );

  const call = async (fn: () => Promise<Output>) => {
    setLoading(true);
    setOutput(null);
    try {
      setOutput(await fn());
    } catch (err: unknown) {
      const e = err as { response?: { data: unknown }; message?: string };
      setOutput((e?.response?.data ?? e?.message ?? 'Erro desconhecido') as Output);
    } finally {
      setLoading(false);
    }
  };

  const isAnalista = createForm.role === 'analista';

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-50 bg-gray-900 text-yellow-400 text-xs font-bold px-3 py-2 rounded-full shadow-lg border border-yellow-500 cursor-pointer"
      >
        {open ? '✕ DEV' : '🛠 DEV'}
      </button>

      {open && (
        <div className="fixed bottom-14 right-4 z-50 w-96 max-h-[85vh] flex flex-col bg-gray-900 text-gray-100 rounded-xl shadow-2xl border border-gray-700 overflow-hidden">
          <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
            <span className="text-yellow-400 font-bold text-sm">DEV — API Phase 5</span>
            <span className="text-xs text-gray-500 ml-auto">só role dono vê isso</span>
          </div>

          <div className="overflow-y-auto px-4 py-3 flex-1 text-sm space-y-1">

            {/* GET /me */}
            <Section title="GET /me">
              <Btn color="blue" onClick={() => call(() => api.get('/me').then((r) => r.data))}>
                Ver meus dados
              </Btn>
            </Section>

            {/* GET /users */}
            <Section title="GET /users">
              <Btn color="blue" onClick={() => call(() => api.get('/users').then((r) => r.data))}>
                Listar todos
              </Btn>
            </Section>

            {/* POST /users */}
            <Section title="POST /users — criar usuário">
              <div className="space-y-2">
                <select
                  className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-400"
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      role: e.target.value as 'dono' | 'analista' | 'cliente',
                      email: '',
                      cpf: '',
                    }))
                  }
                >
                  <option value="analista">analista (CPF como senha)</option>
                  <option value="cliente">cliente (convite por email)</option>
                  <option value="dono">dono → deve 403 para gestor</option>
                </select>

                <Input
                  placeholder="email@exemplo.com"
                  value={createForm.email}
                  onChange={(v) => setCreateForm((f) => ({ ...f, email: v }))}
                />
                {isAnalista && (
                  <Input
                    placeholder="CPF — vira a senha inicial (só dígitos ou formatado)"
                    value={createForm.cpf}
                    onChange={(v) => setCreateForm((f) => ({ ...f, cpf: v }))}
                  />
                )}

                <Input
                  placeholder="Nome"
                  value={createForm.name}
                  onChange={(v) => setCreateForm((f) => ({ ...f, name: v }))}
                />
                <Input
                  placeholder="Sobrenome (opcional)"
                  value={createForm.surname}
                  onChange={(v) => setCreateForm((f) => ({ ...f, surname: v }))}
                />

                <Btn
                  color="green"
                  onClick={() =>
                    call(() => {
                      const body: Record<string, string> = {
                        email: createForm.email,
                        name: createForm.name,
                        role: createForm.role,
                      };
                      if (createForm.surname) body.surname = createForm.surname;
                      if (isAnalista) body.cpf = createForm.cpf;
                      return api.post('/users', body).then((r) => r.data);
                    })
                  }
                >
                  Criar usuário
                </Btn>

                {isAnalista && (
                  <p className="text-xs text-yellow-400">
                    ↳ Resposta inclui temporaryPassword (= dígitos do CPF)
                  </p>
                )}
              </div>
            </Section>

            {/* POST /users/bulk */}
            <Section title="POST /users/bulk">
              <p className="text-xs text-gray-500 mb-1">Array de usuários (JSON)</p>
              <textarea
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-400 h-24 resize-none"
                value={bulkJson}
                onChange={(e) => setBulkJson(e.target.value)}
              />
              <Btn
                color="purple"
                onClick={() =>
                  call(() => {
                    const users = JSON.parse(bulkJson) as unknown[];
                    return api.post('/users/bulk', { users }).then((r) => r.data);
                  })
                }
              >
                Criar em lote
              </Btn>
            </Section>

            {/* Ações por ID */}
            <Section title="Ações por User ID">
              <Input
                placeholder="UUID do usuário"
                value={userId}
                onChange={setUserId}
              />
              <div className="flex gap-2 flex-wrap mt-2">
                <Btn
                  color="blue"
                  onClick={() => call(() => api.get(`/users/${userId}`).then((r) => r.data))}
                >
                  GET /:id
                </Btn>
                <Btn
                  color="green"
                  onClick={() =>
                    call(() =>
                      api.patch(`/users/${userId}/activate`, { active: true }).then((r) => r.data),
                    )
                  }
                >
                  Ativar
                </Btn>
                <Btn
                  color="red"
                  onClick={() =>
                    call(() =>
                      api.patch(`/users/${userId}/activate`, { active: false }).then((r) => r.data),
                    )
                  }
                >
                  Desativar
                </Btn>
                <Btn
                  color="yellow"
                  onClick={() =>
                    call(() => api.post(`/users/${userId}/resend-invite`).then((r) => r.data))
                  }
                >
                  Reenviar convite
                </Btn>
              </div>
            </Section>

            {/* PATCH /me/change-password */}
            <Section title="PATCH /me/change-password">
              <p className="text-xs text-gray-500 mb-1">Testa troca de senha obrigatória</p>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Nova senha (mín. 8 chars)"
                  value={newPassword}
                  onChange={setNewPassword}
                />
                <Btn
                  color="purple"
                  onClick={() =>
                    call(() =>
                      api.patch('/me/change-password', { newPassword }).then((r) => r.data),
                    )
                  }
                >
                  Trocar senha
                </Btn>
              </div>
            </Section>

            {/* PATCH /me/onboarding */}
            <Section title="PATCH /me/onboarding">
              <div className="space-y-2">
                <Input
                  placeholder="Nome"
                  value={onboardingForm.name}
                  onChange={(v) => setOnboardingForm((f) => ({ ...f, name: v }))}
                />
                <Input
                  placeholder="Sobrenome"
                  value={onboardingForm.surname}
                  onChange={(v) => setOnboardingForm((f) => ({ ...f, surname: v }))}
                />
                <Input
                  placeholder="Telefone"
                  value={onboardingForm.telefone}
                  onChange={(v) => setOnboardingForm((f) => ({ ...f, telefone: v }))}
                />
                <Btn
                  color="green"
                  onClick={() =>
                    call(() =>
                      api
                        .patch('/me/onboarding', {
                          name: onboardingForm.name,
                          surname: onboardingForm.surname || undefined,
                          telefone: onboardingForm.telefone || undefined,
                        })
                        .then((r) => r.data),
                    )
                  }
                >
                  Completar onboarding
                </Btn>
              </div>
            </Section>

            {/* POST /tenants */}
            <Section title="POST /tenants (só admin)">
              <Btn
                color="yellow"
                onClick={() =>
                  call(() =>
                    api
                      .post('/tenants', { name: 'Tenant Teste', slug: `teste-${Date.now()}` })
                      .then((r) => r.data),
                  )
                }
              >
                Criar tenant teste → deve 403
              </Btn>
            </Section>
          </div>

          {/* Output */}
          <div className="border-t border-gray-700 bg-gray-950 px-3 py-2 max-h-52 overflow-y-auto">
            {loading && <p className="text-xs text-gray-400">Carregando...</p>}
            {!loading && output !== null && (
              <pre className="text-xs text-green-300 whitespace-pre-wrap break-all">
                {JSON.stringify(output, null, 2)}
              </pre>
            )}
            {!loading && output === null && (
              <p className="text-xs text-gray-600">Resultado aparece aqui</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
