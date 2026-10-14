# ADR 0009 — Senha temporária guardada criptografada até o primeiro acesso

**Status:** Aceito (14/10/2026) · **Itens:** BE-18 (complementa o SEC-01)

## Contexto
Analistas e clientes recebem, no cadastro, uma senha temporária aleatória (SEC-01), que precisa ser trocada no primeiro acesso. Até aqui ela aparecia uma única vez, na tela do cadastro, e não era guardada. Se a página recarregasse antes de o gestor (ou o analista, no caso do cliente) repassar a senha, ela se perdia, e não havia como recuperá-la sem cadastrar a pessoa de novo.

## Decisão
1. A senha temporária fica guardada na tabela `user_temp_passwords`, **criptografada** pela API (AES-256-GCM, vinculada ao id do usuário). A chave vem de `TEMP_PASSWORD_KEY` ou, sem ela, é derivada (HKDF) da chave de serviço do Supabase que a API já tem. A senha nunca fica em texto puro no banco nem nos logs.
2. Ela pode ser vista de novo (`GET /users/:id/temporary-password`) só enquanto a pessoa não criou a própria senha:
   - o gestor vê a de analistas e clientes da assessoria;
   - o analista vê a de clientes que ele cadastrou ou cujo processo é dele;
   - cliente não vê nenhuma.
3. Cada consulta fica registrada no `audit_logs` (`temp_password_viewed`), sem a senha.
4. Quando a pessoa troca a senha (primeiro acesso, convite ou "esqueci minha senha"), o registro é apagado e a API responde que a senha temporária não vale mais. Excluir o cliente também apaga o registro.
5. Para cadastros anteriores a esta decisão, ou quando a chave muda, a senha aparece como "não guardada" e é possível gerar outra (`POST /users/:id/temporary-password`, também auditado); a anterior deixa de funcionar.

## Consequências
- O gestor e o analista conseguem repassar o acesso a qualquer momento antes do primeiro login, sem recadastrar ninguém.
- O banco passa a conter, por pouco tempo, um segredo que dá acesso a uma conta. Isso é mitigado pela criptografia com chave fora do banco, pela exclusão no primeiro acesso, pela troca de senha obrigatória e pela auditoria de cada consulta.
- Trocar `TEMP_PASSWORD_KEY` ou a chave de serviço do Supabase torna ilegíveis as senhas guardadas. Elas passam a "não guardadas" e uma nova pode ser gerada; nenhum acesso é perdido.
