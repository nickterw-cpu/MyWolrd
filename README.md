# Central

Central é um aplicativo pessoal para organizar tarefas, metas, hábitos, finanças e outras áreas da vida. Este repositório contém duas versões independentes:

- **Aplicação web** (`App.jsx`, `src/`): React e Vite no navegador, login Google e dados sincronizados manualmente pelo Supabase.
- **Arquivo independente** (`central.html`): funciona sem instalar o projeto e guarda os dados no armazenamento local do navegador. Não entra na conta Google nem sincroniza com o Supabase.

## Funcionalidades da aplicação web

A aplicação web reúne:

- Dashboard com widgets configuráveis.
- Tarefas, metas, hábitos e rotinas.
- Finanças, contas, cartões e investimentos.
- Notas, estudos, áreas de estudo e carreira.
- Procedimentos e autocuidado, visão de futuro e diário.
- Compras, casa, hobbies e desenvolvimento pessoal.
- Atalhos, páginas personalizadas e busca.
- Configurações de áreas, categorias, listas e aparência.
- Exportação e importação de backup em JSON.
- Instalação da aplicação web como PWA em celulares e computadores compatíveis.

A interface adapta os menus, formulários, filtros e listas para celular, tablet e computador. Áreas, status e categorias podem ser gerenciados nas próprias telas ou em **Configurações → Listas, categorias e status**; objetivos de investimentos também são editáveis na área de investimentos. As mudanças atualizam os formulários e filtros sem apagar os registros associados.

Lançamentos financeiros podem ser salvos automaticamente após informar um valor válido ou pelo botão **Salvar lançamento**. Eles permanecem sincronizados com a conta no Supabase e podem ser editados ou excluídos na lista. Em **Finanças → Planejamento**, é possível informar salário bruto, renda extra prevista, descontos, líquido esperado, dia de recebimento e limites por categoria em percentual ou valor fixo. Cada limite pode ser marcado como protegido para reservas e objetivos.

No painel mensal, somente entradas com status **pago** contam como renda recebida; a renda prevista não entra no saldo disponível. Saídas pagas são gastos realizados e saídas pendentes/agendadas são compromissos. Classifique cada saída como fixa, variável, recorrente, pontual, procedimento, hobby/lazer, transferência para reserva ou investimento. Reservas e investimentos são mostrados à parte do consumo; registre-os com a classificação correspondente para que o valor transferido não seja descontado novamente da meta protegida. O formulário também permite guardar o valor previsto original separado do valor real. Para despesas pendentes, a data é o vencimento; ao marcar como paga, atualize-a para a data efetiva do pagamento, se for diferente. O disponível é calculado com a renda recebida, os gastos de consumo, os compromissos pendentes, as transferências realizadas e as metas protegidas ainda não transferidas. Ao pagar um compromisso, atualize o mesmo lançamento para **pago** para que ele deixe de ser contado como pendente e passe a ser contado como gasto.

Esse é o primeiro estágio do planejamento financeiro. A integração da Wishlist, Procedimentos Estéticos e Hobbies, as previsões de cenários e os alertas proativos fazem parte das etapas seguintes. Os alertas nesta etapa são apenas avisos internos quando os compromissos, gastos e reservas excedem o dinheiro efetivamente recebido; o app não envia notificações em segundo plano.

## Instalar no celular

A aplicação web pode ser instalada como PWA quando acessada por HTTPS (ou em `localhost`):

- **Android:** abra a aplicação no Chrome e escolha **Instalar app** no aviso da Central ou no menu do navegador.
- **iPhone/iPad:** abra a aplicação no Safari, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**.
- No computador, navegadores compatíveis também oferecem a opção de instalação.

A interface, os ícones e as fontes Fraunces e Manrope são incluídos no build; o service worker guarda os arquivos da aplicação e mostra um aviso quando uma nova versão está pronta. A navegação usa o hash da URL (por exemplo, `#/financas`), então voltar no navegador retorna à página anterior.

O service worker disponibiliza os arquivos da interface sem rede, mas os dados da conta ainda precisam ser carregados do Supabase. Edição offline com sincronização posterior não está disponível nesta versão.

## Como os dados funcionam

1. A pessoa entra com uma conta Google. O Supabase Auth mantém a sessão.
2. Após o login, a aplicação carrega do Supabase os dados associados ao identificador dessa conta.
3. Cada área da aplicação é armazenada como um registro separado em `public.central_user_data`, com uma chave e um valor JSON.
4. Ao alterar os dados, a aplicação salva aquela área no Supabase. Se a conexão ou gravação falhar, mostra um aviso.
5. Os dados pertencem à conta Google usada para entrar. Para acessá-los em outro navegador ou aparelho, use a mesma conta e **Atualizar dados**.

O botão **Atualizar dados** busca os dados atuais do Supabase. A aplicação não mantém sincronização em tempo real entre abas ou dispositivos; se os mesmos dados forem alterados em mais de um lugar, atualize antes de continuar trabalhando.

### Segurança e privacidade

