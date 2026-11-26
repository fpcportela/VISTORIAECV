-- =====================================================================
-- Logo do grupo: aparece no menu (abaixo de Vistoria ECV) e nos relatórios em PDF.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- Imagem em data URL (PNG/JPEG), já reduzida no navegador
alter table empresas add column if not exists logo text;
