-- Robô: opções (menu, unidades, tipo de veículo, serviço, horário) vão como botões de ação no WhatsApp
alter table whatsapp_robo add column if not exists botoes boolean not null default true;