- A tabela usa políticas de segurança em nível de linha (RLS). Usuários autenticados podem ler, inserir, alterar e apagar somente linhas cujo `user_id` corresponda à própria sessão (`auth.uid()`).
- A chave `anon`/publishable é destinada ao uso no navegador; a RLS é o que restringe o acesso aos registros. **Nunca exponha uma chave `service_role`** no frontend, no repositório ou em variáveis com prefixo `VITE_`.
- A aplicação não contém cópias de dados pessoais nem registros de demonstração. Uma conta sem dados começa com as listas de conteúdo vazias; dados existentes não são removidos automaticamente.
- Apagar a tabela da Central não apaga as contas Google, o projeto Supabase nem as outras tabelas do projeto.

## Backups

### Exportar

Na aplicação web, entre em **Configurações → Exportar backup**. O navegador baixa `central-de-comando-backup.json`. Guarde o arquivo em local seguro; ele pode conter informações pessoais.

No `central.html`, exporte o backup nesse próprio arquivo e no mesmo navegador em que os dados locais estão guardados. Os dados desse HTML não são enviados ao Supabase automaticamente.

### Importar

Na aplicação web:

1. Entre com a conta Google que deve receber os dados.
2. Abra **Configurações → Importar backup** e escolha o arquivo JSON.
3. Aguarde a confirmação de que o backup foi salvo no Supabase.
4. Confira algumas áreas e faça uma nova exportação como cópia de segurança.

A importação valida o formato JSON e grava as áreas reconhecidas pelo aplicativo. Para cada área presente no arquivo, o conteúdo importado substitui o conteúdo atual daquela área. Áreas ausentes no arquivo não são apagadas. Para substituir completamente os dados de uma conta ou de todas as contas, faça primeiro uma limpeza explícita da tabela e só então importe o backup.

## Limpar todos os dados da Central

> **Atenção:** este procedimento exclui permanentemente os registros da Central de todos os usuários. Faça e confira um backup antes de executar. Ele não pode ser desfeito pelo aplicativo.

No painel do projeto correto do Supabase, abra **SQL Editor → New query**, execute:

```sql
BEGIN;
DELETE FROM public.central_user_data;
SELECT COUNT(*) AS registros_restantes
FROM public.central_user_data;
COMMIT;
```

O resultado da contagem deve ser `0`. Essa operação limpa apenas os dados da Central armazenados nessa tabela; não exclui contas, outros dados do projeto ou arquivos de backup no seu computador. Depois, entre novamente na aplicação e importe o backup.

## Executar localmente

Requisitos: Node.js 18 ou superior e npm.

```sh
npm install
```

Crie `.env.local` a partir do `.env.example` e configure as credenciais do Supabase, conforme a próxima seção. Depois execute:

```sh
npm run dev
```

Abra a URL indicada pelo Vite, normalmente `http://localhost:5173`.

Comandos disponíveis:

```sh
npm run dev      # servidor local de desenvolvimento
npm run build    # compilação de produção em dist/
npm run preview  # pré-visualização local da compilação
```

## Configurar Supabase e login Google

### Variáveis do Supabase

1. No painel Supabase, abra **Project Settings → API** e copie a Project URL e a chave `anon`/publishable.
2. Copie `.env.example` para `.env.local` e substitua os valores de exemplo:

   ```dotenv
   VITE_SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=sua_anon_ou_publishable_key
   ```

3. Reinicie o servidor Vite após alterar `.env.local`.

`.env.local` e outros arquivos `.env.*` estão ignorados pelo Git. Não os force para o repositório.

### Tabela e políticas de acesso

Aplique o arquivo `supabase/migrations/20261010220000_create_central_user_data.sql` pelo **SQL Editor** do Supabase. Ele cria a tabela `public.central_user_data`, a chave composta por usuário e categoria, ativa RLS e configura as políticas de acesso. A aplicação precisa dessa tabela para carregar e guardar os dados.

### Login Google e redirecionamentos

1. Em **Authentication → Providers**, habilite Google e informe o OAuth Client ID e Client Secret do Google Cloud.
2. No Google Cloud, configure como URI de redirecionamento autorizada a URL de callback apresentada pelo Supabase, normalmente `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Em **Authentication → URL Configuration**, configure:
   - **Site URL:** a URL pública da aplicação.
   - **Redirect URLs:** a URL local, por exemplo `http://localhost:5173/**`, e a URL de produção, por exemplo `https://seu-app.vercel.app/**`.

O provedor Google retorna primeiro ao Supabase; a URL de redirecionamento do Supabase é diferente da URL de callback do provedor no Google Cloud.

### Google Agenda (links secretos .ics)

A Central lê o Google Agenda **somente por links secretos .ics**. Não há OAuth da agenda: o login com Google pede apenas os escopos básicos (e-mail e perfil), então não aparece a tela de "app não verificado" por causa de dados da agenda.

Configuração (uma vez):

