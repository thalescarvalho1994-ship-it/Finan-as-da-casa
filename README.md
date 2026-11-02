# Finanças da Casa

App do casal para controlar lançamentos, orçamento por categoria, contas a pagar e metas.
Funciona no navegador e pode ser instalado no celular como app. Os dados ficam no Supabase e
aparecem em tempo real nos dois celulares.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| `index.html`, `styles.css`, `app.js` | O app |
| `config.js` | Onde você cola os dados do seu Supabase |
| `manifest.webmanifest`, `sw.js`, `icons/` | Fazem o app ser instalável no celular |
| `supabase/schema.sql` | Cria as tabelas e as regras de segurança no banco |

## Passo 1: criar o banco no Supabase (uns 10 minutos)

1. Crie uma conta em supabase.com e clique em **New project**.
   Dê um nome (ex.: `financas-da-casa`), crie uma senha forte para o banco e escolha a região **South America (São Paulo)**.
2. Com o projeto pronto, abra **SQL Editor** no menu lateral, clique em **New query**,
   cole todo o conteúdo do arquivo `supabase/schema.sql` e clique em **Run**. Deve aparecer "Success".
3. Em **Authentication → Sign In / Providers → Email**, desligue **Confirm email** se quiser
   entrar sem precisar clicar no link de confirmação (mais simples para uso do casal).
4. Em **Project Settings → API**, copie:
   - **Project URL**
   - a chave **anon public**
5. Abra o arquivo `config.js` e cole esses dois valores no lugar de `COLE_AQUI...`.

A chave "anon" pode ficar pública no GitHub. Quem protege os dados são as regras de segurança
do banco: cada casa só enxerga os próprios lançamentos. Nunca coloque a chave `service_role` no app.

## Passo 2: publicar no GitHub Pages

1. No GitHub, clique em **New repository**, nome `financas-da-casa`, marque **Public** e crie.
2. Clique em **uploading an existing file** e arraste todos os arquivos e a pasta `icons`
   (a pasta `supabase` é opcional). Clique em **Commit changes**.
3. Vá em **Settings → Pages**. Em **Source**, escolha **Deploy from a branch**,
   branch **main**, pasta **/ (root)** e salve.
4. Em 1 ou 2 minutos aparece o endereço, algo como `https://SEU-USUARIO.github.io/financas-da-casa/`.
5. Volte ao Supabase em **Authentication → URL Configuration** e coloque esse endereço em **Site URL**.

## Passo 3: usar

1. Abra o endereço, toque em **Criar conta**, depois em **Criar nossa casa**.
2. Em **Ajustes** aparece o código de convite. Mande para a Bárbara.
3. Ela abre o mesmo endereço, cria a conta dela e toca em **Entrar com o código**.
4. Para instalar no celular:
   - **iPhone:** no Safari, Compartilhar → **Adicionar à Tela de Início**
   - **Android:** no Chrome, menu ⋮ → **Instalar app**

## Atualizar o app depois

Troque os arquivos no GitHub e aumente a versão na primeira linha útil do `sw.js`
(`financas-v1` → `financas-v2`) para os celulares pegarem a versão nova.
