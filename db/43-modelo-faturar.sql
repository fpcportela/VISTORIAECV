-- Modelos salvos também na tela Faturar cliente (fonte 'faturar')
alter table relatorio_modelos drop constraint if exists relatorio_modelos_fonte_check;
alter table relatorio_modelos add constraint relatorio_modelos_fonte_check check (fonte in ('vendas', 'financeiro', 'faturar'));
