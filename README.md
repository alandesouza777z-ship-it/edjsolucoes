# EDJ Controle Operacional

Sistema operacional EDJ preparado para autenticacao real com Supabase.

## Como abrir

Abra `index.html` no navegador.

O login usa o usuario cadastrado em Supabase Auth. O e-mail inicial configurado
e `admin@serralheria.com`; use a senha criada no painel do Supabase.

## O que existe nesta versao

- Login EDJ conectado ao Supabase Auth.
- Dashboard zerado quando nao houver dados.
- Clientes com ficha focada em historico de projetos/orcamentos.
- Orcamentos com base interna de calculo e proposta comercial separada.
- PDF via previa + impressao/salvar como PDF do navegador.
- Projetos/obras com resultado por obra.
- Financeiro com contas a receber, despesas e exportacao CSV.
- Controle de ponto com horas normais, extra 50% e extra 100%.
- Cadastro/edicao/exclusao de materiais, despesas, colaboradores, funcoes e usuarios.
- Busca automatica de dados por CNPJ via BrasilAPI quando houver internet.
- Materiais do orcamento preenchem unidade/preco pelo catalogo e preservam snapshot no orcamento.
- Relatorio de ponto em CSV e previa para impressao/salvar em PDF.
- Persistencia em Supabase por empresa via `company_app_state`, com RLS por `company_id`.

## Importante

Antes de publicar na Vercel, rode `../private-imports/supabase-cloud-state.sql`
no SQL Editor do Supabase.

O arquivo legado `imported-data.js` foi movido para `../private-imports/` para
nao expor dados reais no deploy.

A proxima evolucao tecnica e trocar a persistencia unica em `company_app_state`
por CRUD direto nas tabelas normalizadas ja criadas (`clients`, `quotes`,
`projects`, `receivables`, etc.).
