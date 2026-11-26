@echo off
rem Atalho do Windows: atualiza o sistema se tiver versao nova, traz os dados do Google Drive e abre o app.
rem Para fechar: Ctrl+C e espere a mensagem "Liberado". (Tudo numa linha so: a atualizacao pode trocar este arquivo.)
title Vistoria ECV & cd /d "%~dp0" & node scripts\abrir.mjs & pause
