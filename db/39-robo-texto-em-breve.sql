-- Mensagem final do robô: "Em breve um atendente confirma com você" (antes era "Em instantes ...")
update whatsapp_robo
   set mensagem_final = replace(mensagem_final, 'Em instantes um atendente confirma com você', 'Em breve um atendente confirma com você')
 where mensagem_final like '%Em instantes um atendente confirma com você%';
update whatsapp_robo
   set fluxo = replace(fluxo::text, 'Em instantes um atendente confirma com você', 'Em breve um atendente confirma com você')::jsonb
 where fluxo::text like '%Em instantes um atendente confirma com você%';
