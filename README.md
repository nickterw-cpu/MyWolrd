# Central

O repositório contém a Central em duas versões:

- `central.html`: arquivo independente que funciona sem instalação e salva os dados no navegador do aparelho.
- `App.jsx`: fonte da versão web, executada com Vite, React e Supabase.

A versão web usa autenticação Google. Os dados são separados por usuário no Supabase, com políticas RLS; use o mesmo Google nos aparelhos em que deseja acessar os dados. A atualização entre aparelhos é manual pelo botão **Atualizar dados**.

## Dados iniciais e privacidade

A versão web não inclui mais registros de demonstração nem cópias de dados importados no código-fonte. Uma conta Supabase sem registros começa com listas de conteúdo vazias; os dados já salvos por uma conta são carregados normalmente e não são apagados por esta alteração. Para trazer dados, use **Configurações → Importar backup**.

## Rodar localmente

Requer Node.js 18 ou superior.

```sh
npm install
npm run dev
```

Abra a URL mostrada pelo Vite, normalmente `http://localhost:5173`.

## Configurar o Supabase

1. No painel do projeto, em **Project Settings → API**, copie a Project URL e a chave `anon`/publishable.
2. Copie `.env.example` para `.env.local` e preencha os valores:

   ```dotenv
   VITE_SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=sua_anon_ou_publishable_key
   ```

   A chave pública pode ser usada no navegador. Nunca coloque a `service_role` key neste arquivo nem em variáveis `VITE_`.

3. Crie a tabela e as políticas RLS. Aplique `supabase/migrations/20261010220000_create_central_user_data.sql` pelo **SQL Editor** do Supabase. A tabela permite que cada usuário autenticado leia e altere somente as próprias linhas.
4. Em **Authentication → Providers**, habilite Google e configure o OAuth Client ID e Client Secret obtidos no Google Cloud.
5. No Google Cloud, adicione como URI de redirecionamento autorizada a URL de callback mostrada pelo Supabase (formato `https://<project-ref>.supabase.co/auth/v1/callback`).
6. Em **Authentication → URL Configuration**, configure:
   - Site URL: a URL de produção da Vercel.
   - Redirect URLs: `http://localhost:5173/**` e a URL de produção, por exemplo `https://seu-app.vercel.app/**`.
7. Reinicie o servidor local depois de alterar `.env.local`.

## Importar os dados do `central.html`

Os dados do HTML independente estão no armazenamento local do navegador e não são enviados automaticamente ao Supabase.

1. Faça um backup em **Configurações → Exportar backup** no `central.html`, no navegador e aparelho em que seus dados estão salvos.
2. Acesse a aplicação web e entre com Google.
3. Em **Configurações → Importar backup**, selecione o arquivo JSON exportado.
4. Confirme que os dados aparecem na versão web e faça um novo backup. O arquivo `central.html` original não é alterado.

## Deploy na Vercel

1. Importe o repositório na Vercel usando sua conta GitHub.
2. Use o preset Vite, comando de build `npm run build` e diretório de saída `dist`.
3. Cadastre `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em **Settings → Environment Variables**.
4. Após o primeiro deploy, inclua a URL final da Vercel nas Redirect URLs do Supabase e configure-a como Site URL.
5. Faça um novo deploy após alterar variáveis de ambiente. A Vercel fará deploys automáticos nos próximos pushes para a branch conectada.

`vercel.json` já encaminha rotas da aplicação para `index.html`, evitando erros 404 ao recarregar a página.

## Verificações

```sh
npm run build
```

O `central.html` permanece como uma versão separada e não sincroniza automaticamente com o Supabase. A sincronização entre os aparelhos é feita pela versão web, usando a mesma conta Google.
