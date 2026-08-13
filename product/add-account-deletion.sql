-- ────────────────────────────────────────────────────────────────────────────
--  add-account-deletion.sql — o atleta pode apagar a própria conta.
--
--  Exigência do RGPD, e o produto guarda dado de saúde (HRV, sono, dor, lesão,
--  ciclo menstrual), que é categoria especial — o caminho de exclusão não é
--  cortesia, é obrigação.
--
--  Nenhuma tabela nova: as 19 que referenciam `app.tenants` já têm
--  `on delete cascade`, então apagar a linha do tenant leva tudo junto. Deixar
--  a limpeza para o banco é o que garante que uma tabela criada no ano que vem
--  não fique para trás porque ninguém lembrou de somá-la a uma lista no código.
--
--  Falta só a permissão: app_writer podia inserir tenant (add-athlete-admin) e
--  atualizar a chave (add-athlete-signup), mas nunca apagar.
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant delete on app.tenants to app_writer';
  end if;
end $$;

-- Conferência: deve listar INSERT, SELECT, UPDATE e DELETE.
select privilege_type
  from information_schema.role_table_grants
 where table_schema = 'app' and table_name = 'tenants' and grantee = 'app_writer'
 order by privilege_type;