1. Aplique a migração `supabase/migrations/20261018000000_create_calendar_links.sql`. Ela cria `public.calendar_links`, que guarda os links secretos. A tabela tem RLS ativa e **nenhum acesso para `anon` ou `authenticated`**: só a Edge Function (papel `service_role`) lê e grava.
2. Opcional: aplique `supabase/migrations/20261018000100_drop_google_tokens.sql`, que remove a tabela `google_tokens` da antiga conexão OAuth.
3. Publique a Edge Function a partir da raiz do repositório:

   ```sh
   supabase functions deploy google-calendar
   ```

   Os secrets `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` **não são mais usados pela função** e podem ser removidos de **Edge Functions → Secrets**. O login Google continua usando o cliente OAuth configurado em **Authentication → Providers → Google**.

O `supabase/config.toml` desativa a validação JWT automática do gateway **somente para essa função**, para que o preflight CORS `OPTIONS` do navegador chegue ao handler. A função valida o token Bearer com `auth.getUser()` antes de qualquer operação; não remova essa validação.

Uso: em **Rotinas → Google Agenda → Gerenciar agendas**, cole os links secretos, um por linha. No Google Agenda (no computador): Configurações → escolha a agenda em "Configurações dos meus calendários" → **Integrar agenda** → copie o **Endereço secreto no formato iCal**.

Como funciona:

- A Edge Function (`add-link`) valida o endereço (somente `https://calendar.google.com/calendar/ical/.../basic.ics`), baixa o arquivo para confirmar que é uma agenda válida e salva o link em `calendar_links`. Links repetidos reaproveitam o mesmo registro. Há um limite de 30 agendas por conta.
- O navegador guarda só o `id` do registro, o nome, a cor e a cópia dos eventos. **O link nunca volta para o navegador e não entra nos backups.** Se você restaurar um backup em outra conta, as agendas aparecerão com erro: remova-as e cole os links de novo.
- Ao abrir o app, todas as agendas ativas são atualizadas em paralelo (`fetch-link`); a falha de uma não afeta as outras. Os eventos em cache permanecem consultáveis offline.
- Cada agenda tem cor própria e pode ser renomeada, escondida, atualizada ou removida. Remover apaga o link do servidor (`remove-link`) e não altera nada no Google Agenda.
- A tela junta os eventos das agendas ativas, com filtro por agenda. Eventos recorrentes são expandidos automaticamente.
- Dados de versões anteriores (um link único guardado dentro dos dados da agenda) são migrados para o servidor na primeira atualização. Agendas que vieram de conexão OAuth ou de arquivo .ics enviado deixam de existir; adicione-as por link.

Trate cada link como uma senha: quem o tiver lê aquela agenda. Se um link vazar, use **Redefinir** no mesmo lugar do Google Agenda onde você o copiou e cole o novo link.

Para o login Google: no Google Cloud, em **Google Auth Platform → Data Access**, deixe apenas os escopos `openid`, `email` e `profile` (remova `calendar.readonly`, se estiver lá) e, em **Audience**, publique o app em produção para que qualquer conta consiga entrar. Quem já tinha autorizado a agenda pode revogar o acesso em https://myaccount.google.com/permissions.

## Publicar na Vercel

1. Importe o repositório do GitHub na Vercel.
2. Use o preset Vite, o comando `npm run build` e o diretório de saída `dist`.
3. Em **Settings → Environment Variables**, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` para os ambientes de deploy necessários.
4. Inclua a URL de produção nas **Redirect URLs** do Supabase e configure-a como **Site URL**.
5. Faça deploy. Commits enviados para a branch conectada iniciam novos deploys automaticamente. Faça um novo deploy após alterar as variáveis de ambiente.

O arquivo `vercel.json` encaminha as rotas da aplicação para `index.html`, permitindo abrir e atualizar rotas da SPA sem erro 404.

## Estrutura do repositório

| Caminho | Finalidade |
| --- | --- |
| `App.jsx` | Aplicação principal e funcionalidades da Central |
| `src/main.jsx` | Inicialização da aplicação React |
| `src/AppShell.jsx` | Sessão, login Google e tela de autenticação |
| `src/lib/supabase.js` | Configuração do cliente Supabase |
| `src/lib/userData.js` | Leitura, gravação e cache de dados do usuário |
| `src/lib/localDate.js` | Formatação de datas no fuso local |
| `src/components/` | Avisos de atualização, instalação e notificações |
| `src/styles.css` | Estilos da aplicação web |
| `public/` | Ícones da aplicação instalável |
| `supabase/migrations/` | Tabelas e políticas RLS (dados da Central e links de agenda) |
| `supabase/functions/google-calendar/` | Salva links secretos .ics e busca as agendas no servidor |
| `central.html` | Versão independente, com dados locais no navegador |
| `vercel.json` | Reescrita das rotas SPA na Vercel |

## Verificação

Antes de publicar alterações, gere a compilação:

```sh
npm run build
```

O resultado de produção é criado em `dist/`. O build verifica a compilação do frontend; para validar persistência e login, também é necessário usar um projeto Supabase configurado.
